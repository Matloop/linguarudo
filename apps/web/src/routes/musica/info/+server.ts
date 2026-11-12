import { error, json } from '@sveltejs/kit';
import { YOUTUBE_OEMBED_URL, YOUTUBE_PLAYLIST_URL } from '$app/env/private';
import { fetchTrackInfo } from '#lib/music/oembed.ts';
import { fetchPlaylist } from '#lib/music/playlist.ts';
import { parseYoutubeId } from '#lib/music/youtube.ts';
import type { RequestHandler } from './$types';

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * ?v=: título e artista palpitados pelo oEmbed do YouTube.
 * ?list=: nome, artista e faixas de uma playlist (álbum).
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	if (!(await locals.getUser())) error(401, 'Entre para escolher uma música.');

	const list = url.searchParams.get('list');
	if (list !== null) {
		if (!/^[A-Za-z0-9_-]{10,64}$/.test(list)) error(400, 'Playlist do YouTube inválida.');
		const playlist = await fetchPlaylist(YOUTUBE_PLAYLIST_URL, list);
		if (!playlist) error(404, 'Não deu para ler essa playlist.');
		return json(playlist, { headers: NO_STORE });
	}

	const id = parseYoutubeId(url.searchParams.get('v') ?? '');
	if (!id) error(400, 'Link do YouTube inválido.');
	const info = await fetchTrackInfo(YOUTUBE_OEMBED_URL, id);
	if (!info) error(404, 'Não deu para ler esse vídeo.');
	return json(info, { headers: NO_STORE });
};
