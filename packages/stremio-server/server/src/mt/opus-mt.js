// Tradução local de falas: OPUS-MT (MarianMT) em ONNX int8 com onnxruntime-node, dentro do servidor.
//
// Modelo: Helsinki-NLP/opus-mt-tc-big-itc-itc (CC-BY-4.0, Helsinki-NLP / OPUS-MT), exportado pelo
// scripts/setup-mt.sh. Entre línguas românicas (itálicas) em qualquer direção; o idioma de
// destino vai num token >>xxx<< antes do texto (>>pob<< = português do Brasil, >>por<< = europeu).
//
// O modelo carrega no primeiro uso (≈1–2 s) e as execuções vão em fila: uma fala por vez, com
// intraOpNumThreads fixo (4 por padrão; todos os núcleos mediu 2–3x mais lento). Decodificação
// gulosa (≈50 ms por fala).
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { languageProfile } from '@linguetta/language';
import { createSpmTokenizer } from './spm.js';

export const MT_MODEL_DIRNAME = 'opus-mt-tc-big-itc-itc';
export const DEFAULT_MT_THREADS = 4;
const FILES = ['linguetta-mt.json', 'config.json', 'vocab.json', 'spm-pieces.json', 'encoder_model.onnx', 'decoder_model.onnx', 'decoder_with_past_model.onnx'];

// ISO 639-1 → 639-3 dos idiomas que têm token no vocab do modelo. Tags de 3 letras ('ast',
// 'lad', 'pms', 'vec'...) já são o próprio código.
const ISO3 = {
  an: 'arg', ca: 'cat', co: 'cos', es: 'spa', fr: 'fra', gl: 'glg', ht: 'hat', it: 'ita',
  la: 'lat', oc: 'oci', pt: 'por', rm: 'roh', ro: 'ron', sc: 'srd', wa: 'wln',
};

function regionOf(tag) {
  try {
    return new Intl.Locale(tag).region ?? null;
  } catch {
    return null;
  }
}

/**
 * Token de destino do OPUS-MT para a língua nativa, ou null. Português sem região ou do Brasil
 * → >>pob<< (sem ele a saída sai em PT-PT); outras regiões (pt-PT, pt-AO...) → >>por<<.
 * Não confere o vocabulário: isso é com o tradutor (route).
 */
export function opusTargetToken(tag) {
  const { base } = languageProfile(tag);
  if (base === 'pt') {
    const region = regionOf(tag);
    return !region || region === 'BR' ? '>>pob<<' : '>>por<<';
  }
  const code = ISO3[base] ?? (base.length === 3 ? base : null);
  return code ? `>>${code}<<` : null;
}

/** Instruções para instalar o modelo (log do servidor e /health). */
export function setupHint(dir) {
  return `tradução local indisponível: modelo ausente em ${dir} (rode server/scripts/setup-mt.sh)`;
}

/**
 * Tradutor local. Sem o modelo instalado fica `available: false` e o servidor sobe normalmente.
 *   route(sourceLang, nativeLanguage) → { token } | null
 *   translate({ sourceLang, nativeLanguage, text }) → Promise<string>  (rota precisa existir)
 * opts.loadOrt: injeta o onnxruntime (testes).
 */
