import { describe, expect, test } from 'bun:test';
import {
	ankiDeckPath,
	budget,
	deckLimit,
	deckQuota,
	deckTree,
	isPausedIn,
	newAllowance,
	parseDeckName,
	parseLeechLapses,
	parseLimit,
	parseLimitMode,
	quotaLeft,
	studyDayKey,
	summarizeDecks,
	takeWithin,
	type Deck,
	type RawDeckCounts
} from './decks.ts';

function deck(id: string, over: Partial<Deck> = {}): Deck {
	return {
		id,
		language: 'it',
		name: id,
		parentId: null,
		isDefault: false,
		paused: false,
		newOrder: 'importance',
		newPerDay: null,
		reviewsPerDay: null,
		newPerDayToday: null,
		reviewsPerDayToday: null,
		onReader: true,
		position: 0,
		createdAt: '2026-11-01T00:00:00.000Z',
		...over
	};
}

const counts = (over: Partial<RawDeckCounts> = {}): RawDeckCounts => ({
	newAvailable: 0,
	learning: 0,
	reviewAvailable: 0,
	newDoneToday: 0,
	reviewDoneToday: 0,
	items: 0,
	fichas: 0,
	flashcards: 0,
	leeches: 0,
	...over
});

const general = { newPerDay: 20, reviewsPerDay: 200 };

describe('orçamento de novas', () => {
	test('perDay + extraNew − newDoneToday, nunca negativo', () => {
		expect(newAllowance(10, 0, 6)).toBe(4);
		expect(newAllowance(10, 5, 6)).toBe(9);
		expect(newAllowance(10, 0, 14)).toBe(0);
		expect(
			budget({ perDay: 10, extraNew: 5, newDoneToday: 3, reviewsPerDay: 50, reviewDoneToday: 60 })
		).toEqual({
			perDay: 10,
			extraNew: 5,
			newDoneToday: 3,
			newAllowance: 12,
			reviewsPerDay: 50,
			reviewDoneToday: 60,
			reviewAllowance: 0
		});
	});

	test('dia de estudo como data local', () => {
		expect(studyDayKey(new Date('2026-11-13T07:00:00.000Z'), 'America/Sao_Paulo')).toBe(
			'2026-11-13'
		);
		expect(studyDayKey(new Date('2026-11-13T02:00:00.000Z'), 'America/Sao_Paulo')).toBe(
			'2026-11-12'
		);
	});
});

describe('limites diários', () => {
	test('Só hoje > Este baralho > Geral, por tipo', () => {
		expect(deckLimit(deck('a'), 'new', general)).toEqual({ value: 20, mode: 'geral' });
		const own = deck('a', { newPerDay: 5, reviewsPerDay: 0 });
		expect(deckLimit(own, 'new', general)).toEqual({ value: 5, mode: 'deck' });
		expect(deckLimit(own, 'reviews', general)).toEqual({ value: 0, mode: 'deck' });
		const today = deck('a', { newPerDay: 5, newPerDayToday: 40 });
		expect(deckLimit(today, 'new', general)).toEqual({ value: 40, mode: 'hoje' });
		expect(deckLimit(today, 'reviews', general)).toEqual({ value: 200, mode: 'geral' });
	});

	const decks = [
		deck('p', { newPerDay: 5 }),
		deck('c', { parentId: 'p', newPerDay: 3 }),
		deck('o')
	];

	test('vagas: o feito no filho conta no pai; extra soma em todos', () => {
		const q = deckQuota(decks, 'new', general, { c: 2, o: 1 });
		expect(q.left.get('p')).toBe(3);
		expect(q.left.get('c')).toBe(1);
		expect(q.left.get('o')).toBe(19);
		expect(quotaLeft(q, 'c')).toBe(1);
		const extra = deckQuota(decks, 'new', general, { c: 2 }, { extra: 5 });
		expect(extra.left.get('p')).toBe(8);
		expect(extra.left.get('c')).toBe(6);
	});

	test('nunca negativo; o teto da sessão limita quotaLeft', () => {
		const q = deckQuota(decks, 'new', general, { c: 9 }, { max: 2 });
		expect(q.left.get('p')).toBe(0);
		expect(q.left.get('c')).toBe(0);
		expect(quotaLeft(q, 'o')).toBe(2);
	});

	test('takeWithin: corta pelo deck, pelo pai e pelo total, na ordem dada', () => {
		const list = ['c1', 'c2', 'p1', 'c3', 'p2', 'p3', 'p4', 'o1', 'o2'];
		const deckOf = (x: string) => x.replace(/\d+$/, '');
		const q = deckQuota(decks, 'new', general, {});
		// c: 3 próprias; p: 5 contando as do filho.
		expect(takeWithin(list, deckOf, q)).toEqual(['c1', 'c2', 'p1', 'c3', 'p2', 'o1', 'o2']);
		expect(takeWithin(list, deckOf, { ...q, max: 4 })).toEqual(['c1', 'c2', 'p1', 'c3']);
		const zero = deckQuota([deck('p', { reviewsPerDay: 0 })], 'reviews', general, {});
		expect(takeWithin(['p1'], deckOf, zero)).toEqual([]);
	});
});

