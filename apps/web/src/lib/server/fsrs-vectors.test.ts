import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { Grade } from '#lib/review.ts';
import { replay, scheduleReview, type FlashcardFields, type LogEntry } from './scheduler';

// Paridade do FSRS (docs/sync/CONTRACT.md, seção 11): o servidor tem de continuar
// passando os mesmos vetores que o firmware do e-reader passa.

type Step = { rating: Grade; reviewedAt: string; expected: FlashcardFields };
type Case = {
	name: string;
	flashcardId: string;
	createdAt: string;
	steps: Step[];
	arrivalOrder?: number[];
};

const vectors = JSON.parse(
	readFileSync(
		new URL('../../../../../docs/sync/fixtures/fsrs-vectors.json', import.meta.url),
		'utf8'
	)
) as { tolerance: { float: number; dueAtMs: number }; cases: Case[] };

const { float, dueAtMs } = vectors.tolerance;

function expectCard(actual: FlashcardFields, expected: FlashcardFields) {
	for (const k of ['stability', 'stability_fast', 'difficulty', 'scheduled_days'] as const) {
		const diff = Math.abs(actual[k] - expected[k]);
		expect(diff <= Math.max(float, float * Math.abs(expected[k]))).toBe(true);
	}
	expect(Math.abs(Date.parse(actual.due_at) - Date.parse(expected.due_at))).toBeLessThanOrEqual(
		dueAtMs
	);
	expect(actual.state).toBe(expected.state);
	expect(actual.schedule_status).toBe(expected.schedule_status);
	expect(actual.reps).toBe(expected.reps);
	expect(actual.lapses).toBe(expected.lapses);
	expect(actual.learning_step).toBe(expected.learning_step);
	expect(actual.last_review_at).toBe(expected.last_review_at);
}

describe('fsrs-vectors.json', () => {
	for (const c of vectors.cases) {
		const seed = { id: c.flashcardId, created_at: c.createdAt };

		test(`${c.name}: cada passo em ordem`, async () => {
			for (let n = 1; n <= c.steps.length; n++) {
				const logs: LogEntry[] = c.steps
					.slice(0, n)
					.map((s) => ({ rating: s.rating, reviewed_at: s.reviewedAt }));
				const { card } = await replay(seed, logs);
				expectCard(card, c.steps[n - 1].expected);
			}
		});

		test(`${c.name}: chegando pelo push (scheduleReview na ordem de chegada)`, async () => {
			const order = c.arrivalOrder ?? c.steps.map((_, i) => i);
			let row = { ...seed, ...(await replay(seed, [])).card };
			const logs: LogEntry[] = [];
			for (const i of order) {
				const review = { rating: c.steps[i].rating, reviewed_at: c.steps[i].reviewedAt };
				const { next } = await scheduleReview(row, logs, review);
				logs.push(review);
				row = { ...row, ...next };
			}
			const { id: _id, created_at: _created, ...card } = row;
			expectCard(card, c.steps[c.steps.length - 1].expected);
		});
	}
});
