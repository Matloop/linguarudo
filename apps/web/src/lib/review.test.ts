import { describe, expect, test } from 'bun:test';
import {
	REVIEW_TIME_ZONE,
	answerItem,
	clockFrom,
	DEFAULT_CLOCK,
	isLeech,
	leechAlert,
	buildQueue,
	dayStart,
	estimateMinutes,
	formatAgo,
	formatInterval,
	formatNextReview,
	formatToday,
	formatWhen,
	GRADE_LABELS,
	highlightParts,
	isDueToday,
	isMastered,
	itemStrength,
	MASTERED_STABILITY_DAYS,
	nextAvailableAt,
	nextDayStart,
	reviewCount,
	sessionProgress,
	startSession,
	STRENGTH_LABELS,
	undoLast,
	reviewMedia,
	reviewMediaPaths,
	withMediaUrls,
	type FichaReview,
	type QueueFlashcard,
	type ItemReview,
	type ReviewItem
} from './review';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function card(id: string, over: Partial<QueueFlashcard> = {}): QueueFlashcard {
	return {
		id,
		itemId: `item-${id}`,
		state: 2,
		dueAt: '2026-11-10T12:00:00.000Z',
		createdAt: '2026-11-01T12:00:00.000Z',
		...over
	};
}

function item(id: string, over: Partial<ItemReview> = {}): ReviewItem {
	return {
		flashcardId: id,
		source: 'item',
		itemId: `item-${id}`,
		kind: 'reconhecer',
		reps: 0,
		state: 0,
		dueAt: '2026-11-10T12:00:00.000Z',
		lemma: id,
		sense: '',
		ipa: '',
		reading: '',
		language: 'en',
		sentence: '',
		highlight: '',
		origin: null,
		sourceDetail: '',
		tags: [],
		intervals: { 1: '1 min', 2: '14 h', 3: '5 d', 4: '54 d' },
		image: null,
		audio: null,
		...over
	};
}

