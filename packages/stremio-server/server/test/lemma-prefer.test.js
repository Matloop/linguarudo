// lemma (forma de dicionário do target) e preferWords (palavras do banco do usuário primeiro).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateCueAnnotations } from '../src/validate.js';
import { cacheKey } from '../src/cache.js';
import { createMockProvider } from '../src/providers/mock.js';
import { buildUserMessage, createClaudeProvider, OUTPUT_SCHEMA } from '../src/providers/claude.js';
import { annotate, parseAnnotateRequest } from '../src/app.js';
import { PT_IT } from '../src/dictionary.js';

test('validate: lemma vem do provider (minúsculo) ou cai no target em minúsculas', () => {
  const text = 'Agora vamos às festas.';
  const out = validateCueAnnotations(text, [
    { source: 'festas', target: 'feste', lemma: ' Festa ' },
    { source: 'Agora', target: 'Adesso' },
  ]);
  assert.deepEqual(out.map((a) => a.lemma), ['festa', 'adesso']);
});

test('dicionário mock: toda entrada tem lemma; flexões apontam para a forma base', () => {
  for (const [k, e] of PT_IT) assert.ok(e.lemma && e.lemma === e.lemma.toLowerCase(), k);
  assert.equal(PT_IT.get('festas').lemma, 'festa');
  assert.equal(PT_IT.get('dias').lemma, 'giorno');
  assert.equal(PT_IT.get('quero').lemma, 'volere');
  assert.equal(PT_IT.get('bonita').lemma, 'bello');
  assert.equal(PT_IT.get('agora').lemma, 'adesso');
});

test('mock devolve lemma em cada anotação', async () => {
  const mock = createMockProvider();
  const [[a]] = await mock.annotate({ sourceLang: 'pt', targetLang: 'it', density: 1, texts: ['Eu não quero festas.'] });
  assert.ok(a.lemma);
  const all = (await mock.annotate({ sourceLang: 'pt', targetLang: 'it', density: 1, texts: ['Eu não quero ir às festas.'] }))[0];
  assert.deepEqual(all.map((x) => [x.target, x.lemma]), [['voglio', 'volere'], ['feste', 'festa']]);
});

test('mock: preferWords entra primeiro e conta na densidade; o resto completa com palavras novas', async () => {
  const mock = createMockProvider();
  const texts = [
    'Eu não quero só ir às festas.',
    'Agora preciso de dinheiro para o carro.',
    'Meu irmão comprou um livro novo.',
    'Vamos para a praia hoje com os amigos.',
  ];
  const req = { sourceLang: 'pt', targetLang: 'it', density: 0.1, texts };
  const base = (await mock.annotate(req)).flat();
  // escolhe lemas que o mock NÃO pegaria sozinho
  const notPicked = ['festa', 'libro', 'spiaggia', 'soldi'].filter((l) => !base.some((a) => a.lemma === l));
  assert.ok(notPicked.length >= 2, `base pegou ${base.map((a) => a.lemma)}`);
  const prefer = notPicked.slice(0, 2);

  const out = (await mock.annotate({ ...req, preferWords: prefer })).flat();
  assert.equal(out.length, base.length, 'mesma densidade');
  for (const l of prefer) assert.ok(out.some((a) => a.lemma === l), `faltou ${l}`);

  // densidade maior: além das preferidas, completa com outras
  const dense = (await mock.annotate({ ...req, density: 0.3, preferWords: prefer })).flat();
  assert.ok(dense.some((a) => !prefer.includes(a.lemma)));
});

test('parseAnnotateRequest: preferWords opcional, normalizado (minúsculas, sem duplicatas, ordenado)', () => {
  const base = { sourceLang: 'pt', targetLang: 'it', cues: [] };
  assert.deepEqual(parseAnnotateRequest(base).preferWords, []);
  assert.deepEqual(parseAnnotateRequest({ ...base, preferWords: [' Festa', 'giorno', 'festa', '', 42] }).preferWords, ['festa', 'giorno']);
  assert.throws(() => parseAnnotateRequest({ ...base, preferWords: 'festa' }), /preferWords/);
  assert.throws(() => parseAnnotateRequest({ ...base, preferWords: Array.from({ length: 1001 }, (_, i) => `w${i}`) }), /preferWords/);
});

test('cacheKey muda com preferWords', () => {
  const base = { provider: 'mock', model: 'm', sourceLang: 'pt', targetLang: 'it', density: 0.1, texts: ['a'] };
  assert.equal(cacheKey(base), cacheKey({ ...base, preferWords: [] }));
  assert.notEqual(cacheKey(base), cacheKey({ ...base, preferWords: ['festa'] }));
});

test('annotate repassa preferWords ao provider', async () => {
  let seen = null;
  const provider = { name: 'fake', model: 'x', annotate: async (r) => ((seen = r.preferWords), r.texts.map(() => [])) };
  await annotate({ provider, cache: null }, { sourceLang: 'pt', targetLang: 'it', density: 0.1, preferWords: ['festa'], cues: [{ id: '1', text: 'oi festas' }] });
  assert.deepEqual(seen, ['festa']);
});

test('claude: schema pede lemma e a mensagem lista as palavras preferidas', async () => {
  const item = OUTPUT_SCHEMA.properties.annotations.items;
  assert.ok(item.properties.lemma && item.required.includes('lemma'));
  const msg = buildUserMessage({ sourceLang: 'pt', targetLang: 'it', density: 0.1, texts: ['Vamos às festas.'], preferWords: ['festa', 'giorno'] });
  assert.match(msg, /festa, giorno/);
  assert.doesNotMatch(buildUserMessage({ sourceLang: 'pt', targetLang: 'it', density: 0.1, texts: ['x'] }), /studying/i);

  const client = {
    beta: {
      messages: {
        create: async () => ({
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: JSON.stringify({ annotations: [{ cue: 1, source: 'festas', target: 'feste', lemma: 'festa', ipa: '', pos: '', meaning: '', example: '' }] }) }],
        }),
      },
    },
  };
  const out = await createClaudeProvider({ client }).annotate({ sourceLang: 'pt', targetLang: 'it', density: 0.1, texts: ['Vamos às festas.'] });
  assert.equal(out[0][0].lemma, 'festa');
});
