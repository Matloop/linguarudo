import Anthropic from '@anthropic-ai/sdk';
import { langName } from '../lang.js';
import { countWords } from '@linguetta/language';
import { blendPlan } from '../blend/select.js';

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
        properties: { cue: { type: 'integer' }, source: STR, target: STR, lemma: STR, reading: STR, ipa: STR, pos: STR, meaning: STR, translatedLine: STR },
        required: ['cue', 'source', 'target', 'lemma', 'reading', 'ipa', 'pos', 'meaning', 'translatedLine'],
        additionalProperties: false,
      },
    },
  },
  required: ['annotations'],
  additionalProperties: false,
};

// Regras genéricas de lema e leitura, comuns ao blend e à consulta (ADR 0004: qualquer idioma).
const LEMMA_CASE = `Write it the way a dictionary of that language writes its headwords: lowercase, except where the spelling of the language requires capitals (German nouns: "Häuser" -> "Haus"; proper nouns: "Roma", "Tokyo").`;
const LEMMA_FORM = `Use the citation form of the language: the infinitive for verbs where the language has one (Italian "voglio" -> "volere", Spanish "quiero" -> "querer"), the singular for nouns (German "Kinder" -> "Kind"), the masculine singular for gendered adjectives (French "belles" -> "beau", Russian "новая" -> "новый"), the dictionary form for Japanese verbs and adjectives ("食べました" -> "食べる"), and so on. For languages without inflection (Chinese, Thai, Vietnamese...) return the word as is.`;
const READING = `the pronunciation in the script learners customarily use when the language is not written in the Latin alphabet: hiragana for Japanese ("食べる" -> "たべる"), pinyin with tone marks for Chinese ("学习" -> "xuéxí"), the standard romanization for Korean, Russian, Greek, Arabic, Hebrew, Hindi, Thai and similar. An empty string for languages written in the Latin alphabet.`;

/**
 * Prompt de sistema do blend. Só depende do par de idiomas e da língua nativa, então
 * continua estável entre os lotes do mesmo vídeo (cache de prompt).
 */
export function annotateSystem({ sourceLang, targetLang, nativeLanguage }) {
  const source = langName(sourceLang);
  const target = langName(targetLang);
  const native = langName(nativeLanguage);
  return `You help a speaker of ${native} learn ${target} while watching films. You receive a batch of numbered subtitle cues in ${source}. Some words in the cues will be replaced on screen by their ${target} translation, and the viewer can click them to see what they mean. Your job is to choose those words and translate them.

How to choose:
- The request says how many words to pick and in how many cues. The app later keeps only some of your picks, spread evenly through the film, so cover cues all over the batch (it is a target, not a hard rule; fewer is fine if the cues have little useful vocabulary).
- Prefer vocabulary a learner benefits from: nouns, verbs, adjectives, adverbs, and common multi-word expressions (Portuguese "de novo", English "give up", Spanish "por favor").
- Skip proper names, interjections and filler ("uh", "hum", "ah"), numbers, and words that are spelled the same in both languages (they teach nothing).
- Follow the request for how many words per cue. Several words of the same cue may be picked, even next to each other (Portuguese "casais casados" -> Italian "coppie sposate" is two annotations), as long as each one is worth learning.
- Do not pick overlapping spans in the same cue.
- The request may list words the viewer is studying (${target} dictionary forms). When a cue contains a word whose translation is one of them, pick it first; those picks count toward the requested number, and new words fill the rest.

How to fill each annotation:
- cue: the number of the cue it belongs to.
- source: the word or expression copied character-for-character from that cue, same accents and capitalisation, whole words only (never part of a word; in languages written without spaces, such as Japanese, Chinese or Thai, a complete word as a dictionary would segment it). In the cue list, " / " marks a line break and is not part of the text.
- target: the ${target} translation as it would read in this sentence: matching gender, number, tense, person and capitalisation, so it can replace the source word in place. Use the natural equivalent, which may be more than one word (Portuguese "preciso" -> Italian "ho bisogno", English "I need" -> German "ich brauche").
- lemma: the dictionary form of target. ${LEMMA_CASE} ${LEMMA_FORM} For a multi-word expression, the whole expression in its canonical form (Italian "ho bisogno" -> "avere bisogno").
- reading: for target, ${READING}
- ipa: IPA pronunciation of target, between slashes.
- pos: part of speech of target, written in ${native} and abbreviated the way ${native} dictionaries do (noun with gender and number, verb with person and tense, adjective, adverb, expression).
- meaning: short meaning in ${native} (2 to 6 words).
- translatedLine: the whole cue translated into natural ${target}, as a ${target} subtitle of the same scene would read, containing target. Translate the entire cue, not just the part around the word, and do not invent a new sentence. Write it on one line (drop the " / " line-break marks). Every annotation of the same cue has the same translatedLine.`;
}

