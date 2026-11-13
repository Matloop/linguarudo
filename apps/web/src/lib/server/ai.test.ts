import { describe, expect, test } from 'bun:test';
import {
	AiError,
	COOLDOWN_MS,
	createAiChain,
	geminiProvider,
	groqProvider,
	type JsonRequest
} from './ai';
import { parseSuggestRequest, parseSuggestion, suggestRequest } from './suggest';

type Call = { url: string; init: RequestInit; body: Record<string, unknown> };

/** fetch falso: responde com a próxima resposta da fila do host e guarda a chamada. */
function fakeFetch(routes: Record<string, (() => Response)[]>) {
	const calls: Call[] = [];
	const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
		const url = String(input);
		calls.push({ url, init, body: JSON.parse(String(init.body)) });
		const host = new URL(url).host;
		const next = routes[host]?.shift();
		if (!next) throw new Error(`sem resposta para ${host}`);
		return next();
	}) as typeof globalThis.fetch;
	return { fetch, calls };
}

const GROQ = 'api.groq.com';
const GEMINI = 'generativelanguage.googleapis.com';

const ok = (content: unknown) => () =>
	Response.json({
		choices: [
			{
				message: { content: typeof content === 'string' ? content : JSON.stringify(content) },
				finish_reason: 'stop'
			}
		]
	});
const status = (code: number) => () =>
	Response.json({ error: { message: `erro ${code}` } }, { status: code });

const req: JsonRequest<{ word: string }> = {
	system: 'sys',
	user: 'usr',
	schema: { type: 'object' },
	schemaName: 'teste',
	maxTokens: 500,
	parse: (d) =>
		d && typeof (d as { word?: unknown }).word === 'string'
			? { word: (d as { word: string }).word }
			: null
};

const quiet = { warn() {} };
const both = () => [groqProvider('gk'), geminiProvider('gm')];

