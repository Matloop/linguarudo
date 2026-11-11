// oEmbed do YouTube: título do vídeo e canal, para preencher título e artista.
// Roda no servidor (o endpoint do YouTube não é feito para o navegador).

import { guessTrack, type TrackGuess } from './track.ts';

export async function fetchTrackInfo(
	endpoint: string,
	videoId: string,
	fetcher: typeof fetch = fetch
): Promise<TrackGuess | null> {
	const url = new URL(endpoint);
	url.searchParams.set('url', `https://www.youtube.com/watch?v=${videoId}`);
	url.searchParams.set('format', 'json');
	try {
		const res = await fetcher(url, { signal: AbortSignal.timeout(6_000) });
		if (!res.ok) return null;
		const body = (await res.json()) as { title?: unknown; author_name?: unknown };
		if (typeof body.title !== 'string') return null;
		return guessTrack(body.title, typeof body.author_name === 'string' ? body.author_name : '');
	} catch {
		return null;
	}
}
