import { test } from 'node:test';
import assert from 'node:assert/strict';

import { annotate, parseAnnotateRequest } from '../src/app.js';
import { buildUserMessage } from '../src/providers/claude.js';
import { REPEAT_GAP, blendPlan, frequencyScore, selectSwaps } from '../src/blend/select.js';

const LANGS = { sourceLang: 'pt', targetLang: 'it' };
// Lista de frequência de mentira: posição de cada palavra.
const freq = (ranks) => ({ rank: (w) => ranks[w.toLowerCase()] ?? null });
const ann = (source, lemma, target = lemma) => ({ source, target, lemma });
const SHORT = (w) => `Eu vi ${w} ontem.`;
// Fala de n palavras ("p0 p1 … pn-1", prefixo único por fala) com todas as palavras candidatas.
const cue = (n, id) => Array.from({ length: n }, (_, k) => `${id}w${k}`).join(' ');
const allCands = (n, id) => Array.from({ length: n }, (_, k) => ann(`${id}w${k}`, `${id}l${k}`));
const batch = (sizes) => ({ texts: sizes.map((n, i) => cue(n, `c${i}`)), candidates: sizes.map((n, i) => allCands(n, `c${i}`)) });
const swapped = (out) => out.reduce((n, anns) => n + anns.reduce((m, a) => m + a.source.split(' ').length, 0), 0);
const withSwap = (out) => out.flatMap((a, i) => (a.length ? [i] : []));

test('frequência: faixa intermediária > muito comum > rara (na lista) > fora da lista; sem lista é neutra', () => {
  const f = freq({ casa: 50, giardino: 2000, sgabello: 30000 });
  assert.ok(frequencyScore(f, 'giardino') > frequencyScore(f, 'casa'));
  assert.ok(frequencyScore(f, 'casa') > frequencyScore(f, 'sgabello'));
  assert.ok(frequencyScore(f, 'sgabello') > frequencyScore(f, 'xyz'));
  assert.equal(frequencyScore(f, 'xyz', 'giardino'), frequencyScore(f, 'giardino'), 'vale a melhor forma (lema ou alvo)');
  assert.equal(frequencyScore(null, 'xyz'), 2);
});

test('plano: cota = round(cobertura × palavras); até 1 palavra por fala espalha uma troca por fala, acima disso o teto cresce com o tamanho da fala', () => {
  const texts = [cue(4, 'a'), cue(6, 'b'), cue(10, 'c')]; // 20 palavras
  const low = blendPlan({ texts, sourceLang: 'pt', wordCoverage: 0.1 });
  assert.deepEqual({ words: low.words, quota: low.quota, perCue: low.perCue }, { words: 20, quota: 2, perCue: false });
  assert.deepEqual(low.caps, [1, 1, 1]);
  const mid = blendPlan({ texts, sourceLang: 'pt', wordCoverage: 0.25 });
  assert.equal(mid.perCue, true);
  assert.deepEqual(mid.caps, [1, 2, 3], 'round(25% × palavras), no mínimo 1');
  const high = blendPlan({ texts, sourceLang: 'pt', wordCoverage: 0.5 });
  assert.deepEqual(high.caps, [2, 3, 5], 'no máximo metade das palavras');
  assert.equal(blendPlan({ texts: [cue(3, 'x')], sourceLang: 'pt', wordCoverage: 0.5 }).caps[0], 1, 'metade de 3 = 1');
});

test('cota: a parte real das palavras trocadas segue a cobertura; com 0 não troca nada', () => {
  const { texts, candidates } = batch(Array(20).fill(5)); // 100 palavras
  for (const [cov, cues, perCue] of [[0.05, 5, 1], [0.1, 10, 1], [0.2, 20, 1], [0.4, 20, 2]]) {
    const out = selectSwaps({ ...LANGS, texts, candidates, wordCoverage: cov });
    assert.equal(swapped(out), Math.round(cov * 100), `cobertura ${cov}`);
    assert.equal(withSwap(out).length, cues, `cobertura ${cov}: falas com troca`);
    assert.ok(out.every((a) => a.length <= perCue), `cobertura ${cov}: no máximo ${perCue} por fala`);
  }
  assert.deepEqual(selectSwaps({ ...LANGS, texts, candidates, wordCoverage: 0 }), texts.map(() => []));
});

