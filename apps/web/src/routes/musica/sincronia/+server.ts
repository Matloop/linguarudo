import { error, json } from '@sveltejs/kit';
import { parseSyncUpdate } from '#lib/music/timeline.ts';
import type { Json } from '#lib/database.types.ts';
import type { RequestHandler } from './$types';

/** Guarda na obra a linha do tempo da letra (âncoras, velocidade, palpite ignorado, registro do LRCLIB). */
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!(await locals.getUser())) error(401, 'Entre para ajustar a música.');

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		error(400, 'Corpo JSON inválido.');
	}
	const update = parseSyncUpdate(body);
	if (!update) error(400, 'Sincronia inválida.');

	const { error: dbError } = await locals.supabase.rpc('set_lyrics_sync', {
		p_work: update.workId,
		p_sync: update.sync as unknown as Json
	});
	if (dbError?.message.includes('invalid_sync')) error(400, 'Sincronia inválida.');
	if (dbError?.message.includes('work_not_found')) error(404, 'Música não encontrada.');
	if (dbError) error(500, 'Não deu para salvar a sincronia agora.');
	return json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
};
