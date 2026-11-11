import { error, redirect } from '@sveltejs/kit';
import { FICHA_KIND_LABELS, fichaPlainText, type FichaFlashcardKind } from '#lib/fichas.ts';
import { formatNextReview } from '#lib/review.ts';
import type { PageServerLoad } from './$types';

const PAGE_SIZE = 500;

export const load: PageServerLoad = async ({ locals, parent, url }) => {
	const { shell } = await parent();
	if (!shell) error(401, 'Entre para ver suas fichas.');
	if (!shell.active) redirect(303, '/inicio');
	const user = await locals.getUser();
	if (!user) error(401, 'Entre para ver suas fichas.');
	const language = shell.active;
	const tag = url.searchParams.get('tag')?.trim() || null;
	const now = new Date();

	let query = locals.supabase
		.from('fichas')
		.select(
			'id, front, back, reverse, cloze_count, tags, created_at, flashcards(kind, ord, due_at)'
		)
		.eq('user_id', user.id)
		.eq('language', language)
		.is('deleted_at', null)
		.order('created_at', { ascending: false })
		.limit(PAGE_SIZE);
	if (tag) query = query.contains('tags', [tag]);
	const [{ data, error: dbError }, all] = await Promise.all([
		query,
		locals.supabase
			.from('fichas')
			.select('tags')
			.eq('user_id', user.id)
			.eq('language', language)
			.is('deleted_at', null)
			.filter('tags', 'neq', '{}')
			.limit(5000)
	]);
	if (dbError) error(500, 'Não deu para carregar as fichas agora.');

	const tags = [...new Set((all.data ?? []).flatMap((r) => r.tags))].sort((a, b) =>
		a.localeCompare(b, 'pt-BR')
	);
	return {
		tag,
		tags,
		language,
		uiLanguage: shell.uiLanguage,
		fichas: data.map((f) => {
			const kinds = f.flashcards.map((c) =>
				c.kind === 'lacuna' ? `Lacuna ${c.ord}` : FICHA_KIND_LABELS[c.kind as FichaFlashcardKind]
			);
			return {
				id: f.id,
				front: fichaPlainText(f.front),
				back: fichaPlainText(f.back),
				tags: f.tags,
				flashcards: f.flashcards.length,
				kinds: f.cloze_count > 0 ? `${f.cloze_count} lacunas` : kinds.join(' · '),
				next: formatNextReview(
					f.flashcards.map((c) => c.due_at),
					now
				)
			};
		})
	};
};
