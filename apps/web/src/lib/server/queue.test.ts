import { describe, expect, test } from 'bun:test';
import type { Deck } from '#lib/decks.ts';
import {
	importance,
	orderNew,
	parseQueueState,
	planNew,
	readerDecks,
	readerRanks,
	scopeDeckIds,
	stableHash,
	stateAllowance,
	type QueueCandidate,
	type QueueState
} from './queue.ts';

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

let n = 0;
function card(id: string, deckId: string, over: Partial<QueueCandidate> = {}): QueueCandidate {
	n++;
	return {
		id,
		itemId: `item-${id}`,
		fichaId: null,
		kind: 'reconhecer',
		ord: 0,
		deckId,
		createdAt: new Date(Date.UTC(2026, 10, 1, 0, n)).toISOString(),
		encounters: 1,
		works: 0,
		lastWorkId: null,
		buried: false,
		...over
	};
}

function state(over: Partial<QueueState> = {}): QueueState {
	return {
		settings: { perDay: 10, newOrder: 'importance', leechLapses: 8, leechAction: 'wait' },
		dayKey: '2026-11-11',
		extraNew: 0,
		newDoneByDeck: {},
		activeWorkId: null,
		decks: [deck('padrao', { isDefault: true })],
		candidates: [],
		...over
	};
}

const ids = (l: { id: string }[]) => l.map((c) => c.id);

describe('orçamento', () => {
	test('perDay + extraNew − novas feitas hoje (em todos os decks)', () => {
		const s = state({ extraNew: 5, newDoneByDeck: { padrao: 4, outro: 3 } });
		expect(stateAllowance(s)).toBe(8);
		expect(stateAllowance({ ...s, newDoneByDeck: { padrao: 30 } })).toBe(0);
	});

	test('a sessão para no orçamento e conta o que sobra', () => {
		const candidates = Array.from({ length: 15 }, (_, i) => card(`c${i}`, 'padrao'));
		const plan = planNew(state({ candidates, newDoneByDeck: { padrao: 6 } }), { kind: 'all' });
		expect(plan.ids).toHaveLength(4);
		expect(plan.newAllowance).toBe(4);
		expect(plan.newDoneToday).toBe(6);
		expect(plan.more).toBe(11);
	});
});

describe('ordem das novas', () => {
	test('importância: encontros + 2 × obras + bônus da obra ativa; empate por criação', () => {
		const a = card('a', 'padrao', { encounters: 1 });
		const b = card('b', 'padrao', { encounters: 2, works: 1 });
		const c = card('c', 'padrao', { encounters: 1, lastWorkId: 'w1', works: 1 });
		const d = card('d', 'padrao', { encounters: 1 });
		expect(importance(b, null)).toBe(4);
		expect(importance(c, 'w1')).toBe(6);
		const s = state({ activeWorkId: 'w1', candidates: [a, b, c, d] });
		expect(ids(orderNew(s, new Set(['padrao'])))).toEqual(['c', 'b', 'a', 'd']);
	});

	test('deck com ordem do deck segue a criação', () => {
		const s = state({
			decks: [deck('anki', { newOrder: 'deck' })],
			candidates: [
				card('x', 'anki', { encounters: 9 }),
				card('y', 'anki'),
				card('z', 'anki', { encounters: 3 })
			]
		});
		expect(ids(orderNew(s, new Set(['anki'])))).toEqual(['x', 'y', 'z']);
	});

	test('random é estável no dia e muda no outro', () => {
		const candidates = Array.from({ length: 20 }, (_, i) => card(`r${i}`, 'mix'));
		const s = state({ decks: [deck('mix', { newOrder: 'random' })], candidates });
		const today = ids(orderNew(s, new Set(['mix'])));
		expect(ids(orderNew(s, new Set(['mix'])))).toEqual(today);
		expect(ids(orderNew({ ...s, dayKey: '2026-11-12' }, new Set(['mix'])))).not.toEqual(today);
		expect(stableHash('abc')).toBe(stableHash('abc'));
	});

	test('teto do deck desconta as novas que o deck já começou hoje', () => {
		const s = state({
			decks: [deck('a', { newCap: 3 }), deck('b')],
			newDoneByDeck: { a: 2 },
			candidates: [card('a1', 'a'), card('a2', 'a'), card('b1', 'b'), card('b2', 'b')]
		});
		expect(ids(orderNew(s, new Set(['a', 'b']))).filter((id) => id.startsWith('a'))).toEqual([
			'a1'
		]);
	});

	test('intercala decks pela cabeça mais importante', () => {
		const s = state({
			decks: [deck('a', { newOrder: 'deck' }), deck('b', { position: 1 })],
			candidates: [
				card('a1', 'a', { encounters: 1 }),
				card('a2', 'a', { encounters: 5 }),
				card('b1', 'b', { encounters: 3 })
			]
		});
		expect(ids(orderNew(s, new Set(['a', 'b'])))).toEqual(['b1', 'a1', 'a2']);
	});

	test('conta em ordem de deck: um deck inteiro depois do outro, filho logo após o pai', () => {
		const s = state({
			settings: { perDay: 10, newOrder: 'deck', leechLapses: 8, leechAction: 'wait' },
			decks: [deck('b', { position: 1 }), deck('a'), deck('a-filho', { parentId: 'a' })],
			candidates: [card('b1', 'b', { encounters: 9 }), card('f1', 'a-filho'), card('a1', 'a')]
		});
		expect(ids(orderNew(s, new Set(['a', 'b', 'a-filho'])))).toEqual(['a1', 'f1', 'b1']);
	});

	test('irmão revisado hoje e segundo flashcard novo do mesmo item ficam de fora', () => {
		const s = state({
			candidates: [
				card('rec', 'padrao', { itemId: 'i1' }),
				card('prod', 'padrao', { itemId: 'i1', kind: 'produzir' }),
				card('enterrado', 'padrao', { buried: true })
			]
		});
		expect(ids(orderNew(s, new Set(['padrao'])))).toEqual(['rec']);
	});
});

