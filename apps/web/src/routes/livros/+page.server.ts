import { error, fail } from '@sveltejs/kit';
import { BookError, chapterRows, deleteBook } from '#lib/server/books.ts';
import type { Actions, PageServerLoad } from './$types';

/** Lista dos livros: título, autor, par de línguas, estado do intervalo e a chave do aparelho. */
export const load: PageServerLoad = async ({ locals, parent }) => {
	const user = await locals.getUser();
	if (!user) error(401, 'Entre para ver seus livros.');
	const { shell } = await parent();
	if (!shell) error(401, 'Entre para ver seus livros.');
	const { data: books, error: dbError } = await locals.supabase
		.from('books')
		.select(
			'id, title, author, book_language, language, range_from, range_to, on_device, current_version, updated_at'
		)
		.order('updated_at', { ascending: false });
	if (dbError) error(500, 'Não deu para carregar seus livros agora.');
	const chapters = await chapterRows(
		locals.supabase,
		(books ?? []).map((b) => b.id)
	).catch(() => []);
	return {
		userId: user.id,
		studyLanguages: shell.studyLanguages,
		active: shell.active,
		nativeLanguage: shell.nativeLanguage,
		books: (books ?? []).map((b) => ({
			...b,
			chapters: chapters.filter((c) => c.bookId === b.id)
		}))
	};
};

const idOf = (form: FormData) => {
	const id = String(form.get('id') ?? '');
	return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
};

export const actions: Actions = {
	device: async ({ locals, request }) => {
		const form = await request.formData();
		const id = idOf(form);
		if (!id) return fail(400, { message: 'Livro inválido.' });
		const on = form.get('on') === 'true';
		const { error: dbError } = await locals.supabase
			.from('books')
			.update({ on_device: on })
			.eq('id', id);
		if (dbError) return fail(500, { message: 'Não deu para salvar agora.' });
		return { on };
	},
	delete: async ({ locals, request }) => {
		const user = await locals.getUser();
		if (!user) return fail(401, { message: 'Entre de novo.' });
		const id = idOf(await request.formData());
		if (!id) return fail(400, { message: 'Livro inválido.' });
		try {
			await deleteBook(locals.supabase, user.id, id);
		} catch (e) {
			if (e instanceof BookError) return fail(e.status, { message: e.message });
			throw e;
		}
		return {};
	}
};
