import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../src/app.js';
import { createDiskCache } from '../src/cache.js';
import { selectTranslator } from '../src/config.js';
import { translate } from '../src/lookup.js';
import { createOpusMtTranslator, joinLines, MT_MODEL_DIRNAME, opusTargetToken } from '../src/mt/opus-mt.js';
import { createSpmTokenizer, normalizeNmt } from '../src/mt/spm.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const MODEL_DIR = process.env.LINGOBLEND_MT_DIR || join(here, '..', '.models', MT_MODEL_DIRNAME);
const S = '▁';

// ------------------------------------------------------------------ tokenizador

// Vocabulário sintético: peças com score, ids do "Marian" em outra ordem e uma peça fora do vocab.
const PIECES = [
  ['<unk>', 0, 2],
  ['<s>', 0, 3],
  ['</s>', 0, 3],
  [`${S}ciao`, -2, 1],
  [`${S}c`, -3, 1],
  ['iao', -3, 1],
  [`${S}`, -4, 1],
  ['c', -5, 1],
  ['i', -5, 1],
  ['a', -5, 1],
  ['o', -5, 1],
  ['fi', -4, 1],
  ['ne', -4, 1],
  [`${S}fine`, -9, 1],
  ['!', -3, 1],
  ['zz', -1, 1], // não está no vocab do Marian → <unk>
];
const VOCAB = {
  '</s>': 0, '<unk>': 1, '<pad>': 2, '>>pob<<': 3, [`${S}ciao`]: 10, [`${S}c`]: 11, iao: 12, [S]: 13,
  c: 14, i: 15, a: 16, o: 17, fi: 18, ne: 19, [`${S}fine`]: 20, '!': 21,
};
const tok = () => createSpmTokenizer({ pieces: PIECES, vocab: VOCAB });

test('spm: Viterbi escolhe o caminho de maior score', () => {
  const t = tok();
  assert.deepEqual(t.tokenize('ciao'), [`${S}ciao`]); // -2 bate ▁c + iao (-6)
  // ▁fine (-9) perde para ▁ + fi + ne (-12)? Não: -9 > -12, fica a peça inteira.
  assert.deepEqual(t.tokenize('fine'), [`${S}fine`]);
  assert.deepEqual(t.tokenize('ciao!'), [`${S}ciao`, '!']);
  assert.deepEqual(t.encode('ciao ciao'), [10, 10, 0]);
});

test('spm: nmt_nfkc, espaços colapsados e prefixo ▁', () => {
  assert.equal(normalizeNmt('  ﬁne\t\tciao\n'), 'fine ciao');
  assert.equal(normalizeNmt('a\u0007b​c'), 'ab c');
  const t = tok();
  assert.deepEqual(t.tokenize('  ﬁne   ciao '), [`${S}fine`, `${S}ciao`]);
  assert.deepEqual(t.tokenize('   '), []);
  assert.deepEqual(t.encode(''), [0]);
});

test('spm: caracteres sem peça viram um <unk> só; peça fora do vocab vira <unk>', () => {
  const t = tok();
  assert.deepEqual(t.tokenize('ciao xyw!'), [`${S}ciao`, S, 'xyw', '!']);
  assert.deepEqual(t.encode('ciao xyw!'), [10, 13, 1, 21, 0]);
  assert.deepEqual(t.encode('zz'), [13, 1, 0]); // ▁ + zz (fora do vocab)
});

test('spm: decode pula especiais e troca ▁ por espaço', () => {
  const t = tok();
  assert.equal(t.decode([10, 13, 18, 19, 21, 1, 0, 2]), 'ciao fine!');
  assert.equal(t.tokenId('>>pob<<'), 3);
});

// ------------------------------------------------------------------ rota de idiomas

test('opusTargetToken: pt e pt-BR → >>pob<<, pt-PT → >>por<<', () => {
  assert.equal(opusTargetToken('pt'), '>>pob<<');
  assert.equal(opusTargetToken('pt-BR'), '>>pob<<');
  assert.equal(opusTargetToken('pt-PT'), '>>por<<');
  assert.equal(opusTargetToken('pt-AO'), '>>por<<');
  assert.equal(opusTargetToken('es'), '>>spa<<');
  assert.equal(opusTargetToken('fr-CA'), '>>fra<<');
  assert.equal(opusTargetToken('it'), '>>ita<<');
  assert.equal(opusTargetToken('ro'), '>>ron<<');
  assert.equal(opusTargetToken('ast'), '>>ast<<');
  assert.equal(opusTargetToken('en'), null);
  assert.equal(opusTargetToken('ja'), null);
});

