import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { countWords, findWord } from '@linguetta/language';
import { normalizeLang } from '../src/lang.js';
import { validateCueAnnotations } from '../src/validate.js';
import { cacheKey, createDiskCache } from '../src/cache.js';
import { createMockProvider } from '../src/providers/mock.js';
import { createClaudeProvider, ProviderError } from '../src/providers/claude.js';
import { selectProvider } from '../src/config.js';
import { createClaudeCodeProvider } from '../src/providers/claude-code.js';
import { annotate, createApp } from '../src/app.js';
import { PT_IT } from '../src/dictionary.js';

const PT_IT_LANGS = { sourceLang: 'pt', targetLang: 'it' };

const SAMPLE = [
  'Eu não quero só ir às festas.',
  'Agora preciso de dinheiro para o carro.',
  'Ela disse que vai voltar amanhã de novo.',
  'A noite estava fria e a cidade vazia.',
  'Meu irmão comprou um livro novo.',
  'Você entendeu a pergunta?',
  'Vamos para a praia hoje com os amigos.',
  'Não tenho medo da verdade.',
];

test('normalizeLang devolve a tag BCP 47 canônica (escrita e região preservadas)', () => {
  assert.equal(normalizeLang('pt'), 'pt');
  assert.equal(normalizeLang('por'), 'pt');
  for (const v of ['pob', 'pt-BR', 'pt_br', 'PT-br', 'pb']) assert.equal(normalizeLang(v), 'pt-BR', v);
  assert.equal(normalizeLang('PT-PT'), 'pt-PT');
  assert.equal(normalizeLang('ita'), 'it');
  assert.equal(normalizeLang('ger'), 'de');
  assert.equal(normalizeLang('iw'), 'he');
  assert.equal(normalizeLang('zh-Hant'), 'zh-Hant');
  assert.equal(normalizeLang('zht'), 'zh-Hant');
  for (const v of ['', null, undefined, 42, '???', 'not a lang', 'Portuguese', 'italiano']) assert.equal(normalizeLang(v), null, String(v));
});

test('validateCueAnnotations: source por palavras inteiras do segmentador do idioma', () => {
  const pt = { sourceLang: 'pt', targetLang: 'it' };
  const one = (text, source) => validateCueAnnotations(text, [{ source, target: 'x' }], pt)[0]?.source ?? null;
  assert.equal(one('Eu não quero só ir às festas.', 'festas'), 'festas');
  assert.equal(one('Ação e reação.', 'ação'), 'Ação'); // sem diferenciar maiúsculas, cai na primeira inteira
  assert.equal(one('reação', 'ação'), null); // pedaço de palavra
  assert.equal(one('festa', 'festas'), null);
  assert.equal(one('festas', 'festa'), null);
  assert.equal(one('Não sei', 'nao'), null); // acento importa
  assert.equal(one('guarda-chuva', 'chuva'), null); // parte de palavra hifenizada
  assert.equal(one('Faça isso de\nnovo, por favor', 'de novo'), 'de\nnovo'); // atravessa quebra de linha
  assert.equal(one('Eu sei', 'Eu sei.'), null); // pontuação no source não vale
  assert.equal(one('Vou à praia amanha\u0303', 'amanhã'), 'amanha\u0303'); // NFD no texto, NFC no source
  assert.equal(countWords("Olá, tudo bem? Guarda-chuva d'água 3", 'pt'), 6);
});

test('validateCueAnnotations aceita anotações em japonês, chinês e tailandês', () => {
  const ja = validateCueAnnotations('私は毎朝パンを食べます', [{ source: '食べ', target: 'mangio', lemma: 'mangiare' }], { sourceLang: 'ja', targetLang: 'it' });
  assert.deepEqual(ja, [{ source: '食べ', target: 'mangio', lemma: 'mangiare' }]);
  const zh = validateCueAnnotations('我每天早上都学习中文。', [{ source: '学习', target: 'studio' }], { sourceLang: 'zh', targetLang: 'it' });
  assert.equal(zh[0]?.source, '学习');
  const th = validateCueAnnotations('ฉันกินข้าวทุกวัน', [{ source: 'กินข้าว', target: 'mangio' }], { sourceLang: 'th', targetLang: 'it' });
  assert.equal(th[0]?.source, 'กินข้าว');
  // leitura entra no Annotation quando vem do provider
  const r = validateCueAnnotations('Vamos comer.', [{ source: 'comer', target: '食べる', lemma: '食べる', reading: 'たべる' }], { sourceLang: 'pt', targetLang: 'ja' });
  assert.equal(r[0].reading, 'たべる');
});

