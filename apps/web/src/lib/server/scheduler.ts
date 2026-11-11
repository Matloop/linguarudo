// Agendamento FSRS (ts-fsrs). Só roda no servidor: o navegador recebe os
// rótulos de intervalo prontos e manda a nota; quem calcula o próximo estado é aqui.
// O cronograma de um flashcard é função do log de revisões (ADR 0001): replay() o
// reconstrói do zero, na ordem de reviewed_at.

import { DefaultScheduler } from 'ts-fsrs';
import type { FlashcardKind } from '#lib/items.ts';
import { formatInterval, type Grade } from '#lib/review.ts';

/** Retenção desejada fixa no MVP. */
export const DESIRED_RETENTION = 0.9;

/** Colunas de agendamento da tabela cards (snake_case, como vêm do banco). */
export interface FlashcardFields {
	due_at: string;
	stability: number;
	stability_fast: number;
	difficulty: number;
	state: number;
	schedule_status: string;
	last_review_at: string | null;
	reps: number;
	lapses: number;
	scheduled_days: number;
	learning_step: number;
}

export interface FlashcardRow extends FlashcardFields {
	id: string;
}

/** Uma linha de review_logs, no que importa para o cronograma. */
export interface LogEntry {
	rating: Grade;
	/** Momento da revisão no aparelho (ISO). */
	reviewed_at: string;
}

/** O que define o flashcard antes de qualquer revisão. */
export interface FlashcardSeed {
	id: string;
	created_at: string;
}

/** Intervalo a partir do qual uma revisão de Reconhecer libera o Produzir. */
export const PRODUCE_UNLOCK_DAYS = 7;

const DAY_MS = 86_400_000;

// FSRS-7 (padrão do ts-fsrs 6) com passos de aprendizado e fuzz. O fuzz usa
// cardId + reps como semente, então a prévia e a nota dão o mesmo intervalo.
let schedulerPromise: ReturnType<typeof createScheduler> | undefined;
function createScheduler() {
	return DefaultScheduler({ desiredRetention: DESIRED_RETENTION, enableFuzz: true });
}
function scheduler() {
	return (schedulerPromise ??= createScheduler());
}

type Scheduler = Awaited<ReturnType<typeof createScheduler>>;
type FsrsCard = ReturnType<Scheduler['newCard']>;

function toFsrs(row: FlashcardRow): FsrsCard {
	return {
		cardId: row.id,
		dueAt: new Date(row.due_at),
		stability: row.stability,
		stabilityFast: row.stability_fast,
		difficulty: row.difficulty,
		state: row.state,
		scheduleStatus: row.schedule_status,
		lastReviewAt: row.last_review_at ? new Date(row.last_review_at) : null,
		reps: row.reps,
		lapses: row.lapses,
		scheduledDays: row.scheduled_days,
		learningStep: row.learning_step
	} as FsrsCard;
}

function fromFsrs(card: FsrsCard): FlashcardFields {
	return {
		due_at: card.dueAt.toISOString(),
		stability: card.stability,
		stability_fast: card.stabilityFast,
		difficulty: card.difficulty,
		state: card.state,
		schedule_status: card.scheduleStatus,
		last_review_at: card.lastReviewAt ? card.lastReviewAt.toISOString() : null,
		reps: card.reps,
		lapses: card.lapses,
		scheduled_days: card.scheduledDays,
		learning_step: card.learningStep
	};
}

/** Aplica uma nota ao flashcard, no instante dado. */
export async function applyRating(row: FlashcardRow, grade: Grade, now: Date) {
	const s = await scheduler();
	const result = s.review({ card: toFsrs(row), grade, now });
	return { next: fromFsrs(result.card) };
}

/** Flashcard novo, como o banco cria: vence na criação. */
function emptyFlashcard(seed: FlashcardSeed): FlashcardRow {
	return {
		id: seed.id,
		due_at: seed.created_at,
		stability: 0,
		stability_fast: 0,
		difficulty: 0,
		state: 0,
		schedule_status: 'new',
		last_review_at: null,
		reps: 0,
		lapses: 0,
		scheduled_days: 0,
		learning_step: 0
	};
}

function intervalDays(next: FlashcardFields, reviewedAt: string): number {
	return (Date.parse(next.due_at) - Date.parse(reviewedAt)) / DAY_MS;
}

/**
 * Reconstrói o flashcard aplicando o log em ordem de reviewed_at (empate: ordem recebida).
 * maxIntervalDays é o maior intervalo que alguma revisão deu (para o Produzir).
 */
export async function replay(seed: FlashcardSeed, logs: readonly LogEntry[]) {
	const ordered = logs
		.map((log, i) => ({ log, i }))
		.sort((a, b) => Date.parse(a.log.reviewed_at) - Date.parse(b.log.reviewed_at) || a.i - b.i);
	const { id, ...empty } = emptyFlashcard(seed);
	let card: FlashcardFields = empty;
	let maxIntervalDays = 0;
	for (const { log } of ordered) {
		const { next } = await applyRating({ id, ...card }, log.rating, new Date(log.reviewed_at));
		maxIntervalDays = Math.max(maxIntervalDays, intervalDays(next, log.reviewed_at));
		card = next;
	}
	return { card, maxIntervalDays };
}

/**
 * Próximo estado depois de uma revisão nova. Se ela é mais recente que a última
 * aplicada, basta aplicar a nota. Se chegou atrasada (revisada offline antes de
 * outra que já entrou), o flashcard inteiro é recalculado pelo log.
 */
export async function scheduleReview(
	row: FlashcardRow & FlashcardSeed,
	logs: readonly LogEntry[],
	review: LogEntry
) {
	const inOrder =
		!row.last_review_at || Date.parse(review.reviewed_at) >= Date.parse(row.last_review_at);
	if (inOrder) {
		const { next } = await applyRating(row, review.rating, new Date(review.reviewed_at));
		return { next, intervalDays: intervalDays(next, review.reviewed_at), replayed: false };
	}
	const { card, maxIntervalDays } = await replay(row, [...logs, review]);
	return { next: card, intervalDays: maxIntervalDays, replayed: true };
}

/** Uma revisão de Reconhecer com intervalo longo cria o Produzir, se houver sentido a pedir. */
export function unlocksProduce(r: {
	kind: FlashcardKind;
	sense: string;
	intervalDays: number;
}): boolean {
	return r.kind === 'reconhecer' && r.sense.trim() !== '' && r.intervalDays >= PRODUCE_UNLOCK_DAYS;
}

/** Rótulos em PT do próximo intervalo de cada botão. */
export async function previewIntervals(
	row: FlashcardRow,
	now: Date
): Promise<Record<Grade, string>> {
	const s = await scheduler();
	const labels = {} as Record<Grade, string>;
	for (const { grade, card } of s.preview({ card: toFsrs(row), now })) {
		labels[grade as Grade] = formatInterval(card.dueAt.getTime() - now.getTime());
	}
	return labels;
}