test('joinLines: " / " vira espaço, barra sem espaços fica', () => {
  assert.equal(joinLines('Magari... / Ma non lo è.'), 'Magari... Ma non lo è.');
  assert.equal(joinLines('1/2 e/o'), '1/2 e/o');
});

/** Pasta de modelo falsa: manifesto, vocab, config, peças e ONNX vazios (a fake do ORT não lê). */
async function fakeModelDir() {
  const dir = await mkdtemp(join(tmpdir(), 'lingoblend-mt-'));
  const vocab = { ...VOCAB, '>>por<<': 4, '>>spa<<': 5, '>>ita<<': 6 };
  await writeFile(join(dir, 'linguetta-mt.json'), JSON.stringify({ model: 'Helsinki-NLP/fake', revision: 'abc', sourceLanguages: ['it', 'es', 'pt', 'ast'] }));
  await writeFile(join(dir, 'vocab.json'), JSON.stringify(vocab));
  await writeFile(join(dir, 'config.json'), JSON.stringify({ vocab_size: 22, decoder_start_token_id: 2, pad_token_id: 2, eos_token_id: 0 }));
  await writeFile(join(dir, 'spm-pieces.json'), JSON.stringify({ pieces: PIECES }));
  for (const f of ['encoder_model', 'decoder_model', 'decoder_with_past_model']) await writeFile(join(dir, `${f}.onnx`), '');
  return dir;
}

/** onnxruntime falso: gera "ciao fine" e depois </s>; o pad tem o maior logit e precisa ser banido. */
function fakeOrt(calls) {
  class Tensor {
    constructor(type, data, dims) {
      Object.assign(this, { type, data, dims });
    }
  }
  const V = 22;
  const logits = (best) => {
    const data = new Float32Array(V).fill(-1);
    data[2] = 100; // <pad>
    data[best] = 5;
    return new Tensor('float32', data, [1, 1, V]);
  };
  const kv = () => new Tensor('float32', new Float32Array(1), [1, 1, 1, 1]);
  const plan = [10, 20, 0]; // ▁ciao, ▁fine, </s>
  return {
    Tensor,
    InferenceSession: {
      async create(path, opts) {
        calls.push({ create: path.split('/').pop(), opts });
        if (path.endsWith('encoder_model.onnx')) {
          return { run: async (f) => (calls.push({ enc: [...f.input_ids.data].map(Number) }), { last_hidden_state: kv() }) };
        }
        if (path.endsWith('decoder_model.onnx')) {
          return { run: async () => ({ logits: logits(plan[0]), 'present.0.decoder.key': kv(), 'present.0.encoder.key': kv() }) };
        }
        let step = 1;
        return {
          run: async (f) => {
            calls.push({ past: Object.keys(f).sort() });
            return { logits: logits(plan[step++]), 'present.0.decoder.key': kv() };
          },
        };
      },
    },
  };
}

test('tradutor sem modelo: indisponível, com a dica do setup', () => {
  const t = createOpusMtTranslator({ dir: join(tmpdir(), 'nao-existe-lingoblend'), log: {} });
  assert.equal(t.available, false);
  assert.match(t.reason, /setup-mt\.sh/);
  assert.equal(t.route('it', 'pt'), null);
});

