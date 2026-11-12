import { describe, expect, test } from 'bun:test';
import { Resampler } from './resample';

describe('Resampler', () => {
	test('48 kHz → 16 kHz: um terço das amostras, constante continua constante', () => {
		const r = new Resampler(48_000, 16_000);
		const out = r.push(new Float32Array(4800).fill(0.5));
		expect(out.length).toBe(1600);
		for (const x of out) expect(x).toBeCloseTo(0.5, 6);
	});

	test('44,1 kHz → 16 kHz em pedaços de 128 dá o mesmo que de uma vez', () => {
		const input = new Float32Array(44_100).map((_, i) => Math.sin(i / 20));
		const whole = new Resampler(44_100, 16_000).push(input);
		const r = new Resampler(44_100, 16_000);
		const parts: number[] = [];
		for (let i = 0; i < input.length; i += 128) parts.push(...r.push(input.subarray(i, i + 128)));
		expect(Math.abs(whole.length - 16_000)).toBeLessThanOrEqual(1);
		expect(parts.length).toBe(whole.length);
		for (let i = 0; i < whole.length; i++) expect(parts[i]).toBeCloseTo(whole[i], 5);
	});

	test('mesma taxa devolve cópia', () => {
		const input = new Float32Array([1, 2, 3]);
		const out = new Resampler(16_000, 16_000).push(input);
		expect([...out]).toEqual([1, 2, 3]);
		expect(out).not.toBe(input);
	});

	test('taxa inválida', () => {
		expect(() => new Resampler(0, 16_000)).toThrow();
	});
});
