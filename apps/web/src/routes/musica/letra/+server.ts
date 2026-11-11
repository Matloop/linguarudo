import { error, json } from '@sveltejs/kit';
import { LRCLIB_URL } from '$app/env/private';
import { LIMITS } from '#lib/items.ts';
import { findSyncedLyrics } from '#lib/music/lrclib.ts';
import { parseSyncedLyrics } from '#lib/music/lrc.ts';
import type { RequestHandler } from './$types';

const NO_STORE = { 'Cache-Control': 'no-store' };
const MAX_DURATION_S = 4 * 3600;

function readText(value: string | null): string {
	return [...(value ?? '').normalize('NFC').trim()].slice(0, LIMITS.title).join('');
}

/**
 * Letra sincronizada, buscada no LRCLIB na hora de jogar. O servidor só repassa:
 * a letra não é guardada no banco nem em cache.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	if (!(await locals.getUser())) error(401, 'Entre para jogar.');

	const title = readText(url.searchParams.get('title'));
	const artist = readText(url.searchParams.get('artist'));
	if (!title || !artist) error(400, 'Faltam título e artista.');
	const rawDuration = Number(url.searchParams.get('duration'));
	const duration =
		Number.isFinite(rawDuration) && rawDuration > 0 && rawDuration <= MAX_DURATION_S
			? rawDuration
			: null;

	const found = await findSyncedLyrics(LRCLIB_URL, { title, artist, duration });
	if (found.status === 'unavailable') {
		return json({ error: 'indisponivel' }, { status: 502, headers: NO_STORE });
	}
	const lines = found.status === 'ok' ? parseSyncedLyrics(found.synced) : [];
	if (lines.length === 0) {
		return json({ error: 'sem_letra' }, { status: 404, headers: NO_STORE });
	}
	// A duração da faixa serve para o palpite de sincronia (clipe com intro).
	const trackDuration = found.status === 'ok' ? found.duration : null;
	return json({ lines, duration: trackDuration }, { headers: NO_STORE });
};
