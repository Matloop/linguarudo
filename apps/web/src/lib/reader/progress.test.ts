import { describe, expect, test } from 'bun:test';
import {
	ProgressSaver,
	SAVE_EVERY_MS,
	parsePosition,
	positionFrom,
	type ReadingPosition
} from './progress';

describe('parsePosition', () => {
	test('arredonda para uma casa e limita a 0–100', () => {
		expect(parsePosition({ spine: 4, chapterPercent: 37.54, percent: 120 })).toEqual({
			spine: 4,
			chapterPercent: 37.5,
			percent: 100
		});
		expect(parsePosition({ spine: 0, chapterPercent: -3, percent: 0 })?.chapterPercent).toBe(0);
	});

	test('recusa o que não é posição', () => {
		expect(parsePosition(null)).toBeNull();
		expect(parsePosition({ spine: -1, chapterPercent: 0, percent: 0 })).toBeNull();
		expect(parsePosition({ spine: 1.5, chapterPercent: 0, percent: 0 })).toBeNull();
		expect(parsePosition({ spine: '1', chapterPercent: 0, percent: 0 })).toBeNull();
		expect(parsePosition({ spine: 1, chapterPercent: NaN, percent: 0 })).toBeNull();
		expect(parsePosition({ spine: 1, chapterPercent: 2 })).toBeNull();
	});

	test('frações do leitor viram percentuais', () => {
		expect(positionFrom(2, 0.5, 0.2134)).toEqual({ spine: 2, chapterPercent: 50, percent: 21.3 });
	});
});

describe('ProgressSaver', () => {
	function setup(initial: ReadingPosition | null = { spine: 0, chapterPercent: 0, percent: 0 }) {
		let t = 1_000_000;
		const saved: ReadingPosition[] = [];
		const saver = new ProgressSaver({ initial, save: (p) => saved.push(p), now: () => t });
		return { saver, saved, advance: (ms: number) => (t += ms) };
	}
	const at = (spine: number, chapterPercent: number): ReadingPosition => ({
		spine,
		chapterPercent,
		percent: spine * 10 + chapterPercent / 10
	});

	test('troca de capítulo grava na hora', () => {
		const { saver, saved } = setup();
		saver.update(at(0, 40));
		expect(saved).toEqual([]);
		saver.update(at(1, 0));
		expect(saved).toEqual([at(1, 0)]);
	});

	test('no mesmo capítulo, grava a cada 30 s de leitura', () => {
		const { saver, saved, advance } = setup();
		saver.update(at(0, 10));
		advance(SAVE_EVERY_MS - 1);
		saver.tick();
		expect(saved).toEqual([]);
		saver.update(at(0, 20));
		advance(1);
		saver.tick();
		expect(saved).toEqual([at(0, 20)]);
		advance(SAVE_EVERY_MS);
		saver.tick();
		expect(saved).toHaveLength(1);
	});

	test('flush ao sair grava o pendente uma vez só', () => {
		const { saver, saved } = setup();
		saver.update(at(0, 55));
		saver.flush();
		saver.flush();
		expect(saved).toEqual([at(0, 55)]);
	});

	test('voltar para a posição guardada não grava', () => {
		const { saver, saved } = setup(at(3, 50));
		saver.update(at(3, 60));
		saver.update(at(3, 50));
		saver.flush();
		expect(saved).toEqual([]);
	});

	test('sem posição guardada, a primeira grava', () => {
		const { saver, saved } = setup(null);
		saver.update(at(0, 0));
		expect(saved).toEqual([at(0, 0)]);
	});
});
