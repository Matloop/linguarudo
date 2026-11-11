import { describe, expect, test } from 'bun:test';
import {
	ankiDeckPath,
	budget,
	capRemaining,
	deckTree,
	isPausedIn,
	newAllowance,
	parseDeckName,
	parseLeechLapses,
	parseNewCap,
	summarizeDecks,
	type Deck,
	type DeckCounts
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
		newCap: null,
		onReader: true,
		position: 0,
		createdAt: '2026-11-01T00:00:00.000Z',
		...over
	};
}

const counts = (over: Partial<Omit<DeckCounts, 'newToday'>> = {}) => ({
	newAvailable: 0,
	learning: 0,
	review: 0,
	newDoneToday: 0,
	items: 0,
	fichas: 0,
	leeches: 0,
	...over
});

describe('orçamento de novas', () => {
	test('perDay + extraNew − newDoneToday, nunca negativo', () => {
		expect(newAllowance(10, 0, 6)).toBe(4);
		expect(newAllowance(10, 5, 6)).toBe(9);
		expect(newAllowance(10, 0, 14)).toBe(0);
		expect(budget(10, 5, 3)).toEqual({
			perDay: 10,
			extraNew: 5,
			newDoneToday: 3,
			newAllowance: 12
		});
	});

	test('teto do deck', () => {
		expect(capRemaining(null, 50)).toBe(Infinity);
		expect(capRemaining(5, 3)).toBe(2);
		expect(capRemaining(5, 9)).toBe(0);
	});
});

describe('validação', () => {
	test('nome: espaços colapsados, 1 a 80', () => {
		expect(parseDeckName('  Verbi   irregolari ')).toBe('Verbi irregolari');
		expect(parseDeckName('   ')).toBeNull();
		expect(parseDeckName('a'.repeat(81))).toBeNull();
		expect(parseDeckName(3)).toBeNull();
	});

	test('teto e limite de teimosa', () => {
		expect(parseNewCap('')).toBeNull();
		expect(parseNewCap('20')).toBe(20);
		expect(parseNewCap(-1)).toBeUndefined();
		expect(parseNewCap(1.5)).toBeUndefined();
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
		deck('a1', { parentId: 'a', newCap: 2 }),
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

	test('novas de hoje: teto do deck e orçamento; pai soma os filhos', () => {
		const raw = new Map([
			['a', counts({ newAvailable: 3, review: 4 })],
			['a1', counts({ newAvailable: 10, newDoneToday: 1, learning: 2 })],
			['a2', counts({ newAvailable: 1 })]
		]);
		const rows = summarizeDecks(decks, raw, 4);
		const a = rows.find((r) => r.id === 'a')!;
		const a1 = rows.find((r) => r.id === 'a1')!;
		expect(a1.counts.newToday).toBe(1);
		expect(a1.depth).toBe(1);
		expect(a.counts.newToday).toBe(3);
		expect(a.total).toMatchObject({ newAvailable: 14, newToday: 4, learning: 2, review: 4 });
		expect(rows.find((r) => r.id === 'b')!.counts).toMatchObject({ newToday: 0, items: 0 });
	});
});
