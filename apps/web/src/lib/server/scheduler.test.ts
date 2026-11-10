import { describe, expect, test } from 'bun:test';
import { applyRating, previewIntervals, type CardRow } from './scheduler';

const now = new Date('2026-11-10T15:00:00.000Z');

function newRow(over: Partial<CardRow> = {}): CardRow {
	return {
		id: '3f0b6a5e-0000-4000-8000-000000000001',
		due_at: '2026-11-10T12:00:00+00:00',
		stability: 0,
		stability_fast: 0,
		difficulty: 0,
		state: 0,
		schedule_status: 'new',
		last_review_at: null,
		reps: 0,
		lapses: 0,
		scheduled_days: 0,
		learning_step: 0,
		...over
	};
}

describe('applyRating', () => {
	test('Bom num cartão novo agenda para dias depois e incrementa reps', async () => {
		const { next, revlog } = await applyRating(newRow(), 3, now);
		expect(next.reps).toBe(1);
		expect(next.state).toBeGreaterThan(0);
		expect(next.stability).toBeGreaterThan(0);
		expect(next.last_review_at).toBe(now.toISOString());
		expect(new Date(next.due_at).getTime()).toBeGreaterThan(now.getTime() + 24 * 3600_000);
		expect(revlog.rating).toBe(3);
		expect(revlog.reviewTime).toBe(now.toISOString());
	});

	test('De novo deixa o cartão para daqui a minutos', async () => {
		const { next } = await applyRating(newRow(), 1, now);
		const ms = new Date(next.due_at).getTime() - now.getTime();
		expect(ms).toBeGreaterThan(0);
		expect(ms).toBeLessThanOrEqual(30 * 60_000);
	});

	test('notas maiores dão intervalos maiores', async () => {
		const dues = await Promise.all(
			([1, 2, 3, 4] as const).map(async (g) =>
				new Date((await applyRating(newRow(), g, now)).next.due_at).getTime()
			)
		);
		expect([...dues].sort((a, b) => a - b)).toEqual(dues);
		expect(new Set(dues).size).toBe(4);
	});

	test('errar um cartão em revisão conta um lapso', async () => {
		const { next: aprendido } = await applyRating(newRow(), 3, now);
		const depois = new Date(aprendido.due_at);
		const { next } = await applyRating({ ...newRow(), ...aprendido }, 1, depois);
		expect(next.lapses).toBe(1);
		expect(next.reps).toBe(2);
	});

	test('o resultado é determinístico para o mesmo cartão e momento', async () => {
		const a = await applyRating(newRow({ reps: 0 }), 3, now);
		const b = await applyRating(newRow({ reps: 0 }), 3, now);
		expect(a.next).toEqual(b.next);
	});
});

describe('previewIntervals', () => {
	test('quatro rótulos em PT, coerentes com applyRating', async () => {
		const labels = await previewIntervals(newRow(), now);
		expect(Object.keys(labels)).toEqual(['1', '2', '3', '4']);
		expect(labels[1]).toMatch(/min$/);
		const { next } = await applyRating(newRow(), 4, now);
		const days = Math.round((new Date(next.due_at).getTime() - now.getTime()) / 86_400_000);
		expect(labels[4]).toMatch(/(d|mês|meses)$/);
		if (days < 31) expect(labels[4]).toBe(`${days} d`);
	});
});
