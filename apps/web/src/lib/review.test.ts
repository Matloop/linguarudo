import { describe, expect, test } from 'bun:test';
import {
	REVIEW_TIME_ZONE,
	answerItem,
	buildQueue,
	dayStart,
	formatInterval,
	formatWhen,
	highlightParts,
	isMastered,
	MASTERED_STABILITY_DAYS,
	nextAvailableAt,
	nextDayStart,
	reviewCount,
	sessionProgress,
	startSession,
	undoLast,
	type QueueCard,
	type ReviewItem
} from './review';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function card(id: string, over: Partial<QueueCard> = {}): QueueCard {
	return {
		id,
		state: 2,
		dueAt: '2026-11-10T12:00:00.000Z',
		createdAt: '2026-11-01T12:00:00.000Z',
		...over
	};
}

function item(id: string, over: Partial<ReviewItem> = {}): ReviewItem {
	return {
		cardId: id,
		kind: 'reconhecer',
		reps: 0,
		state: 0,
		dueAt: '2026-11-10T12:00:00.000Z',
		lemma: id,
		sense: '',
		language: 'en',
		sentence: '',
		highlight: '',
		origin: null,
		sourceDetail: '',
		intervals: { 1: '1 min', 2: '14 h', 3: '5 d', 4: '54 d' },
		...over
	};
}

describe('buildQueue', () => {
	const now = new Date('2026-11-10T15:00:00.000Z');

	test('vencidos primeiro (mais atrasado antes), depois novos por ordem de criação', () => {
		const q = buildQueue(
			[
				card('novo-b', { state: 0, createdAt: '2026-11-05T00:00:00.000Z' }),
				card('venc-2', { dueAt: '2026-11-10T14:00:00.000Z' }),
				card('novo-a', { state: 0, createdAt: '2026-11-02T00:00:00.000Z' }),
				card('venc-1', { dueAt: '2026-11-09T10:00:00.000Z', state: 3 })
			],
			{ now, newLimit: 10, newDoneToday: 0 }
		);
		expect(q.map((c) => c.id)).toEqual(['venc-1', 'venc-2', 'novo-a', 'novo-b']);
	});

	test('ignora cartões que ainda não venceram', () => {
		const q = buildQueue([card('futuro', { dueAt: '2026-11-11T00:00:00.000Z' }), card('ok')], {
			now,
			newLimit: 10,
			newDoneToday: 0
		});
		expect(q.map((c) => c.id)).toEqual(['ok']);
	});

	test('novos respeitam o limite do dia, descontando os já vistos hoje', () => {
		const novos = Array.from({ length: 15 }, (_, i) =>
			card(`n${String(i).padStart(2, '0')}`, {
				state: 0,
				createdAt: new Date(Date.UTC(2026, 10, 1, i)).toISOString()
			})
		);
		expect(buildQueue(novos, { now, newLimit: 10, newDoneToday: 0 })).toHaveLength(10);
		expect(buildQueue(novos, { now, newLimit: 10, newDoneToday: 7 }).map((c) => c.id)).toEqual([
			'n00',
			'n01',
			'n02'
		]);
		expect(buildQueue(novos, { now, newLimit: 10, newDoneToday: 12 })).toHaveLength(0);
	});

	test('revisões vencidas não têm limite', () => {
		const vencidos = Array.from({ length: 300 }, (_, i) => card(`v${i}`));
		expect(buildQueue(vencidos, { now, newLimit: 0, newDoneToday: 0 })).toHaveLength(300);
	});
});

describe('reviewCount', () => {
	test('soma vencidos e novos que ainda cabem no limite', () => {
		expect(reviewCount({ dueNow: 4, newAvailable: 30, newDoneToday: 3, newLimit: 10 })).toBe(11);
		expect(reviewCount({ dueNow: 0, newAvailable: 2, newDoneToday: 0, newLimit: 10 })).toBe(2);
		expect(reviewCount({ dueNow: 1, newAvailable: 5, newDoneToday: 12, newLimit: 10 })).toBe(1);
	});
});

