import { error, json } from '@sveltejs/kit';
import { YOUTUBE_OEMBED_URL } from '$app/env/private';
import { fetchTrackInfo } from '#lib/music/oembed.ts';
import { parseYoutubeId } from '#lib/music/youtube.ts';
import type { RequestHandler } from './$types';

/** Título e artista palpitados pelo oEmbed do YouTube, para preencher o formulário. */
export const GET: RequestHandler = async ({ locals, url }) => {
	if (!(await locals.getUser())) error(401, 'Entre para escolher uma música.');
	const id = parseYoutubeId(url.searchParams.get('v') ?? '');
	if (!id) error(400, 'Link do YouTube inválido.');

	const info = await fetchTrackInfo(YOUTUBE_OEMBED_URL, id);
	if (!info) error(404, 'Não deu para ler esse vídeo.');
	return json(info, { headers: { 'Cache-Control': 'no-store' } });
};