function ficha(id: string, over: Partial<FichaReview> = {}): FichaReview {
	return {
		flashcardId: id,
		source: 'ficha',
		kind: 'frente',
		ord: 0,
		fichaId: 'f-' + id,
		reps: 0,
		state: 0,
		dueAt: '2026-11-10T12:00:00.000Z',
		front: 'frente',
		back: 'verso',
		language: 'en',
		tags: [],
		intervals: { 1: '1 min', 2: '14 h', 3: '5 d', 4: '54 d' },
		frontImage: 'u/fi.webp',
		frontAudio: 'u/fa.mp3',
		backImage: 'u/bi.webp',
		backAudio: null,
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

	test('ignora flashcards que ainda não venceram', () => {
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

describe('irmãos ocultos', () => {
	const now = new Date('2026-11-10T15:00:00.000Z');
	const opts = { now, newLimit: 10, newDoneToday: 0 };

	test('só um cartão em revisão por item entra no dia', () => {
		const q = buildQueue(
			[
				card('rec', { itemId: 'a', dueAt: '2026-11-09T10:00:00.000Z' }),
				card('prod', { itemId: 'a', dueAt: '2026-11-10T10:00:00.000Z' }),
				card('outro', { itemId: 'b' })
			],
			opts
		);
		expect(q.map((c) => c.id)).toEqual(['rec', 'outro']);
	});

	test('irmão revisado hoje oculta o cartão em revisão e o novo', () => {
		const q = buildQueue(
			[
				card('prod', { itemId: 'a' }),
				card('novo', { itemId: 'b', state: 0 }),
				card('livre', { itemId: 'c' })
			],
			{
				...opts,
				reviewedToday: [
					{ id: 'rec', itemId: 'a' },
					{ id: 'rec-b', itemId: 'b' }
				]
			}
		);
		expect(q.map((c) => c.id)).toEqual(['livre']);
	});

	test('o próprio cartão revisado hoje não se oculta, e aprendendo não espera o irmão', () => {
		const q = buildQueue(
			[
				card('rec', { itemId: 'a', state: 3 }),
				card('prod', { itemId: 'a', state: 1, dueAt: '2026-11-10T14:00:00.000Z' }),
				card('sozinho', { itemId: 'b' })
			],
			{
				...opts,
				reviewedToday: [
					{ id: 'rec', itemId: 'a' },
					{ id: 'sozinho', itemId: 'b' }
				]
			}
		);
		expect(q.map((c) => c.id)).toEqual(['rec', 'sozinho', 'prod']);
	});
});

describe('sanguessuga', () => {
	test('teimosa a partir de 8 lapsos em algum cartão', () => {
		expect(isLeech([{ lapses: 7 }, { lapses: 2 }])).toBe(false);
		expect(isLeech([{ lapses: 0 }, { lapses: 8 }])).toBe(true);
	});

	test('avisa no 8º lapso e depois a cada 4', () => {
		expect([7, 8, 9, 11, 12, 16].map(leechAlert)).toEqual([false, true, false, false, true, true]);
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
	const midnight = { timeZone: REVIEW_TIME_ZONE, startHour: 0 };

	test('padrão: São Paulo, virada às 4 h como no Anki', () => {
		expect(DEFAULT_CLOCK).toEqual({ timeZone: 'America/Sao_Paulo', startHour: 4 });
	});

	test('o dia vira às 4 h de São Paulo (07:00 UTC)', () => {
		// 06:30 UTC = 03:30 em São Paulo: ainda é o dia 10.
		expect(dayStart(new Date('2026-11-11T06:30:00.000Z')).toISOString()).toBe(
			'2026-11-10T07:00:00.000Z'
		);
		expect(dayStart(new Date('2026-11-11T07:00:00.000Z')).toISOString()).toBe(
			'2026-11-11T07:00:00.000Z'
		);
		expect(nextDayStart(new Date('2026-11-10T15:00:00.000Z')).toISOString()).toBe(
			'2026-11-11T07:00:00.000Z'
		);
	});

	test('virada à meia-noite (UTC−3)', () => {
		// 01:30 UTC do dia 11 ainda é dia 10 em São Paulo (22:30).
		expect(dayStart(new Date('2026-11-11T01:30:00.000Z'), midnight).toISOString()).toBe(
			'2026-11-10T03:00:00.000Z'
		);
		expect(nextDayStart(new Date('2026-11-10T15:00:00.000Z'), midnight).toISOString()).toBe(
			'2026-11-11T03:00:00.000Z'
		);
	});

	test('funciona com fuso que tem horário de verão', () => {
		const ny = { timeZone: 'America/New_York', startHour: 0 };
		// Nova York: 9 de março de 2026 já é EDT (UTC−4).
		expect(dayStart(new Date('2026-03-09T12:00:00.000Z'), ny).toISOString()).toBe(
			'2026-03-09T04:00:00.000Z'
		);
		// Dia da troca (8/3): meia-noite ainda é EST (UTC−5); às 4 h já é EDT.
		expect(dayStart(new Date('2026-03-08T20:00:00.000Z'), ny).toISOString()).toBe(
			'2026-03-08T05:00:00.000Z'
		);
		expect(
			dayStart(new Date('2026-03-08T20:00:00.000Z'), { ...ny, startHour: 4 }).toISOString()
		).toBe('2026-03-08T08:00:00.000Z');
	});

	test('clockFrom cai no padrão com fuso ou hora inválidos', () => {
		expect(clockFrom(null, null)).toEqual(DEFAULT_CLOCK);
		expect(clockFrom('Foo/Bar', 30)).toEqual(DEFAULT_CLOCK);
		expect(clockFrom('Europe/Rome', 0)).toEqual({ timeZone: 'Europe/Rome', startHour: 0 });
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
		).toBe('2026-11-11T07:00:00.000Z');
	});

	test('sem nada agendado volta null', () => {
		expect(
			nextAvailableAt({ now, nextDueAt: null, newAvailable: 0, newDoneToday: 0, newLimit: 10 })
		).toBeNull();
	});
});

describe('highlightParts', () => {
	test('destaca a palavra ignorando maiúsculas', () => {
		expect(highlightParts("Don't Give up on me.", 'give up', 'en')).toEqual([
			{ text: "Don't ", hit: false },
			{ text: 'Give up', hit: true },
			{ text: ' on me.', hit: false }
		]);
	});

	test('destaca todas as ocorrências', () => {
		expect(highlightParts('allora, allora', 'allora', 'it').filter((p) => p.hit)).toHaveLength(2);
	});

	test('usa a regra de palavra do idioma (alemão com maiúscula, japonês sem espaços)', () => {
		expect(highlightParts('Das Haus ist alt.', 'haus', 'de').filter((p) => p.hit)).toEqual([
			{ text: 'Haus', hit: true }
		]);
		expect(highlightParts('猫が好き', '猫', 'ja').filter((p) => p.hit)).toEqual([
			{ text: '猫', hit: true }
		]);
	});

	test('sem a palavra, volta o texto inteiro', () => {
		expect(highlightParts('nada aqui', 'xyz', 'pt')).toEqual([{ text: 'nada aqui', hit: false }]);
	});
});

describe('sessão', () => {
	const now = new Date('2026-11-10T15:00:00.000Z');

	test('responder avança e conta acertos (Errei é erro)', () => {
		let s = startSession([item('a'), item('b')]);
		s = answerItem(s, {
			rating: 3,
			logId: 'l1',
			updated: item('a', { dueAt: '2026-11-15T00:00:00.000Z' }),
			now
		});
		expect(s.queue.map((i) => i.flashcardId)).toEqual(['b']);
		expect(s.answered).toBe(1);
		expect(s.correct).toBe(1);
		expect(sessionProgress(s)).toBe(50);
	});

	test('Errei com vencimento próximo volta para o fim da fila', () => {
		let s = startSession([item('a'), item('b')]);
		s = answerItem(s, {
			rating: 1,
			logId: 'l1',
			updated: item('a', { reps: 1, state: 1, dueAt: '2026-11-10T15:01:00.000Z' }),
			now
		});
		expect(s.queue.map((i) => i.flashcardId)).toEqual(['b', 'a']);
		expect(s.queue[1].reps).toBe(1);
		expect(s.correct).toBe(0);
		expect(sessionProgress(s)).toBe(33);
	});

	test('desfazer devolve o flashcard ao topo com o estado anterior e acerta as contas', () => {
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
		expect(s.queue.map((i) => i.flashcardId)).toEqual(['a', 'b']);
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

	test('todos os flashcards em revisão com estabilidade alta', () => {
		expect(isMastered([review(MASTERED_STABILITY_DAYS)])).toBe(true);
		expect(isMastered([review(120), review(95)])).toBe(true);
	});

	test('basta um flashcard abaixo do limite para não ser dominado', () => {
		expect(isMastered([review(120), review(MASTERED_STABILITY_DAYS - 1)])).toBe(false);
	});

	test('reaprendendo não é dominado, mesmo com estabilidade alta', () => {
		expect(isMastered([{ state: 3, stability: 200 }])).toBe(false);
	});

	test('sem flashcards não é dominado', () => {
		expect(isMastered([])).toBe(false);
	});

	test('o limite fica bem acima do "maduro" do Anki (21 dias)', () => {
		expect(MASTERED_STABILITY_DAYS).toBeGreaterThanOrEqual(60);
	});
});

describe('rótulos das notas', () => {
	test('a nota 1 se chama Errei', () => {
		expect(GRADE_LABELS).toEqual({ 1: 'Errei', 2: 'Difícil', 3: 'Bom', 4: 'Fácil' });
	});
});

describe('sessão conta as notas', () => {
	const now = new Date('2026-11-10T15:00:00.000Z');

	test('cada nota soma no seu balde e desfazer desconta', () => {
		let s = startSession([item('a'), item('b')]);
		expect(s.byGrade).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0 });
		s = answerItem(s, {
			rating: 3,
			logId: 'l1',
			updated: item('a', { dueAt: '2026-11-15T00:00:00.000Z' }),
			now
		});
		expect(s.byGrade[3]).toBe(1);
		s = undoLast(s, item('a'));
		expect(s.byGrade[3]).toBe(0);
	});
});

describe('itemStrength', () => {
	const c = (state: number, stability: number) => ({ state, stability });

	test('só flashcards novos é força 0 (Nova)', () => {
		expect(itemStrength([c(0, 0)])).toBe(0);
		expect(itemStrength([])).toBe(0);
		expect(STRENGTH_LABELS[0]).toBe('Nova');
	});

	test('a estabilidade mais fraca decide', () => {
		expect(itemStrength([c(1, 0.5)])).toBe(1);
		expect(itemStrength([c(2, 30), c(2, 5)])).toBe(2);
		expect(itemStrength([c(2, 40)])).toBe(3);
	});

	test('dominado é força 4', () => {
		expect(itemStrength([c(2, MASTERED_STABILITY_DAYS)])).toBe(4);
		expect(STRENGTH_LABELS[4]).toBe('Dominada');
	});

	test('flashcard novo ao lado de um antigo não zera a força', () => {
		expect(itemStrength([c(2, 40), c(0, 0)])).toBe(3);
	});
});

describe('próxima revisão', () => {
	// 15:00 UTC = 12:00 em São Paulo.
	const now = new Date('2026-11-11T15:00:00.000Z');

	test('o flashcard que vence primeiro decide; vencido ou hoje é "hoje"', () => {
		expect(formatNextReview(['2026-11-20T15:00:00.000Z', '2026-11-11T10:00:00.000Z'], now)).toBe(
			'hoje'
		);
		expect(formatNextReview(['2026-11-12T02:00:00.000Z'], now)).toBe('hoje');
		// 03:30 do dia 12 em São Paulo ainda é o dia de estudo 11.
		expect(formatNextReview(['2026-11-12T06:30:00.000Z'], now)).toBe('hoje');
	});

	test('amanhã e em N dias, contando dias do calendário', () => {
		expect(formatNextReview(['2026-11-12T13:00:00.000Z'], now)).toBe('amanhã');
		expect(formatNextReview(['2026-11-14T13:00:00.000Z'], now)).toBe('em 3 dias');
	});

	test('isDueToday acompanha o rótulo', () => {
		expect(isDueToday(['2026-11-12T02:00:00.000Z'], now)).toBe(true);
		expect(isDueToday(['2026-11-12T13:00:00.000Z'], now)).toBe(false);
		expect(isDueToday([], now)).toBe(false);
	});
});

describe('datas da interface', () => {
	const now = new Date('2026-11-11T15:00:00.000Z');

	test('formatToday escreve o dia por extenso', () => {
		expect(formatToday(now)).toBe('Quarta, 11 de novembro');
	});

	test('formatAgo em linguagem de gente', () => {
		expect(formatAgo(new Date(now.getTime() - 20_000), now)).toBe('agora');
		expect(formatAgo(new Date(now.getTime() - 5 * MIN), now)).toBe('há 5 min');
		expect(formatAgo(new Date(now.getTime() - 3 * HOUR), now)).toBe('há 3 h');
		expect(formatAgo(new Date('2026-11-10T20:00:00.000Z'), now)).toBe('ontem');
		expect(formatAgo(new Date('2026-11-08T20:00:00.000Z'), now)).toBe('há 3 dias');
		expect(formatAgo(new Date('2026-10-12T20:00:00.000Z'), now)).toBe('12 out');
	});

	test('estimateMinutes: uns 30 segundos por flashcard, no mínimo 1', () => {
		expect(estimateMinutes(1)).toBe(1);
		expect(estimateMinutes(13)).toBe(7);
		expect(estimateMinutes(0)).toBe(0);
	});
});

describe('mídia na revisão', () => {
	const media = { image: 'u/i.webp', audio: 'u/a.mp3' };

	test('Reconhecer: áudio na pergunta, imagem só na resposta', () => {
		const m = reviewMedia(item('x', media));
		expect(m.ask).toEqual({ image: null, audio: 'u/a.mp3' });
		expect(m.answer).toEqual(media);
	});

	test('Produzir: imagem na pergunta, áudio só ao revelar', () => {
		const m = reviewMedia(item('x', { ...media, kind: 'produzir' }));
		expect(m.ask).toEqual({ image: 'u/i.webp', audio: null });
		expect(m.answer).toEqual(media);
	});

	test('ficha: cada lado leva a sua mídia; inverso troca', () => {
		const front = { image: 'u/fi.webp', audio: 'u/fa.mp3' };
		const back = { image: 'u/bi.webp', audio: null };
		expect(reviewMedia(ficha('a'))).toEqual({ ask: front, answer: back });
		expect(reviewMedia(ficha('a', { kind: 'inverso' }))).toEqual({ ask: back, answer: front });
	});

	test('caminhos e troca por URLs assinadas (sem URL some)', () => {
		expect(reviewMediaPaths(ficha('a'))).toEqual(['u/fi.webp', 'u/fa.mp3', 'u/bi.webp']);
		expect(reviewMediaPaths(item('x'))).toEqual([]);
		const urls = new Map([['u/i.webp', 'https://s/i']]);
		const signed = withMediaUrls(item('x', media), urls);
		expect(signed.source === 'item' && [signed.image, signed.audio]).toEqual(['https://s/i', null]);
	});
});
