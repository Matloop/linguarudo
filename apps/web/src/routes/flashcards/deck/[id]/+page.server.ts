import { error, redirect } from '@sveltejs/kit';
import { entryFlags, entryNext, type EntryFlags } from '#lib/decks-ui.ts';
import { fichaPlainText } from '#lib/fichas.ts';
import { formatNextReview, nextDayStart } from '#lib/review.ts';
import { loadDeckSummaries, loadQueueState } from '#lib/server/decks.ts';
import {
	defaultAction,
	deleteAction,
	limitsAction,
	moveAction,
	optionsAction,
	pauseAction,
	releaseAction,
	renameAction
} from '#lib/server/deck-actions.ts';
import { planNew, scopeDeckIds } from '#lib/server/queue.ts';
import type { Actions, PageServerLoad } from './$types';

/** Itens + fichas mostrados por deck (como /palavras). */
const PAGE_SIZE = 500;

export interface DeckEntry {
	kind: 'item' | 'ficha';
	id: string;
	title: string;
	sub: string;
	deckId: string;
	known: boolean;
	next: string;
	flags: EntryFlags;
	cards: number;
	createdAt: string;
}

export const load: PageServerLoad = async ({ locals, params, parent }) => {
	const user = await locals.getUser();
	if (!user) error(401, 'Entre para ver seus baralhos.');
	const { shell } = await parent();
	if (!shell) error(401, 'Entre para ver seus baralhos.');
	if (!shell.active) redirect(303, '/inicio');
	const language = shell.active;
	const now = new Date();

	const [overview, state] = await Promise.all([
		loadDeckSummaries(locals.supabase, language, now, shell.clock).catch(() => null),
		loadQueueState(locals.supabase, language, now, shell.clock).catch(() => null)
	]);
	if (!overview || !state) error(500, 'Não deu para carregar o baralho agora.');
	const deck = overview.decks.find((d) => d.id === params.id);
	if (!deck) error(404, 'Baralho não encontrado.');

	const scope = [...scopeDeckIds(state.decks, { kind: 'deck', deckId: deck.id })];
	const plan = planNew(state, { kind: 'deck', deckId: deck.id });
	const ctx = { nextDayStart: nextDayStart(now, shell.clock), plannedIds: new Set(plan.ids) };

	const [items, fichas] = await Promise.all([
		locals.supabase
			.from('items')
			.select(
				'id, lemma, sense, status, leech_hold, deck_id, created_at, flashcards(id, state, due_at)'
			)
			.eq('user_id', user.id)
			.eq('language', language)
			.in('deck_id', scope)
			.is('deleted_at', null)
			.order('created_at', { ascending: false })
			.limit(PAGE_SIZE),
		locals.supabase
			.from('fichas')
			.select(
				'id, front, back, status, leech_hold, deck_id, created_at, flashcards(id, state, due_at)'
			)
			.eq('user_id', user.id)
			.eq('language', language)
			.in('deck_id', scope)
			.is('deleted_at', null)
			.order('created_at', { ascending: false })
			.limit(PAGE_SIZE)
	]);
	if (items.error || fichas.error) error(500, 'Não deu para carregar o baralho agora.');

	const entry = (
		kind: DeckEntry['kind'],
		r: {
			id: string;
			status: string;
			leech_hold: string | null;
			deck_id: string;
			created_at: string;
			flashcards: { id: string; state: number; due_at: string }[];
		},
		title: string,
		sub: string
	): DeckEntry => {
		const cards = r.flashcards.map((c) => ({ id: c.id, state: c.state, dueAt: c.due_at }));
		const known = r.status !== 'ativo';
		const flags = entryFlags({ status: r.status, leechHold: r.leech_hold, cards }, ctx);
		return {
			kind,
			id: r.id,
			title,
			sub,
			deckId: r.deck_id,
			known,
			next: entryNext(flags, known, () =>
				formatNextReview(
					cards.filter((c) => c.state > 0).map((c) => c.dueAt),
					now,
					shell.clock
				)
			),
			flags,
			cards: cards.length,
			createdAt: r.created_at
		};
	};

	const entries = [
		...items.data.map((r) => entry('item', r, r.lemma, r.sense || 'Sem tradução')),
		...fichas.data.map((r) =>
			entry('ficha', r, fichaPlainText(r.front) || 'Ficha sem frente', fichaPlainText(r.back))
		)
	].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

	const parentDeck = deck.parentId
		? (overview.decks.find((d) => d.id === deck.parentId) ?? null)
		: null;
	const defaultDeck = overview.decks.find((d) => d.isDefault) ?? null;

	return {
		deck,
		decks: overview.decks,
		parent: parentDeck ? { id: parentDeck.id, name: parentDeck.name } : null,
		defaultName: defaultDeck?.name ?? '',
		entries,
		language
	};
};

export const actions: Actions = {
	options: optionsAction,
	rename: renameAction,
	default: defaultAction,
	delete: deleteAction,
	move: moveAction,
	release: releaseAction,
	pause: pauseAction,
	limits: limitsAction
};
