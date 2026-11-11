import { error, json } from '@sveltejs/kit';
import { parseMusicWords } from '#lib/music/save.ts';
import { isDuplicateError } from '#lib/words.ts';
import type { RequestHandler } from './$types';

/** Salva palavras da música no banco (source = 'music'). Palavras repetidas são puladas. */
export const POST: RequestHandler = async ({ locals, request }) => {
	const user = await locals.getUser();
	if (!user) error(401, 'Entre para salvar palavras.');

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		error(400, 'Corpo JSON inválido.');
	}
	const parsed = parseMusicWords(body);
	if (!parsed.ok) error(400, 'Palavras inválidas.');

	// Um insert por palavra: o índice único usa lower(term), que o upsert do PostgREST não alcança.
	const saved: string[] = [];
	const existing: string[] = [];
	const failed: string[] = [];
	for (const word of parsed.words) {
		const { error: dbError } = await locals.supabase
			.from('words')
			.insert({ ...word, user_id: user.id, source: 'music' });
		if (!dbError) saved.push(word.term);
		else if (isDuplicateError(dbError)) existing.push(word.term);
		else failed.push(word.term);
	}
	return json({ saved, existing, failed }, { headers: { 'Cache-Control': 'no-store' } });
};
