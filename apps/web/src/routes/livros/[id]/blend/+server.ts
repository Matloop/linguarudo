import { json } from '@sveltejs/kit';
import type { Config } from '@sveltejs/adapter-vercel';
import { AiError } from '#lib/server/ai.ts';
import { ai, aiFailure } from '#lib/server/ai-chain.ts';
import { BookError, markChapterError, requireBook, runPart } from '#lib/server/books.ts';
import type { RequestHandler } from './$types';

// Dois providers de até 25 s cada.
export const config: Config = { maxDuration: 60 };

/**
 * Um pedaço do blend: o navegador chama capítulo por capítulo até `done`. Corpo: { spine }.
 * 429 = limite grátis da IA (o que veio fica guardado; "Continuar" retoma).
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const user = await locals.getUser();
	if (!user) return json({ message: 'Entre de novo.' }, { status: 401 });
	const body = (await request.json().catch(() => null)) as { spine?: unknown } | null;
	const spine = body?.spine;
	if (typeof spine !== 'number' || !Number.isInteger(spine) || spine < 0) {
		return json({ message: 'Requisição inválida.' }, { status: 400 });
	}
	try {
		const book = await requireBook(locals.supabase, params.id);
		try {
			return json(await runPart(locals.supabase, ai, book, spine), {
				headers: { 'Cache-Control': 'no-store' }
			});
		} catch (e) {
			if (e instanceof AiError && e.kind === 'upstream') {
				await markChapterError(locals.supabase, book.id, spine, e.message);
			}
			throw e;
		}
	} catch (e) {
		if (e instanceof BookError) return json({ message: e.message }, { status: e.status });
		return aiFailure(e, 'livros/blend');
	}
};