// A IA propõe mais do que a cobertura pede (falas e palavras por fala): a escolha final
// (src/blend/select.js) precisa de alternativas para espaçar e preferir as melhores.
const OFFER = 1.5;

/** O pedido do lote: o mesmo alvo da escolha (blendPlan), com folga de OFFER. */
export function coverageRequest({ texts, sourceLang, wordCoverage }) {
  const plan = blendPlan({ texts, sourceLang, wordCoverage });
  const shown = `The app will show about ${plan.quota} of them (${Math.round(wordCoverage * 100)}% of the words) and keeps the best ones.`;
  if (!plan.perCue) {
    const cues = Math.min(texts.length, Math.max(1, Math.ceil(plan.quota * OFFER)));
    return `Pick one word in about ${cues} of the cues, spread over the whole batch. ${shown}`;
  }
  const share = Math.min(0.75, wordCoverage * OFFER);
  const total = Math.min(plan.words, Math.ceil(plan.quota * OFFER));
  const ten = Math.max(1, Math.round(10 * share));
  return `Pick words in every cue, in proportion to its length: about ${Math.round(share * 100)}% of each cue's words (a 10-word cue gets about ${ten}, a short cue at least 1), about ${total} words in total. ${shown}`;
}

export function buildUserMessage({ sourceLang, targetLang, nativeLanguage, wordCoverage, texts, preferWords = [] }) {
  const words = texts.reduce((n, t) => n + countWords(t, sourceLang), 0);
  const lines = texts.map((t, i) => `[${i + 1}] ${t.replace(/\s*\n\s*/g, ' / ')}`);
  const studying = preferWords.length > 0 ? `Words the viewer is studying (pick these first when they fit): ${preferWords.join(', ')}\n` : '';
  return `Source language: ${langName(sourceLang)} (${sourceLang})
Target language: ${langName(targetLang)} (${targetLang})
Viewer's native language: ${langName(nativeLanguage)} (${nativeLanguage})
The batch has ${texts.length} cues and ${words} words. ${coverageRequest({ texts, sourceLang, wordCoverage })}
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
  properties: { lemma: STR, reading: STR, ipa: STR, pos: STR, meaning: STR, translation: STR },
  required: ['lemma', 'reading', 'ipa', 'pos', 'meaning', 'translation'],
  additionalProperties: false,
};

export function lookupSystem({ lang, nativeLanguage }) {
  const target = langName(lang);
  const native = langName(nativeLanguage);
  return `You help a speaker of ${native} learn ${target} while watching films with ${target} subtitles. The viewer selected a word or a multi-word expression in a subtitle line and wants to save it to study.

Fill:
- lemma: the dictionary form of the selection. ${LEMMA_CASE} ${LEMMA_FORM} For an expression, its canonical form with the verb in the citation form and the pronouns/prepositions it normally takes (Italian "facevo finta di" -> "fare finta di", "me ne vado" -> "andarsene"; English "gave up on" -> "give up on"). If the selection is an elided article or preposition (Italian "dell'", French "l'"), give its full form ("di", "le").
- reading: for the lemma, ${READING}
- ipa: IPA pronunciation of the lemma, between slashes.
- pos: part of speech of the lemma, written in ${native} and abbreviated the way ${native} dictionaries do (noun with gender, verb, adjective, adverb, preposition, expression).
- meaning: the meaning in ${native} as used in this line, 1 to 6 words.
- translation: a natural ${native} translation of the whole subtitle line. In the line, " / " marks a line break.`;
}

export function buildLookupMessage({ lang, nativeLanguage, text, sentence }) {
  return `Language: ${langName(lang)} (${lang})
Viewer's native language: ${langName(nativeLanguage)} (${nativeLanguage})
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

export function buildTranslateMessage({ sourceLang, nativeLanguage, text }) {
  return `From ${langName(sourceLang)} (${sourceLang}) to ${langName(nativeLanguage)} (${nativeLanguage}):
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
            system: annotateSystem(req),
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
          callJson({ system: lookupSystem(req), user: buildLookupMessage(req), schema: LOOKUP_SCHEMA, maxTokens: 1000, valid: isObj, what: 'a consulta' }),
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