export function createOpusMtTranslator({ dir, threads = DEFAULT_MT_THREADS, log = console, loadOrt } = {}) {
  const missing = FILES.filter((f) => !existsSync(join(dir, f)));
  if (missing.length) {
    return { name: 'opus-mt', model: null, available: false, reason: setupHint(dir), dir, route: () => null, translate: unavailable };
  }
  const manifest = JSON.parse(readFileSync(join(dir, 'linguetta-mt.json'), 'utf8'));
  const vocab = JSON.parse(readFileSync(join(dir, 'vocab.json'), 'utf8'));
  const config = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'));
  const sources = new Set(manifest.sourceLanguages ?? []);
  const model = manifest.model;

  function route(sourceLang, nativeLanguage) {
    if (!sources.has(languageProfile(sourceLang).base)) return null;
    const token = opusTargetToken(nativeLanguage);
    return token && vocab[token] !== undefined ? { token } : null;
  }

  let loading = null;
  async function load() {
    const t0 = performance.now();
    const ort = loadOrt ? await loadOrt() : (await import('onnxruntime-node')).default;
    const { pieces } = JSON.parse(await readFile(join(dir, 'spm-pieces.json'), 'utf8'));
    const tokenizer = createSpmTokenizer({ pieces, vocab });
    const opts = { intraOpNumThreads: threads, interOpNumThreads: 1, executionMode: 'sequential', graphOptimizationLevel: 'all' };
    const [enc, dec0, decP] = await Promise.all(
      ['encoder_model', 'decoder_model', 'decoder_with_past_model'].map((n) => ort.InferenceSession.create(join(dir, `${n}.onnx`), opts)),
    );
    log.info?.(`[mt] ${model} carregado em ${Math.round(performance.now() - t0)} ms (threads=${threads})`);
    return { ort, tokenizer, enc, dec0, decP };
  }

  // Uma execução por vez: o onnxruntime já usa `threads` núcleos por fala.
  let queue = Promise.resolve();
  function serial(fn) {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  }

  async function translate({ sourceLang, nativeLanguage, text }) {
    const r = route(sourceLang, nativeLanguage);
    if (!r) throw new Error(`sem rota local ${sourceLang}->${nativeLanguage}`);
    loading ??= load().catch((e) => {
      loading = null;
      throw e;
    });
    const engine = await loading;
    return serial(() => greedy(engine, config, vocab[r.token], text));
  }

  return { name: 'opus-mt', model, revision: manifest.revision, available: true, dir, route, translate };
}

async function unavailable() {
  throw new Error('tradução local indisponível');
}

/** Decodificação gulosa: encoder uma vez, decoder no passo 0, decoder_with_past nos seguintes. */
async function greedy({ ort, tokenizer, enc, dec0, decP }, cfg, langId, text) {
  // " / " marca quebra de linha da legenda; para o modelo, a fala é uma frase só.
  const src = joinLines(text);
  const ids = [langId, ...tokenizer.encode(src)];
  const i64 = (arr, dims) => new ort.Tensor('int64', BigInt64Array.from(arr, BigInt), dims);
  const mask = i64(ids.map(() => 1), [1, ids.length]);
  const { last_hidden_state } = await enc.run({ input_ids: i64(ids, [1, ids.length]), attention_mask: mask });
  const V = cfg.vocab_size;
  let out = await dec0.run({
    input_ids: i64([cfg.decoder_start_token_id], [1, 1]),
    encoder_hidden_states: last_hidden_state,
    encoder_attention_mask: mask,
  });
  const encKV = {};
  for (const k of Object.keys(out)) if (k.includes('.encoder.')) encKV[k.replace('present', 'past_key_values')] = out[k];
  const maxNew = Math.min(256, Math.max(128, ids.length * 2));
  const gen = [];
  for (let step = 0; step < maxNew; step++) {
    const next = argmax(out.logits.data, (out.logits.dims[1] - 1) * V, V, cfg.pad_token_id);
    if (next === cfg.eos_token_id) break;
    gen.push(next);
    const feeds = { input_ids: i64([next], [1, 1]), encoder_attention_mask: mask, ...encKV };
    for (const k of Object.keys(out)) if (k.includes('.decoder.')) feeds[k.replace('present', 'past_key_values')] = out[k];
    out = await decP.run(feeds);
  }
  return tokenizer.decode(gen);
}

/** " / " (quebra de linha da legenda) vira espaço: o modelo traduz a fala como uma frase só. */
export function joinLines(text) {
  return text.replace(/\s+\/\s+/g, ' ');
}

function argmax(data, off, n, banned) {
  let best = -1;
  let bv = -Infinity;
  for (let i = 0; i < n; i++) {
    if (i !== banned && data[off + i] > bv) {
      bv = data[off + i];
      best = i;
    }
  }
  return best;
}
