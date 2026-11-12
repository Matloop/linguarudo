import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { annotate, createApp } from '../src/app.js';
import { createLocalAnnotator } from '../src/blend/local.js';
import { openDictionaries } from '../src/dict/wiktionary.js';
import { createMockProvider } from '../src/providers/mock.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const DIR = process.env.LINGOBLEND_DICT_DIR || join(here, '..', '.dict');
const REAL = existsSync(join(DIR, 'it.sqlite')) && existsSync(join(DIR, 'pt.sqlite'));
const skip = REAL ? false : `sem it.sqlite e pt.sqlite em ${DIR}`;

// Tradutor de mentira: frases e palavras soltas como o OPUS-MT respondeu de verdade.
const MT = {
  'Estou falando para minha família agora.': 'Ora parlo alla mia famiglia.',
  família: 'famiglia',
  falando: 'parlando',
  'Coma seu bacon vegetariano.': 'Mangia la tua pancetta vegetariana.',
  vegetariano: 'vegetariano',
  bacon: 'pancetta',
  'Conversamos sobre isso.': 'Parlato di questo.',
  conversamos: 'parliamo',
  'Obrigado. Volte sempre.': 'Grazie. Torna sempre.',
  obrigado: 'grazie',
  volte: 'torna',
  'Produtos químicos.': 'Prodotti chimici.',
  produtos: 'prodotti',
  químicos: 'chimici',
  'Você se atrasou de novo.': 'Sei di nuovo in ritardo.',
  atrasou: 'ritardo',
};
// Palavra original → língua nativa espanhola (legenda fora da nativa).
const MT_ES = { família: 'familia', produto: 'producto', químico: 'químico' };
const fakeMt = (calls = []) => ({
  name: 'fake-mt',
  available: true,
  languages: ['es', 'it', 'pt'],
  route: (s, t) => (s.startsWith('pt') && (t === 'it' || t === 'es') ? { token: `>>${t}<<`, model: 'fake@1' } : null),
  translate: async ({ text, nativeLanguage }) => (calls.push(text), (nativeLanguage === 'es' ? MT_ES : MT)[text] ?? text),
});
const req = (texts, extra = {}) => ({ sourceLang: 'pt-BR', targetLang: 'it', nativeLanguage: 'pt-BR', wordCoverage: 0.5, texts, ...extra });

test('Blend local: troca pela forma da frase, com o lema e a classe do dicionário', { skip }, async () => {
  const local = createLocalAnnotator({ translator: fakeMt(), dictionaries: openDictionaries({ dir: DIR, log: {} }) });
  const [picks] = await local.annotate(req(['Estou falando para minha família agora.']));
  const fam = picks.find((p) => p.source === 'família');
  assert.deepEqual(
    { target: fam.target, lemma: fam.lemma, pos: fam.pos, meaning: fam.meaning, translatedLine: fam.translatedLine },
    { target: 'famiglia', lemma: 'famiglia', pos: 'substantivo feminino', meaning: 'família', translatedLine: 'Ora parlo alla mia famiglia.' },
  );

  // "Produtos" → "Prodotti": o lema é o substantivo prodotto (não produrre), com maiúscula de começo de frase.
  const [[prod]] = await local.annotate(req(['Produtos químicos.']));
  assert.equal(prod.target, 'Prodotti');
  assert.equal(prod.lemma, 'prodotto');
});

test('Blend local: na dúvida não troca (concordância, forma verbal, pessoa, interjeição)', { skip }, async () => {
  const local = createLocalAnnotator({ translator: fakeMt(), dictionaries: openDictionaries({ dir: DIR, log: {} }) });
  const out = await local.annotate(req(['Coma seu bacon vegetariano.', 'Conversamos sobre isso.', 'Obrigado. Volte sempre.', 'Você se atrasou de novo.']));
  const sources = out.map((picks) => picks.map((p) => p.source));
  assert.ok(!sources[0].includes('vegetariano'), 'vegetariano (m.) ≠ vegetariana (f.)');
  assert.ok(!sources[1].includes('Conversamos'), 'flexionado ≠ particípio');
  assert.ok(!sources[2].includes('Obrigado'), 'interjeição');
  assert.ok(!sources[3].includes('atrasou'), 'ele atrasou ≠ (io) ritardo');
});