test('tradutor: rota pelo idioma de origem do manifesto e token de destino no vocab', async () => {
  const dir = await fakeModelDir();
  try {
    const t = createOpusMtTranslator({ dir, log: {} });
    assert.equal(t.available, true);
    assert.equal(t.model, 'Helsinki-NLP/fake');
    assert.deepEqual(t.route('it', 'pt'), { token: '>>pob<<' });
    assert.deepEqual(t.route('it-CH', 'pt-PT'), { token: '>>por<<' });
    assert.deepEqual(t.route('ast', 'es'), { token: '>>spa<<' });
    assert.equal(t.route('en', 'pt'), null); // origem fora do modelo
    assert.equal(t.route('it', 'en'), null); // destino sem token
    assert.equal(t.route('it', 'fr'), null); // destino com código, mas fora deste vocab
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('tradutor: carrega uma vez, prefixa o token de idioma, bane o pad e para no </s>', async () => {
  const dir = await fakeModelDir();
  try {
    const calls = [];
    const t = createOpusMtTranslator({ dir, threads: 3, log: {}, loadOrt: async () => fakeOrt(calls) });
    const out = await t.translate({ sourceLang: 'it', nativeLanguage: 'pt-BR', text: 'ciao' });
    assert.equal(out, 'ciao fine');
    const creates = calls.filter((c) => c.create);
    assert.equal(creates.length, 3);
    assert.equal(creates[0].opts.intraOpNumThreads, 3);
    assert.deepEqual(calls.find((c) => c.enc).enc, [3, 10, 0]); // >>pob<< ▁ciao </s>
    assert.deepEqual(calls.find((c) => c.past).past, ['encoder_attention_mask', 'input_ids', 'past_key_values.0.decoder.key', 'past_key_values.0.encoder.key']);
    // segunda fala: não recarrega
    await t.translate({ sourceLang: 'it', nativeLanguage: 'pt-PT', text: 'ciao' }).catch(() => {});
    assert.equal(calls.filter((c) => c.create).length, 3);
    await assert.rejects(t.translate({ sourceLang: 'en', nativeLanguage: 'pt', text: 'hi' }), /sem rota local/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('selectTranslator: LINGOBLEND_MT_DIR, LINGOBLEND_MT_THREADS', async () => {
  const dir = await fakeModelDir();
  try {
    assert.equal(selectTranslator({ LINGOBLEND_MT_DIR: dir }, { defaultDir: '/nada', log: {} }).available, true);
    assert.equal(selectTranslator({}, { defaultDir: join(tmpdir(), 'nao-existe-lingoblend'), log: {} }).available, false);
    assert.throws(() => selectTranslator({ LINGOBLEND_MT_THREADS: '0' }, { defaultDir: dir, log: {} }), /LINGOBLEND_MT_THREADS/);
    assert.throws(() => selectTranslator({ LINGOBLEND_MT_THREADS: 'x' }, { defaultDir: dir, log: {} }), /LINGOBLEND_MT_THREADS/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ /translate: engines e cache

function fakes() {
  const n = { local: 0, ai: 0 };
  const translator = {
    name: 'opus-mt',
    model: 'Helsinki-NLP/fake',
    revision: 'abc',
    available: true,
    route: (src, native) => (src === 'it' && native.startsWith('pt') ? { token: '>>pob<<' } : null),
    translate: async ({ text }) => (n.local++, text === 'boom' ? Promise.reject(new Error('onnx caiu')) : `local: ${text}`),
  };
  const provider = { name: 'fake-ai', model: 'm', translate: async ({ text }) => (n.ai++, `ia: ${text}`) };
  return { n, translator, provider };
}

test('translate: engine local por padrão, ai pelo provider, 422 sem rota local', async () => {
  const { translator, provider } = fakes();
  const req = { sourceLang: 'it', nativeLanguage: 'pt', text: 'Ciao' };
  assert.deepEqual(await translate({ provider, translator, cache: null }, req), { translation: 'local: Ciao', engine: 'local', cached: false });
  assert.deepEqual(await translate({ provider, translator, cache: null }, { ...req, engine: 'ai' }), { translation: 'ia: Ciao', engine: 'ai', cached: false });
  const unavailable = (e) => e.status === 422 && e.code === 'local_unavailable';
  await assert.rejects(translate({ provider, translator, cache: null }, { ...req, sourceLang: 'ja', engine: 'local' }), unavailable);
  await assert.rejects(translate({ provider, translator: null, cache: null }, { ...req, engine: 'local' }), unavailable);
  await assert.rejects(translate({ provider, translator: { ...translator, available: false }, cache: null }, req), unavailable);
  // mesmo idioma: texto de volta, sem modelo nenhum
  assert.equal((await translate({ provider, translator: null, cache: null }, { ...req, sourceLang: 'pt-BR' })).translation, 'Ciao');
  await assert.rejects(translate({ provider, translator, cache: null }, { ...req, text: 'boom' }), (e) => e.status === 500 && e.code === 'local_error');
});

test('translate: cache separado por engine (e pelo modelo local)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lingoblend-mtc-'));
  try {
    const { n, translator, provider } = fakes();
    const cache = createDiskCache(dir);
    const req = { sourceLang: 'it', nativeLanguage: 'pt', text: 'Ciao' };
    assert.equal((await translate({ provider, translator, cache }, { ...req, engine: 'local' })).translation, 'local: Ciao');
    const ai = await translate({ provider, translator, cache }, { ...req, engine: 'ai' });
    assert.deepEqual(ai, { translation: 'ia: Ciao', engine: 'ai', cached: false });
    assert.deepEqual(await translate({ provider, translator, cache }, { ...req, engine: 'local' }), { translation: 'local: Ciao', engine: 'local', cached: true });
    assert.equal((await translate({ provider, translator, cache }, { ...req, engine: 'ai' })).cached, true);
    assert.deepEqual(n, { local: 1, ai: 1 });
    // outra revisão do modelo local não reaproveita
    assert.equal((await translate({ provider, translator: { ...translator, revision: 'def' }, cache }, req)).cached, false);
    assert.equal(n.local, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('HTTP: /translate com engine, 422 local_unavailable, 400 invalid_engine, /health com mt', async () => {
  const { translator, provider } = fakes();
  const server = createApp({ provider, translator, log: {} });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body) => fetch(`${base}/translate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    let r = await post({ sourceLang: 'it', nativeLanguage: 'pt-BR', text: 'Ciao' });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { translation: 'local: Ciao', engine: 'local' });
    r = await post({ sourceLang: 'it', nativeLanguage: 'pt', text: 'Ciao', engine: 'ai' });
    assert.deepEqual(await r.json(), { translation: 'ia: Ciao', engine: 'ai' });
    r = await post({ sourceLang: 'fr', nativeLanguage: 'pt', text: 'Salut', engine: 'local' });
    assert.equal(r.status, 422);
    assert.equal((await r.json()).code, 'local_unavailable');
    r = await post({ sourceLang: 'it', nativeLanguage: 'pt', text: 'Ciao', engine: 'deepl' });
    assert.equal(r.status, 400);
    assert.equal((await r.json()).code, 'invalid_engine');
    r = await fetch(`${base}/health`);
    assert.deepEqual((await r.json()).mt, { available: true, model: 'Helsinki-NLP/fake' });
  } finally {
    await new Promise((r) => server.close(r));
  }
});

// ------------------------------------------------------------------ paridade com o modelo real

const hasModel = existsSync(join(MODEL_DIR, 'tokenizer-fixture.json'));

test('modelo real: ids do tokenizador JS = MarianTokenizer e traduções = ONNX int8 em Python', { skip: !hasModel && `sem modelo em ${MODEL_DIR} (rode scripts/setup-mt.sh)` }, async () => {
  const fixture = JSON.parse(readFileSync(join(MODEL_DIR, 'tokenizer-fixture.json'), 'utf8'));
  const t = createOpusMtTranslator({ dir: MODEL_DIR, log: {} });
  assert.equal(t.available, true);
  const spm = createSpmTokenizer({
    pieces: JSON.parse(readFileSync(join(MODEL_DIR, 'spm-pieces.json'), 'utf8')).pieces,
    vocab: JSON.parse(readFileSync(join(MODEL_DIR, 'vocab.json'), 'utf8')),
  });
  for (const c of fixture.cases) {
    assert.deepEqual(spm.encode(c.text), c.encoded, `ids: ${c.text}`);
    assert.equal(spm.decode(c.output), c.translation, `decode: ${c.text}`);
  }
  for (const c of fixture.cases) {
    assert.equal(c.langToken, '>>pob<<');
    assert.equal(await t.translate({ sourceLang: 'it', nativeLanguage: 'pt-BR', text: c.text }), c.translation, `tradução: ${c.text}`);
  }
});
