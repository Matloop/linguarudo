// Acesso ao banco da revisão (cards, review_logs e as RPCs da migration de revisão).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '#lib/database.types.ts';
import {
	dayStart,
	formatWhen,
	nextAvailableAt,
	reviewCount,
	type ReviewCounts,
	type ReviewItem
} from '#lib/review.ts';
import { formatSource } from '#lib/stremio.ts';
import { previewIntervals, type CardRow } from './scheduler.ts';

type Client = SupabaseClient<Database>;

export const CARD_COLUMNS =
	'id, due_at, stability, stability_fast, difficulty, state, schedule_status, last_review_at, reps, lapses, scheduled_days, learning_step, paused, created_at';

export const CARD_WITH_WORD = `${CARD_COLUMNS}, words!inner(term, translation, lang, context, context_highlight, source, source_title, source_time_s)`;

export interface ReviewSummary extends ReviewCounts {
	count: number;
	/** Texto do estado vazio ("hoje às 18:00"); null se não há nada agendado. */
	next: string | null;
}

export async function fetchReviewSummary(supabase: Client, now: Date): Promise<ReviewSummary> {
	const { data, error } = await supabase
		.rpc('review_counts', { p_day_start: dayStart(now).toISOString() })
		.single();
	if (error || !data) throw new Error(`review_counts: ${error?.message}`);

	const counts: ReviewCounts = {
		dueNow: data.due_now,
		newAvailable: data.new_available,
		newDoneToday: data.new_done_today,
		newLimit: data.new_limit
	};
	const nextAt = nextAvailableAt({ ...counts, now, nextDueAt: data.next_due_at });
	return { ...counts, count: reviewCount(counts), next: nextAt ? formatWhen(nextAt, now) : null };
}

type CardWithWord = CardRow & {
	words: Pick<ReviewItem, 'term' | 'translation' | 'lang' | 'context' | 'source'> & {
		context_highlight: string;
		source_title: string;
		source_time_s: number | null;
	};
};

export async function toReviewItem(row: CardWithWord, now: Date): Promise<ReviewItem> {
	return {
		cardId: row.id,
		reps: row.reps,
		state: row.state,
		dueAt: row.due_at,
		term: row.words.term,
		translation: row.words.translation,
		lang: row.words.lang,
		context: row.words.context,
		contextHighlight: row.words.context_highlight,
		source: row.words.source,
		sourceDetail: formatSource(row.words.source_title, row.words.source_time_s),
		intervals: await previewIntervals(row, now)
	};
}

/** Erros das RPCs review_card/undo_review, em PT. */
export function reviewErrorMessage(message: string | undefined): { status: number; text: string } {
	switch (message) {
		case 'new_limit':
			return { status: 409, text: 'Você já viu todos os cartões novos de hoje. Volte amanhã!' };
		case 'card_stale':
			return { status: 409, text: 'Esse cartão já foi avaliado em outra aba.' };
		case 'card_paused':
			return { status: 409, text: 'Essa palavra está pausada.' };
		case 'log_not_latest':
			return { status: 409, text: 'Só dá para desfazer a última nota deste cartão.' };
		case 'card_not_found':
		case 'log_not_found':
			return { status: 404, text: 'Cartão não encontrado.' };
		default:
			return { status: 500, text: 'Não deu para salvar agora. Tente de novo.' };
	}
}
