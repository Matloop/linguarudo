import { describe, expect, test } from 'bun:test';
import { budget, summarizeDecks, type Deck, type RawDeckCounts } from './decks.ts';
import {
	deckDisplayName,
	deckSubtitle,
	entryFlags,
	entryNext,
	inTab,
	forToday,
	hubSubtitle,
	plural,
	quotaDoneText,
	rowCounts,
	selectionKey,
	selectionLabel,
	selectRange,
	todayBreakdown,
	todayTotals,
	tomorrowText
} from './decks-ui.ts';

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

const raw = (over: Partial<RawDeckCounts> = {}): RawDeckCounts => ({
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

const day = (perDay: number, newDoneToday: number, reviewsPerDay = 200, reviewDoneToday = 0) =>
	budget({ perDay, extraNew: 0, newDoneToday, reviewsPerDay, reviewDoneToday });

describe('textos', () => {
	test('plural e nome de subdeck do Anki', () => {
		expect(plural(1, 'baralho', 'baralhos')).toBe('1 baralho');
		expect(plural(0, 'baralho', 'baralhos')).toBe('0 baralhos');
		expect(deckDisplayName('B::C')).toBe('B › C');
		expect(deckDisplayName('B :: C::D')).toBe('B › C › D');
		expect(deckDisplayName('Séries')).toBe('Séries');
	});

	test('cabeçalho do hub', () => {
		const decks = [deck('a'), deck('b'), deck('c'), deck('a1', { parentId: 'a' })];
		expect(hubSubtitle(decks, 63)).toBe('3 baralhos · 1 sub-baralho · 63 cartas');
		expect(hubSubtitle([deck('a')], 1)).toBe('1 baralho · 1 carta');
	});

	test('detalhe de hoje sem partes zeradas', () => {
		expect(todayBreakdown(4, 10)).toBe('4 novas · 10 revisões');
		expect(todayBreakdown(1, 0)).toBe('1 nova');
		expect(todayBreakdown(0, 1)).toBe('1 revisão');
		expect(todayBreakdown(0, 0)).toBe('');
	});

	test('fim de cota e amanhã', () => {
		expect(quotaDoneText({ perDay: 10, extraNew: 0 })).toBe('As 10 novas de hoje acabaram');
		expect(quotaDoneText({ perDay: 10, extraNew: 5 })).toBe(
			'As 10 novas + 5 extras de hoje acabaram'
		);
		expect(tomorrowText(23)).toBe('Amanhã: cerca de 23 revisões.');
		expect(tomorrowText(1)).toBe('Amanhã: cerca de 1 revisão.');
		expect(tomorrowText(0)).toBe('Amanhã: nada vence ainda.');
	});

	test('subtítulo do deck e rótulo da seleção', () => {
		expect(
			deckSubtitle(48, {
				new: { value: 20, mode: 'geral' },
				reviews: { value: 200, mode: 'deck' }
			})
		).toBe('48 cartas · 20 novas/dia · 200 revisões/dia');
		expect(
			deckSubtitle(1, { new: { value: 1, mode: 'hoje' }, reviews: { value: 1, mode: 'geral' } })
		).toBe('1 carta · 1 nova/dia · 1 revisão/dia');
		expect(selectionLabel(1)).toBe('1 selecionado');
		expect(selectionLabel(3)).toBe('3 selecionados');
	});
});

describe('para hoje', () => {
	const decks = [
		deck('a', { position: 1 }),
		deck('a1', { parentId: 'a' }),
		deck('p', { position: 2, paused: true }),
		deck('p1', { parentId: 'p' })
	];
	const counts = new Map([
		['a', raw({ newAvailable: 3, reviewAvailable: 4 })],
		['a1', raw({ newAvailable: 10, learning: 2 })],
		['p', raw({ reviewAvailable: 7, newAvailable: 5 })],
		['p1', raw({ reviewAvailable: 1 })]
	]);

	test('soma os ativos e limita as novas ao orçamento', () => {
		const b = day(10, 4);
		const rows = summarizeDecks(decks, counts, b);
		const t = todayTotals(rows, b);
		// Novas: min(6, 3 + 6) = 6; revisões: 4 + 2 (pausado e filho de pausado ficam fora).
		expect(t).toEqual({ total: 12, fresh: 6, reviews: 6, waiting: 7, budgetSpent: false });
	});

	test('orçamento esgotado', () => {
		const b = day(10, 10);
		const t = todayTotals(summarizeDecks(decks, counts, b), b);
		expect(t.fresh).toBe(0);
		expect(t.budgetSpent).toBe(true);
		expect(t.total).toBe(6);
	});

	test('linha do pai mostra o que a sessão dele serve; subdeck, o próprio', () => {
		const b = day(10, 0);
		const rows = summarizeDecks(decks, counts, b);
		const a = rows.find((d) => d.id === 'a')!;
		const a1 = rows.find((d) => d.id === 'a1')!;
		expect(forToday(rowCounts(a))).toBe(10 + 2 + 4);
		expect(forToday(rowCounts(a1))).toBe(10 + 2);
	});

	test('revisões: limite do pai junta os filhos; o Geral corta o Estudar tudo', () => {
		const ds = [
			deck('a', { reviewsPerDay: 3 }),
			deck('a1', { parentId: 'a' }),
			deck('b', { position: 1 })
		];
		const c = new Map([
			['a', raw({ reviewAvailable: 2 })],
			['a1', raw({ reviewAvailable: 5, learning: 1 })],
			['b', raw({ reviewAvailable: 4 })]
		]);
		const rows = summarizeDecks(ds, c, day(10, 0));
		expect(rowCounts(rows.find((d) => d.id === 'a')!).review).toBe(3);
		// a: min(2 + 3, 3) = 3; b: 4; aprendendo (1) fica fora do limite.
		expect(todayTotals(rows, day(10, 0)).reviews).toBe(1 + 3 + 4);
		// Geral de 5 com 0 feitas: min(7, 5) + 1.
		const tight = day(10, 0, 5);
		expect(todayTotals(summarizeDecks(ds, c, tight), tight).reviews).toBe(1 + 5);
	});
});

describe('seleção', () => {
	const order = ['a', 'b', 'c', 'd', 'e'];

	test('Shift+clique marca o intervalo nos dois sentidos', () => {
		expect([...selectRange(order, new Set(['b']), 'b', 'd')].sort()).toEqual(['b', 'c', 'd']);
		expect([...selectRange(order, new Set(['d']), 'd', 'a')].sort()).toEqual(['a', 'b', 'c', 'd']);
	});

	test('alvo já marcado desmarca o intervalo', () => {
		const sel = new Set(['a', 'b', 'c', 'd']);
		expect([...selectRange(order, sel, 'a', 'c')]).toEqual(['d']);
	});

	test('sem âncora (ou âncora fora da lista), só o alvo', () => {
		expect([...selectRange(order, new Set(), null, 'c')]).toEqual(['c']);
		expect([...selectRange(order, new Set(), 'z', 'c')]).toEqual(['c']);
		expect([...selectRange(order, new Set(['a']), 'a', 'z')]).toEqual(['a']);
	});

	test('teclas', () => {
		const ctx = { typing: false, dialogOpen: false, any: true };
		expect(selectionKey({ key: 'x' }, ctx)).toBe('toggle');
		expect(selectionKey({ key: 'X' }, ctx)).toBe('toggle');
		expect(selectionKey({ key: 'Escape' }, ctx)).toBe('clear');
		expect(selectionKey({ key: 'Escape' }, { ...ctx, any: false })).toBeNull();
		expect(selectionKey({ key: 'a', ctrlKey: true }, ctx)).toBe('all');
		expect(selectionKey({ key: 'a', metaKey: true }, ctx)).toBe('all');
		expect(selectionKey({ key: 'x', ctrlKey: true }, ctx)).toBeNull();
		expect(selectionKey({ key: 'x' }, { ...ctx, typing: true })).toBeNull();
		expect(selectionKey({ key: 'a', ctrlKey: true }, { ...ctx, dialogOpen: true })).toBeNull();
	});
});

describe('entryFlags', () => {
	const ctx = {
		nextDayStart: new Date('2026-11-12T04:00:00Z'),
		plannedIds: new Set(['planned'])
	};
	const card = (id: string, state: number, dueAt = '2026-11-11T10:00:00Z') => ({
		id,
		state,
		dueAt
	});

	test('nova planejada entra hoje; nova fora do plano não', () => {
		const a = entryFlags({ status: 'ativo', leechHold: null, cards: [card('planned', 0)] }, ctx);
		expect(a).toEqual({ fresh: true, learning: false, leech: false, today: true });
		const b = entryFlags({ status: 'ativo', leechHold: null, cards: [card('x', 0)] }, ctx);
		expect(b.today).toBe(false);
		expect(inTab(b, 'novas')).toBe(true);
		expect(inTab(b, 'hoje')).toBe(false);
	});

	test('revisão vence até o fim do dia de estudo', () => {
		const due = entryFlags(
			{ status: 'ativo', leechHold: null, cards: [card('a', 2, '2026-11-12T03:59:00Z')] },
			ctx
		);
		expect(due.today).toBe(true);
		const later = entryFlags(
			{ status: 'ativo', leechHold: null, cards: [card('a', 2, '2026-11-12T04:00:00Z')] },
			ctx
		);
		expect(later.today).toBe(false);
	});

	test('teimosa e conhecida ficam fora da fila; teimosa só na aba Teimosas', () => {
		const leech = entryFlags({ status: 'ativo', leechHold: 'wait', cards: [card('a', 3)] }, ctx);
		expect(leech.today).toBe(false);
		expect(inTab(leech, 'teimosas')).toBe(true);
		expect(inTab(leech, 'aprendendo')).toBe(false);
		const known = entryFlags({ status: 'conhecido', leechHold: null, cards: [card('a', 2)] }, ctx);
		expect(known.today).toBe(false);
		expect(inTab(known, 'todas')).toBe(true);
	});
});

describe('entryNext', () => {
	const flags = (fresh: boolean, today: boolean) => ({
		fresh,
		today,
		learning: false,
		leech: false
	});
	const date = () => 'em 4 dias';
	test('nova planejada, nova em espera, estudada e conhecida', () => {
		expect(entryNext(flags(true, true), false, date)).toBe('nova hoje');
		expect(entryNext(flags(true, false), false, date)).toBe('nova');
		expect(entryNext(flags(false, false), false, date)).toBe('em 4 dias');
		expect(entryNext(flags(true, false), true, date)).toBe('Já sei');
	});
});