test('Blend local: devolve todas as candidatas da fala e guarda a palavra solta em cache', { skip }, async () => {
  const calls = [];
  const local = createLocalAnnotator({ translator: fakeMt(calls), dictionaries: openDictionaries({ dir: DIR, log: {} }) });
  const texts = ['Estou falando para minha família agora.', 'Produtos químicos.'];
  const out = await local.annotate(req(texts));
  assert.deepEqual(out.map((p) => p.map((a) => a.lemma).sort()), [['famiglia'], ['chimico', 'prodotto']], 'falando ≠ parlo (forma verbal)');
  assert.ok(out.flat().every((a) => !('rank' in a)));
  const before = calls.length;
  await local.annotate(req(texts));
  assert.equal(calls.length - before, 2, 'só as frases de novo; as palavras soltas vêm do cache');
});

test('Blend local: indisponível sem tradutor, sem rota (para a estudo ou para a nativa) ou sem dicionário', () => {
  const dictionaries = { get: (l) => (l === 'it' || l.startsWith('pt') ? {} : null) };
  const off = createLocalAnnotator({ translator: { available: false }, dictionaries });
  assert.match(off.unavailable(req([])), /tradutor/);
  const local = createLocalAnnotator({ translator: fakeMt(), dictionaries });
  assert.equal(local.unavailable(req([])), null);
  assert.equal(local.unavailable(req([], { nativeLanguage: 'es' })), null, 'legenda fora da nativa, com rota para a nativa');
  assert.match(local.unavailable(req([], { targetLang: 'de' })), /sem tradução local pt-BR->de: o motor local cobre es, it, pt/);
  assert.match(local.unavailable(req([], { nativeLanguage: 'en' })), /sem tradução local pt-BR->en/);
  const noSource = createLocalAnnotator({ translator: fakeMt(), dictionaries: { get: (l) => (l === 'it' ? {} : null) } });
  assert.match(noSource.unavailable(req([])), /sem dicionário local de pt-BR/);
});

test('Blend local: legenda fora da língua nativa, significado traduzido para a nativa', { skip }, async () => {
  const local = createLocalAnnotator({ translator: fakeMt(), dictionaries: openDictionaries({ dir: DIR, log: {} }) });
  const [picks] = await local.annotate(req(['Estou falando para minha família agora.'], { nativeLanguage: 'es' }));
  const fam = picks.find((p) => p.source === 'família');
  assert.deepEqual({ target: fam.target, meaning: fam.meaning }, { target: 'famiglia', meaning: 'familia' });
});

test('Blend local: palavra gramatical e verbo/advérbio muito comum não viram troca; substantivo comum vira', { skip }, async () => {
  const MT2 = { 'Minha casa está aqui.': 'La mia casa è qui.', casa: 'casa', minha: 'mia', aqui: 'qui' };
  const calls = [];
  const translator = { ...fakeMt(), translate: async ({ text }) => (calls.push(text), MT2[text] ?? text) };
  const local = createLocalAnnotator({ translator, dictionaries: openDictionaries({ dir: DIR, log: {} }) });
  await local.annotate(req(['Minha casa está aqui.']));
  // Só a palavra que passou pelos filtros é traduzida sozinha: minha (pronome), está (verbo de apoio
  // entre as mais comuns) e aqui (advérbio comum) param antes.
  assert.deepEqual(calls.slice(1), ['casa']);
});