describe('validação', () => {
	test('nome: espaços colapsados, 1 a 80', () => {
		expect(parseDeckName('  Verbi   irregolari ')).toBe('Verbi irregolari');
		expect(parseDeckName('   ')).toBeNull();
		expect(parseDeckName('a'.repeat(81))).toBeNull();
		expect(parseDeckName(3)).toBeNull();
	});

	test('limites diários e limite de teimosa', () => {
		expect(parseLimit('', 'new')).toBeNull();
		expect(parseLimit('20', 'new')).toBe(20);
		expect(parseLimit(-1, 'new')).toBeNull();
		expect(parseLimit(1.5, 'reviews')).toBeNull();
		expect(parseLimit(1001, 'new')).toBeNull();
		expect(parseLimit(9999, 'reviews')).toBe(9999);
		expect(parseLimitMode('hoje')).toBe('hoje');
		expect(parseLimitMode('sempre')).toBeNull();
		expect(parseLeechLapses('8')).toBe(8);
		expect(parseLeechLapses(0)).toBeNull();
		expect(parseLeechLapses(100)).toBeNull();
	});

	test('caminho do Anki: um nível, o resto achatado no filho', () => {
		expect(ankiDeckPath('')).toEqual([]);
		expect(ankiDeckPath('Italiano')).toEqual(['Italiano']);
		expect(ankiDeckPath('Italiano::Vocab')).toEqual(['Italiano', 'Vocab']);
		expect(ankiDeckPath('A:: B ::C')).toEqual(['A', 'B::C']);
		expect(ankiDeckPath('::A::')).toEqual(['A']);
	});
});

describe('árvore e contagens', () => {
	const decks = [
		deck('b', { position: 1 }),
		deck('a', { isDefault: true }),
		deck('a2', { parentId: 'a', createdAt: '2026-11-03T00:00:00.000Z' }),
		deck('a1', { parentId: 'a', newPerDay: 2 }),
		deck('p', { paused: true, position: 2 }),
		deck('p1', { parentId: 'p' })
	];

	test('pais na ordem, cada um seguido dos filhos', () => {
		expect(deckTree(decks).map((d) => d.id)).toEqual(['a', 'a1', 'a2', 'b', 'p', 'p1']);
	});

	test('filho de pausado conta como pausado', () => {
		expect(isPausedIn(decks[5], decks)).toBe(true);
		expect(isPausedIn(decks[2], decks)).toBe(false);
	});

	test('hoje: limites do deck e do pai; o pai soma os filhos dentro do próprio limite', () => {
		const raw = new Map([
			['a', counts({ newAvailable: 3, reviewAvailable: 4, flashcards: 30 })],
			['a1', counts({ newAvailable: 10, newDoneToday: 1, learning: 2, flashcards: 12 })],
			['a2', counts({ newAvailable: 1, reviewAvailable: 3, flashcards: 4 })]
		]);
		const rows = summarizeDecks(decks, raw, { perDay: 4, reviewsPerDay: 5, extraNew: 0 });
		const a = rows.find((r) => r.id === 'a')!;
		const a1 = rows.find((r) => r.id === 'a1')!;
		// a1: limite próprio 2, 1 feita → 1.
		expect(a1.counts.newToday).toBe(1);
		expect(a1.limits.new).toEqual({ value: 2, mode: 'deck' });
		expect(a1.depth).toBe(1);
		// a: Geral 4, 1 feita no filho → 3 vagas.
		expect(a.counts.newToday).toBe(3);
		expect(a.limits).toMatchObject({ newLeft: 3, reviewsLeft: 5 });
		expect(a.limits.new).toEqual({ value: 4, mode: 'geral' });
		expect(a.total).toMatchObject({
			newAvailable: 14,
			newToday: 3,
			learning: 2,
			reviewAvailable: 7,
			review: 5,
			flashcards: 46
		});
		expect(rows.find((r) => r.id === 'b')!.counts).toMatchObject({ newToday: 0, items: 0 });
	});

	test('Só hoje vale para o deck; "+N hoje" soma no limite', () => {
		const raw = new Map([['b', counts({ newAvailable: 50 })]]);
		const withToday = decks.map((d) => (d.id === 'b' ? { ...d, newPerDayToday: 30 } : d));
		const rows = summarizeDecks(withToday, raw, { perDay: 4, reviewsPerDay: 5, extraNew: 5 });
		const b = rows.find((r) => r.id === 'b')!;
		expect(b.limits.new).toEqual({ value: 30, mode: 'hoje' });
		expect(b.counts.newToday).toBe(35);
	});
});
