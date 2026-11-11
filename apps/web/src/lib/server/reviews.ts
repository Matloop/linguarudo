// Acesso ao banco da revisão: flashcards com o item e o encontro mais recente,
// review_logs e as funções record_review / undo_review / review_counts.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '#lib/database.types.ts';
import { formatWorkSource, type FlashcardKind, type Origin } from '#lib/items.ts';
import type { Language } from '#lib/languages.ts';
import {
	dayStart,
	formatWhen,
	nextAvailableAt,
	reviewCount,
	type ReviewCounts,
	type ReviewItem
} from '#lib/review.ts';
import {
	previewIntervals,
	type FlashcardRow,
	type FlashcardSeed,
	type LogEntry
} from './scheduler.ts';

type Client = SupabaseClient<Database>;

const FLASHCARD_COLUMNS =
	'id, kind, due_at, stability, stability_fast, difficulty, state, schedule_status, last_review_at, reps, lapses, scheduled_days, learning_step, created_at';

const FLASHCARD_WITH_ITEM = `${FLASHCARD_COLUMNS}, items!inner(lemma, reading, sense, ipa, language, encounters(sentence, highlight, origin, position, seen_at, works(title, subtitle)))`;

/**
 * Flashcards revisáveis do usuário: o item está ativo e não foi apagado. Cada um vem
 * com o encontro mais recente (a frase que aparece no verso). Com `language`, só
 * os daquele idioma.
 */
export function reviewableFlashcards(supabase: Client, userId: string, language?: Language) {
	const query = supabase
		.from('flashcards')
		.select(FLASHCARD_WITH_ITEM)
		.eq('user_id', userId)
		.eq('items.status', 'ativo')
		.is('items.deleted_at', null)
		.is('items.encounters.deleted_at', null)
		.order('seen_at', { referencedTable: 'items.encounters', ascending: false })
		.limit(1, { referencedTable: 'items.encounters' });
	return language ? query.eq('items.language', language) : query;
}

export type ReviewFlashcardRow = FlashcardRow &
	FlashcardSeed & {
		kind: FlashcardKind;
		items: {
			lemma: string;
			sense: string;
			ipa: string;
			reading: string;
			language: string;
			encounters: {
				sentence: string;
				highlight: string;
				origin: string;
				position: unknown;
				works: { title: string; subtitle: string } | null;
			}[];
		};
	};

export async function loadReviewFlashcard(supabase: Client, userId: string, flashcardId: string) {
	const { data } = await reviewableFlashcards(supabase, userId).eq('id', flashcardId).maybeSingle();
	return data as ReviewFlashcardRow | null;
}

/** Log do flashcard, na ordem em que as revisões aconteceram. */
export async function loadLogs(supabase: Client, flashcardId: string) {
	const { data, error } = await supabase
		.from('review_logs')
		.select('id, rating, reviewed_at')
		.eq('flashcard_id', flashcardId)
		.order('reviewed_at');
	if (error) throw new Error(`review_logs: ${error.message}`);
	return data as (LogEntry & { id: string })[];
}

export async function toReviewItem(row: ReviewFlashcardRow, now: Date): Promise<ReviewItem> {
	const encounter = row.items.encounters[0] ?? null;
	return {
		flashcardId: row.id,
		kind: row.kind,
		reps: row.reps,
		state: row.state,
		dueAt: row.due_at,
		lemma: row.items.lemma,
		sense: row.items.sense,
		ipa: row.items.ipa,
		reading: row.items.reading,
		language: row.items.language,
		sentence: encounter?.sentence ?? '',
		highlight: encounter?.highlight ?? '',
		origin: (encounter?.origin as Origin | undefined) ?? null,
		sourceDetail: encounter ? formatWorkSource(encounter.works, encounter.position) : '',
		intervals: await previewIntervals(row, now)
	};
}

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

/** Erros de record_review/undo_review, em PT. */
export function reviewErrorMessage(message: string | undefined): { status: number; text: string } {
	switch (message) {
		case 'flashcard_stale':
			return { status: 409, text: 'Esse flashcard já foi avaliado em outra aba.' };
		case 'flashcard_not_found':
		case 'log_not_found':
			return { status: 404, text: 'Flashcard não encontrado.' };
		default:
			return { status: 500, text: 'Não deu para salvar agora. Tente de novo.' };
	}
}
