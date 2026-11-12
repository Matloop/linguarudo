// lemma (forma de dicionário do target) e preferWords (palavras do banco do usuário primeiro).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateCueAnnotations } from '../src/validate.js';
import { cacheKey } from '../src/cache.js';
import { createMockProvider } from '../src/providers/mock.js';
import { annotateSystem, buildUserMessage, createClaudeProvider, OUTPUT_SCHEMA } from '../src/providers/claude.js';
import { annotate, parseAnnotateRequest } from '../src/app.js';
import { PT_IT } from '../src/dictionary.js';

test('validate: lemma vem do provider com a caixa do dicionário, ou cai no target', () => {
  const text = 'Agora vamos às festas.';
  const out = validateCueAnnotations(text, [
    { source: 'festas', target: 'feste', lemma: ' festa ' },
    { source: 'Agora', target: 'Adesso' },
  ], { sourceLang: 'pt', targetLang: 'it' });
  assert.deepEqual(out.map((a) => a.lemma), ['festa', 'Adesso']);
  // alemão: substantivo fica com maiúscula; lema gritado desce para minúsculas
  const de = validateCueAnnotations('As casas e a noite.', [
    { source: 'casas', target: 'Häuser', lemma: 'Haus' },
    { source: 'noite', target: 'NACHT', lemma: 'NACHT' },
  ], { sourceLang: 'pt', targetLang: 'de' });
  assert.deepEqual(de.map((a) => a.lemma), ['Haus', 'nacht']);
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
  const [[a]] = await mock.annotate({ sourceLang: 'pt', targetLang: 'it', nativeLanguage: 'pt', wordCoverage: 0.5, texts: ['Eu não quero festas.'] });
  assert.ok(a.lemma);
  const all = (await mock.annotate({ sourceLang: 'pt', targetLang: 'it', nativeLanguage: 'pt', wordCoverage: 0.5, texts: ['Eu não quero ir às festas.'] }))[0];
  assert.deepEqual(all.map((x) => [x.target, x.lemma]).sort(), [['feste', 'festa'], ['voglio', 'volere']]);
});

test('mock: as palavras do banco vêm primeiro entre as candidatas da fala', async () => {
  const mock = createMockProvider();
  const req = { sourceLang: 'pt', targetLang: 'it', nativeLanguage: 'pt', wordCoverage: 0.3, texts: ['Eu não quero só ir às festas com o meu irmão agora.'] };
  const [base] = await mock.annotate(req);
  assert.ok(base.length >= 3);
  const last = base[base.length - 1].lemma;
  const [out] = await mock.annotate({ ...req, preferWords: [last] });
  assert.equal(out[0].lemma, last);
  assert.equal(out.length, base.length);
});

test('parseAnnotateRequest: preferWords opcional, normalizado (caixa mantida, sem duplicatas pela lemmaKey, ordenado)', () => {
  const base = { sourceLang: 'pt', targetLang: 'it', nativeLanguage: 'pt', engine: 'ai', cues: [] };
  assert.deepEqual(parseAnnotateRequest(base).preferWords, []);
  assert.deepEqual(parseAnnotateRequest({ ...base, preferWords: [' Festa', 'giorno', 'festa', '', 42] }).preferWords, ['Festa', 'giorno']);
  assert.deepEqual(parseAnnotateRequest({ ...base, targetLang: 'de', preferWords: ['Haus', 'gehen', 'haus'] }).preferWords, ['gehen', 'Haus']);
  assert.throws(() => parseAnnotateRequest({ ...base, preferWords: 'festa' }), /preferWords/);
  assert.throws(() => parseAnnotateRequest({ ...base, preferWords: Array.from({ length: 1001 }, (_, i) => `w${i}`) }), /preferWords/);
});

test('cacheKey muda com preferWords', () => {
  const base = { provider: 'mock', model: 'm', sourceLang: 'pt', targetLang: 'it', nativeLanguage: 'pt', request: 0.3, texts: ['a'] };
  assert.equal(cacheKey(base), cacheKey({ ...base, preferWords: [] }));
  assert.notEqual(cacheKey(base), cacheKey({ ...base, preferWords: ['festa'] }));
});