// Dicionário de mentira: palavra → leituras [lema, classe, acepções, notas da remissão].
const fakeDict = (words) => ({
  version: 'fake@1',
  frequency: null,
  resolve: (surface) =>
    (words[surface.toLowerCase()] ?? []).map(([word, pos, senses, notes = []], k) => ({ entry: { id: `${word}/${pos}`, word, pos, s: senses.map((g) => [g, []]) }, notes, score: 10 - k })),
});
const GLOSS_PT = {
  primo: [['primo', 'noun', ['male cousin (son of a person’s uncle or aunt)']], ['primo', 'adj', ['prime (having no factors)', 'first']]],
  primos: [['primo', 'noun', ['male cousin (son of a person’s uncle or aunt)'], ['plural of primo']]],
  meus: [['meu', 'pron', ['my']]],
  cheiro: [['cheiro', 'noun', ['smell (sensation)', 'sense of smell']]],
  jogada: [['jogada', 'noun', ['move', 'trick']]],
  tábua: [['tábua', 'noun', ['board; plank (long, flat piece of wood)']]],
  sobrado: [['sobrado', 'noun', ['a two-storey house']], ['sobrar', 'verb', ['to remain, be left'], ['participle past of sobrar']]],
};
const GLOSS_IT = {
  cugino: [['cugino', 'noun', ['a male cousin (son of one’s uncle or aunt)']]],
  primo: [['primo', 'adj', ['first']]],
  odore: [['odore', 'noun', ['smell, odour']]],
  profumo: [['profumo', 'noun', ['scent, smell']]],
  suono: [['suono', 'noun', ['sound', 'noise', 'move']]],
  annusa: [['annusare', 'verb', ['to smell', 'to sniff'], ['third-person singular present indicative of annusare']]],
  tavolino: [['tavolino', 'noun', ['small table']], ['tavolo', 'noun', ['table, board'], ['diminutive of tavolo']]],
  resto: [['resto', 'noun', ['rest, remainder']], ['restare', 'verb', ['to stay, to remain'], ['first-person singular present indicative of restare']]],
};
const MT_GLOSS = {
  'Meu primo chegou.': 'Mio cugino arrivò.', primo: 'primo',
  'Sinto cheiro.': 'Sento odore profumo.', 'Bom cheiro.': 'Annusa bene.', cheiro: 'aroma',
  'Que jogada.': 'Che suono.', jogada: 'gioco',
  'Uma tábua.': 'Un tavolino.', tábua: 'asse',
  'Meus primos.': 'Miei cugino.', primos: 'primi',
  'O sobrado.': 'Il resto.', sobrado: 'villetta',
};
const glossLocal = () =>
  createLocalAnnotator({
    translator: { ...fakeMt(), translate: async ({ text }) => MT_GLOSS[text] ?? text },
    dictionaries: { get: (l) => (l === 'it' ? fakeDict(GLOSS_IT) : l.startsWith('pt') ? fakeDict(GLOSS_PT) : null) },
  });

test('Blend local: sem a palavra solta na frase, alinha pela glosa em inglês dos dois dicionários', async () => {
  // "primo" sozinho → "primo" (não está na frase); "male cousin" está em primo (pt) e em cugino (it).
  const [[pick]] = await glossLocal().annotate(req(['Meu primo chegou.']));
  assert.deepEqual({ source: pick.source, target: pick.target, lemma: pick.lemma, meaning: pick.meaning }, { source: 'primo', target: 'cugino', lemma: 'cugino', meaning: 'primo' });
});

test('Blend local: pela glosa, na dúvida não troca (dois tokens, acepção secundária, outra classe, remissão, concordância)', async () => {
  const texts = ['Sinto cheiro.', 'Bom cheiro.', 'Que jogada.', 'Uma tábua.', 'Meus primos.', 'O sobrado.'];
  const out = await glossLocal().annotate(req(texts));
  // odore e profumo têm "smell": dois tokens; "move" só na 3ª acepção de suono; annusare é verbo;
  // "tavolino" é lema e não casa por tavolo (board); primos (plural) ≠ cugino; sobrado: particípio ≠ (io) resto.
  assert.deepEqual(Object.fromEntries(texts.map((t, i) => [t, out[i].map((p) => p.target)])), Object.fromEntries(texts.map((t) => [t, []])));
});

// Legenda em inglês, estudo em italiano, nativa PT-BR: saídas reais do opus-mt-tc-big-en-it e -en-pt.
const SKIP_EN = existsSync(join(DIR, 'en.sqlite')) && existsSync(join(DIR, 'it.sqlite')) ? false : `sem en.sqlite e it.sqlite em ${DIR}`;
const MT_EN = {
  it: {
    "I've heard of married couples who deliberately spend a night apart.": 'Ho sentito parlare di coppie sposate che deliberatamente trascorrono una notte a parte.',
    heard: 'sentito', married: 'sposato', couples: 'coppie', deliberately: 'deliberatamente', spend: 'Spesa', night: 'notte', apart: 'a parte',
    'What the hell are you talking about?': 'Di che diavolo stai parlando?', hell: 'inferno', talking: 'Parlare',
    'We should call a lawyer right now.': 'Dovremmo chiamare un avvocato adesso.', call: 'chiama', lawyer: 'avvocato',
  },
  pt: { heard: 'Ouviu', married: 'Casado', couple: 'casal', deliberately: 'deliberadamente', night: 'noite', 'to talk': 'Para falar', to: 'Para', 'to call': 'Para ligar', lawyer: 'advogado' },
};
const fakeMtEn = (calls = []) => ({
  name: 'fake-mt',
  available: true,
  languages: ['en'],
  route: (s, t) => (s === 'en' && (t === 'it' || t.startsWith('pt')) ? { token: t === 'it' ? null : '>>pob<<', model: `fake-en-${t}@1` } : null),
  translate: async ({ text, nativeLanguage }) => (calls.push(text), MT_EN[nativeLanguage === 'it' ? 'it' : 'pt'][text] ?? text),
});