describe('formatInterval', () => {
	test('minutos, horas e dias curtos', () => {
		expect(formatInterval(10 * 1000)).toBe('1 min');
		expect(formatInterval(MIN)).toBe('1 min');
		expect(formatInterval(10 * MIN)).toBe('10 min');
		expect(formatInterval(59 * MIN)).toBe('59 min');
		expect(formatInterval(HOUR)).toBe('1 h');
		expect(formatInterval(14.3 * HOUR)).toBe('14 h');
		expect(formatInterval(DAY)).toBe('1 d');
		expect(formatInterval(3.4 * DAY)).toBe('3 d');
		expect(formatInterval(8 * DAY)).toBe('8 d');
	});

	test('meses e anos por extenso, com vírgula decimal', () => {
		expect(formatInterval(40 * DAY)).toBe('1 mês');
		expect(formatInterval(60 * DAY)).toBe('2 meses');
		expect(formatInterval(365 * DAY)).toBe('1 ano');
		expect(formatInterval(1.5 * 365 * DAY)).toBe('1,5 ano');
		expect(formatInterval(3 * 365 * DAY)).toBe('3 anos');
	});

	test('nunca mostra zero nem negativo', () => {
		expect(formatInterval(0)).toBe('1 min');
		expect(formatInterval(-5 * MIN)).toBe('1 min');
	});
});

describe('limites do dia no fuso', () => {
	test('o fuso fica num ponto só', () => {
		expect(REVIEW_TIME_ZONE).toBe('America/Sao_Paulo');
	});

	test('meia-noite de São Paulo (UTC−3)', () => {
		// 01:30 UTC do dia 11 ainda é dia 10 em São Paulo (22:30).
		expect(dayStart(new Date('2026-11-11T01:30:00.000Z')).toISOString()).toBe(
			'2026-11-10T03:00:00.000Z'
		);
		expect(dayStart(new Date('2026-11-11T03:00:00.000Z')).toISOString()).toBe(
			'2026-11-11T03:00:00.000Z'
		);
		expect(nextDayStart(new Date('2026-11-10T15:00:00.000Z')).toISOString()).toBe(
			'2026-11-11T03:00:00.000Z'
		);
	});

	test('funciona com fuso que tem horário de verão', () => {
		// Nova York: 9 de março de 2026 já é EDT (UTC−4).
		expect(dayStart(new Date('2026-03-09T12:00:00.000Z'), 'America/New_York').toISOString()).toBe(
			'2026-03-09T04:00:00.000Z'
		);
		// Dia da troca (8/3): meia-noite ainda é EST (UTC−5).
		expect(dayStart(new Date('2026-03-08T20:00:00.000Z'), 'America/New_York').toISOString()).toBe(
			'2026-03-08T05:00:00.000Z'
		);
	});
});

describe('formatWhen', () => {
	const now = new Date('2026-11-10T15:00:00.000Z'); // 12:00 em São Paulo

	test('hoje, amanhã ou a data, no horário de São Paulo', () => {
		expect(formatWhen(new Date('2026-11-10T21:00:00.000Z'), now)).toBe('hoje às 18:00');
		expect(formatWhen(new Date('2026-11-11T02:59:00.000Z'), now)).toBe('hoje às 23:59');
		expect(formatWhen(new Date('2026-11-11T03:00:00.000Z'), now)).toBe('amanhã às 00:00');
		expect(formatWhen(new Date('2026-11-14T12:30:00.000Z'), now)).toBe('14/11 às 09:30');
	});

	test('o que já passou vira "agora"', () => {
		expect(formatWhen(new Date('2026-11-10T14:00:00.000Z'), now)).toBe('agora');
	});
});

describe('nextAvailableAt', () => {
	const now = new Date('2026-11-10T15:00:00.000Z');

	test('próxima revisão agendada', () => {
		expect(
			nextAvailableAt({
				now,
				nextDueAt: '2026-11-10T18:00:00.000Z',
				newAvailable: 0,
				newDoneToday: 0,
				newLimit: 10
			})?.toISOString()
		).toBe('2026-11-10T18:00:00.000Z');
	});

	test('novos esperando o limite liberam amanhã, se isso vier antes', () => {
		expect(
			nextAvailableAt({
				now,
				nextDueAt: '2026-11-14T18:00:00.000Z',
				newAvailable: 5,
				newDoneToday: 10,
				newLimit: 10
			})?.toISOString()
		).toBe('2026-11-11T03:00:00.000Z');
	});

	test('sem nada agendado volta null', () => {
		expect(
			nextAvailableAt({ now, nextDueAt: null, newAvailable: 0, newDoneToday: 0, newLimit: 10 })
		).toBeNull();
	});
});

