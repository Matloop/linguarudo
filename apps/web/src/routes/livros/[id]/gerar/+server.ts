import { json } from '@sveltejs/kit';
import type { Config } from '@sveltejs/adapter-vercel';
import { EpubError } from '#lib/blend/epub.ts';
import { BookError, buildVersion, requireBook } from '#lib/server/books.ts';
import type { RequestHandler } from './$types';

export const config: Config = { maxDuration: 60, memory: 2048 };

/** Monta a versão nova com os capítulos prontos do intervalo (substitui a anterior). */
export const POST: RequestHandler = async ({ locals, params }) => {
	const user = await locals.getUser();
	if (!user) return json({ message: 'Entre de novo.' }, { status: 401 });
	try {
		const book = await requireBook(locals.supabase, params.id);
		return json(await buildVersion(locals.supabase, user.id, book), {
			headers: { 'Cache-Control': 'no-store' }
		});
	} catch (e) {
		if (e instanceof BookError) return json({ message: e.message }, { status: e.status });
		if (e instanceof EpubError) return json({ message: e.message }, { status: 400 });
		throw e;
	}
};