test('validateCueAnnotations descarta source fora do texto, sobreposições e excesso', () => {
  const text = 'Eu não quero só ir às festas de novo.';
  const out = validateCueAnnotations(text, [
    { source: 'Festas', target: 'feste', ipa: '/x/', pos: 'subst.', meaning: 'm', example: 'e' },
    { source: 'fest', target: 'fest' },
    { source: 'carro', target: 'macchina' },
    { source: 'festas', target: 'feste' }, // duplicata/sobreposição
    { source: 'quero', target: '' }, // sem target
    { source: 'de novo', target: 'di nuovo', ipa: '' },
    { source: 'quero', target: 'voglio' }, // excede 2 por cue
  ], PT_IT_LANGS);
  assert.deepEqual(out, [
    { source: 'festas', target: 'feste', lemma: 'feste', ipa: '/x/', pos: 'subst.', meaning: 'm', example: 'e' },
    { source: 'de novo', target: 'di nuovo', lemma: 'di nuovo' },
  ]);
  assert.deepEqual(validateCueAnnotations(text, null), []);
});

test('dicionário mock tem ~200 entradas completas e sem palavras idênticas', () => {
  assert.ok(PT_IT.size >= 190, `só ${PT_IT.size} entradas`);
  for (const [k, e] of PT_IT) {
    for (const f of ['target', 'ipa', 'pos', 'meaning', 'example']) assert.ok(e[f], `${k}.${f}`);
    assert.notEqual(e.target.toLowerCase(), k, `${k} é idêntica`);
    assert.match(e.ipa, /^\/.+\/$/, `${k}.ipa`);
  }
});

test('provider mock: formato, densidade, máx. 2 por cue, determinístico', async () => {
  const mock = createMockProvider();
  const req = { sourceLang: 'pt', targetLang: 'it', nativeLanguage: 'pt-BR', density: 0.1, texts: SAMPLE };
  const a = await mock.annotate(req);
  const b = await mock.annotate(req);
  assert.deepEqual(a, b);
  assert.equal(a.length, SAMPLE.length);
  const total = a.flat().length;
  const words = SAMPLE.reduce((n, t) => n + countWords(t, 'pt'), 0);
  assert.equal(total, Math.round(0.1 * words), `total=${total} words=${words}`);
  for (const [i, anns] of a.entries()) {
    assert.ok(anns.length <= 2);
    for (const ann of anns) {
      assert.ok(findWord(SAMPLE[i], ann.source, 'pt'), ann.source);
      for (const f of ['source', 'target', 'reading', 'ipa', 'pos', 'meaning', 'example']) assert.equal(typeof ann[f], 'string');
    }
  }
  // espalha: com a cota menor que o nº de cues, ninguém ganha 2
  assert.ok(a.every((x) => x.length <= 1));

  const dense = await mock.annotate({ ...req, density: 0.5 });
  assert.ok(dense.flat().length > total);
  assert.ok(dense.every((x) => x.length <= 2));

  // capitalização e expressão multi-palavra
  const [[agora]] = await mock.annotate({ ...req, density: 1, texts: ['Agora sim.'] });
  assert.deepEqual([agora.source, agora.target], ['Agora', 'Adesso']);
  const [phr] = await mock.annotate({ ...req, density: 1, texts: ['Faça de novo, por favor.'] });
  assert.deepEqual(phr.map((x) => x.target), ['di nuovo', 'per favore']);

  // par sem dicionário (ou nativa que não é PT): formato válido, vazio, sem erro
  assert.deepEqual(await mock.annotate({ ...req, targetLang: 'es' }), SAMPLE.map(() => []));
  assert.deepEqual(await mock.annotate({ ...req, nativeLanguage: 'en' }), SAMPLE.map(() => []));
  assert.deepEqual(await mock.annotate({ ...req, sourceLang: 'ja', texts: ['私は毎朝パンを食べます'] }), [[]]);
});

test('cacheKey é estável e ignora ids', () => {
  const base = { provider: 'mock', model: 'm', sourceLang: 'pt', targetLang: 'it', nativeLanguage: 'pt', density: 0.1, texts: ['a', 'b'] };
  assert.equal(cacheKey(base), cacheKey({ ...base, texts: ['a', 'b'] }));
  assert.match(cacheKey(base), /^[0-9a-f]{64}$/);
  assert.equal(
    cacheKey(base),
    cacheKey({ texts: ['a', 'b'], density: 0.1, nativeLanguage: 'pt', targetLang: 'it', sourceLang: 'pt', model: 'm', provider: 'mock' }),
  );
  for (const change of [{ provider: 'claude' }, { model: 'x' }, { sourceLang: 'es' }, { targetLang: 'fr' }, { nativeLanguage: 'en' }, { density: 0.2 }, { texts: ['b', 'a'] }, { texts: ['ab'] }]) {
    assert.notEqual(cacheKey(base), cacheKey({ ...base, ...change }), JSON.stringify(change));
  }
});