test('espaçamento: abaixo de 1 troca por fala, as falas com troca ficam espalhadas', () => {
  const { texts, candidates } = batch(Array(20).fill(5));
  const chosen = withSwap(selectSwaps({ ...LANGS, texts, candidates, wordCoverage: 0.05 }));
  assert.deepEqual(chosen, [0, 4, 8, 12, 16]);
  const ten = withSwap(selectSwaps({ ...LANGS, texts, candidates, wordCoverage: 0.1 }));
  assert.ok(ten.every((i, k) => k === 0 || i - ten[k - 1] === 2), `uma em cada duas: ${ten}`);
});

test('teto por fala cresce com a cobertura e com o tamanho da fala', () => {
  const { texts, candidates } = batch([10]);
  for (const [cov, n] of [[0.1, 1], [0.3, 3], [0.5, 5]]) {
    assert.equal(selectSwaps({ ...LANGS, texts, candidates, wordCoverage: cov })[0].length, n, `cobertura ${cov}`);
  }
  const mixed = batch([4, 12, 4, 12]); // 32 palavras; 25% → 8
  const out = selectSwaps({ ...LANGS, ...mixed, wordCoverage: 0.25 });
  assert.deepEqual(out.map((a) => a.length), [1, 3, 1, 3]);
});

test('teto é limite, não obrigação: extra só com candidata boa (fora da lista não entra)', () => {
  const f = freq({ macchina: 400, estate: 900 });
  const long = 'Eu quero muito comprar um carro novo para viajar com a família no verão.';
  const candidates = [[ann('carro', 'macchina'), ann('família', 'xyz'), ann('verão', 'estate')]];
  const [out] = selectSwaps({ ...LANGS, texts: [long], candidates, wordCoverage: 0.5, frequency: f });
  assert.deepEqual(out.map((a) => a.source), ['carro', 'verão'], 'a rara fica de fora; ordem de leitura');
});

test('extra: a nota decide se entra, o desempate pela ordem do motor não (rara na lista em qualquer posição)', () => {
  // somma (rank 9000, nota 1,5) é a 3ª candidata: o desempate a deixaria em 1,48 < EXTRA_MIN.
  const f = freq({ macchina: 400, estate: 900, somma: 9000 });
  const long = 'Eu quero muito comprar um carro novo para viajar com a soma do verão.';
  const candidates = [[ann('carro', 'macchina'), ann('verão', 'estate'), ann('soma', 'somma')]];
  const [out] = selectSwaps({ ...LANGS, texts: [long], candidates, wordCoverage: 0.5, frequency: f });
  assert.deepEqual(out.map((a) => a.source), ['carro', 'soma', 'verão']);
});

test('trocas vizinhas na mesma fala valem ("coppie sposate")', () => {
  const texts = ['Os casais casados brigam.'];
  const candidates = [[ann('casais', 'coppia', 'coppie'), ann('casados', 'sposato', 'sposate')]];
  const [out] = selectSwaps({ ...LANGS, texts, candidates, wordCoverage: 0.5 });
  assert.deepEqual(out.map((a) => a.target), ['coppie', 'sposate']);
});

test('compensação: troca que não coube (fala sem candidata) vai para a fala mais longe das já escolhidas', () => {
  // 20 falas × 5 palavras, 3% → cota 3, janelas de 6,7 falas (começam em 0, 7 e 14). A do meio
  // (7–13) não tem candidata: a terceira troca vai para a fala 6 (6 da 0, 8 da 14), a mais isolada.
  const { texts, candidates } = batch(Array(20).fill(5));
  for (let i = 7; i <= 13; i++) candidates[i] = [];
  const out = selectSwaps({ ...LANGS, texts, candidates, wordCoverage: 0.03 });
  assert.deepEqual(withSwap(out), [0, 6, 14]);
});

