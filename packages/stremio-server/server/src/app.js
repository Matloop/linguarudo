import { createServer } from 'node:http';
import { cacheKey } from './cache.js';
import { HttpError } from './errors.js';
import { lookup, parseLookupRequest, parseTranslateRequest, translate } from './lookup.js';
import { lemmaKey } from '@linguetta/language';
import { requireLanguage, sameLanguage } from './lang.js';
import { validateBatch } from './validate.js';

export const MAX_BODY = 2 * 1024 * 1024;
export const MAX_CUES = 500;
export const DEFAULT_DENSITY = 0.1;
export const MAX_PREFER_WORDS = 1000;

export { HttpError };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function send(res, status, body) {
  const data = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    ...CORS,
    ...(data ? { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data) } : {}),
  });
  res.end(data);
}

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (declared > limit) return reject(new HttpError(413, 'body_too_large', `corpo maior que ${limit} bytes`));
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'body_too_large', `corpo maior que ${limit} bytes`));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req, limit) {
  try {
    return JSON.parse(await readBody(req, limit));
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, 'invalid_json', 'JSON inválido');
  }
}

/** Valida e normaliza o corpo de POST /annotate. */
export function parseAnnotateRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'invalid_body', 'corpo deve ser um objeto JSON');
  const sourceLang = requireLanguage(body.sourceLang, 'sourceLang');
  const targetLang = requireLanguage(body.targetLang, 'targetLang');
  const nativeLanguage = requireLanguage(body.nativeLanguage, 'nativeLanguage');
  let density = body.density === undefined ? DEFAULT_DENSITY : Number(body.density);
  if (!Number.isFinite(density) || density < 0 || density > 1) throw new HttpError(400, 'invalid_density', 'density deve estar entre 0 e 1');
  density = Math.round(density * 1000) / 1000;
  if (!Array.isArray(body.cues)) throw new HttpError(400, 'invalid_cues', 'cues deve ser uma lista');
  if (body.cues.length > MAX_CUES) throw new HttpError(400, 'too_many_cues', `no máximo ${MAX_CUES} cues por requisição`);
  const cues = body.cues.map((c, i) => {
    const id = typeof c?.id === 'number' ? String(c.id) : c?.id;
    if (typeof id !== 'string' || !id) throw new HttpError(400, 'invalid_cues', `cues[${i}].id inválido`);
    if (typeof c.text !== 'string') throw new HttpError(400, 'invalid_cues', `cues[${i}].text inválido`);
    return { id, text: c.text };
  });
  const preferWords = parsePreferWords(body.preferWords, targetLang);
  return { sourceLang, targetLang, nativeLanguage, density, cues, preferWords };
}

/**
 * Lemas (língua-alvo) que o usuário está aprendendo. A caixa fica como veio ("Haus"); duplicatas
 * saem pela lemmaKey do idioma (fica a primeira) e a lista vai ordenada pela chave (cache estável).
 */
function parsePreferWords(raw, lang) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new HttpError(400, 'invalid_prefer_words', 'preferWords deve ser uma lista');
  if (raw.length > MAX_PREFER_WORDS) throw new HttpError(400, 'too_many_prefer_words', `no máximo ${MAX_PREFER_WORDS} preferWords`);
  const byKey = new Map();
  for (const w of raw) {
    if (typeof w !== 'string') continue;
    const v = w.normalize('NFC').trim().replace(/\s+/g, ' ');
    if (!v || v.length > 80) continue;
    const key = lemmaKey(v, lang);
    if (!byKey.has(key)) byKey.set(key, v);
  }
  return [...byKey.keys()].sort().map((k) => byKey.get(k));
}

/**
 * Lógica de anotação, independente de HTTP.
 * provider: { name, model, annotate({ sourceLang, targetLang, nativeLanguage, density, texts, preferWords }) -> Array<raw[]> }
 * cache: { get(key), set(key, annotationsByIndex) } ou null
 */
