import { error, json } from '@sveltejs/kit';
import { parseSyncUpdate } from '#lib/music/offset.ts';
import type { RequestHandler } from './$types';

/** Guarda na obra o deslocamento da letra e/ou que o palpite pela duração foi ignorado. */
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
		p_offset: update.offset ?? undefined,
		p_hint_dismissed: update.hintDismissed ?? undefined
	});
	if (dbError?.message.includes('work_not_found')) error(404, 'Música não encontrada.');
	if (dbError) error(500, 'Não deu para salvar a sincronia agora.');
	return json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
};
