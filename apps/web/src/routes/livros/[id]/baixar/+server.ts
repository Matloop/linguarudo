import { error, redirect } from '@sveltejs/kit';
import { bookFileName } from '#lib/blend/filename.ts';
import { BOOKS_BUCKET, BookError, requireBook } from '#lib/server/books.ts';
import type { RequestHandler } from './$types';

/** Baixa a versão atual (URL assinada de 15 min, com o nome do arquivo do contrato). */
export const GET: RequestHandler = async ({ locals, params }) => {
	const user = await locals.getUser();
	if (!user) error(401, 'Entre para baixar.');
	let book;
	try {
		book = await requireBook(locals.supabase, params.id);
	} catch (e) {
		if (e instanceof BookError) error(e.status, e.message);
		throw e;
	}
	if (!book.current_version) error(409, 'Este livro ainda não tem uma versão gerada.');
	const { data: version } = await locals.supabase
		.from('book_versions')
		.select('path')
		.eq('book_id', book.id)
		.eq('version', book.current_version)
		.maybeSingle();
	if (!version) error(409, 'Este livro ainda não tem uma versão gerada.');
	const { data } = await locals.supabase.storage
		.from(BOOKS_BUCKET)
		.createSignedUrl(version.path, 15 * 60, {
			download: bookFileName(book.title, book.book_language, book.language)
		});
	if (!data) error(503, 'Não deu para baixar agora.');
	redirect(303, data.signedUrl, { external: true });
};