export async function annotate({ provider, cache }, req) {
  const { sourceLang, targetLang, nativeLanguage, density, cues, preferWords = [] } = req;
  const texts = cues.map((c) => c.text);
  let byIndex = null;
  let cached = false;

  if (sameLanguage(sourceLang, targetLang) || density === 0 || texts.every((t) => !t.trim())) {
    byIndex = texts.map(() => []);
  } else {
    const key = cacheKey({ provider: provider.name, model: provider.model, sourceLang, targetLang, nativeLanguage, density, texts, preferWords });
    byIndex = cache ? await cache.get(key) : null;
    if (Array.isArray(byIndex) && byIndex.length === texts.length) {
      cached = true;
    } else {
      const raw = await provider.annotate({ sourceLang, targetLang, nativeLanguage, density, texts, preferWords });
      byIndex = validateBatch(texts, raw, { sourceLang, targetLang });
      if (cache) await cache.set(key, byIndex).catch((e) => console.warn('[cache] falha ao gravar:', e.message));
    }
  }

  const annotations = {};
  cues.forEach((c, i) => {
    if (byIndex[i]?.length) annotations[c.id] = byIndex[i];
  });
  return { provider: provider.name, annotations, cached };
}

/** Código estável do erro: o do HttpError, provider_error para falha do provider, internal no resto. */
function errorCode(err, status) {
  if (err.code && typeof err.code === 'string' && err instanceof HttpError) return err.code;
  if (status === 502 || status === 504) return 'provider_error';
  return status >= 500 ? 'internal' : 'bad_request';
}

/**
 * translator: tradutor local (src/mt/opus-mt.js) ou null; sem ele, /translate local dá 422.
 * dictionaries: dicionários locais (src/dict/wiktionary.js) ou null; sem eles, /lookup local
 * responde found: false (só com as traduções locais).
 */
export function createApp({ provider, translator = null, dictionaries = null, cache = null, log = console }) {
  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'OPTIONS') return send(res, 204);
      if (url.pathname === '/health') {
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method_not_allowed', 'use GET');
        const mt = translator?.available
          ? { available: true, model: translator.model }
          : { available: false, model: null, ...(translator?.reason ? { reason: translator.reason } : {}) };
        const dict = { languages: dictionaries?.status() ?? {}, ...(dictionaries?.reason ? { reason: dictionaries.reason } : {}) };
        return send(res, 200, { ok: true, provider: provider.name, model: provider.model, mt, dict });
      }
      if (url.pathname === '/lookup' || url.pathname === '/translate') {
        if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed', 'use POST');
        const body = await readJson(req, 64 * 1024);
        const t0 = Date.now();
        if (url.pathname === '/lookup') {
          const parsed = parseLookupRequest(body);
          const out = await lookup({ provider, translator, dictionaries, cache }, parsed);
          const by = parsed.engine === 'local' ? `local${out.result.found ? '' : ' sem verbete'}` : provider.name;
          log.info?.(`[lookup] ${parsed.lang}/${parsed.nativeLanguage} ${parsed.engine} "${parsed.text}" → ${out.result.lemma}, ${out.cached ? 'cache' : by} ${Date.now() - t0}ms`);
          return send(res, 200, out.result);
        }
        const parsed = parseTranslateRequest(body);
        const out = await translate({ provider, translator, cache }, parsed);
        const by = parsed.engine === 'local' ? translator?.name : provider.name;
        log.info?.(`[translate] ${parsed.sourceLang}->${parsed.nativeLanguage} ${parsed.engine}, ${out.cached ? 'cache' : by} ${Date.now() - t0}ms`);
        return send(res, 200, { translation: out.translation, engine: out.engine });
      }
      if (url.pathname === '/annotate') {
        if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed', 'use POST');
        const body = await readJson(req);
        const parsed = parseAnnotateRequest(body);
        const t0 = Date.now();
        const out = await annotate({ provider, cache }, parsed);
        const n = Object.values(out.annotations).reduce((s, a) => s + a.length, 0);
        log.info?.(
          `[annotate] ${parsed.sourceLang}->${parsed.targetLang} ${parsed.cues.length} cues, ${n} anotações, ` +
            `${out.cached ? 'cache' : provider.name} ${Date.now() - t0}ms`,
        );
        return send(res, 200, { provider: out.provider, annotations: out.annotations });
      }
      throw new HttpError(404, 'not_found', 'não encontrado');
    } catch (err) {
      const status = err.status ?? 500;
      if (status >= 500) log.error?.(`[error] ${req.method} ${url.pathname}:`, err.message, err.cause?.message ?? '');
      if (!res.headersSent) send(res, status, { error: err.message || 'erro interno', code: errorCode(err, status) });
    }
  });
}
