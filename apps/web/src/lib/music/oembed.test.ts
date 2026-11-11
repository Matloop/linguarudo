import { describe, expect, test } from 'bun:test';
import { fetchTrackInfo } from './oembed.ts';

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const asFetch = (fn: (input: string | URL | Request) => Promise<Response>) =>
	fn as unknown as typeof fetch;

describe('fetchTrackInfo', () => {
	test('consulta o oEmbed do vídeo e devolve título e artista adivinhados', async () => {
		let asked = '';
		const fetcher = asFetch(async (input) => {
			asked = String(input);
			return ok({
				title: 'Banda Inventada - Canção Falsa (Official Video)',
				author_name: 'BandaInventadaVEVO'
			});
		});
		const out = await fetchTrackInfo('http://oembed.test/oembed', 'AbC123_-xyZ', fetcher);
		expect(out).toEqual({ artist: 'Banda Inventada', title: 'Canção Falsa' });
		const url = new URL(asked);
		expect(url.searchParams.get('url')).toBe('https://www.youtube.com/watch?v=AbC123_-xyZ');
		expect(url.searchParams.get('format')).toBe('json');
	});

	test('vídeo que não existe ou erro de rede devolve null', async () => {
		const url = 'http://x.test/o';
		const id = 'AbC123_-xyZ';
		expect(
			await fetchTrackInfo(
				url,
				id,
				asFetch(async () => new Response('', { status: 404 }))
			)
		).toBeNull();
		expect(
			await fetchTrackInfo(
				url,
				id,
				asFetch(async () => {
					throw new Error('boom');
				})
			)
		).toBeNull();
		expect(
			await fetchTrackInfo(
				url,
				id,
				asFetch(async () => ok({ nada: 1 }))
			)
		).toBeNull();
	});
});