describe('createAiChain', () => {
	test('corpo do pedido: modelo, schema strict, teto de tokens e raciocínio de cada provider', async () => {
		const { fetch, calls } = fakeFetch({ [GROQ]: [status(500)], [GEMINI]: [ok({ word: 'x' })] });
		await createAiChain(both(), { fetch, log: quiet }).json(req);

		const [groq, gemini] = calls;
		expect(groq.url).toBe('https://api.groq.com/openai/v1/chat/completions');
		expect(groq.init.method).toBe('POST');
		expect((groq.init.headers as Record<string, string>).authorization).toBe('Bearer gk');
		expect(groq.body).toEqual({
			model: 'openai/gpt-oss-120b',
			messages: [
				{ role: 'system', content: 'sys' },
				{ role: 'user', content: 'usr' }
			],
			response_format: {
				type: 'json_schema',
				json_schema: { name: 'teste', schema: { type: 'object' }, strict: true }
			},
			max_completion_tokens: 500,
			temperature: 0.2,
			reasoning_effort: 'low',
			include_reasoning: false
		});

		expect(gemini.url).toBe(
			'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
		);
		expect((gemini.init.headers as Record<string, string>).authorization).toBe('Bearer gm');
		expect(gemini.body.model).toBe('gemini-3.5-flash-lite');
		expect(gemini.body.max_tokens).toBe(500);
		expect(gemini.body.reasoning_effort).toBe('low');
		expect(gemini.body).not.toHaveProperty('temperature');
		expect(gemini.body).not.toHaveProperty('max_completion_tokens');
	});

	test('modelo trocado por variável; outro modelo do Groq sem campos de raciocínio', () => {
		expect(groqProvider('k', 'llama-x').extra).toEqual({ temperature: 0.2 });
		expect(geminiProvider('k', 'gemini-4-hydrogen').model).toBe('gemini-4-hydrogen');
		expect(groqProvider('k', '').model).toBe('openai/gpt-oss-120b');
	});

	test('Groq responde: o Gemini nem é chamado', async () => {
		const { fetch, calls } = fakeFetch({ [GROQ]: [ok({ word: 'volere' })] });
		const out = await createAiChain(both(), { fetch, log: quiet }).json(req);
		expect(out).toEqual({ word: 'volere' });
		expect(calls).toHaveLength(1);
	});

	test('Groq 429: usa o Gemini', async () => {
		const { fetch, calls } = fakeFetch({ [GROQ]: [status(429)], [GEMINI]: [ok({ word: 'g' })] });
		const out = await createAiChain(both(), { fetch, log: quiet }).json(req);
		expect(out).toEqual({ word: 'g' });
		expect(calls.map((c) => new URL(c.url).host)).toEqual([GROQ, GEMINI]);
	});

	test('saída malformada (não JSON, fora do formato) ou erro de rede: cai no próximo', async () => {
		for (const bad of [
			ok('isto não é json'),
			ok({ other: 1 }),
			() => {
				throw new TypeError('fetch failed');
			}
		]) {
			const { fetch } = fakeFetch({ [GROQ]: [bad], [GEMINI]: [ok({ word: 'g' })] });
			expect(await createAiChain(both(), { fetch, log: quiet }).json(req)).toEqual({ word: 'g' });
		}
	});

	test('aceita JSON em cerca ```json', async () => {
		const { fetch } = fakeFetch({ [GROQ]: [ok('```json\n{"word":"a"}\n```')] });
		expect(await createAiChain(both(), { fetch, log: quiet }).json(req)).toEqual({ word: 'a' });
	});

	test('sem chave: pula o provider; sem nenhuma: unavailable sem chamar nada', async () => {
		const { fetch, calls } = fakeFetch({ [GEMINI]: [ok({ word: 'g' })] });
		const chain = createAiChain([groqProvider(''), geminiProvider('gm')], { fetch, log: quiet });
		expect(await chain.json(req)).toEqual({ word: 'g' });
		expect(calls).toHaveLength(1);

		const none = createAiChain([groqProvider(''), geminiProvider('')], { fetch, log: quiet });
		const err = await none.json(req).catch((e) => e);
		expect(err).toBeInstanceOf(AiError);
		expect(err.kind).toBe('unavailable');
		expect(calls).toHaveLength(1);
	});

	test('os dois 429: rate_limit; um 429 e outro 500: upstream', async () => {
		const a = fakeFetch({ [GROQ]: [status(429)], [GEMINI]: [status(429)] });
		const e1 = await createAiChain(both(), { fetch: a.fetch, log: quiet })
			.json(req)
			.catch((e) => e);
		expect(e1).toBeInstanceOf(AiError);
		expect(e1.kind).toBe('rate_limit');

		const b = fakeFetch({ [GROQ]: [status(429)], [GEMINI]: [status(500)] });
		const e2 = await createAiChain(both(), { fetch: b.fetch, log: quiet })
			.json(req)
			.catch((e) => e);
		expect(e2.kind).toBe('upstream');
	});

	test('cooldown: depois de um 429 o Groq fica de fora por 60 s', async () => {
		let t = 1_000_000;
		const { fetch, calls } = fakeFetch({
			[GROQ]: [status(429), ok({ word: 'groq' })],
			[GEMINI]: [ok({ word: 'g1' }), ok({ word: 'g2' })]
		});
		const chain = createAiChain(both(), { fetch, log: quiet, now: () => t });
		const hosts = () => calls.map((c) => new URL(c.url).host);

		expect(await chain.json(req)).toEqual({ word: 'g1' });
		t += COOLDOWN_MS - 1;
		expect(await chain.json(req)).toEqual({ word: 'g2' });
		expect(hosts()).toEqual([GROQ, GEMINI, GEMINI]);

		t += 1;
		expect(await chain.json(req)).toEqual({ word: 'groq' });
		expect(hosts()).toEqual([GROQ, GEMINI, GEMINI, GROQ]);
	});

	test('todos em cooldown: rate_limit sem chamar ninguém', async () => {
		let t = 0;
		const { fetch, calls } = fakeFetch({ [GROQ]: [status(429)], [GEMINI]: [status(429)] });
		const chain = createAiChain(both(), { fetch, log: quiet, now: () => t });
		await chain.json(req).catch(() => {});
		t += 1000;
		const err = await chain.json(req).catch((e) => e);
		expect(err.kind).toBe('rate_limit');
		expect(calls).toHaveLength(2);
	});
});

