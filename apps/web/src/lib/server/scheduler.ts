// Agendamento FSRS (ts-fsrs). Só roda no servidor: o navegador recebe os
// rótulos de intervalo prontos e manda a nota; quem calcula o próximo estado é aqui.

import { DefaultScheduler } from 'ts-fsrs';
import { formatInterval, type Grade } from '#lib/review.ts';

/** Retenção desejada fixa no MVP. */
export const DESIRED_RETENTION = 0.9;

/** Colunas de agendamento da tabela cards (snake_case, como vêm do banco). */
export interface CardFields {
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

export interface CardRow extends CardFields {
	id: string;
}

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

function toFsrs(row: CardRow): FsrsCard {
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

function fromFsrs(card: FsrsCard): CardFields {
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

/** Datas viram ISO para caber num jsonb. */
function plain(value: object): Record<string, unknown> {
	return JSON.parse(JSON.stringify(value));
}

/** Aplica a nota: devolve o novo estado do cartão e o log do ts-fsrs. */
export async function applyRating(row: CardRow, grade: Grade, now: Date) {
	const s = await scheduler();
	const result = s.review({ card: toFsrs(row), grade, now });
	return { next: fromFsrs(result.card), revlog: plain(result.revlog) };
}

/** Rótulos em PT do próximo intervalo de cada botão. */
export async function previewIntervals(row: CardRow, now: Date): Promise<Record<Grade, string>> {
	const s = await scheduler();
	const labels = {} as Record<Grade, string>;
	for (const { grade, card } of s.preview({ card: toFsrs(row), now })) {
		labels[grade as Grade] = formatInterval(card.dueAt.getTime() - now.getTime());
	}
	return labels;
}
