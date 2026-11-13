import { error, fail } from '@sveltejs/kit';
import { MAX_COVERAGE } from '#lib/blend/select.ts';
import { parseLanguage } from '#lib/languages.ts';
import { loadSettings } from '#lib/server/settings.ts';
import {
	BookError,
	chapterRows,
	requireBook,
	resetCandidates
} from '#lib/server/books.ts';
import type { Actions, PageServerLoad } from './$types';

/** Configuração do blend de um livro e o progresso da geração. */
export const load: PageServerLoad = async ({ locals, params, parent }) => {
	const user = await locals.getUser();
	if (!user) error(401, 'Entre para ver seus livros.');
	const { shell } = await parent();
	if (!shell) error(401, 'Entre para ver seus livros.');
	try {
		const book = await requireBook(locals.supabase, params.id);
		const chapters = await chapterRows(locals.supabase, [book.id]);
		return {
			book: {
				id: book.id,
				title: book.title,
				author: book.author,
				bookLanguage: book.book_language,
				language: book.language,
				coverage: book.coverage,
				rangeFrom: book.range_from,
				rangeTo: book.range_to,
				onDevice: book.on_device,
				version: book.current_version
			},
			chapters,
			studyLanguages: shell.studyLanguages,
			uiLanguage: shell.uiLanguage
		};
	} catch (e) {
		if (e instanceof BookError) error(e.status, e.message);
		throw e;
	}
};

export const actions: Actions = {
	/**
	 * Grava língua, cobertura e intervalo. Mudar a língua do livro, a do blend ou a
	 * cobertura invalida as candidatas guardadas.
	 */
	settings: async ({ locals, params, request }) => {
		const user = await locals.getUser();
		if (!user) return fail(401, { message: 'Entre de novo.' });
		const { studyLanguages } = await loadSettings(
			locals.supabase,
			user.id,
			request.headers.get('accept-language')
		);
		const form = await request.formData();
		let book;
		try {
			book = await requireBook(locals.supabase, params.id);
		} catch (e) {
			if (e instanceof BookError) return fail(e.status, { message: e.message });
			throw e;
		}
		const language = parseLanguage(form.get('language'));
		if (!language || !studyLanguages.includes(language)) {
			return fail(400, { message: 'Escolha um dos seus idiomas de estudo.' });
		}
		const bookLanguage = parseLanguage(form.get('bookLanguage'));
		if (!bookLanguage) return fail(400, { message: 'Língua do livro inválida (use it, pt-BR, en...).' });
		if (bookLanguage === language) {
			return fail(400, { message: 'A língua do livro e a do blend precisam ser diferentes.' });
		}
		const percent = Number(form.get('coverage'));
		if (!Number.isFinite(percent) || percent < 1 || percent > MAX_COVERAGE * 100) {
			return fail(400, { message: `Quanto: de 1% a ${MAX_COVERAGE * 100}%.` });
		}
		const coverage = Math.round(percent) / 100;
		const from = Number(form.get('from'));
		const to = Number(form.get('to'));
		if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) {
			return fail(400, { message: 'Intervalo de capítulos inválido.' });
		}
		const changed =
			language !== book.language ||
			bookLanguage !== book.book_language ||
			Math.abs(coverage - book.coverage) > 1e-6;
		const { error: dbError } = await locals.supabase
			.from('books')
			.update({
				language,
				book_language: bookLanguage,
				coverage,
				range_from: from,
				range_to: to
			})
			.eq('id', book.id);
		if (dbError) return fail(500, { message: 'Não deu para salvar agora.' });
		if (changed) await resetCandidates(locals.supabase, book.id);
		return { reset: changed };
	}
};
