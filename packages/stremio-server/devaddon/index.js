// Addon local de teste: oferece o filme aberto Sintel (Blender Foundation, CC-BY 3.0)
// com a legenda oficial em português, para testar o LingoBlend.
// Rodar: node devaddon/index.js  →  instalar http://127.0.0.1:7000/manifest.json no Stremio.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PORT = Number(process.env.PORT || 7000);
const BASE = `http://127.0.0.1:${PORT}`;
const DIR = path.dirname(fileURLToPath(import.meta.url));

const MOVIE_ID = 'lingoblend:sintel';
const meta = {
  id: MOVIE_ID,
  type: 'movie',
  name: 'Sintel',
  poster: 'https://archive.org/services/img/Sintel',
  background: 'https://archive.org/services/img/Sintel',
  description: 'Curta aberto da Blender Foundation (2010, CC-BY 3.0). Legenda oficial em português para testar o LingoBlend.',
  releaseInfo: '2010',
  runtime: '15 min',
};

const manifest = {
  id: 'dev.lingoblend.sintel',
  version: '0.1.0',
  name: 'LingoBlend Teste (Sintel)',
  description: 'Filme aberto com legenda em português para testar o LingoBlend',
  resources: ['catalog', 'meta', 'stream', 'subtitles'],
  types: ['movie'],
  idPrefixes: ['lingoblend:'],
  catalogs: [{ type: 'movie', id: 'lingoblend-open', name: 'LingoBlend Teste' }],
};

const routes = {
  '/manifest.json': () => manifest,
  '/catalog/movie/lingoblend-open.json': () => ({ metas: [meta] }),
  [`/meta/movie/${MOVIE_ID}.json`]: () => ({ meta }),
  [`/stream/movie/${MOVIE_ID}.json`]: () => ({
    streams: [{ url: 'https://archive.org/download/Sintel/sintel-2048-stereo_512kb.mp4', title: 'Sintel 2048p estéreo (archive.org)' }],
  }),
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, '');
  const url = decodeURIComponent(new URL(req.url, BASE).pathname);
  console.log(req.method, url);
  if (routes[url]) return send(res, 200, routes[url]());
  // /subtitles/movie/<id>.json ou /subtitles/movie/<id>/<extra>.json
  if (url.startsWith(`/subtitles/movie/${MOVIE_ID}`)) {
    return send(res, 200, { subtitles: [{ id: 'sintel-pt', url: `${BASE}/files/sintel_pt.srt`, lang: 'por' }] });
  }
  if (url === '/files/sintel_pt.srt') {
    return send(res, 200, await readFile(path.join(DIR, 'subtitles/sintel_pt.srt')), 'application/x-subrip; charset=utf-8');
  }
  send(res, 404, { error: 'not found' });
}).listen(PORT, '127.0.0.1', () => console.log(`LingoBlend devaddon: ${BASE}/manifest.json`));