test('annotate repassa preferWords ao provider', async () => {
  let seen = null;
  const provider = { name: 'fake', model: 'x', annotate: async (r) => ((seen = r.preferWords), r.texts.map(() => [])) };
  await annotate({ provider, cache: null }, { sourceLang: 'pt', targetLang: 'it', nativeLanguage: 'pt', wordCoverage: 0.1, preferWords: ['festa'], cues: [{ id: '1', text: 'oi festas' }] });
  assert.deepEqual(seen, ['festa']);
});

test('claude: schema pede lemma e a mensagem lista as palavras preferidas', async () => {
  const item = OUTPUT_SCHEMA.properties.annotations.items;
  assert.ok(item.properties.lemma && item.required.includes('lemma'));
  const msg = buildUserMessage({ sourceLang: 'pt', targetLang: 'it', nativeLanguage: 'pt', wordCoverage: 0.1, texts: ['Vamos às festas.'], preferWords: ['festa', 'giorno'] });
  assert.match(msg, /festa, giorno/);
  assert.doesNotMatch(buildUserMessage({ sourceLang: 'pt', targetLang: 'it', nativeLanguage: 'pt', wordCoverage: 0.1, texts: ['x'] }), /studying/i);

  const client = {
    beta: {
      messages: {
        create: async () => ({
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: JSON.stringify({ annotations: [{ cue: 1, source: 'festas', target: 'feste', lemma: 'festa', ipa: '', pos: '', meaning: '', translatedLine: '' }] }) }],
        }),
      },
    },
  };
  const out = await createClaudeProvider({ client }).annotate({ sourceLang: 'pt', targetLang: 'it', nativeLanguage: 'pt', wordCoverage: 0.1, texts: ['Vamos às festas.'] });
  assert.equal(out[0][0].lemma, 'festa');
});

test('parseAnnotateRequest: tags BCP 47 canônicas e nativeLanguage obrigatório', () => {
  const r = parseAnnotateRequest({ sourceLang: 'pob', targetLang: 'zht', nativeLanguage: 'PT_br', engine: 'ai', cues: [] });
  assert.deepEqual([r.sourceLang, r.targetLang, r.nativeLanguage], ['pt-BR', 'zh-Hant', 'pt-BR']);
  assert.throws(() => parseAnnotateRequest({ sourceLang: 'pt', targetLang: 'it', cues: [] }), (e) => e.status === 400 && e.code === 'missing_native_language');
  assert.throws(() => parseAnnotateRequest({ sourceLang: 'pt', targetLang: 'it', nativeLanguage: '??', cues: [] }), (e) => e.code === 'invalid_native_language');
});

test('claude: prompt do blend é neutro e usa a língua nativa; schema pede reading', async () => {
  const item = OUTPUT_SCHEMA.properties.annotations.items;
  assert.ok(item.required.includes('reading'));
  const calls = [];
  const client = {
    beta: { messages: { create: async (p) => (calls.push(p), { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"annotations":[]}' }] }) } },
  };
  await createClaudeProvider({ client }).annotate({ sourceLang: 'en', targetLang: 'ja', nativeLanguage: 'de', wordCoverage: 0.1, texts: ['I eat bread every morning.'] });
  const prompt = calls[0].system[0].text + calls[0].messages[0].content;
  assert.match(prompt, /speaker of German/);
  assert.match(prompt, /meaning in German/);
  assert.match(prompt, /learn Japanese/);
  assert.doesNotMatch(prompt, /Brazilian Portuguese/);
  assert.doesNotMatch(annotateSystem({ sourceLang: 'pt', targetLang: 'it', nativeLanguage: 'en' }), /Brazilian|Portuguese speaker/);
});

test('a mensagem conta palavras pelo segmentador do idioma da cue (japonês sem espaços)', () => {
  const msg = buildUserMessage({ sourceLang: 'ja', targetLang: 'it', nativeLanguage: 'pt', wordCoverage: 0.5, texts: ['私は毎朝パンを食べます'] });
  const words = Number(msg.match(/and (\d+) words/)[1]);
  assert.ok(words > 1, `contou ${words}`);
});
