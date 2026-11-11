import { describe, expect, test } from 'bun:test';
import {
	PRODUCE_UNLOCK_DAYS,
	applyRating,
	previewIntervals,
	replay,
	replaySteps,
	scheduleReview,
	unlocksProduce,
	type CardRow
} from './scheduler';

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
		const { next } = await applyRating(newRow(), 3, now);
		expect(next.reps).toBe(1);
		expect(next.state).toBeGreaterThan(0);
		expect(next.stability).toBeGreaterThan(0);
		expect(next.last_review_at).toBe(now.toISOString());
		expect(new Date(next.due_at).getTime()).toBeGreaterThan(now.getTime() + 24 * 3600_000);
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

const seed = { id: '3f0b6a5e-0000-4000-8000-000000000002', created_at: '2026-11-01T12:00:00.000Z' };
const at = (iso: string) => new Date(iso).toISOString();

describe('replay', () => {
	test('sem revisões devolve o cartão novo, vencendo na criação', async () => {
		const { card, maxIntervalDays } = await replay(seed, []);
		expect(card.state).toBe(0);
		expect(card.reps).toBe(0);
		expect(card.due_at).toBe(seed.created_at);
		expect(maxIntervalDays).toBe(0);
	});

	test('aplica as revisões na ordem de reviewed_at, não na de chegada', async () => {
		const logs = [
			{ rating: 3 as const, reviewed_at: at('2026-11-20T10:00:00Z') },
			{ rating: 1 as const, reviewed_at: at('2026-11-02T10:00:00Z') }
		];
		const a = await replay(seed, logs);
		const b = await replay(seed, [...logs].reverse());
		expect(a.card).toEqual(b.card);
		expect(a.card.reps).toBe(2);
		expect(a.card.last_review_at).toBe(at('2026-11-20T10:00:00Z'));
	});

	test('dá o mesmo resultado que aplicar as notas uma a uma', async () => {
		const t1 = new Date('2026-11-02T10:00:00Z');
		const one = await applyRating(newRow({ id: seed.id, due_at: seed.created_at }), 3, t1);
		const t2 = new Date(one.next.due_at);
		const two = await applyRating({ id: seed.id, ...one.next }, 3, t2);
		const { card } = await replay(seed, [
			{ rating: 3, reviewed_at: t1.toISOString() },
			{ rating: 3, reviewed_at: t2.toISOString() }
		]);
		expect(card).toEqual(two.next);
	});
});

describe('scheduleReview', () => {
	const t1 = at('2026-11-02T10:00:00Z');
	const t2 = at('2026-11-06T10:00:00Z');
	const t3 = at('2026-11-12T10:00:00Z');

	test('revisão em ordem é incremental e bate com o replay', async () => {
		const before = await replay(seed, [{ rating: 3, reviewed_at: t1 }]);
		const row = { ...seed, ...before.card };
		const r = await scheduleReview(row, [{ rating: 3, reviewed_at: t1 }], {
			rating: 4,
			reviewed_at: t2
		});
		expect(r.replayed).toBe(false);
		const full = await replay(seed, [
			{ rating: 3, reviewed_at: t1 },
			{ rating: 4, reviewed_at: t2 }
		]);
		expect(r.next).toEqual(full.card);
	});

	test('revisão fora de ordem (offline) recalcula o cartão inteiro', async () => {
		const logs = [
			{ rating: 3 as const, reviewed_at: t1 },
			{ rating: 3 as const, reviewed_at: t3 }
		];
		const before = await replay(seed, logs);
		const r = await scheduleReview({ ...seed, ...before.card }, logs, {
			rating: 1,
			reviewed_at: t2
		});
		expect(r.replayed).toBe(true);
		const full = await replay(seed, [logs[0], { rating: 1, reviewed_at: t2 }, logs[1]]);
		expect(r.next).toEqual(full.card);
		expect(r.next.reps).toBe(3);
		expect(r.next.last_review_at).toBe(t3);
	});
});

describe('unlocksProduce', () => {
	test(`Reconhecer com intervalo de ${PRODUCE_UNLOCK_DAYS} dias ou mais libera o Produzir`, () => {
		expect(unlocksProduce({ kind: 'reconhecer', sense: 'festa', intervalDays: 7 })).toBe(true);
		expect(unlocksProduce({ kind: 'reconhecer', sense: 'festa', intervalDays: 30 })).toBe(true);
	});

	test('intervalo curto não libera', () => {
		expect(unlocksProduce({ kind: 'reconhecer', sense: 'festa', intervalDays: 6.9 })).toBe(false);
	});

	test('sem sentido não há o que pedir no Produzir', () => {
		expect(unlocksProduce({ kind: 'reconhecer', sense: '', intervalDays: 30 })).toBe(false);
	});

	test('o próprio Produzir não cria outro cartão', () => {
		expect(unlocksProduce({ kind: 'produzir', sense: 'festa', intervalDays: 30 })).toBe(false);
	});

	test('Bom repetido num cartão novo chega a 7 dias e libera', async () => {
		let row = { ...seed, ...(await replay(seed, [])).card };
		const logs: { rating: 3; reviewed_at: string }[] = [];
		let now = new Date('2026-11-02T10:00:00Z');
		let unlocked = false;
		for (let i = 0; i < 6 && !unlocked; i++) {
			const review = { rating: 3 as const, reviewed_at: now.toISOString() };
			const r = await scheduleReview(row, logs, review);
			logs.push(review);
			row = { ...seed, ...r.next };
			unlocked = unlocksProduce({
				kind: 'reconhecer',
				sense: 'festa',
				intervalDays: r.intervalDays
			});
			now = new Date(r.next.due_at);
		}
		expect(unlocked).toBe(true);
	});
});

describe('retenção desejada', () => {
	test('retenção menor dá intervalos maiores para o mesmo histórico', async () => {
		const seed = { id: newRow().id, created_at: '2026-10-01T12:00:00Z' };
		const logs = [
			{ rating: 3 as const, reviewed_at: '2026-10-01T12:00:00Z' },
			{ rating: 3 as const, reviewed_at: '2026-10-05T12:00:00Z' },
			{ rating: 3 as const, reviewed_at: '2026-10-20T12:00:00Z' }
		];
		const low = await replay(seed, logs, 0.8);
		const high = await replay(seed, logs, 0.95);
		expect(low.card.scheduled_days).toBeGreaterThan(high.card.scheduled_days);
	});

	test('replaySteps registra o estado e o intervalo de antes de cada revisão', async () => {
		const seed = { id: newRow().id, created_at: '2026-10-01T12:00:00Z' };
		const { steps } = await replaySteps(seed, [
			{ rating: 3 as const, reviewed_at: '2026-10-01T12:00:00Z' },
			{ rating: 3 as const, reviewed_at: '2026-10-10T12:00:00Z' }
		]);
		expect(steps[0].stateBefore).toBe(0);
		expect(steps[0].lastIntervalDays).toBe(0);
		expect(steps[1].lastIntervalDays).toBe(steps[0].intervalDays);
	});
});
