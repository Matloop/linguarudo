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

const code = (c) => (e) => e.status === 400 && e.code === c;

test('parseLookupRequest normaliza idiomas, espaço da seleção e exige texto e nativeLanguage', () => {
  assert.deepEqual(parseLookupRequest({ lang: 'ita', nativeLanguage: 'pob', text: '  facevo   finta di ', sentence: SENT }), {
    lang: 'it',
    nativeLanguage: 'pt-BR',
    text: 'facevo finta di',
    sentence: SENT,
  });
  assert.equal(parseLookupRequest({ lang: 'zh-Hant', nativeLanguage: 'en', text: '學習' }).lang, 'zh-Hant');
  assert.equal(parseLookupRequest({ lang: 'it', nativeLanguage: 'pt', text: 'ciao' }).sentence, 'ciao');
  assert.throws(() => parseLookupRequest({ lang: 'it', nativeLanguage: 'pt', text: ' ' }), code('empty_text'));
  assert.throws(() => parseLookupRequest({ lang: '', nativeLanguage: 'pt', text: 'ciao' }), code('missing_lang'));
  assert.throws(() => parseLookupRequest({ lang: 'italiano', nativeLanguage: 'pt', text: 'ciao' }), code('invalid_lang'));
  assert.throws(() => parseLookupRequest({ lang: 'it', text: 'ciao' }), code('missing_native_language'));
  assert.throws(() => parseLookupRequest({ lang: 'it', nativeLanguage: 'xx-??', text: 'ciao' }), code('invalid_native_language'));
  assert.throws(() => parseLookupRequest({ lang: 'it', nativeLanguage: 'pt', text: 'x'.repeat(81) }), code('text_too_long'));
  assert.throws(() => parseLookupRequest([]), code('invalid_body'));
});

test('parseTranslateRequest: traduz para nativeLanguage, sem padrão', () => {
  assert.deepEqual(parseTranslateRequest({ sourceLang: 'it', nativeLanguage: 'de', text: ' Ciao ' }), { sourceLang: 'it', nativeLanguage: 'de', text: 'Ciao' });
  assert.throws(() => parseTranslateRequest({ sourceLang: 'it', text: 'Ciao' }), code('missing_native_language'));
  assert.throws(() => parseTranslateRequest({ sourceLang: 'it', nativeLanguage: 'pt', text: '' }), code('empty_text'));
});

test('validateLookup corta campos e cai na seleção quando falta o lema', () => {
  assert.equal(validateLookup('Facevo', {}, 'it').lemma, 'Facevo');
  assert.equal(validateLookup('x', { lemma: '  fare   finta di ' }, 'it').lemma, 'fare finta di');
  assert.equal(validateLookup('x', { lemma: 'CIAO' }, 'it').lemma, 'ciao');
  assert.equal(validateLookup('x', null, 'it').translation, '');
  assert.equal(validateLookup('x', null, 'it').reading, '');
  assert.equal(validateLookup('x', { lemma: '食べる', reading: 'たべる' }, 'ja').reading, 'たべる');
});

test('lookup em alemão mantém a maiúscula do substantivo (Haus)', async () => {
  const provider = { name: 'fake', model: 'm', lookup: async () => ({ lemma: 'Haus', reading: '', ipa: '/haʊ̯s/', pos: 'Subst. n.', meaning: 'casa', translation: '' }) };
  const r = await lookup({ provider, cache: null }, { lang: 'de', nativeLanguage: 'pt', text: 'Häuser', sentence: 'Die Häuser sind alt.' });
  assert.equal(r.result.lemma, 'Haus');
  // seleção toda em maiúsculas cai para minúsculas só em escrita com caixa
  assert.equal(validateLookup('HAUS', {}, 'de').lemma, 'haus');
  assert.equal(validateLookup('ДОМ', {}, 'ru').lemma, 'дом');
  assert.equal(validateLookup('家', {}, 'ja').lemma, '家');
});

