// Acesso ao banco da revisão: flashcards com o item (e o encontro mais recente) ou
// com a ficha, review_logs e as funções record_review / undo_review / review_counts.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '#lib/database.types.ts';
import { sanitizeFichaHtml, type FichaFlashcardKind, type FichaMediaField } from '#lib/fichas.ts';
import { formatWorkSource, type FlashcardKind, type Origin } from '#lib/items.ts';
import type { Language } from '#lib/languages.ts';
import {
	dayStart,
	formatWhen,
	nextAvailableAt,
	reviewCount,
	reviewMediaPaths,
	withMediaUrls,
	type ReviewCounts,
	type ReviewItem
} from '#lib/review.ts';
import { signMedia } from './media.ts';
import {
	previewIntervals,
	type FlashcardRow,
	type FlashcardSeed,
	type LogEntry
} from './scheduler.ts';

type Client = SupabaseClient<Database>;

const FLASHCARD_COLUMNS =
	'id, kind, ord, due_at, stability, stability_fast, difficulty, state, schedule_status, last_review_at, reps, lapses, scheduled_days, learning_step, created_at';

const FLASHCARD_WITH_ITEM = `${FLASHCARD_COLUMNS}, items!inner(lemma, reading, sense, ipa, language, tags, image, audio, encounters(sentence, highlight, origin, position, seen_at, works(title, subtitle)))`;

const FLASHCARD_WITH_FICHA = `${FLASHCARD_COLUMNS}, fichas!inner(id, front, back, language, tags, front_image, front_audio, back_image, back_audio)`;

export interface ReviewFilter {
	language?: Language;
	/** Só flashcards com esta tag (no item ou na ficha). */
	tag?: string | null;
}

/**
 * Flashcards de item revisáveis: o item está ativo e não foi apagado. Cada um vem
 * com o encontro mais recente (a frase que aparece no verso).
 */
export function reviewableItemFlashcards(supabase: Client, userId: string, f: ReviewFilter = {}) {
	let query = supabase
		.from('flashcards')
		.select(FLASHCARD_WITH_ITEM)
		.eq('user_id', userId)
		.eq('items.status', 'ativo')
		.is('items.deleted_at', null)
		.is('items.encounters.deleted_at', null)
		.order('seen_at', { referencedTable: 'items.encounters', ascending: false })
		.limit(1, { referencedTable: 'items.encounters' });
	if (f.language) query = query.eq('items.language', f.language);
	if (f.tag) query = query.contains('items.tags', [f.tag]);
	return query;
}

/** Flashcards de ficha revisáveis: a ficha está ativa e não foi apagada. */
export function reviewableFichaFlashcards(supabase: Client, userId: string, f: ReviewFilter = {}) {
	let query = supabase
		.from('flashcards')
		.select(FLASHCARD_WITH_FICHA)
		.eq('user_id', userId)
		.eq('fichas.status', 'ativo')
		.is('fichas.deleted_at', null);
	if (f.language) query = query.eq('fichas.language', f.language);
	if (f.tag) query = query.contains('fichas.tags', [f.tag]);
	return query;
}

type BaseRow = FlashcardRow & FlashcardSeed & { ord: number };

export type ItemFlashcardRow = BaseRow & {
	kind: FlashcardKind;
	items: {
		lemma: string;
		sense: string;
		ipa: string;
		reading: string;
		language: string;
		tags: string[];
		image: string | null;
		audio: string | null;
		encounters: {
			sentence: string;
			highlight: string;
			origin: string;
			position: unknown;
			works: { title: string; subtitle: string } | null;
		}[];
	};
};

export type FichaFlashcardRow = BaseRow & {
	kind: FichaFlashcardKind;
	fichas: { id: string; front: string; back: string; language: string; tags: string[] } & Record<
		FichaMediaField,
		string | null
	>;
};

export type ReviewFlashcardRow = ItemFlashcardRow | FichaFlashcardRow;

/** Sentido a pedir no Produzir (vazio para ficha, que não libera Produzir). */
export function rowSense(row: ReviewFlashcardRow): string {
	return 'items' in row ? row.items.sense : '';
}

export async function loadReviewFlashcard(supabase: Client, userId: string, flashcardId: string) {
	const [item, ficha] = await Promise.all([
		reviewableItemFlashcards(supabase, userId).eq('id', flashcardId).maybeSingle(),
		reviewableFichaFlashcards(supabase, userId).eq('id', flashcardId).maybeSingle()
	]);
	return (item.data ?? ficha.data) as ReviewFlashcardRow | null;
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
	const base = {
		flashcardId: row.id,
		reps: row.reps,
		state: row.state,
		dueAt: row.due_at,
		intervals: await previewIntervals(row, now)
	};
	if ('fichas' in row) {
		return {
			...base,
			source: 'ficha',
			kind: row.kind,
			ord: row.ord,
			fichaId: row.fichas.id,
			// Já sai sanitizado do formulário e do import; de novo aqui, por ir para {@html}.
			front: sanitizeFichaHtml(row.fichas.front),
			back: sanitizeFichaHtml(row.fichas.back),
			language: row.fichas.language,
			tags: row.fichas.tags,
			frontImage: row.fichas.front_image,
			frontAudio: row.fichas.front_audio,
			backImage: row.fichas.back_image,
			backAudio: row.fichas.back_audio
		};
	}
	const encounter = row.items.encounters[0] ?? null;
	return {
		...base,
		source: 'item',
		kind: row.kind,
		lemma: row.items.lemma,
		sense: row.items.sense,
		ipa: row.items.ipa,
		reading: row.items.reading,
		language: row.items.language,
		tags: row.items.tags,
		sentence: encounter?.sentence ?? '',
		highlight: encounter?.highlight ?? '',
		origin: (encounter?.origin as Origin | undefined) ?? null,
		sourceDetail: encounter ? formatWorkSource(encounter.works, encounter.position) : '',
		image: row.items.image,
		audio: row.items.audio
	};
}

/** Assina a mídia de todos os flashcards de uma vez e troca caminhos por URLs. */
export async function attachMediaUrls<T extends ReviewItem>(
	supabase: Client,
	items: T[]
): Promise<T[]> {
	const urls = await signMedia(supabase, items.flatMap(reviewMediaPaths)).catch(
		() => new Map<string, string>()
	);
	return items.map((i) => withMediaUrls(i, urls));
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
