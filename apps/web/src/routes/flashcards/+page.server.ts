import { error, redirect } from '@sveltejs/kit';
import { loadDeckSummaries } from '#lib/server/decks.ts';
import { createAction, nestAction, pauseAction, renameAction } from '#lib/server/deck-actions.ts';
import { flashcardCount, tomorrowReviews } from '#lib/server/session.ts';
import { loadTags } from '#lib/server/summary.ts';
import type { Actions, PageServerLoad } from './$types';

/** Hub de decks: "N para hoje", a tabela de decks e o que se faz com eles. */
export const load: PageServerLoad = async ({ locals, parent }) => {
	const user = await locals.getUser();
	if (!user) error(401, 'Entre para ver seus flashcards.');
	const { shell } = await parent();
	if (!shell) error(401, 'Entre para ver seus flashcards.');
	if (!shell.active) redirect(303, '/inicio');
	const language = shell.active;
	const now = new Date();

	const [overview, flashcards, tags, tomorrow] = await Promise.all([
		loadDeckSummaries(locals.supabase, language, now, shell.clock).catch(() => null),
		flashcardCount(locals.supabase, user.id, language).catch(() => 0),
		loadTags(locals.supabase, user.id, language).catch(() => []),
		tomorrowReviews(locals.supabase, user.id, language, now, shell.clock).catch(() => null)
	]);
	if (!overview) error(500, 'Não deu para carregar os decks agora.');
	return { ...overview, flashcards, tags, tomorrow, language };
};

export const actions: Actions = {
	create: createAction,
	rename: renameAction,
	pause: pauseAction,
	nest: nestAction
};