describe('escopos', () => {
	const decks = [
		deck('padrao', { isDefault: true }),
		deck('pai'),
		deck('filho', { parentId: 'pai' }),
		deck('pausado', { paused: true }),
		deck('sob-pausado', { parentId: 'pausado' })
	];

	test('Estudar tudo deixa de fora pausados e filhos de pausados', () => {
		expect([...scopeDeckIds(decks, { kind: 'all' })].sort()).toEqual(['filho', 'padrao', 'pai']);
	});

	test('um deck inclui os subdecks', () => {
		expect([...scopeDeckIds(decks, { kind: 'deck', deckId: 'pai' })].sort()).toEqual([
			'filho',
			'pai'
		]);
		const s = state({
			decks,
			candidates: [card('p', 'padrao'), card('pa', 'pai'), card('fi', 'filho')]
		});
		expect(ids(planNew(s, { kind: 'deck', deckId: 'pai' }).ids.map((id) => ({ id })))).toEqual([
			'pa',
			'fi'
		]);
	});

	test('Desta obra: só itens da obra, fora do orçamento', () => {
		const s = state({
			decks,
			newDoneByDeck: { padrao: 50 },
			candidates: [
				card('x', 'padrao', { itemId: 'ix' }),
				card('y', 'pausado', { itemId: 'iy' }),
				card('z', 'padrao')
			]
		});
		const plan = planNew(s, { kind: 'obra', workId: 'w', itemIds: new Set(['ix', 'iy']) });
		expect(plan.newAllowance).toBe(0);
		expect(plan.ids.sort()).toEqual(['x', 'y']);
	});
});

describe('leitor', () => {
	test('ranks só nos decks do leitor, com lacuna mais baixa da ficha e sem Produzir', () => {
		const s = state({
			decks: [deck('padrao', { isDefault: true }), deck('fora', { onReader: false, position: 1 })],
			candidates: [
				card('r1', 'padrao', { encounters: 5 }),
				card('l2', 'padrao', { itemId: null, fichaId: 'f', kind: 'lacuna', ord: 2, encounters: 0 }),
				card('l1', 'padrao', { itemId: null, fichaId: 'f', kind: 'lacuna', ord: 1, encounters: 0 }),
				card('inv', 'padrao', { itemId: null, fichaId: 'g', kind: 'inverso', encounters: 0 }),
				card('out', 'fora', { encounters: 9 })
			]
		});
		const ranks = readerRanks(s);
		expect(ranks.get('r1')).toBe(1);
		expect(ranks.get('l1')).toBe(2);
		expect(ranks.has('l2')).toBe(false);
		expect(ranks.has('inv')).toBe(false);
		expect(ranks.has('out')).toBe(false);
		expect(readerDecks(s).map((d) => d.id)).toEqual(['padrao']);
	});

	test('parseQueueState aceita o jsonb do banco', () => {
		const s = parseQueueState(
			{
				settings: { perDay: 7, newOrder: 'random', leechLapses: 6, leechAction: 'suspend' },
				dayKey: '2026-11-11',
				extraNew: 5,
				newDoneByDeck: { d1: 2 },
				activeWorkId: null,
				decks: [
					{
						id: 'd1',
						name: 'Minhas palavras',
						parentId: null,
						default: true,
						paused: false,
						newOrder: 'importance',
						newCap: null,
						onReader: true,
						position: 0,
						createdAt: '2026-11-01T00:00:00Z'
					}
				],
				candidates: [
					{
						id: 'c',
						itemId: 'i',
						fichaId: null,
						kind: 'reconhecer',
						ord: 0,
						deckId: 'd1',
						createdAt: '2026-11-01T00:00:00Z',
						encounters: 2,
						works: 1,
						lastWorkId: 'w',
						buried: false
					}
				]
			},
			'it'
		);
		expect(s.settings).toEqual({
			perDay: 7,
			newOrder: 'random',
			leechLapses: 6,
			leechAction: 'suspend'
		});
		expect(stateAllowance(s)).toBe(10);
		expect(s.decks[0].isDefault).toBe(true);
		expect(s.candidates[0].works).toBe(1);
	});
});
