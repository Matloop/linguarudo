import { error, json } from '@sveltejs/kit';
import { parsePosition } from '#lib/reader/progress.ts';
import type { RequestHandler } from './$types';

/**
 * Posição de leitura do leitor web (book_progress, source 'web'). Quem leu por último
 * vence: save_book_progress só troca a guardada se `at` for mais novo. `current` diz se
 * esta posição ficou sendo a do livro.
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const user = await locals.getUser();
	if (!user) error(401, 'Entre para ler.');

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		error(400, 'Corpo JSON inválido.');
	}
	const position = parsePosition(body);
	if (!position) error(400, 'Posição inválida.');
	const now = new Date();
	const raw = new Date(typeof body.at === 'string' ? body.at : '');
	const at = Number.isNaN(raw.getTime()) || raw > now ? now : raw;

	const { data, error: dbError } = await locals.supabase.rpc('save_book_progress', {
		p_book: params.id,
		p_spine: position.spine,
		p_chapter_percent: position.chapterPercent,
		p_percent: position.percent,
		p_at: at.toISOString()
	});
	// Livro de outra pessoa ou apagado: a chave estrangeira (book_id, user_id) recusa.
	if (dbError) error(dbError.code === '23503' ? 404 : 500, 'Não deu para guardar a posição.');
	return json({ current: data === true }, { headers: { 'Cache-Control': 'no-store' } });
};
