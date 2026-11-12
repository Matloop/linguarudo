// Servidor falso do LRCLIB e do oEmbed do YouTube para os e2e (o app chama os dois pelo servidor,
// então o Playwright não consegue interceptar). Roda com `bun src/e2e/mock-sources.ts`.

import {
	CLIP_EXTRA_SECONDS,
	LIVE_SECONDS,
	LRC,
	LRC_LIVE,
	LRCLIB_IDS,
	VIDEOS,
	VIDEO_SECONDS
} from './fixtures.ts';

const PORT = 4599;

const record = (id: number, title: string, synced: string | null, duration = VIDEO_SECONDS) => ({
	id,
	trackName: title,
	artistName: 'Banda Inventada',
	albumName: id === LRCLIB_IDS.clipLive ? 'Ao Vivo' : 'Álbum Inventado',
	duration,
	instrumental: false,
	plainLyrics: null,
	syncedLyrics: synced
});

const RECORDS = [
	record(LRCLIB_IDS.ok, VIDEOS.ok.title, LRC),
	record(LRCLIB_IDS.clip, VIDEOS.clip.title, LRC, VIDEO_SECONDS - CLIP_EXTRA_SECONDS),
	record(LRCLIB_IDS.clipLive, VIDEOS.clip.title, LRC_LIVE, LIVE_SECONDS),
	record(LRCLIB_IDS.noLyrics, VIDEOS.noLyrics.title, null)
];

const byTitle = (title: string) => RECORDS.filter((r) => r.trackName === title);
const DOWN = () => new Response('boom', { status: 503 });
const MISSING = () => new Response(JSON.stringify({ statusCode: 404 }), { status: 404 });

Bun.serve({
	port: PORT,
	fetch(req) {
		const url = new URL(req.url);

		const byId = /^\/api\/get\/(\d+)$/.exec(url.pathname);
		if (byId) {
			const found = RECORDS.find((r) => r.id === Number(byId[1]));
			return found ? Response.json(found) : MISSING();
		}

		if (url.pathname === '/api/get') {
			const title = url.searchParams.get('track_name') ?? '';
			if (title === VIDEOS.down.title) return DOWN();
			// Como o LRCLIB: só acha com a duração a até 2 s.
			const duration = Number(url.searchParams.get('duration'));
			const found = byTitle(title).find(
				(r) => r.duration !== null && Math.abs(r.duration - duration) <= 2
			);
			return found ? Response.json(found) : MISSING();
		}

		if (url.pathname === '/api/search') {
			const title = url.searchParams.get('track_name') ?? url.searchParams.get('q') ?? '';
			const key = Object.values(VIDEOS).find((v) => title.includes(v.title))?.title ?? '';
			if (key === VIDEOS.down.title) return DOWN();
			return Response.json(byTitle(key));
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
