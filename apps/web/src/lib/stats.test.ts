import { describe, expect, test } from 'bun:test';
import { DEFAULT_CLOCK } from './review.ts';
import {
	buildStats,
	bucketSize,
	dayIndexer,
	histogram,
	reviewKind,
	type StatsCard,
	type StatsLog
} from './stats.ts';

// São Paulo, virada às 4h = 07:00Z.
const NOW = new Date('2026-11-11T15:00:00Z');

const log = (at: string, rating: number, extra: Partial<StatsLog> = {}): StatsLog => ({
	rating,
	reviewed_at: at,
	duration_ms: 5000,
	state_before: 2,
	last_interval_days: 5,
	...extra
});

const card = (extra: Partial<StatsCard> = {}): StatsCard => ({
	state: 2,
	due_at: '2026-11-13T10:00:00Z',
	stability: 10,
	difficulty: 5.5,
	scheduled_days: 10,
	known: false,
	...extra
});

describe('dayIndexer', () => {
	const idx = dayIndexer(NOW, DEFAULT_CLOCK, Date.parse('2026-01-01T00:00:00Z'));

	test('a virada às 4h separa os dias', () => {
		expect(idx.day(Date.parse('2026-11-11T07:00:00Z'))).toBe(0);
		expect(idx.day(Date.parse('2026-11-11T06:59:00Z'))).toBe(-1);
		expect(idx.day(Date.parse('2026-11-12T07:00:00Z'))).toBe(1);
		expect(idx.day(Date.parse('2026-01-02T12:00:00Z'))).toBe(-313);
	});

	test('hora local no fuso do usuário', () => {
		expect(idx.hour(Date.parse('2026-11-11T07:30:00Z'))).toBe(4);
		expect(idx.hour(Date.parse('2026-11-11T02:10:00Z'))).toBe(23);
	});
});

describe('buildStats', () => {
	test('hoje, tipos e retenção verdadeira', () => {
		const stats = buildStats({
			now: NOW,
			clock: DEFAULT_CLOCK,
			addedAt: ['2026-11-11T08:00:00Z', '2026-11-01T12:00:00Z'],
			cards: [card(), card({ state: 0 }), card({ known: true })],
			logs: [
				log('2026-11-11T08:00:00Z', 3),
				log('2026-11-11T09:00:00Z', 1, { last_interval_days: 30 }),
				log('2026-11-11T10:00:00Z', 3, { state_before: 0, last_interval_days: 0 }),
				log('2026-11-10T12:00:00Z', 4, { last_interval_days: 40 })
			]
		});
		expect(stats.today.cards).toBe(3);
		expect(stats.today.again).toBe(1);
		expect(stats.today.byKind).toEqual({ aprender: 1, recente: 1, madura: 1, reaprender: 0 });
		expect(stats.today.ms).toBe(15000);
		expect(stats.retention[0].recente).toEqual({ pass: 1, fail: 0 });
		expect(stats.retention[0].madura).toEqual({ pass: 0, fail: 1 });
		expect(stats.retention[1].madura).toEqual({ pass: 1, fail: 0 });
		expect(stats.counts).toMatchObject({ novos: 1, recentes: 1, conhecidos: 1 });
		expect(stats.forecast[2]).toBe(1);
		expect(stats.firstDay).toBe(-10);
		expect(stats.added).toEqual([
			{ day: -10, n: 1 },
			{ day: 0, n: 1 }
		]);
		expect(stats.streak).toEqual({ current: 2, longest: 2 });
		expect(stats.difficulty).toEqual([50]);
		expect(stats.buttons.tudo.maduros).toEqual([1, 0, 0, 1]);
		expect(stats.hours['1m'][5]).toEqual({ hour: 5, total: 1, correct: 1 });
		expect(stats.hours['1m'][6]).toEqual({ hour: 6, total: 1, correct: 0 });
	});

	test('vencidos entram no dia 0 da previsão', () => {
		const stats = buildStats({
			now: NOW,
			clock: DEFAULT_CLOCK,
			addedAt: [],
			logs: [],
			cards: [card({ due_at: '2026-11-01T00:00:00Z' }), card({ due_at: '2029-01-01T00:00:00Z' })]
		});
		expect(stats.forecast[0]).toBe(1);
		expect(stats.overdue).toBe(1);
		expect(stats.beyond).toBe(1);
	});
});

test('reviewKind segue o revlog do Anki', () => {
	expect(reviewKind({ state_before: 0, last_interval_days: 0 })).toBe('aprender');
	expect(reviewKind({ state_before: 1, last_interval_days: 0 })).toBe('aprender');
	expect(reviewKind({ state_before: 3, last_interval_days: 30 })).toBe('reaprender');
	expect(reviewKind({ state_before: 2, last_interval_days: 20 })).toBe('recente');
	expect(reviewKind({ state_before: 2, last_interval_days: 21 })).toBe('madura');
});

test('histogram e bucketSize', () => {
	const h = histogram([0, 1, 2, 50, 200], 79, 40);
	expect(h.width).toBe(2);
	expect(h.bins[0].n).toBe(2);
	expect(h.bins[1].n).toBe(1);
	expect(h.over).toBe(1);
	expect(bucketSize(30)).toBe(1);
	expect(bucketSize(365)).toBe(7);
	expect(bucketSize(2000)).toBe(60);
});
