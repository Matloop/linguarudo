import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDictionary, compactEntry } from '../src/dict/build.js';
import { MAX_DEPTH, openDictionaries, openDictionary, startsSentence, tokenize } from '../src/dict/wiktionary.js';
import { lookup, posLabel, tidyWordTranslation } from '../src/lookup.js';
import { createDiskCache } from '../src/cache.js';
import { createApp } from '../src/app.js';
import { createMockProvider } from '../src/providers/mock.js';

// Fixture mínima no formato do Wiktextract (não é o dump real).
const sense = (gloss, extra = {}) => ({ glosses: [gloss], ...extra });
const formOf = (gloss, word, tags = []) => ({ glosses: [gloss], tags: ['form-of', ...tags], form_of: [{ word }] });
const it = (word, pos, senses, extra = {}) => ({ word, pos, lang: 'Italian', lang_code: 'it', senses, ...extra });

const FIXTURE = [
  it('pulito', 'adj', [sense('clean, neat, tidy', { tags: ['figuratively'] }), sense('broke (having no money)', { tags: ['colloquial'] })], {
    sounds: [{ ipa: '/puˈli.to/' }],
    forms: [{ form: 'pulita', tags: ['feminine'] }, { form: 'pulitissimo', tags: ['superlative'] }, { form: 'it-adj', tags: ['inflection-template'] }],
  }),
  it('pulitissimo', 'adj', [formOf('superlative degree of pulito', 'pulito', ['superlative'])]),
  it('pulitissima', 'adj', [formOf('feminine singular of pulitissimo', 'pulitissimo', ['feminine', 'singular'])]),
  it('fare', 'verb', [sense('to do'), sense('to make')], {
    sounds: [{ ipa: '/ˈfa.re/' }],
    forms: [{ form: 'facevo', tags: ['first-person', 'imperfect'] }, { form: 'facemmo', tags: ['first-person', 'plural', 'past', 'historic'] }, { form: 'ho fatto', tags: ['multiword-construction'] }],
  }),
  it('facevo', 'verb', [formOf('first-person singular imperfect indicative of fare', 'fare')]),
  it('finta', 'noun', [sense('feint', { tags: ['feminine'] })], { sounds: [{ ipa: '/ˈfin.ta/' }] }),
  it('finta', 'verb', [formOf('inflection of fintare: third-person singular present indicative', 'fintare')]),
  it('fintare', 'verb', [sense('to feint')]),
  it('di', 'prep', [sense('of')]),
  it('fare finta', 'verb', [sense('to pretend')]),
  it('in bocca al lupo', 'intj', [sense('good luck')], { sounds: [{ ipa: '/imˌbok.ka.alˈlu.po/' }] }),
  it('Roma', 'name', [sense('Rome'), sense('Rome (province)'), sense('Ancient Rome')], { sounds: [{ ipa: '/ˈro.ma/' }] }),
  it('roma', 'noun', [sense('a type of rice')]),
  it('aaa', 'noun', [formOf('alt of bbb', 'bbb')]),
  it('bbb', 'noun', [formOf('alt of aaa', 'aaa')]),
  ...Array.from({ length: MAX_DEPTH + 3 }, (_, i) => it(`d${i}`, 'noun', [formOf(`form of d${i + 1}`, `d${i + 1}`)])),
  it(`d${MAX_DEPTH + 3}`, 'noun', [sense('the bottom')]),
  it('avere', 'verb', [sense('to have')]),
  it('ho', 'verb', [formOf('first-person singular present indicative of avere and (obsolete) havere', 'avere and')]),
  it('il', 'article', [sense('the')]),
  it("l'", 'article', [{ glosses: ['apocopic form of il/lo'], tags: ['alt-of'], alt_of: [{ word: 'il/lo' }] }]),
  it('la', 'article', [sense('the')]),
  it('la', 'noun', [sense('la (musical note)')]),
  it('lui', 'pron', [sense('he')]),
  it('porta', 'noun', [sense('door', { tags: ['feminine'] })]),
  it('porta', 'verb', [formOf('third-person singular present indicative of portare', 'portare')]),
  it('portare', 'verb', ['to bring', 'to carry', 'to wear', 'to take', 'to lead', 'to hold', 'to bear', 'to have', 'to support', 'to drive'].map((g) => sense(g)), { forms: Array.from({ length: 100 }, (_, i) => ({ form: `portax${i}` })) }),
  { word: 'propre', pos: 'adj', lang: 'French', lang_code: 'fr', senses: [sense('clean')] },
  it('-issimo', 'suffix', [sense('very')]),
];