test('compensação: sem fala livre, completa a cota com mais trocas nas falas que têm candidatas', () => {
  // Só 5 das 20 falas têm candidatas; 10% de 100 palavras = 10 → 2 por fala (até metade de 5).
  const { texts, candidates } = batch(Array(20).fill(5));
  candidates.forEach((_, i) => i % 4 !== 0 && (candidates[i] = []));
  const out = selectSwaps({ ...LANGS, texts, candidates, wordCoverage: 0.1 });
  assert.equal(swapped(out), 10);
  assert.deepEqual(out.map((a) => a.length).filter(Boolean), [2, 2, 2, 2, 2]);
  // a cota não passa da metade das palavras de cada fala: com 50% e candidatas só nessas falas, para em 2
  assert.equal(swapped(selectSwaps({ ...LANGS, texts, candidates, wordCoverage: 0.5 })), 10);
});

test('expressão de várias palavras conta todas as palavras na cota', () => {
  const texts = Array.from({ length: 10 }, (_, i) => `Faça c${i} de novo agora mesmo.`); // 6 palavras cada
  const candidates = texts.map((_, i) => [ann('de novo', 'di nuovo'), ann(`c${i}`, `cosa${i}`)]);
  const out = selectSwaps({ ...LANGS, texts, candidates, wordCoverage: 0.2, preferWords: ['di nuovo'] });
  assert.equal(swapped(out), 12, '20% de 60');
});

test('na janela vence a melhor candidata: banco, depois frequência útil; janela sem candidata compensa em outra', () => {
  const f = freq({ casa: 10, giardino: 2000 });
  const texts = [SHORT('casa'), SHORT('jardim'), SHORT('banco'), SHORT('x'), SHORT('y'), SHORT('z')]; // 24 palavras
  const candidates = [[ann('casa', 'casa')], [ann('jardim', 'giardino')], [ann('banco', 'sgabello')], [], [], []];
  // 5% de 24 → cota 1: uma janela com as 6 falas.
  const out = selectSwaps({ ...LANGS, texts, candidates, wordCoverage: 0.05, frequency: f });
  assert.deepEqual(out.map((a) => a.map((x) => x.lemma)), [[], ['giardino'], [], [], [], []]);
  const bank = selectSwaps({ ...LANGS, texts, candidates, wordCoverage: 0.05, frequency: f, preferWords: ['Sgabello'] });
  assert.deepEqual(bank.map((a) => a.map((x) => x.lemma)), [[], [], ['sgabello'], [], [], []]);
});

test('banco primeiro dentro da fala', () => {
  const f = freq({ giardino: 2000 });
  const texts = [cue(4, 'a')];
  const candidates = [[ann('aw0', 'giardino'), ann('aw1', 'sgabello')]];
  const [out] = selectSwaps({ ...LANGS, texts, candidates, wordCoverage: 0.25, frequency: f, preferWords: ['sgabello'] });
  assert.deepEqual(out.map((a) => a.lemma), ['sgabello']);
});

test('repetição: o mesmo lema, do banco ou não, só volta depois de REPEAT_GAP falas', () => {
  const n = REPEAT_GAP + 5;
  const texts = Array.from({ length: n }, () => SHORT('festa'));
  const candidates = texts.map(() => [ann('festa', 'festa')]);
  const fresh = selectSwaps({ ...LANGS, texts, candidates, wordCoverage: 0.25 });
  assert.deepEqual(withSwap(fresh), [0, REPEAT_GAP], 'lema novo também volta, espaçado');
  const bank = selectSwaps({ ...LANGS, texts, candidates, wordCoverage: 0.25, preferWords: ['festa'] });
  assert.deepEqual(withSwap(bank), [0, REPEAT_GAP]);
  const short = selectSwaps({ ...LANGS, texts: texts.slice(0, REPEAT_GAP), candidates: candidates.slice(0, REPEAT_GAP), wordCoverage: 0.25 });
  assert.equal(short.flat().length, 1, 'dentro de REPEAT_GAP falas aparece uma vez só');
});