describe('parseSuggestRequest', () => {
	const study = ['it', 'ja'];

	test('normaliza texto e frase; idioma canônico', () => {
		expect(
			parseSuggestRequest({ language: 'IT', text: '  voglio \n', sentence: ' Io  voglio. ' }, study)
		).toEqual({
			language: 'it',
			text: 'voglio',
			sentence: 'Io voglio.'
		});
		expect(parseSuggestRequest({ language: 'ja', text: '食べ' }, study)).toEqual({
			language: 'ja',
			text: '食べ',
			sentence: ''
		});
	});

	test('rejeita idioma fora dos de estudo, texto vazio ou longo, frase longa', () => {
		expect(parseSuggestRequest(null, study)).toHaveProperty('error');
		expect(parseSuggestRequest({ language: 'de', text: 'Haus' }, study)).toHaveProperty('error');
		expect(parseSuggestRequest({ language: 'it', text: '   ' }, study)).toHaveProperty('error');
		expect(parseSuggestRequest({ language: 'it', text: 'a'.repeat(101) }, study)).toHaveProperty(
			'error'
		);
		expect(
			parseSuggestRequest({ language: 'it', text: 'a', sentence: 'a'.repeat(501) }, study)
		).toHaveProperty('error');
		expect(parseSuggestRequest({ language: 'it', text: 'a', sentence: 3 }, study)).toHaveProperty(
			'error'
		);
	});
});

describe('parseSuggestion', () => {
	test('apara e corta os campos; a frase enviada volta igual', () => {
		expect(
			parseSuggestion(
				{ lemma: ' volere ', reading: '', sense: ' querer ', sentence: 'Voglio un caffè.' },
				'Io voglio.'
			)
		).toEqual({ lemma: 'volere', reading: '', sense: 'querer', sentence: 'Io voglio.' });
		const long = parseSuggestion(
			{ lemma: 'a'.repeat(300), sense: 'b'.repeat(300), sentence: 'c' },
			''
		);
		expect(long?.lemma).toHaveLength(80);
		expect(long?.sense).toHaveLength(200);
		expect(long?.reading).toBe('');
		expect(long?.sentence).toBe('c');
	});

	test('sem lema: malformada', () => {
		expect(parseSuggestion({ lemma: '  ', sense: 'x' }, '')).toBeNull();
		expect(parseSuggestion('volere', '')).toBeNull();
	});
});

describe('suggestRequest', () => {
	test('prompt em inglês com os idiomas; sem frase, pede exemplo', () => {
		const r = suggestRequest({ language: 'it', text: 'voglio', sentence: '' }, 'pt-BR');
		expect(r.user).toContain('Language: Italian (it)');
		expect(r.user).toContain('(pt-BR)');
		expect(r.user).toContain('Word: voglio');
		expect(r.user).not.toContain('Sentence:');
		expect(r.system).toContain('example sentence');
		expect(r.schema).toMatchObject({
			additionalProperties: false,
			required: ['lemma', 'reading', 'sense', 'sentence']
		});

		const withSentence = suggestRequest(
			{ language: 'it', text: 'voglio', sentence: 'Io voglio.' },
			'pt'
		);
		expect(withSentence.user).toContain('Sentence: Io voglio.');
		expect(
			withSentence.parse({ lemma: 'volere', reading: '', sense: 'querer', sentence: 'x' })?.sentence
		).toBe('Io voglio.');
	});
});