async function withDict(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'lingoblend-dict-'));
  try {
    const r = await buildDictionary(FIXTURE, { file: join(dir, 'it.sqlite'), lang: 'it', source: 'fixture' });
    const dicts = openDictionaries({ dir, log: {} });
    try {
      await fn({ dicts, dict: dicts.get('it'), dir, built: r });
    } finally {
      dicts.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('compactEntry guarda acepções, remissões e formas; descarta o resto', () => {
  const e = compactEntry(FIXTURE[0]);
  assert.equal(e.ipa, '/puˈli.to/');
  assert.deepEqual(e.s[0], ['clean, neat, tidy', ['figuratively']]);
  assert.deepEqual(e.forms.map((f) => f[0]), ['pulita', 'pulitissimo']); // template fora
  assert.deepEqual(compactEntry(FIXTURE[2]).f, [['form', 'pulitissimo', 'feminine singular of pulitissimo']]);
  assert.equal(compactEntry({ word: '-issimo', pos: 'suffix', senses: [sense('very')] }), null);
  assert.equal(compactEntry({ word: 'x', pos: 'noun', senses: [] }), null);
  // forma com espaço só entra em verbete de várias palavras
  assert.ok(!compactEntry(FIXTURE[3]).forms.some(([f]) => f === 'ho fatto'));
});

test('dicionários roteados pela subtag base; idioma sem arquivo → null', async () => {
  await withDict(async ({ dicts, built }) => {
    assert.ok(dicts.get('it'));
    assert.equal(dicts.get('it-CH'), dicts.get('it'));
    assert.equal(dicts.get('ja'), null);
    assert.equal(dicts.get('fr'), null);
    assert.equal(dicts.reason, null);
    assert.equal(dicts.status().it.entries, built.entries);
    assert.equal(built.entries, FIXTURE.length - 2); // francês e sufixo fora
  });
  const none = openDictionaries({ dir: join(tmpdir(), 'nao-existe-lingoblend'), log: {} });
  assert.equal(none.get('it'), null);
  assert.match(none.reason, /setup-dict\.sh/);
});

test('cadeia de remissões até o lema, com as notas (pulitissima → pulitissimo → pulito)', async () => {
  await withDict(async ({ dict }) => {
    const r = dict.lookup('Pulitissima', 'Pulitissima, come la mia coscienza.');
    assert.equal(r.found, true);
    assert.equal(r.lemma, 'pulito');
    assert.equal(r.pos, 'adj');
    assert.equal(r.ipa, '/puˈli.to/');
    assert.deepEqual(r.grammar, ['feminine singular of pulitissimo', 'superlative degree of pulito']);
    assert.deepEqual(r.senses, ['(figuratively) clean, neat, tidy', '(colloquial) broke (having no money)']);
    assert.match(r.url, /wiktionary\.org\/wiki\/pulito#Italian/);
    assert.equal(dict.lookup('PULITISSIMA', 'PULITISSIMA!').lemma, 'pulito');
    assert.equal(dict.lookup('facevo', 'Lo facevo.').lemma, 'fare');
    // só na tabela de formas do lema
    const f = dict.lookup('facemmo', 'Lo facemmo.');
    assert.equal(f.lemma, 'fare');
    assert.deepEqual(f.grammar, ['first-person plural past historic of fare']);
    // alvo com lixo do Wiktextract ("avere and") e alt_of "il/lo"
    assert.equal(dict.lookup('ho', 'ho fame').lemma, 'avere');
    assert.equal(dict.lookup("l'", "l'amico").lemma, 'il');
    assert.equal(dict.lookup('l’', 'l’amico').lemma, 'il');
  });
});

test('ciclos e cadeias longas não travam', async () => {
  await withDict(async ({ dict }) => {
    const c = dict.lookup('aaa', 'aaa');
    assert.equal(c.found, true);
    assert.ok(['aaa', 'bbb'].includes(c.lemma));
    assert.ok(c.grammar.length <= 2);
    const d = dict.lookup('d0', 'd0');
    assert.ok(d.grammar.length <= MAX_DEPTH);
    assert.notEqual(d.lemma, `d${MAX_DEPTH + 3}`); // parou no limite
  });
});

test('caixa: maiúscula de começo de frase não vira nome próprio, no meio da frase sim', async () => {
  await withDict(async ({ dict }) => {
    assert.equal(dict.lookup('Roma', 'Vado a Roma.').lemma, 'Roma');
    assert.equal(dict.lookup('roma', 'un piatto di roma').lemma, 'roma');
    assert.equal(dict.lookup('Roma', 'Roma è bella.').lemma, 'Roma'); // os dois casam; vence o verbete mais rico
    assert.equal(dict.lookup('Facevo', 'Facevo finta.').lemma, 'fare');
    assert.equal(startsSentence('Facevo', 'Facevo finta.', 'it'), true);
    assert.equal(startsSentence('Roma', 'Vado a Roma.', 'it'), false);
    assert.equal(startsSentence('Roma', 'Basta. Roma è bella.', 'it'), true);
    assert.equal(startsSentence('Ciao', 'no / Ciao', 'it'), true);
  });
});

test('contexto: depois de artigo prefere o substantivo, depois de pronome o verbo rico', async () => {
  await withDict(async ({ dict }) => {
    assert.equal(dict.lookup('porta', 'apri la porta').lemma, 'porta');
    assert.equal(dict.lookup('porta', 'lui porta il vino').lemma, 'portare');
  });
});

test('expressões: verbete exato, lemas por palavra, verbete dentro da seleção, senão nada', async () => {
  await withDict(async ({ dict }) => {
    const exact = dict.lookup('in bocca al lupo', 'In bocca al lupo!');
    assert.equal(exact.lemma, 'in bocca al lupo');
    assert.equal(exact.ipa, '/imˌbok.ka.alˈlu.po/');
    const two = dict.lookup('Facevo finta', 'Facevo finta di dormire.');
    assert.equal(two.lemma, 'fare finta');
    assert.deepEqual(two.senses, ['to pretend']);
    const three = dict.lookup('facevo finta di', 'Facevo finta di dormire.');
    assert.equal(three.found, true);
    assert.equal(three.lemma, 'fare finta di');
    assert.equal(three.headword, 'fare finta');
    assert.equal(three.ipa, ''); // a IPA do verbete não cobre o "di"
    assert.deepEqual(three.senses, ['to pretend']);
    assert.equal(dict.lookup('zzz yyy', 'zzz yyy').found, false);
    assert.equal(dict.lookup('finta zzz', 'finta zzz').found, false); // ponta que não é lema
    assert.equal(dict.lookup('qwerty', 'qwerty').found, false);
    assert.deepEqual(tokenize("dell'acqua fresca", 'it').map((t) => t.text + t.sep), ["dell'", 'acqua ', 'fresca']);
  });
});

// Tradutor falso: "traduz" pondo colchetes; route só para it→pt.
function fakeTranslator(calls = []) {
  return {
    name: 'opus-mt',
    available: true,
    models: [{ model: 'fake-mt', revision: 'r1', dir: '/x', sourceLanguages: ['it'] }],
    languages: ['it'],
    route: (src, dst) => (src.startsWith('it') && dst.startsWith('pt') ? { token: '>>pob<<', model: 'fake-mt@r1' } : null),
    translate: async ({ text }) => (calls.push(text), text === 'pulito' ? 'Limpo.' : `[${text}]`),
  };
}

function spyProvider() {
  const calls = [];
  return {
    calls,
    name: 'fake',
    model: 'm',
    lookup: async (req) => (calls.push(req), { lemma: 'pulitissimo', ipa: '/x/', pos: 'adj.', meaning: 'superlativo de limpo', translation: 'Limpíssima.' }),
    translate: async () => 'IA',
  };
}

const PULI = { lang: 'it', nativeLanguage: 'pt-BR', text: 'Pulitissima', sentence: 'Pulitissima, come la mia coscienza.' };

test('lookup local: dicionário + tradução do lema e da fala, sem chamar a IA', async () => {
  await withDict(async ({ dicts }) => {
    const calls = [];
    const provider = spyProvider();
    const { result } = await lookup({ provider, translator: fakeTranslator(calls), dictionaries: dicts, cache: null }, { ...PULI, engine: 'local' });
    assert.deepEqual(result, {
      lemma: 'pulito',
      reading: '',
      ipa: '/puˈli.to/',
      pos: 'adjetivo',
      meaning: 'limpo',
      translation: '[Pulitissima, come la mia coscienza.]',
      engine: 'local',
      found: true,
      senses: ['(figuratively) clean, neat, tidy', '(colloquial) broke (having no money)'],
      grammar: ['feminine singular of pulitissimo', 'superlative degree of pulito'],
      source: { name: 'Wiktionary', license: 'CC BY-SA 4.0', via: 'kaikki.org (Wiktextract)', url: 'https://en.wiktionary.org/wiki/pulito#Italian' },
    });
    assert.deepEqual(calls.sort(), ['Pulitissima, come la mia coscienza.', 'pulito']);
    assert.equal(provider.calls.length, 0);
    // padrão sem engine também é local
    assert.equal((await lookup({ provider, translator: fakeTranslator(), dictionaries: dicts, cache: null }, PULI)).result.engine, 'local');
    // expressão: significado vem do verbete achado
    const expr = await lookup({ provider, translator: fakeTranslator(), dictionaries: dicts, cache: null }, { ...PULI, text: 'facevo finta di', sentence: 'Facevo finta di dormire.' });
    assert.equal(expr.result.lemma, 'fare finta di');
    assert.equal(expr.result.meaning, '[fare finta]');
    assert.equal(expr.result.pos, 'locução verbal');
    assert.equal(provider.calls.length, 0);
  });
});

test('lookup local sem verbete: seleção como lema, traduções locais, found: false', async () => {
  await withDict(async ({ dicts }) => {
    const provider = spyProvider();
    const { result } = await lookup({ provider, translator: fakeTranslator(), dictionaries: dicts, cache: null }, { ...PULI, text: 'Bho', sentence: 'Bho, non lo so.' });
    assert.equal(result.found, false);
    assert.equal(result.lemma, 'Bho');
    assert.equal(result.meaning, '[Bho]');
    assert.equal(result.translation, '[Bho, non lo so.]');
    assert.deepEqual(result.senses, []);
    assert.equal(result.source, null);
    assert.equal(provider.calls.length, 0);
  });
});

test('lookup local sem rota de tradução: campos de tradução vazios, dicionário preenchido', async () => {
  await withDict(async ({ dicts }) => {
    const calls = [];
    const { result } = await lookup({ provider: spyProvider(), translator: fakeTranslator(calls), dictionaries: dicts, cache: null }, { ...PULI, nativeLanguage: 'ja' });
    assert.equal(result.lemma, 'pulito');
    assert.equal(result.found, true);
    assert.equal(result.pos, 'adj'); // rótulo em inglês fora do português
    assert.equal(result.meaning, '');
    assert.equal(result.translation, '');
    assert.equal(calls.length, 0);
    // idioma sem dicionário: nada do dicionário, só a tradução local quando há rota
    const none = await lookup({ provider: spyProvider(), translator: null, dictionaries: dicts, cache: null }, { lang: 'ja', nativeLanguage: 'pt', text: '食べ', sentence: '食べます' });
    assert.deepEqual({ ...none.result }, { lemma: '食べ', reading: '', ipa: '', pos: '', meaning: '', translation: '', engine: 'local', found: false, senses: [], grammar: [], source: null });
  });
});

test('lookup engine "ai" chama o provider e marca engine/found', async () => {
  await withDict(async ({ dicts }) => {
    const provider = spyProvider();
    const calls = [];
    const { result } = await lookup({ provider, translator: fakeTranslator(calls), dictionaries: dicts, cache: null }, { ...PULI, engine: 'ai' });
    assert.equal(result.engine, 'ai');
    assert.equal(result.lemma, 'pulitissimo');
    assert.equal(result.meaning, 'superlativo de limpo');
    assert.equal(result.found, true);
    assert.deepEqual(result.senses, []);
    assert.equal(provider.calls.length, 1);
    assert.equal(calls.length, 0);
  });
});

test('cache: local e IA em chaves separadas; versão do dicionário entra na chave', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'lingoblend-dc-'));
  try {
    await withDict(async ({ dicts, dir }) => {
      const cache = createDiskCache(cacheDir);
      const provider = spyProvider();
      const ctx = { provider, translator: fakeTranslator(), dictionaries: dicts, cache };
      assert.equal((await lookup(ctx, PULI)).cached, false);
      const again = await lookup(ctx, PULI);
      assert.equal(again.cached, true);
      assert.equal(again.result.lemma, 'pulito');
      const ai = await lookup(ctx, { ...PULI, engine: 'ai' });
      assert.equal(ai.cached, false);
      assert.equal(ai.result.lemma, 'pulitissimo');
      assert.equal((await lookup(ctx, { ...PULI, engine: 'ai' })).cached, true);
      assert.equal(provider.calls.length, 1);
      // o local continua o local depois da IA
      assert.equal((await lookup(ctx, PULI)).result.engine, 'local');
      // dicionário refeito (outra versão) → consulta de novo
      await new Promise((r) => setTimeout(r, 5));
      dicts.close();
      await buildDictionary(FIXTURE, { file: join(dir, 'it.sqlite'), lang: 'it' });
      const fresh = openDictionaries({ dir, log: {} });
      try {
        assert.equal((await lookup({ ...ctx, dictionaries: fresh }, PULI)).cached, false);
      } finally {
        fresh.close();
      }
      // falha do tradutor não fica no cache
      const flaky = { ...fakeTranslator(), translate: async () => { throw new Error('boom'); } };
      const broken = await lookup({ ...ctx, translator: flaky, dictionaries: null }, { ...PULI, text: 'xyz', sentence: 'xyz abc' });
      assert.equal(broken.result.translation, '');
      assert.equal((await lookup({ ...ctx, translator: flaky, dictionaries: null }, { ...PULI, text: 'xyz', sentence: 'xyz abc' })).cached, false);
    });
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test('tidyWordTranslation e posLabel', () => {
  assert.equal(tidyWordTranslation('pulito', 'Limpo.'), 'limpo');
  assert.equal(tidyWordTranslation('Roma', 'Roma.'), 'Roma');
  assert.equal(tidyWordTranslation('ciao!', 'Oi!'), 'oi!');
  assert.equal(tidyWordTranslation('onu', 'ONU'), 'ONU');
  assert.equal(tidyWordTranslation('in bocca al lupo', '- Boca a boca'), 'boca a boca');
  assert.equal(posLabel({ pos: 'noun', gender: 'feminine', lemma: 'porta' }, 'pt-BR'), 'substantivo feminino');
  assert.equal(posLabel({ pos: 'verb', gender: '', lemma: 'fare finta' }, 'pt'), 'locução verbal');
  assert.equal(posLabel({ pos: 'noun', gender: 'masculine', lemma: 'stato' }, 'en'), 'noun m.');
  assert.equal(posLabel({ pos: 'prep_phrase', gender: '', lemma: 'a b' }, 'de'), 'prep phrase');
});

test('HTTP: /health lista os dicionários e /lookup aceita engine', async () => {
  await withDict(async ({ dicts }) => {
    const server = createApp({ provider: createMockProvider(), translator: fakeTranslator(), dictionaries: dicts, log: {} });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (body) => fetch(`${base}/lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    try {
      const h = await (await fetch(`${base}/health`)).json();
      assert.equal(h.dict.languages.it.entries, FIXTURE.length - 2);
      assert.ok(h.dict.languages.it.builtAt);
      let r = await post({ ...PULI });
      assert.equal(r.status, 200);
      const local = await r.json();
      assert.equal(local.lemma, 'pulito');
      assert.equal(local.engine, 'local');
      r = await post({ ...PULI, engine: 'ai' });
      assert.equal((await r.json()).engine, 'ai');
      r = await post({ ...PULI, engine: 'gpt' });
      assert.equal(r.status, 400);
      assert.equal((await r.json()).code, 'invalid_engine');
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});

// Banco real do italiano (scripts/setup-dict.sh it); pulado quando não está instalado.
const here = fileURLToPath(new URL('.', import.meta.url));
const REAL = join(process.env.LINGOBLEND_DICT_DIR || join(here, '..', '.dict'), 'it.sqlite');

test('dicionário real do italiano', { skip: existsSync(REAL) ? false : `sem ${REAL}` }, () => {
  const d = openDictionary(REAL);
  try {
    const p = d.lookup('Pulitissima', 'Pulitissima, come la mia coscienza.');
    assert.equal(p.lemma, 'pulito');
    assert.ok(p.grammar.length >= 2, p.grammar.join(' | '));
    assert.equal(d.lookup('facevo', 'Facevo finta di dormire.').lemma, 'fare');
    assert.equal(d.lookup('Facevo', 'Facevo finta di dormire.').lemma, 'fare');
    assert.equal(d.lookup('facevo finta di', 'Facevo finta di dormire.').lemma, 'fare finta di');
    assert.equal(d.lookup('Roma', 'Vado a Roma.').lemma, 'Roma');
    assert.equal(d.lookup('bambini', 'I bambini giocano.').lemma, 'bambino');
    assert.equal(d.lookup('in bocca al lupo', 'In bocca al lupo!').lemma, 'in bocca al lupo');
    assert.equal(d.lookup('zxqwvk', 'zxqwvk').found, false);
    // Classe fechada antes do homógrafo raro (nota musical, letra, família de línguas).
    const mi = d.lookup('mi', 'Non è che non mi piaccia.');
    assert.equal(mi.pos, 'pron');
    assert.match(mi.senses[0], /\bme\b/);
    assert.equal(d.lookup('ci', 'Che ci fai qui?').pos, 'pron');
    assert.equal(d.lookup('fa', 'Che fa?').lemma, 'fare');
    assert.equal(d.lookup('porta', 'Apri la porta.').pos, 'noun');
  } finally {
    d.close();
  }
});
