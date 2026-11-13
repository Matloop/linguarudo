import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** A URL assinada vale 15 min; o leitor baixa o arquivo inteiro logo ao abrir. */
const SIGNED_SECONDS = 15 * 60;

export const load: PageServerLoad = async ({ locals, params }) => {
	const user = await locals.getUser();
	if (!user) error(401, 'Entre para ler.');

	const { data: book } = await locals.supabase
		.from('books')
		.select('id, title, author, book_language, language, current_version')
		.eq('id', params.id)
		.maybeSingle();
	if (!book) error(404, 'Livro não encontrado.');
	if (!book.current_version) error(409, 'Este livro ainda não tem uma versão com blend pronta.');

	const [{ data: version }, { data: progress }] = await Promise.all([
		locals.supabase
			.from('book_versions')
			.select('path')
			.eq('book_id', book.id)
			.eq('version', book.current_version)
			.maybeSingle(),
		locals.supabase
			.from('book_progress')
			.select('spine, chapter_percent, percent, at')
			.eq('book_id', book.id)
			.maybeSingle()
	]);
	if (!version) error(409, 'Este livro ainda não tem uma versão com blend pronta.');
	const { data: signed } = await locals.supabase.storage
		.from('books')
		.createSignedUrl(version.path, SIGNED_SECONDS);
	if (!signed) error(503, 'Não deu para abrir o arquivo do livro agora.');

	return {
		book: {
			id: book.id,
			title: book.title,
			author: book.author,
			language: book.language,
			bookLanguage: book.book_language,
			version: book.current_version
		},
		fileUrl: signed.signedUrl,
		progress: progress
			? {
					spine: progress.spine,
					chapterPercent: progress.chapter_percent,
					percent: progress.percent
				}
			: null
	};
};