test('cueOffset: as janelas seguem a posição global; a que começou no lote anterior é dele (a cota compensa)', () => {
  const { texts, candidates } = batch(Array(10).fill(5));
  // 10% de 50 palavras → cota 5, janelas de 2 falas; lote começando na fala 11: a janela 5 (10–11) é do lote anterior.
  const mid = selectSwaps({ ...LANGS, texts, candidates, wordCoverage: 0.1, cueOffset: 11 });
  assert.equal(mid[0].length, 0, 'fala 11 é da janela que começou em 10');
  assert.equal(swapped(mid), 5, 'a cota é do lote');
});

test('annotate: candidatas em cache, a escolha roda a cada pedido (mudar a cobertura não chama o motor de novo no local)', async () => {
  const store = new Map();
  const cache = { get: async (k) => store.get(k) ?? null, set: async (k, v) => void store.set(k, v) };
  let calls = 0;
  const local = {
    name: 'local',
    unavailable: () => null,
    model: () => 'm',
    annotate: async ({ texts }) => (calls++, texts.map((t) => [ann(t.split(' ')[2], 'cosa' + t.split(' ')[2])])),
  };
  const cues = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, text: SHORT(`coisa${i}`) })); // 40 palavras
  const req = { sourceLang: 'pt', targetLang: 'it', nativeLanguage: 'pt', engine: 'local', cues };
  const low = await annotate({ provider: null, cache, local }, { ...req, wordCoverage: 0.05 });
  const high = await annotate({ provider: null, cache, local }, { ...req, wordCoverage: 0.25 });
  assert.equal(calls, 1);
  assert.equal(high.cached, true);
  assert.equal(Object.keys(low.annotations).length, 2);
  assert.equal(Object.keys(high.annotations).length, 10);
});

test('parseAnnotateRequest: wordCoverage entre 0 e 0,5, padrão 0,1', () => {
  const base = { sourceLang: 'pt', targetLang: 'it', nativeLanguage: 'pt', engine: 'local', cues: [] };
  assert.equal(parseAnnotateRequest(base).wordCoverage, 0.1);
  assert.equal(parseAnnotateRequest({ ...base, wordCoverage: 0.333 }).wordCoverage, 0.33);
  assert.equal(parseAnnotateRequest({ ...base, wordCoverage: 0.5 }).wordCoverage, 0.5);
  for (const bad of [0.51, -0.1, 'x']) assert.throws(() => parseAnnotateRequest({ ...base, wordCoverage: bad }), /wordCoverage/);
});

test('pedido à IA: o mesmo alvo da escolha, com folga de 1,5×', () => {
  const texts = Array.from({ length: 20 }, (_, i) => cue(5, `c${i}`)); // 100 palavras
  const req = { sourceLang: 'pt', targetLang: 'it', nativeLanguage: 'pt', texts };
  const low = buildUserMessage({ ...req, wordCoverage: 0.1 });
  assert.match(low, /20 cues and 100 words\. Pick one word in about 15 of the cues/);
  assert.match(low, /show about 10 of them \(10% of the words\)/);
  assert.match(buildUserMessage({ ...req, wordCoverage: 0.2 }), /Pick one word in about 20 of the cues/, 'nunca mais falas que o lote');
  const high = buildUserMessage({ ...req, wordCoverage: 0.4 });
  assert.match(high, /Pick words in every cue, in proportion to its length: about 60% of each cue's words \(a 10-word cue gets about 6, a short cue at least 1\), about 60 words in total/);
});
