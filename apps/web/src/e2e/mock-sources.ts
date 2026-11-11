// Servidor falso do LRCLIB e do oEmbed do YouTube para os e2e (o app chama os dois pelo servidor,
// então o Playwright não consegue interceptar). Roda com `bun src/e2e/mock-sources.ts`.

import { LRC, VIDEOS, VIDEO_SECONDS } from './fixtures.ts';

const PORT = 4599;

const record = (title: string, synced: string | null) => ({
	id: 1,
	trackName: title,
	artistName: 'Banda Inventada',
	duration: VIDEO_SECONDS,
	instrumental: false,
	plainLyrics: null,
	syncedLyrics: synced
});

function lyrics(title: string): Response | null {
	if (title === VIDEOS.ok.title) return Response.json(record(title, LRC));
	if (title === VIDEOS.noLyrics.title) return Response.json(record(title, null));
	if (title === VIDEOS.down.title) return new Response('boom', { status: 503 });
	return null;
}

Bun.serve({
	port: PORT,
	fetch(req) {
		const url = new URL(req.url);

		if (url.pathname === '/api/get') {
			const found = lyrics(url.searchParams.get('track_name') ?? '');
			return found ?? new Response(JSON.stringify({ statusCode: 404 }), { status: 404 });
		}

		if (url.pathname === '/api/search') {
			const title = url.searchParams.get('track_name') ?? url.searchParams.get('q') ?? '';
			const key = Object.values(VIDEOS).find((v) => title.includes(v.title))?.title ?? '';
			const found = lyrics(key);
			if (!found) return Response.json([]);
			if (!found.ok) return found;
			return found.json().then((one) => Response.json([one]));
		}

		if (url.pathname === '/oembed') {
			const id = new URL(url.searchParams.get('url') ?? 'http://x').searchParams.get('v');
			const video = Object.values(VIDEOS).find((v) => v.id === id);
			if (!video) return new Response('not found', { status: 404 });
			return Response.json({
				title: `${video.artist} - ${video.title} (Official Video)`,
				author_name: 'BandaInventadaVEVO'
			});
		}

		return new Response('not found', { status: 404 });
	}
});

console.log(`mock LRCLIB/oEmbed em http://127.0.0.1:${PORT}`);
