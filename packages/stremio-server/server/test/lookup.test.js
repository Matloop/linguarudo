import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApp } from '../src/app.js';
import { createDiskCache } from '../src/cache.js';
import { lookup, parseLookupRequest, parseTranslateRequest, translate, validateLookup } from '../src/lookup.js';
import { createMockProvider } from '../src/providers/mock.js';
import { LOOKUP_SCHEMA, buildLookupMessage, createClaudeProvider } from '../src/providers/claude.js';
import { createClaudeCodeProvider } from '../src/providers/claude-code.js';

const SENT = 'Facevo finta di dormire,\nma ti ho sentito.';

test('parseLookupRequest normaliza lang, espaço da seleção e exige texto', () => {
  assert.deepEqual(parseLookupRequest({ lang: 'ita', text: '  facevo   finta di ', sentence: SENT }), {
    lang: 'it',
    text: 'facevo finta di',
    sentence: SENT,
  });
  assert.equal(parseLookupRequest({ lang: 'it', text: 'ciao' }).sentence, 'ciao');
  assert.throws(() => parseLookupRequest({ lang: 'it', text: ' ' }), /text vazio/);
  assert.throws(() => parseLookupRequest({ lang: '', text: 'ciao' }), /lang/);
  assert.throws(() => parseLookupRequest({ lang: 'it', text: 'x'.repeat(81) }), /80/);
  assert.throws(() => parseLookupRequest([]), /objeto/);
});

test('parseTranslateRequest: targetLang padrão pt', () => {
  assert.deepEqual(parseTranslateRequest({ sourceLang: 'it', text: ' Ciao ' }), { sourceLang: 'it', targetLang: 'pt', text: 'Ciao' });
  assert.throws(() => parseTranslateRequest({ sourceLang: 'it', text: '' }), /text vazio/);
});

test('validateLookup corta campos e cai na seleção quando falta o lema', () => {
  assert.equal(validateLookup('Facevo', {}).lemma, 'Facevo');
  assert.equal(validateLookup('x', { lemma: '  fare   finta di ' }).lemma, 'fare finta di');
  assert.equal(validateLookup('x', { lemma: 'CIAO' }).lemma, 'ciao');
  assert.equal(validateLookup('x', null).translation, '');
});

test('mock: acha a palavra italiana pela forma ou pelo lema', async () => {
  const p = createMockProvider();
  const r = await lookup({ provider: p, cache: null }, { lang: 'it', text: 'giorni', sentence: 'Tre giorni fa.' });
  assert.equal(r.result.lemma, 'giorno');
  assert.ok(r.result.meaning);
  const miss = await lookup({ provider: p, cache: null }, { lang: 'it', text: 'Pippo', sentence: 'Pippo.' });
  assert.equal(miss.result.lemma, 'pippo');
  assert.equal(miss.result.meaning, '');
});

test('lookup e translate usam o cache em disco', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lingoblend-lk-'));
  try {
    let lookups = 0;
    let translations = 0;
    const provider = {
      name: 'fake',
      model: 'm',
      lookup: async () => (lookups++, { lemma: 'fare finta di', ipa: '/x/', pos: 'expr.', meaning: 'fingir', translation: 'Eu fingia dormir.' }),
      translate: async () => (translations++, 'Eu fingia dormir.'),
    };
    const cache = createDiskCache(dir);
    const req = { lang: 'it', text: 'Facevo finta di', sentence: SENT };
    assert.equal((await lookup({ provider, cache }, req)).cached, false);
    const again = await lookup({ provider, cache }, { ...req, text: 'facevo finta di' });
    assert.equal(again.cached, true);
    assert.equal(again.result.lemma, 'fare finta di');
    assert.equal(lookups, 1);

    const t = { sourceLang: 'it', targetLang: 'pt', text: SENT };
    assert.equal((await translate({ provider, cache }, t)).translation, 'Eu fingia dormir.');
    assert.equal((await translate({ provider, cache }, t)).cached, true);
    assert.equal(translations, 1);
    assert.equal((await translate({ provider, cache }, { ...t, targetLang: 'it' })).translation, SENT);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('claude: lookup manda a fala e a seleção e devolve o objeto', async () => {
  const calls = [];
  const reply = { lemma: 'fare finta di', ipa: '/ˈfa.re ˈfin.ta di/', pos: 'expr.', meaning: 'fingir', translation: 'Eu fingia dormir.' };
  const client = {
    beta: { messages: { create: async (p) => (calls.push(p), { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(reply) }] }) } },
  };
  const p = createClaudeProvider({ client });
  assert.deepEqual(await p.lookup({ lang: 'it', text: 'facevo finta di', sentence: SENT }), reply);
  assert.equal(calls[0].output_config.format.schema, LOOKUP_SCHEMA);
  assert.match(calls[0].messages[0].content, /dormire, \/ ma ti ho sentito/);
  assert.match(buildLookupMessage({ lang: 'it', text: 'x', sentence: 'y' }), /Italian/);

  const t = createClaudeProvider({
    client: { beta: { messages: { create: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"translation":"Oi"}' }] }) } } },
  });
  assert.equal(await t.translate({ sourceLang: 'it', targetLang: 'pt', text: 'Ciao' }), 'Oi');
});

test('claude-code: lookup usa o schema de consulta e repete saída inválida', async () => {
  const calls = [];
  const outputs = ['lixo', JSON.stringify({ is_error: false, structured_output: { lemma: 'giorno', ipa: '', pos: '', meaning: 'dia', translation: '' } })];
  const p = createClaudeCodeProvider({ run: async (bin, args, input) => (calls.push({ args, input }), outputs.shift()) });
  assert.equal((await p.lookup({ lang: 'it', text: 'giorni', sentence: 'Tre giorni.' })).lemma, 'giorno');
  assert.equal(calls.length, 2);
  assert.match(calls[0].args[calls[0].args.indexOf('--json-schema') + 1], /translation/);
  assert.match(calls[0].input, /Selection: giorni/);
});

test('HTTP: /lookup e /translate', async () => {
  const server = createApp({ provider: createMockProvider(), log: {} });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    let r = await post('/lookup', { lang: 'it', text: 'notte', sentence: 'Buona notte.' });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    assert.equal((await r.json()).lemma, 'notte');
    r = await post('/lookup', { lang: 'it', text: '' });
    assert.equal(r.status, 400);
    r = await post('/translate', { sourceLang: 'it', text: 'Ciao' });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { translation: '' });
    r = await fetch(`${base}/lookup`);
    assert.equal(r.status, 405);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
