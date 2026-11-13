import { json } from '@sveltejs/kit';
import type { Config } from '@sveltejs/adapter-vercel';
import { parseLanguage } from '#lib/languages.ts';
import { loadSettings } from '#lib/server/settings.ts';
import { BookError, registerBook } from '#lib/server/books.ts';
import type { RequestHandler } from './$types';

export const config: Config = { maxDuration: 60 };

/**
 * Depois que o navegador subiu o original no Storage: abre o EPUB, lê título, autor,
 * língua e capítulos e cria o livro. Corpo: { id, language }.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const user = await locals.getUser();
	if (!user) return json({ message: 'Entre de novo.' }, { status: 401 });
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	const id = typeof body?.id === 'string' && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id.toLowerCase() : null;
	if (!id) return json({ message: 'Requisição inválida.' }, { status: 400 });
	const settings = await loadSettings(locals.supabase, user.id, request.headers.get('accept-language'));
	const language = parseLanguage(body?.language);
	if (!language || !settings.studyLanguages.includes(language)) {
		return json({ message: 'Escolha um dos seus idiomas de estudo.' }, { status: 400 });
	}
	try {
		await registerBook(locals.supabase, user.id, id, {
			language,
			fallbackLanguage: settings.nativeLanguage ?? 'pt'
		});
	} catch (e) {
		if (e instanceof BookError) return json({ message: e.message }, { status: e.status });
		throw e;
	}
	return json({ id }, { headers: { 'Cache-Control': 'no-store' } });
};