test('annotate usa cache em disco e remapeia ids', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lingoblend-'));
  try {
    const cache = createDiskCache(dir);
    let calls = 0;
    const mock = createMockProvider();
    const provider = { ...mock, annotate: (r) => (calls++, mock.annotate(r)) };
    const cues = SAMPLE.map((text, i) => ({ id: `a${i}`, text }));
    const req = { sourceLang: 'pt', targetLang: 'it', nativeLanguage: 'pt', density: 0.2, cues };
    const r1 = await annotate({ provider, cache }, req);
    assert.equal(r1.cached, false);
    const r2 = await annotate({ provider, cache }, { ...req, cues: SAMPLE.map((text, i) => ({ id: `b${i}`, text })) });
    assert.equal(r2.cached, true);
    assert.equal(calls, 1);
    assert.deepEqual(Object.keys(r2.annotations), Object.keys(r1.annotations).map((k) => k.replace('a', 'b')));
    assert.deepEqual(Object.values(r2.annotations), Object.values(r1.annotations));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('selectProvider escolhe claude/claude-code/mock pelo ambiente', () => {
  assert.equal(selectProvider({}, { claudeCli: false }).name, 'mock');
  assert.equal(selectProvider({}, { claudeCli: true }).name, 'claude-code');
  assert.equal(selectProvider({}, { claudeCli: true }).model, 'haiku');
  assert.equal(selectProvider({ ANTHROPIC_API_KEY: 'sk-test' }, { claudeCli: true }).name, 'claude');
  assert.equal(selectProvider({ LINGOBLEND_PROVIDER: 'claude-code' }, { claudeCli: false }).name, 'claude-code');
  assert.equal(selectProvider({ ANTHROPIC_API_KEY: 'sk-test' }).name, 'claude');
  assert.equal(selectProvider({ ANTHROPIC_API_KEY: 'sk-test', LINGOBLEND_PROVIDER: 'mock' }).name, 'mock');
  const c = selectProvider({ ANTHROPIC_API_KEY: 'sk-test', LINGOBLEND_MODEL: 'claude-haiku-5-5' });
  assert.equal(c.model, 'claude-haiku-5-5');
  assert.throws(() => selectProvider({ LINGOBLEND_PROVIDER: 'gpt' }));
});

test('provider claude (cliente falso): mapeia cue, repete JSON inválido uma vez, erros viram ProviderError', async () => {
  const calls = [];
  const replies = [
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }] },
    {
      stop_reason: 'end_turn',
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            annotations: [
              { cue: 1, source: 'festas', target: 'feste', ipa: '/ˈfɛs.te/', pos: 'subst. fem. plural', meaning: 'festas', example: 'Andiamo alle feste.' },
              { cue: 9, source: 'x', target: 'y', ipa: '', pos: '', meaning: '', example: '' },
            ],
          }),
        },
      ],
    },
  ];
  const client = { beta: { messages: { create: async (p) => (calls.push(p), replies.shift()) } } };
  const p = createClaudeProvider({ client });
  const out = await p.annotate({ sourceLang: 'pt', targetLang: 'it', nativeLanguage: 'pt', density: 0.1, texts: [SAMPLE[0], SAMPLE[1]] });
  assert.equal(calls.length, 2);
  assert.equal(out[0][0].target, 'feste');
  assert.deepEqual(out[1], []);
  assert.equal(calls[0].model, 'claude-haiku-5-5');
  assert.equal(calls[0].output_config.format.type, 'json_schema');
  assert.match(calls[0].messages[0].content, /\[1\] Eu não quero/);

  const failing = createClaudeProvider({
    client: { beta: { messages: { create: async () => ({ stop_reason: 'refusal', content: [] }) } } },
  });
  await assert.rejects(failing.annotate({ sourceLang: 'pt', targetLang: 'it', nativeLanguage: 'pt', density: 0.1, texts: ['oi'] }), ProviderError);
});

