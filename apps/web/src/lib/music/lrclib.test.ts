import { describe, expect, test } from 'bun:test';
import { findSyncedLyrics, pickSynced, USER_AGENT, type LrclibRecord } from './lrclib.ts';

const rec = (over: Partial<LrclibRecord>): LrclibRecord => ({
	trackName: 'Canção Falsa',
	artistName: 'Banda Inventada',
	duration: 200,
	instrumental: false,
	syncedLyrics: '[00:01.00] Invented verse',
	...over
});

describe('pickSynced', () => {
	test('descarta registros sem letra sincronizada, instrumentais e vazios', () => {
		expect(
			pickSynced(
				[rec({ syncedLyrics: null }), rec({ instrumental: true }), rec({ syncedLyrics: '  ' })],
				{
					title: 'Canção Falsa',
					artist: 'Banda Inventada',
					duration: 200
				}
			)
		).toBeNull();
	});

	test('escolhe a versão com duração mais próxima da do vídeo', () => {
		const best = rec({ duration: 201, syncedLyrics: '[00:01.00] Right one' });
		const out = pickSynced(
			[rec({ duration: 240, syncedLyrics: '[00:01.00] Far one' }), best, rec({ duration: 150 })],
			{ title: 'Canção Falsa', artist: 'Banda Inventada', duration: 203 }
		);
		expect(out).toEqual({ synced: best.syncedLyrics!, duration: 201 });
	});

	test('clipe mais longo que a faixa: aceita a faixa se nada chega a 10 s', () => {
		const clip = { title: 'Canção Falsa', artist: 'Banda Inventada', duration: 216 };
		expect(pickSynced([rec({ duration: 200 })], clip)).toEqual({
			synced: '[00:01.00] Invented verse',
			duration: 200
		});
		// Uma versão que bate com o vídeo ainda ganha.
		const live = rec({ duration: 214, syncedLyrics: '[00:03.00] Live' });
		expect(pickSynced([rec({ duration: 200 }), live], clip)?.synced).toBe('[00:03.00] Live');
		// Mais de 5 min de sobra não é a mesma música.
		expect(pickSynced([rec({ duration: 200 })], { ...clip, duration: 520 })).toBeNull();
	});

	test('recusa faixa mais longa que o vídeo por mais de 10 s', () => {
		expect(
			pickSynced([rec({ duration: 260 })], {
				title: 'Canção Falsa',
				artist: 'Banda Inventada',
				duration: 200
			})
		).toBeNull();
	});

	test('sem duração do vídeo, prefere o mesmo título e artista', () => {
		const exact = rec({
			syncedLyrics: '[00:01.00] Exact',
			trackName: 'canção falsa',
			artistName: 'BANDA INVENTADA'
		});
		const other = rec({
			syncedLyrics: '[00:01.00] Other',
			trackName: 'Outra Coisa',
			artistName: 'Outra Banda'
		});
		expect(
			pickSynced([other, exact], {
				title: 'Canção Falsa',
				artist: 'Banda Inventada',
				duration: null
			})?.synced
		).toBe(exact.syncedLyrics!);
	});

	test('lista vazia ou inválida devolve null', () => {
		expect(pickSynced([], { title: 'x', artist: 'y', duration: null })).toBeNull();
	});
});

// ---------- busca (fetch injetado) ----------
const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function fakeFetch(handler: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
	const calls: { url: URL; init?: RequestInit }[] = [];
	const fn = (async (input: string | URL | Request, init?: RequestInit) => {
		const url = new URL(
			typeof input === 'string' ? input : input instanceof URL ? input : input.url
		);
		calls.push({ url, init });
		return handler(url, init);
	}) as typeof fetch;
	return { fn, calls };
}

const WANTED = { title: 'Canção Falsa', artist: 'Banda Inventada', duration: 200 };
const BASE = 'http://lrclib.test';

describe('findSyncedLyrics', () => {
	test('com duração conhecida tenta /api/get primeiro e manda User-Agent genérico', async () => {
		const { fn, calls } = fakeFetch(() => json(rec({ syncedLyrics: '[00:01.00] Invented verse' })));
		const out = await findSyncedLyrics(BASE, WANTED, fn);
		expect(out).toEqual({ status: 'ok', synced: '[00:01.00] Invented verse', duration: 200 });
		expect(calls).toHaveLength(1);
		expect(calls[0].url.pathname).toBe('/api/get');
		expect(calls[0].url.searchParams.get('track_name')).toBe('Canção Falsa');
		expect(calls[0].url.searchParams.get('artist_name')).toBe('Banda Inventada');
		expect(calls[0].url.searchParams.get('duration')).toBe('200');
		const headers = new Headers(calls[0].init?.headers);
		expect(headers.get('user-agent')).toBe(USER_AGENT);
		expect(USER_AGENT).toBe('Linguetta (https://linguetta-app.vercel.app)');
	});

	test('se /api/get não acha (404), cai para a busca e escolhe o melhor', async () => {
		const { fn, calls } = fakeFetch((url) =>
			url.pathname === '/api/get'
				? json({ statusCode: 404 }, 404)
				: json([rec({ duration: 199, syncedLyrics: '[00:02.00] Search verse' })])
		);
		const out = await findSyncedLyrics(BASE, WANTED, fn);
		expect(out).toEqual({ status: 'ok', synced: '[00:02.00] Search verse', duration: 199 });
		expect(calls.map((c) => c.url.pathname)).toEqual(['/api/get', '/api/search']);
	});

	test('sem duração vai direto para a busca', async () => {
		const { fn, calls } = fakeFetch(() => json([rec({})]));
		await findSyncedLyrics(BASE, { ...WANTED, duration: null }, fn);
		expect(calls.map((c) => c.url.pathname)).toEqual(['/api/search']);
	});

	test('sem letra sincronizada em lugar nenhum: "none"', async () => {
		const { fn } = fakeFetch((url) =>
			url.pathname === '/api/get' ? json({}, 404) : json([rec({ syncedLyrics: null })])
		);
		expect(await findSyncedLyrics(BASE, WANTED, fn)).toEqual({ status: 'none' });
	});

	test('erro de rede ou 5xx em tudo: "unavailable"', async () => {
		const down = fakeFetch(() => {
			throw new TypeError('network down');
		});
		expect(await findSyncedLyrics(BASE, WANTED, down.fn)).toEqual({ status: 'unavailable' });
		const broken = fakeFetch(() => json({ error: 'x' }, 503));
		expect(await findSyncedLyrics(BASE, WANTED, broken.fn)).toEqual({ status: 'unavailable' });
	});
});
