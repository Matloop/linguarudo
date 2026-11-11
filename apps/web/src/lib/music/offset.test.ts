import { describe, expect, test } from 'bun:test';
import {
	clampOffset,
	durationHint,
	formatOffset,
	offsetFromMark,
	parseSyncUpdate,
	syncFromRefs
} from './offset.ts';

const WORK = '0b7a3c1e-8f7d-4a51-9c3e-2d1f0a9b8c7d';

describe('clampOffset', () => {
	test('arredonda a décimos e limita a ±300 s', () => {
		expect(clampOffset(12.46)).toBe(12.5);
		expect(clampOffset(-0.04)).toBe(0);
		expect(clampOffset(900)).toBe(300);
		expect(clampOffset(-301)).toBe(-300);
		expect(clampOffset(Number.NaN)).toBe(0);
	});
});

describe('offsetFromMark', () => {
	test('tempo do vídeo menos o começo da linha na letra', () => {
		expect(offsetFromMark(20.43, 8)).toBe(12.4);
		expect(offsetFromMark(7.5, 8)).toBe(-0.5);
	});
});

describe('durationHint', () => {
	test('a sobra do vídeo vira palpite', () => {
		expect(durationHint(76.4, 60)).toBe(16.4);
		expect(durationHint(55, 60)).toBe(-5);
	});

	test('diferença pequena ou duração desconhecida não dá palpite', () => {
		expect(durationHint(61.5, 60)).toBeNull();
		expect(durationHint(0, 60)).toBeNull();
		expect(durationHint(80, null)).toBeNull();
	});
});

describe('formatOffset', () => {
	test('sinal e vírgula', () => {
		expect(formatOffset(12.4)).toBe('+12,4 s');
		expect(formatOffset(-0.5)).toBe('−0,5 s');
		expect(formatOffset(0)).toBe('+0,0 s');
	});
});

describe('syncFromRefs', () => {
	test('lê o deslocamento salvo e o aviso ignorado', () => {
		expect(
			syncFromRefs({ youtube_id: 'x', lyrics_offset: 12.4, offset_hint_dismissed: true })
		).toEqual({ offset: 12.4, hintDismissed: true });
	});

	test('obra nunca ajustada', () => {
		expect(syncFromRefs({ youtube_id: 'x' })).toEqual({ offset: null, hintDismissed: false });
		expect(syncFromRefs(null)).toEqual({ offset: null, hintDismissed: false });
		expect(syncFromRefs({ lyrics_offset: '3' })).toEqual({ offset: null, hintDismissed: false });
	});
});

describe('parseSyncUpdate', () => {
	test('aceita deslocamento, aviso ignorado ou os dois', () => {
		expect(parseSyncUpdate({ workId: WORK, offset: 12.44 })).toEqual({
			workId: WORK,
			offset: 12.4,
			hintDismissed: null
		});
		expect(parseSyncUpdate({ workId: WORK, hintDismissed: true })).toEqual({
			workId: WORK,
			offset: null,
			hintDismissed: true
		});
	});

	test('recusa corpo inválido', () => {
		expect(parseSyncUpdate(null)).toBeNull();
		expect(parseSyncUpdate({ workId: 'x', offset: 1 })).toBeNull();
		expect(parseSyncUpdate({ workId: WORK })).toBeNull();
		expect(parseSyncUpdate({ workId: WORK, offset: 301 })).toBeNull();
		expect(parseSyncUpdate({ workId: WORK, offset: '1' })).toBeNull();
		expect(parseSyncUpdate({ workId: WORK, hintDismissed: 'sim' })).toBeNull();
	});
});
