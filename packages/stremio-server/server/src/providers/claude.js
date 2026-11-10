import Anthropic from '@anthropic-ai/sdk';
import { langName } from '../lang.js';
import { countWords } from '../words.js';
import { MAX_PER_CUE } from '../validate.js';

export const DEFAULT_MODEL = 'claude-haiku-5-5';
// effort só é enviado quando definido em LINGOBLEND_EFFORT (ex.: 'low' para Opus/Sonnet).
export const DEFAULT_EFFORT = '';

// Modelos que aceitam o fallback server-side em caso de recusa (beta server-side-fallback-2026-07-01).
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5', 'claude-fable-5-1', 'claude-fable-5-2']);

export class ProviderError extends Error {
  constructor(message, { status = 502, cause } = {}) {
    super(message, { cause });
    this.status = status;
  }
}

const STR = { type: 'string' };
export const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    annotations: {
      type: 'array',
      items: {
        type: 'object',
        properties: { cue: { type: 'integer' }, source: STR, target: STR, ipa: STR, pos: STR, meaning: STR, example: STR },
        required: ['cue', 'source', 'target', 'ipa', 'pos', 'meaning', 'example'],
        additionalProperties: false,
      },
    },
  },
  required: ['annotations'],
  additionalProperties: false,
};

// Prompt fixo (sem nada variável) para aproveitar o cache de prompt entre lotes.
export const SYSTEM = `You help a Brazilian Portuguese speaker learn a new language while watching films. You receive a batch of numbered subtitle cues in a source language. Some words in the cues will be replaced on screen by their translation in the target language, and the viewer can click them to see what they mean. Your job is to choose those words and translate them.

How to choose:
- Pick roughly the number of words requested for the batch (it is a target, not a hard rule; fewer is fine if the cues have little useful vocabulary).
- Prefer vocabulary a learner benefits from: nouns, verbs, adjectives, adverbs, and common multi-word expressions ("de novo", "por favor").
- Skip proper names, interjections and filler ("ah", "hum", "ei"), numbers, and words that are spelled the same in both languages (they teach nothing).
- Spread choices across the batch. At most ${MAX_PER_CUE} per cue; many cues should have none.
- Do not pick overlapping spans in the same cue.

How to fill each annotation:
- cue: the number of the cue it belongs to.
- source: the word or expression copied character-for-character from that cue, same accents and capitalisation, whole words only (never part of a word). In the cue list, " / " marks a line break and is not part of the text.
- target: the translation in the target language as it would read in this sentence: matching gender, number, tense, person and capitalisation, so it can replace the source word in place. Use the natural equivalent, which may be more than one word (Portuguese "preciso" -> Italian "ho bisogno").
- ipa: IPA pronunciation of target, between slashes.
- pos: part of speech of target, written in Portuguese and abbreviated (e.g. "subst. fem. plural", "verbo, 1ª p. sing. presente", "adj. masc.", "adv.", "expr.").
- meaning: short meaning in Portuguese (2 to 6 words).
- example: one short, natural sentence in the target language using target (or its base form).`;

export function buildUserMessage({ sourceLang, targetLang, density, texts }) {
  const words = texts.reduce((n, t) => n + countWords(t), 0);
  const want = Math.max(1, Math.round(density * words));
  const lines = texts.map((t, i) => `[${i + 1}] ${t.replace(/\s*\n\s*/g, ' / ')}`);
  return `Source language: ${langName(sourceLang)} (${sourceLang})
Target language: ${langName(targetLang)} (${targetLang})
The batch has ${texts.length} cues and ${words} words. Pick about ${want} words (density ${density}).

Cues:
${lines.join('\n')}`;
}

function describe(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'Anthropic: autenticação falhou (confira ANTHROPIC_API_KEY)';
  if (err instanceof Anthropic.PermissionDeniedError) return 'Anthropic: sem permissão para este modelo/recurso';
  if (err instanceof Anthropic.NotFoundError) return 'Anthropic: modelo não encontrado (confira LINGOBLEND_MODEL)';
  if (err instanceof Anthropic.BadRequestError) return `Anthropic: requisição inválida: ${err.message}`;
  if (err instanceof Anthropic.RateLimitError) return 'Anthropic: limite de requisições atingido, tente de novo em instantes';
  if (err instanceof Anthropic.APIConnectionError) return 'Anthropic: falha de conexão';
  if (err instanceof Anthropic.APIError) return `Anthropic: erro ${err.status ?? ''} ${err.message}`.trim();
  return `Anthropic: ${err?.message ?? String(err)}`;
}

/** Converte a lista [{cue: 1-based, ...}] em um array por índice de cue. */
export function groupByCue(raw, count) {
  const perIndex = Array.from({ length: count }, () => []);
  for (const a of raw) {
    const i = Number(a?.cue) - 1;
    if (Number.isInteger(i) && i >= 0 && i < count) perIndex[i].push(a);
  }
  return perIndex;
}

/**
 * options: { model, effort, client } (client é injetável para testes)
 */
export function createClaudeProvider({ model = DEFAULT_MODEL, effort = DEFAULT_EFFORT, client } = {}) {
  // O SDK já repete 408/409/429/5xx/erros de conexão com backoff; maxRetries: 1 = uma nova tentativa.
  const anthropic = client ?? new Anthropic({ maxRetries: 1, timeout: 120_000 });
  const useFallback = FALLBACK_MODELS.has(model);

  async function callOnce(req) {
    const params = {
      model,
      max_tokens: 16000,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: buildUserMessage(req) }],
      output_config: {
        format: { type: 'json_schema', schema: OUTPUT_SCHEMA },
        ...(effort ? { effort } : {}),
      },
      ...(useFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
    };
    const msg = await anthropic.beta.messages.create(params);

    if (msg.stop_reason === 'refusal') {
      throw new ProviderError(`Anthropic: o modelo recusou o lote${msg.stop_details?.category ? ` (${msg.stop_details.category})` : ''}`);
    }
    if (msg.stop_reason === 'max_tokens') {
      throw Object.assign(new ProviderError('Anthropic: resposta cortada em max_tokens'), { retryable: true });
    }
    const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    let data;
    try {
      data = JSON.parse(text);
    } catch (cause) {
      throw Object.assign(new ProviderError('Anthropic: resposta não é JSON válido', { cause }), { retryable: true });
    }
    if (!Array.isArray(data?.annotations)) {
      throw Object.assign(new ProviderError('Anthropic: resposta sem "annotations"'), { retryable: true });
    }
    return data.annotations;
  }

  return {
    name: 'claude',
    model,
    async annotate(req) {
      let raw;
      try {
        raw = await callOnce(req);
      } catch (err) {
        // Erros HTTP transitórios já foram repetidos pelo SDK; aqui só repetimos saída malformada.
        if (!err?.retryable) throw err instanceof ProviderError ? err : new ProviderError(describe(err), { cause: err });
        try {
          raw = await callOnce(req);
        } catch (err2) {
          throw err2 instanceof ProviderError ? err2 : new ProviderError(describe(err2), { cause: err2 });
        }
      }
      return groupByCue(raw, req.texts.length);
    },
  };
}
