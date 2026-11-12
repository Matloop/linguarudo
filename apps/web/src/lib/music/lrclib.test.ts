import { describe, expect, test } from 'bun:test';
import {
	findSyncedLyrics,
	listVersions,
	MAX_VERSIONS,
	pickSynced,
	USER_AGENT,
	type LrclibRecord
} from './lrclib.ts';

const rec = (over: Partial<LrclibRecord>): LrclibRecord => ({
	id: 7,
	albumName: 'Álbum Inventado',
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
		expect(out).toEqual({ id: 7, synced: best.syncedLyrics!, duration: 201 });
	});

	test('clipe mais longo que a faixa: aceita a faixa se nada chega a 10 s', () => {
		const clip = { title: 'Canção Falsa', artist: 'Banda Inventada', duration: 216 };
		expect(pickSynced([rec({ duration: 200 })], clip)).toEqual({
			id: 7,
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

	test('versão a até 2 s do vídeo ganha, mesmo com outro nome', () => {
		const wanted = { title: 'Canção Falsa', artist: 'Banda Inventada', duration: 200 };
		const sameName = rec({ id: 1, duration: 197, syncedLyrics: '[00:01.00] Same name' });
		const exact = rec({
			id: 2,
			duration: 201.5,
			trackName: 'Canção Falsa (Clipe)',
			syncedLyrics: '[00:01.00] Exact'
		});
		expect(pickSynced([sameName, exact], wanted)?.id).toBe(2);
		// Dentro dos 2 s, o mesmo nome desempata antes da duração.
		const closer = rec({ id: 3, duration: 200, trackName: 'Outra', syncedLyrics: '[00:01.00] C' });
		const named = rec({ id: 4, duration: 201.8, syncedLyrics: '[00:01.00] N' });
		expect(pickSynced([closer, named], wanted)?.id).toBe(4);
	});

	test('lista vazia ou inválida devolve null', () => {
		expect(pickSynced([], { title: 'x', artist: 'y', duration: null })).toBeNull();
	});
});

describe('listVersions', () => {
	const wanted = { title: 'Canção Falsa', artist: 'Banda Inventada', duration: 200 };

	test('uma por id, sem instrumentais nem sem id; sincronizadas e mais próximas primeiro', () => {
		const out = listVersions(
			[
				rec({ id: 1, duration: 260 }),
				rec({ id: 2, duration: 199, syncedLyrics: null }),
				rec({ id: 3, duration: 205 }),
				rec({ id: 3, duration: 205 }),
				rec({ id: 4, instrumental: true }),
				rec({ id: null })
			],
			wanted
		);
		expect(out.map((v) => [v.id, v.synced])).toEqual([
			[3, true],
			[1, true],
			[2, false]
		]);
		expect(out[0]).toEqual({
			id: 3,
			trackName: 'Canção Falsa',
			artistName: 'Banda Inventada',
			albumName: 'Álbum Inventado',
			duration: 205,
			synced: true
		});
	});

	test(`no máximo ${MAX_VERSIONS}`, () => {
		const many = Array.from({ length: 25 }, (_, i) => rec({ id: i + 1 }));
		expect(listVersions(many, wanted)).toHaveLength(MAX_VERSIONS);
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
	test('com duração consulta /api/get e /api/search e manda User-Agent genérico', async () => {
		const { fn, calls } = fakeFetch((url) =>
			url.pathname === '/api/get'
				? json(rec({ id: 1, syncedLyrics: '[00:01.00] Invented verse' }))
				: json([rec({ id: 2, duration: 230 })])
		);
		const out = await findSyncedLyrics(BASE, WANTED, fn);
		expect(out).toMatchObject({
			status: 'ok',
			id: 1,
			synced: '[00:01.00] Invented verse',
			duration: 200
		});
		expect(out.status === 'ok' && out.versions.map((v) => v.id)).toEqual([1, 2]);
		expect(calls.map((c) => c.url.pathname)).toEqual(['/api/get', '/api/search']);
		const get = calls[0].url.searchParams;
		expect(get.get('track_name')).toBe('Canção Falsa');
		expect(get.get('artist_name')).toBe('Banda Inventada');
		expect(get.get('duration')).toBe('200');
		const headers = new Headers(calls[0].init?.headers);
		expect(headers.get('user-agent')).toBe(USER_AGENT);
		expect(USER_AGENT).toBe('Linguetta (https://linguetta-app.vercel.app)');
	});

	test('com id carrega aquele registro (/api/get/{id}), mesmo longe da duração', async () => {
		const { fn, calls } = fakeFetch((url) =>
			url.pathname === '/api/get/42'
				? json({
						id: 42,
						trackName: 'Canção Falsa',
						artistName: 'Banda Inventada',
						albumName: 'Ao Vivo',
						duration: 260,
						instrumental: false,
						syncedLyrics: '[00:05.00] Live verse'
					})
				: json([rec({ id: 1 })])
		);
		const out = await findSyncedLyrics(BASE, { ...WANTED, duration: null }, fn, 42);
		expect(out).toMatchObject({ status: 'ok', id: 42, synced: '[00:05.00] Live verse' });
		expect(out.status === 'ok' && out.versions.map((v) => [v.id, v.albumName])).toEqual([
			[42, 'Ao Vivo'],
			[1, 'Álbum Inventado']
		]);
		expect(calls.map((c) => c.url.pathname)).toEqual(['/api/get/42', '/api/search']);
	});

	test('id que não existe mais: escolhe como sempre', async () => {
		const { fn } = fakeFetch((url) =>
			url.pathname === '/api/get/42' ? json({ statusCode: 404 }, 404) : json([rec({ id: 1 })])
		);
		expect(await findSyncedLyrics(BASE, { ...WANTED, duration: null }, fn, 42)).toMatchObject({
			status: 'ok',
			id: 1
		});
	});

	test('se /api/get não acha (404), cai para a busca e escolhe o melhor', async () => {
		const { fn, calls } = fakeFetch((url) =>
			url.pathname === '/api/get'
				? json({ statusCode: 404 }, 404)
				: json([rec({ duration: 199, syncedLyrics: '[00:02.00] Search verse' })])
		);
		const out = await findSyncedLyrics(BASE, WANTED, fn);
		expect(out).toMatchObject({ status: 'ok', synced: '[00:02.00] Search verse', duration: 199 });
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
