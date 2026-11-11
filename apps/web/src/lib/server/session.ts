// Sessão do player /flashcards/estudar: escopo pela URL, novas planejadas (ADR 0005) e a
// fila montada. A carga da página e a ação "+5 só hoje" usam o mesmo caminho.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '#lib/database.types.ts';
import type { Language } from '#lib/languages.ts';
import { buildQueue, dayStart, nextDayStart, type DayClock } from '#lib/review.ts';
import type { ReviewItem } from '#lib/review.ts';
import { itemsOfWork } from './decks.ts';
import {
	OBRA_SESSION_NEW,
	orderNew,
	planNew,
	scopeDeckIds,
	stateAllowance,
	newDoneToday,
	type NewPlan,
	type QueueScope,
	type QueueState
} from './queue.ts';
import {
	attachMediaUrls,
	reviewableFichaFlashcards,
	reviewableItemFlashcards,
	toReviewItem,
	type ReviewFlashcardRow
} from './reviews.ts';

type Client = SupabaseClient<Database>;

/** Teto de segurança por carga; revisões vencidas não têm limite (a próxima carga traz o resto). */
const MAX_DUE_PER_LOAD = 500;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Escopo da sessão: tudo, um ou mais decks (hub com seleção) ou novas de uma obra. */
export type SessionScope =
	| { kind: 'all' }
	| { kind: 'decks'; deckIds: string[] }
	| { kind: 'obra'; workId: string; itemIds: ReadonlySet<string> };

export type ScopeResult = { ok: true; scope: SessionScope } | { ok: false; status: 404 | 500 };

/** ?deck= (repetível) ou ?obra=. Deck de outro idioma ou inexistente = 404. */
export async function parseScope(
	supabase: Client,
	params: URLSearchParams,
	state: QueueState
): Promise<ScopeResult> {
	const deckIds = [...new Set(params.getAll('deck').filter(Boolean))];
	const obra = params.get('obra');
	if (deckIds.length) {
		if (!deckIds.every((id) => state.decks.some((d) => d.id === id))) {
			return { ok: false, status: 404 };
		}
		return { ok: true, scope: { kind: 'decks', deckIds } };
	}
	if (obra) {
		if (!UUID.test(obra)) return { ok: false, status: 404 };
		const itemIds = await itemsOfWork(supabase, obra).catch(() => null);
		if (!itemIds) return { ok: false, status: 500 };
		return { ok: true, scope: { kind: 'obra', workId: obra, itemIds } };
	}
	return { ok: true, scope: { kind: 'all' } };
}

/**
 * Novas da sessão. Um deck ou tudo: planNew. Vários decks: a união dos escopos (cada um
 * com os subdecks), intercalada como "Estudar tudo" e cortada no orçamento do idioma.
 */
export function planSession(state: QueueState, scope: SessionScope): NewPlan {
	if (scope.kind === 'all') return planNew(state, { kind: 'all' });
	if (scope.kind === 'obra') return planNew(state, scope satisfies QueueScope);
	if (scope.deckIds.length === 1) {
		return planNew(state, { kind: 'deck', deckId: scope.deckIds[0] });
	}
	const deckIds = new Set(
		scope.deckIds.flatMap((deckId) => [...scopeDeckIds(state.decks, { kind: 'deck', deckId })])
	);
	const allowance = stateAllowance(state);
	const list = orderNew(state, deckIds);
	return {
		ids: list.slice(0, allowance).map((c) => c.id),
		newAllowance: allowance,
		newDoneToday: newDoneToday(state),
		more: Math.max(0, list.length - allowance),
		deckIds
	};
}

/** Quantas novas uma sessão "Desta obra" teria agora (para o botão do fim de cota). */
export function obraSessionSize(state: QueueState, itemIds: ReadonlySet<string>): number {
	const items = new Set(
		state.candidates
			.filter((c) => !c.buried && c.itemId && itemIds.has(c.itemId))
			.map((c) => c.itemId)
	);
	return Math.min(items.size, OBRA_SESSION_NEW);
}

export interface SessionQuery {
	userId: string;
	language: Language;
	tag: string | null;
	now: Date;
	clock: DayClock;
	retention: number;
	/** false = só as novas do plano (obra, "+5 só hoje"). */
	withDue: boolean;
}

