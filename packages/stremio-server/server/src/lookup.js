// Modo "só língua-alvo": a legenda já está na língua que o usuário estuda.
//   POST /lookup    { lang, nativeLanguage, text, sentence } → { lemma, reading, ipa, pos, meaning, translation }
//   POST /translate { sourceLang, nativeLanguage, text, engine? } → { translation, engine }
//     engine "local" (padrão): OPUS-MT no próprio servidor (src/mt); sem rota local para o par
//     ou sem modelo instalado → 422 local_unavailable, e o cliente oferece a IA.
//     engine "ai": o provider (Claude / Claude Code / mock).
// Os dois ficam no cache em disco: a mesma fala/seleção não custa de novo.
import { lemmaKey } from '@linguetta/language';
import { HttpError } from './errors.js';
import { lookupKey } from './cache.js';
import { cleanLemma, requireLanguage, sameLanguage } from './lang.js';

export const MAX_SELECTION = 80;
export const MAX_SENTENCE = 500;
export const ENGINES = ['local', 'ai'];

const clean = (v) => (typeof v === 'string' ? v.normalize('NFC').trim() : '');
const oneLine = (v) => clean(v).replace(/\s+/g, ' ');

function body(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new HttpError(400, 'invalid_body', 'corpo deve ser um objeto JSON');
  return b;
}

function requireText(v, max, oneLineOnly) {
  const text = oneLineOnly ? oneLine(v) : clean(v);
  if (!text) throw new HttpError(400, 'empty_text', 'text vazio');
  if (text.length > max) throw new HttpError(400, 'text_too_long', `text com mais de ${max} caracteres`);
  return text;
}

export function parseLookupRequest(raw) {
  const b = body(raw);
  const lang = requireLanguage(b.lang, 'lang');
  const nativeLanguage = requireLanguage(b.nativeLanguage, 'nativeLanguage');
  const text = requireText(b.text, MAX_SELECTION, true);
  const sentence = clean(b.sentence).slice(0, MAX_SENTENCE);
  return { lang, nativeLanguage, text, sentence: sentence || text };
}

export function parseTranslateRequest(raw) {
  const b = body(raw);
  const sourceLang = requireLanguage(b.sourceLang, 'sourceLang');
  const nativeLanguage = requireLanguage(b.nativeLanguage, 'nativeLanguage');
  const text = requireText(b.text, MAX_SENTENCE, false);
  const engine = b.engine === undefined || b.engine === null ? 'local' : b.engine;
  if (!ENGINES.includes(engine)) throw new HttpError(400, 'invalid_engine', `engine deve ser ${ENGINES.map((e) => `"${e}"`).join(' ou ')}`);
  return { sourceLang, nativeLanguage, text, engine };
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * Limpa a resposta do provider. O lema mantém a caixa do dicionário ("Haus", "casa"); sem
 * lema, vale a seleção. Lema todo em maiúsculas desce para minúsculas só em escritas com caixa.
 */
export function validateLookup(text, raw, lang) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    lemma: cleanLemma(str(r.lemma, MAX_SELECTION) || text, lang, MAX_SELECTION),
    reading: str(r.reading, 120),
    ipa: str(r.ipa, 120),
    pos: str(r.pos, 60),
    meaning: str(r.meaning, 200),
    translation: str(r.translation, MAX_SENTENCE),
  };
}

function needs(provider, method) {
  if (typeof provider[method] !== 'function') throw new HttpError(501, 'not_supported', `provider ${provider.name} não suporta ${method}`);
}

async function cached(cache, key, compute) {
  const hit = cache ? await cache.get(key) : null;
  if (hit && typeof hit === 'object' && !Array.isArray(hit)) return { value: hit, cached: true };
  const value = await compute();
  if (cache) await cache.set(key, value).catch((e) => console.warn('[cache] falha ao gravar:', e.message));
  return { value, cached: false };
}

export async function lookup({ provider, cache }, req) {
  needs(provider, 'lookup');
  // A seleção entra pela lemmaKey: "Facevo" no começo da fala e "facevo" no meio dão o mesmo lema.
  const key = lookupKey('lookup', provider.name, provider.model, [req.lang, req.nativeLanguage, lemmaKey(req.text, req.lang), req.sentence]);
  const out = await cached(cache, key, async () => validateLookup(req.text, await provider.lookup(req), req.lang));
  return { result: out.value, cached: out.cached };
}

/**
 * Tradução da fala inteira para a língua nativa.
 * translator: tradutor local (src/mt/opus-mt.js) ou null; { name, model, revision?, available, route, translate }.
 */
export async function translate({ provider, translator = null, cache }, req) {
  const engine = req.engine ?? 'local';
  if (sameLanguage(req.sourceLang, req.nativeLanguage)) return { translation: req.text, engine, cached: false };
  const parts = [req.sourceLang, req.nativeLanguage, req.text];
  let key;
  let compute;
  if (engine === 'local') {
    if (!translator?.available || !translator.route(req.sourceLang, req.nativeLanguage)) {
      throw new HttpError(422, 'local_unavailable', `sem tradução local ${req.sourceLang}->${req.nativeLanguage}`);
    }
    const model = translator.revision ? `${translator.model}@${translator.revision}` : translator.model;
    key = lookupKey('translate-local', translator.name, model, parts);
    compute = async () => {
      try {
        return { translation: str(await translator.translate(req), MAX_SENTENCE * 2) };
      } catch (e) {
        throw new HttpError(500, 'local_error', `tradução local falhou: ${e.message}`);
      }
    };
  } else {
    needs(provider, 'translate');
    key = lookupKey('translate-ai', provider.name, provider.model, parts);
    compute = async () => ({ translation: str(await provider.translate(req), MAX_SENTENCE * 2) });
  }
  const out = await cached(cache, key, compute);
  return { translation: out.value.translation, engine, cached: out.cached };
}