test('provider claude-code (CLI falso): args, structured_output, repete saída inválida, erro de login', async () => {
  const calls = [];
  const ok = { is_error: false, structured_output: { annotations: [{ cue: 2, source: 'festas', target: 'feste', ipa: '', pos: '', meaning: '', example: '' }] } };
  const outputs = ['lixo', JSON.stringify(ok)];
  const run = async (bin, args, input) => (calls.push({ bin, args, input }), outputs.shift());
  const p = createClaudeCodeProvider({ run });
  const out = await p.annotate({ sourceLang: 'pt', targetLang: 'it', nativeLanguage: 'pt', density: 0.1, texts: ['a', 'Eu não quero festas.'] });
  assert.equal(calls.length, 2);
  assert.deepEqual(out[0], []);
  assert.equal(out[1][0].target, 'feste');
  const { args, input } = calls[0];
  assert.equal(args[args.indexOf('--model') + 1], 'haiku');
  assert.ok(args.includes('-p') && args.includes('--json-schema'));
  assert.equal(args[args.indexOf('--tools') + 1], '');
  assert.match(input, /\[2\] Eu não quero festas/);

  // structured_output ausente: cai no JSON de "result"
  const viaResult = createClaudeCodeProvider({ run: async () => JSON.stringify({ is_error: false, result: JSON.stringify(ok.structured_output) }) });
  assert.equal((await viaResult.annotate({ sourceLang: 'pt', targetLang: 'it', nativeLanguage: 'pt', density: 0.1, texts: ['a', 'b'] }))[1][0].source, 'festas');

  let n = 0;
  const unauth = createClaudeCodeProvider({ run: async () => (n++, JSON.stringify({ is_error: true, api_error_status: 401, result: 'Invalid API key' })) });
  await assert.rejects(unauth.annotate({ sourceLang: 'pt', targetLang: 'it', nativeLanguage: 'pt', density: 0.1, texts: ['oi'] }), (e) => e instanceof ProviderError && /login/.test(e.message));
  assert.equal(n, 1);
});

async function withServer(opts, fn) {
  const server = createApp({ log: {}, ...opts });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('HTTP: /health, /annotate (mock), CORS, erros', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lingoblend-'));
  try {
    await withServer({ provider: createMockProvider(), cache: createDiskCache(dir) }, async (base) => {
      let r = await fetch(`${base}/health`);
      assert.equal(r.status, 200);
      assert.equal(r.headers.get('access-control-allow-origin'), '*');
      assert.deepEqual(await r.json(), { ok: true, provider: 'mock', model: 'mock-dict-v1', mt: { available: false, model: null } });

      r = await fetch(`${base}/annotate`, { method: 'OPTIONS', headers: { Origin: 'http://localhost:8080', 'Access-Control-Request-Method': 'POST' } });
      assert.equal(r.status, 204);
      assert.match(r.headers.get('access-control-allow-headers'), /Content-Type/);

      const cues = SAMPLE.map((text, i) => ({ id: `c${i}`, text }));
      r = await fetch(`${base}/annotate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceLang: 'pob', targetLang: 'ita', nativeLanguage: 'pt-BR', density: 0.1, cues }),
      });
      assert.equal(r.status, 200);
      const body = await r.json();
      assert.equal(body.provider, 'mock');
      const ids = Object.keys(body.annotations);
      assert.ok(ids.length > 0);
      for (const id of ids) {
        const cue = cues.find((c) => c.id === id);
        assert.ok(cue, id);
        for (const a of body.annotations[id]) assert.ok(findWord(cue.text, a.source, 'pt'));
      }

      r = await fetch(`${base}/annotate`, { method: 'POST', body: '{nope' });
      assert.equal(r.status, 400);
      assert.ok((await r.json()).error);
      r = await fetch(`${base}/annotate`, { method: 'POST', body: JSON.stringify({ sourceLang: 'pt', targetLang: '??', nativeLanguage: 'pt', cues: [] }) });
      assert.equal(r.status, 400);
      assert.equal((await r.json()).code, 'invalid_target_lang');
      // nativeLanguage é obrigatório (sem padrão 'pt')
      r = await fetch(`${base}/annotate`, { method: 'POST', body: JSON.stringify({ sourceLang: 'pt', targetLang: 'it', cues: [] }) });
      assert.equal(r.status, 400);
      assert.equal((await r.json()).code, 'missing_native_language');
      r = await fetch(`${base}/annotate`, { method: 'POST', body: JSON.stringify({ sourceLang: 'pt', targetLang: 'it', nativeLanguage: 'português', cues: [] }) });
      assert.equal(r.status, 400);
      assert.equal((await r.json()).code, 'invalid_native_language');
      r = await fetch(`${base}/annotate`, { method: 'POST', body: 'x'.repeat(2 * 1024 * 1024 + 10) });
      assert.equal(r.status, 413);
      r = await fetch(`${base}/annotate`);
      assert.equal(r.status, 405);
      r = await fetch(`${base}/nada`);
      assert.equal(r.status, 404);
      assert.equal((await r.json()).code, 'not_found');
    });

    const broken = { name: 'claude', model: 'x', annotate: async () => { throw new ProviderError('Anthropic: falha de conexão'); } };
    await withServer({ provider: broken }, async (base) => {
      const r = await fetch(`${base}/annotate`, {
        method: 'POST',
        body: JSON.stringify({ sourceLang: 'pt', targetLang: 'it', nativeLanguage: 'pt', cues: [{ id: '1', text: 'Olá mundo' }] }),
      });
      assert.equal(r.status, 502);
      assert.deepEqual(await r.json(), { error: 'Anthropic: falha de conexão', code: 'provider_error' });
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