describe('highlightParts', () => {
	test('destaca a palavra ignorando maiúsculas', () => {
		expect(highlightParts("Don't Give up on me.", 'give up')).toEqual([
			{ text: "Don't ", hit: false },
			{ text: 'Give up', hit: true },
			{ text: ' on me.', hit: false }
		]);
	});

	test('destaca todas as ocorrências', () => {
		expect(highlightParts('allora, allora', 'allora').filter((p) => p.hit)).toHaveLength(2);
	});

	test('sem a palavra, volta o texto inteiro', () => {
		expect(highlightParts('nada aqui', 'xyz')).toEqual([{ text: 'nada aqui', hit: false }]);
	});
});

describe('sessão', () => {
	const now = new Date('2026-11-10T15:00:00.000Z');

	test('responder avança e conta acertos (De novo é erro)', () => {
		let s = startSession([item('a'), item('b')]);
		s = answerItem(s, {
			rating: 3,
			logId: 'l1',
			updated: item('a', { dueAt: '2026-11-15T00:00:00.000Z' }),
			now
		});
		expect(s.queue.map((i) => i.cardId)).toEqual(['b']);
		expect(s.answered).toBe(1);
		expect(s.correct).toBe(1);
		expect(sessionProgress(s)).toBe(50);
	});

	test('De novo com vencimento próximo volta para o fim da fila', () => {
		let s = startSession([item('a'), item('b')]);
		s = answerItem(s, {
			rating: 1,
			logId: 'l1',
			updated: item('a', { reps: 1, state: 1, dueAt: '2026-11-10T15:01:00.000Z' }),
			now
		});
		expect(s.queue.map((i) => i.cardId)).toEqual(['b', 'a']);
		expect(s.queue[1].reps).toBe(1);
		expect(s.correct).toBe(0);
		expect(sessionProgress(s)).toBe(33);
	});

	test('desfazer devolve o cartão ao topo com o estado anterior e acerta as contas', () => {
		const original = item('a');
		let s = startSession([original, item('b')]);
		s = answerItem(s, {
			rating: 1,
			logId: 'l1',
			updated: item('a', { reps: 1, dueAt: '2026-11-10T15:01:00.000Z' }),
			now
		});
		expect(s.last?.logId).toBe('l1');

		s = undoLast(s, original);
		expect(s.queue.map((i) => i.cardId)).toEqual(['a', 'b']);
		expect(s.queue[0].reps).toBe(0);
		expect(s.answered).toBe(0);
		expect(s.correct).toBe(0);
		expect(s.last).toBeNull();
	});

	test('desfazer um acerto também desconta o acerto', () => {
		let s = startSession([item('a')]);
		s = answerItem(s, {
			rating: 4,
			logId: 'l1',
			updated: item('a', { dueAt: '2027-01-01T00:00:00.000Z' }),
			now
		});
		expect(s.queue).toHaveLength(0);
		expect(sessionProgress(s)).toBe(100);
		s = undoLast(s, item('a'));
		expect(s.correct).toBe(0);
		expect(s.queue).toHaveLength(1);
	});

	test('sem nota anterior, desfazer não muda nada', () => {
		const s = startSession([item('a')]);
		expect(undoLast(s, item('a'))).toBe(s);
	});
});

describe('isMastered', () => {
	const review = (stability: number) => ({ state: 2, stability });

	test('todos os cartões em revisão com estabilidade alta', () => {
		expect(isMastered([review(MASTERED_STABILITY_DAYS)])).toBe(true);
		expect(isMastered([review(120), review(95)])).toBe(true);
	});

	test('basta um cartão abaixo do limite para não ser dominado', () => {
		expect(isMastered([review(120), review(MASTERED_STABILITY_DAYS - 1)])).toBe(false);
	});

	test('reaprendendo não é dominado, mesmo com estabilidade alta', () => {
		expect(isMastered([{ state: 3, stability: 200 }])).toBe(false);
	});

	test('sem cartões não é dominado', () => {
		expect(isMastered([])).toBe(false);
	});

	test('o limite fica bem acima do "maduro" do Anki (21 dias)', () => {
		expect(MASTERED_STABILITY_DAYS).toBeGreaterThanOrEqual(60);
	});
});
