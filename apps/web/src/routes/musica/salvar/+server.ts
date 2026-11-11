import { error, json } from '@sveltejs/kit';
import { musicEntries, parseMusicSave } from '#lib/music/save.ts';
import { songFromWork } from '#lib/music/song.ts';
import type { RequestHandler } from './$types';

/**
 * Salva palavras da música no banco. Cada uma acha ou cria o item e ganha um encontro
 * de origem 'musica' ligado à obra (o verso e o momento no vídeo).
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const user = await locals.getUser();
	if (!user) error(401, 'Entre para salvar palavras.');

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		error(400, 'Corpo JSON inválido.');
	}
	const parsed = parseMusicSave(body);
	if (!parsed.ok) error(400, 'Palavras inválidas.');

	const { data: work } = await locals.supabase
		.from('works')
		.select('id, title, subtitle, refs, language, played_at')
		.eq('id', parsed.workId)
		.eq('user_id', user.id)
		.eq('kind', 'musica')
		.is('deleted_at', null)
		.maybeSingle();
	const song = work ? songFromWork(work) : null;
	if (!song) error(404, 'Música não encontrada.');

	const { data, error: dbError } = await locals.supabase.rpc('save_items', {
		p_items: musicEntries(parsed.words, song)
	});
	if (dbError) error(500, 'Não deu para salvar agora.');

	const saved = data.filter((r) => r.created).map((r) => r.lemma);
	const existing = data.filter((r) => !r.created).map((r) => r.lemma);
	return json({ saved, existing }, { headers: { 'Cache-Control': 'no-store' } });
};