/** A fila: vencidas dos decks do escopo + as novas do plano, na ordem do plano. */
export async function loadSessionQueue(
	supabase: Client,
	plan: NewPlan,
	q: SessionQuery
): Promise<ReviewItem[] | null> {
	const filter = { language: q.language, tag: q.tag, deckIds: [...plan.deckIds], queued: true };
	const nowIso = q.now.toISOString();
	const sources = [
		() => reviewableItemFlashcards(supabase, q.userId, filter),
		() => reviewableFichaFlashcards(supabase, q.userId, filter)
	];
	const none = Promise.resolve({ data: [], error: null });
	const [results, reviewedToday] = await Promise.all([
		Promise.all(
			sources.flatMap((base) => [
				q.withDue
					? base().gt('state', 0).lte('due_at', nowIso).order('due_at').limit(MAX_DUE_PER_LOAD)
					: none,
				plan.ids.length > 0 ? base().eq('state', 0).in('id', plan.ids) : none
			])
		),
		supabase
			.from('flashcards')
			.select('id, item_id')
			.eq('user_id', q.userId)
			.gte('last_review_at', dayStart(q.now, q.clock).toISOString())
	]);
	if (results.some((r) => r.error) || reviewedToday.error) return null;

	const rank = new Map(plan.ids.map((id, i) => [id, i]));
	const rows = results
		.flatMap((r) => (r.data ?? []) as ReviewFlashcardRow[])
		.sort((a, b) => (rank.get(a.id) ?? -1) - (rank.get(b.id) ?? -1));
	const queue = buildQueue(
		rows.map((r) => ({
			...r,
			itemId: 'items' in r ? r.item_id : null,
			dueAt: r.due_at,
			createdAt: r.created_at
		})),
		{
			now: q.now,
			newLimit: plan.ids.length,
			newDoneToday: 0,
			plannedNew: true,
			reviewedToday: reviewedToday.data.map((c) => ({ id: c.id, itemId: c.item_id }))
		}
	);
	return attachMediaUrls(
		supabase,
		await Promise.all(queue.map((r) => toReviewItem(r, q.now, q.retention)))
	);
}

async function headCount(query: PromiseLike<{ count: number | null; error: unknown }>) {
	const { count, error } = await query;
	if (error) throw new Error('contagem');
	return count ?? 0;
}

/** Revisões que vencem no próximo dia de estudo (o "Amanhã: cerca de N"). */
export async function tomorrowReviews(
	supabase: Client,
	userId: string,
	language: Language,
	now: Date,
	clock: DayClock
): Promise<number> {
	const from = nextDayStart(now, clock);
	const to = nextDayStart(new Date(from.getTime() + 60_000), clock);
	const [items, fichas] = await Promise.all([
		headCount(
			supabase
				.from('flashcards')
				.select('id, items!inner(language, status, deleted_at, leech_hold)', {
					count: 'exact',
					head: true
				})
				.eq('user_id', userId)
				.eq('items.language', language)
				.eq('items.status', 'ativo')
				.is('items.deleted_at', null)
				.is('items.leech_hold', null)
				.gt('state', 0)
				.lt('due_at', to.toISOString())
		),
		headCount(
			supabase
				.from('flashcards')
				.select('id, fichas!inner(language, status, deleted_at, leech_hold)', {
					count: 'exact',
					head: true
				})
				.eq('user_id', userId)
				.eq('fichas.language', language)
				.eq('fichas.status', 'ativo')
				.is('fichas.deleted_at', null)
				.is('fichas.leech_hold', null)
				.gt('state', 0)
				.lt('due_at', to.toISOString())
		)
	]);
	return items + fichas;
}

/** Flashcards do idioma (ou dos decks dados), de itens e fichas, para os cabeçalhos. */
export async function flashcardCount(
	supabase: Client,
	userId: string,
	language: Language,
	deckIds?: readonly string[]
): Promise<number> {
	let items = supabase
		.from('flashcards')
		.select('id, items!inner(language, deleted_at, deck_id)', { count: 'exact', head: true })
		.eq('user_id', userId)
		.eq('items.language', language)
		.is('items.deleted_at', null);
	let fichas = supabase
		.from('flashcards')
		.select('id, fichas!inner(language, deleted_at, deck_id)', { count: 'exact', head: true })
		.eq('user_id', userId)
		.eq('fichas.language', language)
		.is('fichas.deleted_at', null);
	if (deckIds) {
		items = items.in('items.deck_id', [...deckIds]);
		fichas = fichas.in('fichas.deck_id', [...deckIds]);
	}
	const [a, b] = await Promise.all([headCount(items), headCount(fichas)]);
	return a + b;
}