test('mock: acha a palavra italiana pela forma ou pelo lema', async () => {
  const p = createMockProvider();
  const r = await lookup({ provider: p, cache: null }, { lang: 'it', nativeLanguage: 'pt-BR', text: 'giorni', sentence: 'Tre giorni fa.' });
  assert.equal(r.result.lemma, 'giorno');
  assert.ok(r.result.meaning);
  const miss = await lookup({ provider: p, cache: null }, { lang: 'it', nativeLanguage: 'pt', text: 'Pippo', sentence: 'Pippo.' });
  assert.equal(miss.result.lemma, 'Pippo'); // nome próprio: a caixa fica
  assert.equal(miss.result.meaning, '');
  // par sem dicionário: formato válido, vazio
  const other = await lookup({ provider: p, cache: null }, { lang: 'ja', nativeLanguage: 'en', text: '食べ', sentence: '食べます' });
  assert.deepEqual(other.result, { lemma: '食べ', reading: '', ipa: '', pos: '', meaning: '', translation: '' });
  assert.equal((await lookup({ provider: p, cache: null }, { lang: 'it', nativeLanguage: 'en', text: 'giorni', sentence: 'x' })).result.meaning, '');
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
    const req = { lang: 'it', nativeLanguage: 'pt', text: 'Facevo finta di', sentence: SENT };
    assert.equal((await lookup({ provider, cache }, req)).cached, false);
    const again = await lookup({ provider, cache }, { ...req, text: 'facevo finta di' });
    assert.equal(again.cached, true);
    assert.equal(again.result.lemma, 'fare finta di');
    assert.equal(lookups, 1);
    // a chave inclui a língua nativa: outra nativa consulta de novo
    assert.equal((await lookup({ provider, cache }, { ...req, nativeLanguage: 'en' })).cached, false);
    assert.equal(lookups, 2);

    const t = { sourceLang: 'it', nativeLanguage: 'pt', text: SENT };
    assert.equal((await translate({ provider, cache }, t)).translation, 'Eu fingia dormir.');
    assert.equal((await translate({ provider, cache }, t)).cached, true);
    assert.equal(translations, 1);
    assert.equal((await translate({ provider, cache }, { ...t, nativeLanguage: 'en' })).cached, false);
    assert.equal((await translate({ provider, cache }, { ...t, nativeLanguage: 'it-CH' })).translation, SENT);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('claude: lookup manda a fala e a seleção e devolve o objeto', async () => {
  const calls = [];
  const reply = { lemma: 'fare finta di', reading: '', ipa: '/ˈfa.re ˈfin.ta di/', pos: 'expr.', meaning: 'fingir', translation: 'Eu fingia dormir.' };
  const client = {
    beta: { messages: { create: async (p) => (calls.push(p), { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(reply) }] }) } },
  };
  const p = createClaudeProvider({ client });
  assert.deepEqual(await p.lookup({ lang: 'it', nativeLanguage: 'de', text: 'facevo finta di', sentence: SENT }), reply);
  assert.equal(calls[0].output_config.format.schema, LOOKUP_SCHEMA);
  assert.ok(LOOKUP_SCHEMA.required.includes('reading'));
  assert.match(calls[0].messages[0].content, /dormire, \/ ma ti ho sentito/);
  const system = calls[0].system[0].text;
  assert.match(system, /speaker of German learn Italian/);
  assert.match(system, /German translation of the whole subtitle line/);
  assert.doesNotMatch(system + calls[0].messages[0].content, /Brazilian Portuguese/);
  assert.match(buildLookupMessage({ lang: 'it', nativeLanguage: 'ja', text: 'x', sentence: 'y' }), /Italian[\s\S]*Japanese/);

  const t = createClaudeProvider({
    client: { beta: { messages: { create: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"translation":"Oi"}' }] }) } } },
  });
  assert.equal(await t.translate({ sourceLang: 'it', nativeLanguage: 'pt', text: 'Ciao' }), 'Oi');
});

test('claude-code: lookup usa o schema de consulta e repete saída inválida', async () => {
  const calls = [];
  const outputs = ['lixo', JSON.stringify({ is_error: false, structured_output: { lemma: 'giorno', ipa: '', pos: '', meaning: 'dia', translation: '' } })];
  const p = createClaudeCodeProvider({ run: async (bin, args, input) => (calls.push({ args, input }), outputs.shift()) });
  assert.equal((await p.lookup({ lang: 'it', nativeLanguage: 'pt', text: 'giorni', sentence: 'Tre giorni.' })).lemma, 'giorno');
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
    let r = await post('/lookup', { lang: 'it', nativeLanguage: 'pt', text: 'notte', sentence: 'Buona notte.' });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    assert.equal((await r.json()).lemma, 'notte');
    r = await post('/lookup', { lang: 'it', nativeLanguage: 'pt', text: '' });
    assert.equal(r.status, 400);
    assert.equal((await r.json()).code, 'empty_text');
    r = await post('/lookup', { lang: 'it', text: 'notte' });
    assert.equal(r.status, 400);
    assert.deepEqual(await r.json(), { error: 'nativeLanguage ausente', code: 'missing_native_language' });
    r = await post('/translate', { sourceLang: 'it', text: 'Ciao' });
    assert.equal(r.status, 400);
    assert.equal((await r.json()).code, 'missing_native_language');
    r = await post('/translate', { sourceLang: 'it', nativeLanguage: 'pt', text: 'Ciao' });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { translation: '' });
    r = await fetch(`${base}/lookup`);
    assert.equal(r.status, 405);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
