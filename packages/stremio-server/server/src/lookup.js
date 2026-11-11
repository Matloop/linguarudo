// Modo "só língua-alvo": a legenda já está na língua que o usuário estuda.
//   POST /lookup    { lang, nativeLanguage, text, sentence } → { lemma, reading, ipa, pos, meaning, translation }
//   POST /translate { sourceLang, nativeLanguage, text }     → { translation }
// Os dois ficam no cache em disco: a mesma fala/seleção não custa de novo.
import { lemmaKey } from '@linguetta/language';
import { HttpError } from './errors.js';
import { lookupKey } from './cache.js';
import { cleanLemma, requireLanguage, sameLanguage } from './lang.js';

export const MAX_SELECTION = 80;
export const MAX_SENTENCE = 500;

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
  return { sourceLang, nativeLanguage, text };
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

export async function translate({ provider, cache }, req) {
  needs(provider, 'translate');
  if (sameLanguage(req.sourceLang, req.nativeLanguage)) return { translation: req.text, cached: false };
  const key = lookupKey('translate', provider.name, provider.model, [req.sourceLang, req.nativeLanguage, req.text]);
  const out = await cached(cache, key, async () => ({ translation: str(await provider.translate(req), MAX_SENTENCE * 2) }));
  return { translation: out.value.translation, cached: out.cached };
}
