import { createServer } from 'node:http';
import { cacheKey } from './cache.js';
import { normalizeLang } from './lang.js';
import { validateBatch } from './validate.js';

export const MAX_BODY = 2 * 1024 * 1024;
export const MAX_CUES = 500;
export const DEFAULT_DENSITY = 0.1;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

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
    if (declared > limit) return reject(new HttpError(413, `corpo maior que ${limit} bytes`));
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, `corpo maior que ${limit} bytes`));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Valida e normaliza o corpo de POST /annotate. */
export function parseAnnotateRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'corpo deve ser um objeto JSON');
  const sourceLang = normalizeLang(body.sourceLang);
  const targetLang = normalizeLang(body.targetLang);
  if (!sourceLang) throw new HttpError(400, 'sourceLang inválido');
  if (!targetLang) throw new HttpError(400, 'targetLang inválido');
  let density = body.density === undefined ? DEFAULT_DENSITY : Number(body.density);
  if (!Number.isFinite(density) || density < 0 || density > 1) throw new HttpError(400, 'density deve estar entre 0 e 1');
  density = Math.round(density * 1000) / 1000;
  if (!Array.isArray(body.cues)) throw new HttpError(400, 'cues deve ser uma lista');
  if (body.cues.length > MAX_CUES) throw new HttpError(400, `no máximo ${MAX_CUES} cues por requisição`);
  const cues = body.cues.map((c, i) => {
    const id = typeof c?.id === 'number' ? String(c.id) : c?.id;
    if (typeof id !== 'string' || !id) throw new HttpError(400, `cues[${i}].id inválido`);
    if (typeof c.text !== 'string') throw new HttpError(400, `cues[${i}].text inválido`);
    return { id, text: c.text };
  });
  return { sourceLang, targetLang, density, cues };
}

/**
 * Lógica de anotação, independente de HTTP.
 * provider: { name, model, annotate({ sourceLang, targetLang, density, texts }) -> Array<raw[]> }
 * cache: { get(key), set(key, annotationsByIndex) } ou null
 */
export async function annotate({ provider, cache }, req) {
  const { sourceLang, targetLang, density, cues } = req;
  const texts = cues.map((c) => c.text);
  let byIndex = null;
  let cached = false;

  if (sourceLang === targetLang || density === 0 || texts.every((t) => !t.trim())) {
    byIndex = texts.map(() => []);
  } else {
    const key = cacheKey({ provider: provider.name, model: provider.model, sourceLang, targetLang, density, texts });
    byIndex = cache ? await cache.get(key) : null;
    if (byIndex && byIndex.length === texts.length) {
      cached = true;
    } else {
      const raw = await provider.annotate({ sourceLang, targetLang, density, texts });
      byIndex = validateBatch(texts, raw);
      if (cache) await cache.set(key, byIndex).catch((e) => console.warn('[cache] falha ao gravar:', e.message));
    }
  }

  const annotations = {};
  cues.forEach((c, i) => {
    if (byIndex[i]?.length) annotations[c.id] = byIndex[i];
  });
  return { provider: provider.name, annotations, cached };
}

export function createApp({ provider, cache = null, log = console }) {
  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'OPTIONS') return send(res, 204);
      if (url.pathname === '/health') {
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'use GET');
        return send(res, 200, { ok: true, provider: provider.name, model: provider.model });
      }
      if (url.pathname === '/annotate') {
        if (req.method !== 'POST') throw new HttpError(405, 'use POST');
        let body;
        try {
          body = JSON.parse(await readBody(req));
        } catch (e) {
          if (e instanceof HttpError) throw e;
          throw new HttpError(400, 'JSON inválido');
        }
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
      throw new HttpError(404, 'não encontrado');
    } catch (err) {
      const status = err.status ?? 500;
      if (status >= 500) log.error?.(`[error] ${req.method} ${url.pathname}:`, err.message, err.cause?.message ?? '');
      if (!res.headersSent) send(res, status, { error: err.message || 'erro interno' });
    }
  });
}