test('Blend local, legenda em inglês: adjetivo sem gênero casa com a forma flexionada; verbo no infinitivo; modal fica', { skip: SKIP_EN }, async () => {
  const local = createLocalAnnotator({ translator: fakeMtEn(), dictionaries: openDictionaries({ dir: DIR, log: {} }) });
  const texts = ["I've heard of married couples who deliberately spend a night apart.", 'What the hell are you talking about?', 'We should call a lawyer right now.'];
  const out = await local.annotate(req(texts, { sourceLang: 'en' }));
  const pick = (i, w) => out[i].find((p) => p.source === w);
  // "married" (inglês não flexiona o adjetivo) → "sposate", feminino plural de sposato.
  assert.deepEqual(
    { target: pick(0, 'married').target, lemma: pick(0, 'married').lemma, meaning: pick(0, 'married').meaning },
    { target: 'sposate', lemma: 'sposato', meaning: 'casado' },
  );
  assert.deepEqual([pick(0, 'couples').target, pick(0, 'couples').meaning], ['coppie', 'casal']);
  assert.equal(pick(0, "I've"), undefined); // contração
  // particípio presente ↔ gerúndio; significado pelo infinitivo ("to talk" → "Para falar" → "falar")
  assert.deepEqual([pick(1, 'talking').target, pick(1, 'talking').lemma, pick(1, 'talking').meaning], ['parlando', 'parlare', 'falar']);
  // "should" é auxiliar entre as mais comuns: não vira troca; "call" (forma básica = infinitivo e presente) vira
  assert.equal(pick(2, 'should'), undefined);
  assert.deepEqual([pick(2, 'call').target, pick(2, 'call').meaning], ['chiamare', 'ligar']);
});

test('annotate engine "local": usa o motor local, cache com nome próprio; 422 quando não dá', { skip }, async () => {
  const local = createLocalAnnotator({ translator: fakeMt(), dictionaries: openDictionaries({ dir: DIR, log: {} }) });
  const store = new Map();
  const cache = { get: async (k) => store.get(k) ?? null, set: async (k, v) => void store.set(k, v) };
  const provider = { name: 'never', model: 'x', annotate: () => assert.fail('a IA não pode ser chamada') };
  const body = { sourceLang: 'pt-BR', targetLang: 'it', nativeLanguage: 'pt-BR', wordCoverage: 0.5, engine: 'local', cues: [{ id: 'a', text: 'Estou falando para minha família agora.' }] };
  const r1 = await annotate({ provider, cache, local }, body);
  assert.equal(r1.provider, 'local');
  assert.ok(r1.annotations.a.some((x) => x.target === 'famiglia'));
  const r2 = await annotate({ provider, cache, local }, body);
  assert.equal(r2.cached, true);
  await assert.rejects(annotate({ provider, cache, local }, { ...body, nativeLanguage: 'en' }), (e) => e.status === 422 && e.code === 'local_unavailable');
});

test('HTTP /annotate: engine inválido 400; local sem modelo 422 local_unavailable', async () => {
  const server = createApp({ provider: createMockProvider(), log: {} });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const post = (b) => fetch(`${base}/annotate`, { method: 'POST', body: JSON.stringify({ sourceLang: 'pt', targetLang: 'it', nativeLanguage: 'pt', cues: [{ id: '1', text: 'Agora preciso de dinheiro.' }], ...b }) });
    let r = await post({ engine: 'turbo' });
    assert.equal(r.status, 400);
    assert.equal((await r.json()).code, 'invalid_engine');
    r = await post({ engine: 'local' });
    assert.equal(r.status, 422);
    assert.equal((await r.json()).code, 'local_unavailable');
    r = await post({});
    assert.equal(r.status, 400, 'engine é obrigatório');
    r = await post({ engine: 'ai' });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).provider, 'mock');
  } finally {
    server.close();
  }
});
