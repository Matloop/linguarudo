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
        properties: { cue: { type: 'integer' }, source: STR, target: STR, lemma: STR, ipa: STR, pos: STR, meaning: STR, example: STR },
        required: ['cue', 'source', 'target', 'lemma', 'ipa', 'pos', 'meaning', 'example'],
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
- The request may list words the viewer is studying (target-language dictionary forms). When a cue contains a word whose translation is one of them, pick it first; those picks count toward the requested number, and new words fill the rest.

How to fill each annotation:
- cue: the number of the cue it belongs to.
- source: the word or expression copied character-for-character from that cue, same accents and capitalisation, whole words only (never part of a word). In the cue list, " / " marks a line break and is not part of the text.
- target: the translation in the target language as it would read in this sentence: matching gender, number, tense, person and capitalisation, so it can replace the source word in place. Use the natural equivalent, which may be more than one word (Portuguese "preciso" -> Italian "ho bisogno").
- lemma: the dictionary form of target, in lowercase: singular (masculine when the language inflects adjectives) for nouns and adjectives, infinitive for verbs, the whole expression for multi-word expressions (Italian "feste" -> "festa", "voglio" -> "volere", "ho bisogno" -> "avere bisogno").
- ipa: IPA pronunciation of target, between slashes.
- pos: part of speech of target, written in Portuguese and abbreviated (e.g. "subst. fem. plural", "verbo, 1ª p. sing. presente", "adj. masc.", "adv.", "expr.").
- meaning: short meaning in Portuguese (2 to 6 words).
- example: one short, natural sentence in the target language using target (or its base form).`;

export function buildUserMessage({ sourceLang, targetLang, density, texts, preferWords = [] }) {
  const words = texts.reduce((n, t) => n + countWords(t), 0);
  const want = Math.max(1, Math.round(density * words));
  const lines = texts.map((t, i) => `[${i + 1}] ${t.replace(/\s*\n\s*/g, ' / ')}`);
  const studying = preferWords.length > 0 ? `Words the viewer is studying (pick these first when they fit): ${preferWords.join(', ')}\n` : '';
  return `Source language: ${langName(sourceLang)} (${sourceLang})
Target language: ${langName(targetLang)} (${targetLang})
The batch has ${texts.length} cues and ${words} words. Pick about ${want} words (density ${density}).
${studying}
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

// Consulta de uma palavra/expressão clicada numa legenda que já está na língua-alvo.
export const LOOKUP_SCHEMA = {
  type: 'object',
  properties: { lemma: STR, ipa: STR, pos: STR, meaning: STR, translation: STR },
  required: ['lemma', 'ipa', 'pos', 'meaning', 'translation'],
  additionalProperties: false,
};

export const LOOKUP_SYSTEM = `You help a Brazilian Portuguese speaker learn a new language while watching films with subtitles in that language. The viewer selected a word or a multi-word expression in a subtitle line and wants to save it to study.

Fill:
- lemma: the dictionary form of the selection, lowercase (keep capitals only for proper nouns). Singular (masculine when the language inflects adjectives) for nouns and adjectives, infinitive for verbs. For an expression, its canonical form with the verb in the infinitive and pronouns/prepositions it normally takes: Italian "facevo finta di" -> "fare finta di", "ho bisogno" -> "avere bisogno di", "me ne vado" -> "andarsene". If the selection is an elided article or preposition ("dell'", "l'"), give its full form ("di", "il").
- ipa: IPA pronunciation of the lemma, between slashes.
- pos: part of speech of the lemma, in Portuguese, abbreviated ("subst. fem.", "verbo", "adj.", "adv.", "prep.", "expr.").
- meaning: the meaning in Brazilian Portuguese as used in this line, 1 to 6 words.
- translation: a natural Brazilian Portuguese translation of the whole subtitle line. In the line, " / " marks a line break.`;

export function buildLookupMessage({ lang, text, sentence }) {
  return `Language: ${langName(lang)} (${lang})
Subtitle line: ${String(sentence).replace(/\s*\n\s*/g, ' / ')}
Selection: ${text}`;
}

export const TRANSLATE_SCHEMA = {
  type: 'object',
  properties: { translation: STR },
  required: ['translation'],
  additionalProperties: false,
};

export const TRANSLATE_SYSTEM = `You translate one film subtitle line at a time for a language learner. Give a natural, faithful translation that keeps the register (slang stays slang). Do not explain or add notes. In the line, " / " marks a line break; keep it where it makes sense.`;

export function buildTranslateMessage({ sourceLang, targetLang, text }) {
  return `From ${langName(sourceLang)} (${sourceLang}) to ${langName(targetLang)} (${targetLang}):
${String(text).replace(/\s*\n\s*/g, ' / ')}`;
}

const isObj = (d) => d && typeof d === 'object' && !Array.isArray(d);

/** Repete uma vez quando a saída veio malformada (err.retryable). */
export async function retryMalformed(fn, wrap = (e) => e) {
  try {
    return await fn();
  } catch (err) {
    if (!err?.retryable) throw wrap(err);
    try {
      return await fn();
    } catch (err2) {
      throw wrap(err2);
    }
  }
}

/**
 * options: { model, effort, client } (client é injetável para testes)
 */
export function createClaudeProvider({ model = DEFAULT_MODEL, effort = DEFAULT_EFFORT, client } = {}) {
  // O SDK já repete 408/409/429/5xx/erros de conexão com backoff; maxRetries: 1 = uma nova tentativa.
  const anthropic = client ?? new Anthropic({ maxRetries: 1, timeout: 120_000 });
  const useFallback = FALLBACK_MODELS.has(model);
  const wrap = (err) => (err instanceof ProviderError ? err : new ProviderError(describe(err), { cause: err }));

  async function callJson({ system, user, schema, maxTokens, valid, what }) {
    const params = {
      model,
      max_tokens: maxTokens,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: user }],
      output_config: {
        format: { type: 'json_schema', schema },
        ...(effort ? { effort } : {}),
      },
      ...(useFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
    };
    const msg = await anthropic.beta.messages.create(params);

    if (msg.stop_reason === 'refusal') {
      throw new ProviderError(`Anthropic: o modelo recusou ${what}${msg.stop_details?.category ? ` (${msg.stop_details.category})` : ''}`);
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
    if (!valid(data)) throw Object.assign(new ProviderError('Anthropic: resposta fora do formato'), { retryable: true });
    return data;
  }

  return {
    name: 'claude',
    model,
    async annotate(req) {
      // Erros HTTP transitórios já foram repetidos pelo SDK; aqui só repetimos saída malformada.
      const data = await retryMalformed(
        () =>
          callJson({
            system: SYSTEM,
            user: buildUserMessage(req),
            schema: OUTPUT_SCHEMA,
            maxTokens: 16000,
            valid: (d) => Array.isArray(d?.annotations),
            what: 'o lote',
          }),
        wrap,
      );
      return groupByCue(data.annotations, req.texts.length);
    },
    async lookup(req) {
      return retryMalformed(
        () =>
          callJson({ system: LOOKUP_SYSTEM, user: buildLookupMessage(req), schema: LOOKUP_SCHEMA, maxTokens: 1000, valid: isObj, what: 'a consulta' }),
        wrap,
      );
    },
    async translate(req) {
      const data = await retryMalformed(
        () =>
          callJson({ system: TRANSLATE_SYSTEM, user: buildTranslateMessage(req), schema: TRANSLATE_SCHEMA, maxTokens: 1000, valid: isObj, what: 'a tradução' }),
        wrap,
      );
      return String(data.translation ?? '');
    },
  };
}
