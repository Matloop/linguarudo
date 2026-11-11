// Modo "só língua-alvo": a legenda já está na língua que o usuário estuda.
//   POST /lookup    { lang, text, sentence }       → { lemma, ipa, pos, meaning, translation }
//   POST /translate { sourceLang, targetLang?, text } → { translation }
// Os dois ficam no cache em disco: a mesma fala/seleção não custa de novo.
import { HttpError } from './errors.js';
import { lookupKey } from './cache.js';
import { normalizeLang } from './lang.js';

export const MAX_SELECTION = 80;
export const MAX_SENTENCE = 500;

const clean = (v) => (typeof v === 'string' ? v.normalize('NFC').trim() : '');
const oneLine = (v) => clean(v).replace(/\s+/g, ' ');

function body(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new HttpError(400, 'corpo deve ser um objeto JSON');
  return b;
}

export function parseLookupRequest(raw) {
  const b = body(raw);
  const lang = normalizeLang(b.lang);
  if (!lang) throw new HttpError(400, 'lang inválido');
  const text = oneLine(b.text);
  if (!text) throw new HttpError(400, 'text vazio');
  if (text.length > MAX_SELECTION) throw new HttpError(400, `text com mais de ${MAX_SELECTION} caracteres`);
  const sentence = clean(b.sentence).slice(0, MAX_SENTENCE);
  return { lang, text, sentence: sentence || text };
}

export function parseTranslateRequest(raw) {
  const b = body(raw);
  const sourceLang = normalizeLang(b.sourceLang);
  if (!sourceLang) throw new HttpError(400, 'sourceLang inválido');
  const targetLang = b.targetLang === undefined ? 'pt' : normalizeLang(b.targetLang);
  if (!targetLang) throw new HttpError(400, 'targetLang inválido');
  const text = clean(b.text);
  if (!text) throw new HttpError(400, 'text vazio');
  if (text.length > MAX_SENTENCE) throw new HttpError(400, `text com mais de ${MAX_SENTENCE} caracteres`);
  return { sourceLang, targetLang, text };
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Limpa a resposta do provider. O lema cai na seleção (minúscula) quando vem vazio. */
export function validateLookup(text, raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const lemma = (str(r.lemma, MAX_SELECTION) || text).replace(/\s+/g, ' ');
  return {
    lemma: lemma === lemma.toUpperCase() ? lemma.toLowerCase() : lemma,
    ipa: str(r.ipa, 120),
    pos: str(r.pos, 60),
    meaning: str(r.meaning, 200),
    translation: str(r.translation, MAX_SENTENCE),
  };
}

function needs(provider, method) {
  if (typeof provider[method] !== 'function') throw new HttpError(501, `provider ${provider.name} não suporta ${method}`);
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
  // A seleção entra minúscula na chave: "Facevo" no começo da fala e "facevo" no meio dão o mesmo lema.
  const key = lookupKey('lookup', provider.name, provider.model, [req.lang, req.text.toLowerCase(), req.sentence]);
  const out = await cached(cache, key, async () => validateLookup(req.text, await provider.lookup(req)));
  return { result: out.value, cached: out.cached };
}

export async function translate({ provider, cache }, req) {
  needs(provider, 'translate');
  if (req.sourceLang === req.targetLang) return { translation: req.text, cached: false };
  const key = lookupKey('translate', provider.name, provider.model, [req.sourceLang, req.targetLang, req.text]);
  const out = await cached(cache, key, async () => ({ translation: str(await provider.translate(req), MAX_SENTENCE * 2) }));
  return { translation: out.value.translation, cached: out.cached };
}
