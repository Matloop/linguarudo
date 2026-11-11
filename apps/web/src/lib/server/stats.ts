// Dados da tela de estatísticas: cartões e review_logs de um idioma, com os
// metadados dos logs antigos (anteriores às colunas) reconstruídos pelo log.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '#lib/database.types.ts';
import type { Language } from '#lib/languages.ts';
import type { DayClock, Grade } from '#lib/review.ts';
import { buildStats, type StatsCard, type StatsLog } from '#lib/stats.ts';
import { replaySteps } from './scheduler.ts';

type Client = SupabaseClient<Database>;

/** O PostgREST corta em 1000 linhas por resposta. */
const PAGE = 1000;

async function all<T>(
	fetchPage: (
		from: number,
		to: number
	) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
	const rows: T[] = [];
	for (let from = 0; ; from += PAGE) {
		const { data, error } = await fetchPage(from, from + PAGE - 1);
		if (error) throw new Error(error.message);
		rows.push(...(data ?? []));
		if (!data || data.length < PAGE) return rows;
	}
}

interface LogRow {
	id: string;
	flashcard_id: string;
	rating: number;
	reviewed_at: string;
	duration_ms: number | null;
	state_before: number | null;
	last_interval_days: number | null;
}

/** Preenche state_before/last_interval_days dos logs antigos reaplicando o log do cartão. */
async function backfill(
	logs: LogRow[],
	cardCreated: Map<string, string>,
	retention: number
): Promise<StatsLog[]> {
	const byCard = new Map<string, LogRow[]>();
	for (const l of logs) {
		const list = byCard.get(l.flashcard_id);
		if (list) list.push(l);
		else byCard.set(l.flashcard_id, [l]);
	}
	const fixed = new Map<string, { state: number; last: number }>();
	for (const [cardId, list] of byCard) {
		if (list.every((l) => l.state_before != null && l.last_interval_days != null)) continue;
		const { steps } = await replaySteps(
			{ id: cardId, created_at: cardCreated.get(cardId) ?? list[0].reviewed_at },
			list.map((l) => ({ ...l, rating: l.rating as Grade })),
			retention
		);
		for (const s of steps) {
			fixed.set(s.log.id, { state: s.stateBefore, last: s.lastIntervalDays });
		}
	}
	return logs.map((l) => ({
		rating: l.rating,
		reviewed_at: l.reviewed_at,
		duration_ms: l.duration_ms,
		state_before: l.state_before ?? fixed.get(l.id)?.state ?? 0,
		last_interval_days: l.last_interval_days ?? fixed.get(l.id)?.last ?? 0
	}));
}

export async function loadStats(
	supabase: Client,
	userId: string,
	language: Language,
	now: Date,
	clock: DayClock,
	retention: number
) {
	// Cartões apagados ficam de fora do estado atual, mas seus logs continuam no histórico.
	const [cards, logs] = await Promise.all([
		all((from, to) =>
			supabase
				.from('flashcards')
				.select(
					'id, item_id, created_at, state, due_at, stability, difficulty, scheduled_days, items!inner(language, status, created_at, deleted_at)'
				)
				.eq('user_id', userId)
				.eq('items.language', language)
				.order('id')
				.range(from, to)
		),
		all<LogRow>((from, to) =>
			supabase
				.from('review_logs')
				.select(
					'id, flashcard_id, rating, reviewed_at, duration_ms, state_before, last_interval_days'
				)
				.eq('user_id', userId)
				.order('reviewed_at')
				.order('id')
				.range(from, to)
		)
	]);

	const cardCreated = new Map(cards.map((c) => [c.id, c.created_at]));
	const languageLogs = logs.filter((l) => cardCreated.has(l.flashcard_id));
	const live = cards.filter((c) => c.items.deleted_at == null);
	const statsCards: StatsCard[] = live.map((c) => ({
		state: c.state,
		due_at: c.due_at,
		stability: c.stability,
		difficulty: c.difficulty,
		scheduled_days: c.scheduled_days,
		known: c.items.status === 'conhecido'
	}));
	const addedAt = [...new Map(live.map((c) => [c.item_id, c.items.created_at])).values()];

	return buildStats({
		cards: statsCards,
		logs: await backfill(languageLogs, cardCreated, retention),
		addedAt,
		now,
		clock
	});
}
