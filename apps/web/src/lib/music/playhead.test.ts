import { describe, expect, test } from 'bun:test';
import { Playhead, SEEK_GRACE_MS } from './playhead.ts';

describe('sem seek', () => {
	test('segue o player', () => {
		const p = new Playhead();
		expect(p.read(1, 0)).toBe(1);
		expect(p.read(1.5, 16)).toBe(1.5);
	});

	test('tremida pequena para trás é ignorada; pulo grande vale', () => {
		const p = new Playhead();
		p.read(10, 0);
		expect(p.read(9.9, 16)).toBe(10);
		expect(p.read(10.2, 32)).toBe(10.2);
		expect(p.read(3, 48)).toBe(3);
		expect(p.read(40, 64)).toBe(40);
	});
});

describe('depois de um seek', () => {
	test('enquanto o player informa o tempo antigo, vale o alvo', () => {
		const p = new Playhead();
		p.read(30, 0);
		p.seek(5, 10);
		expect(p.seeking).toBe(true);
		expect(p.read(30.1, 20)).toBe(5);
		expect(p.read(30.2, 40)).toBe(5);
		expect(p.read(5.05, 60)).toBe(5.05);
		expect(p.seeking).toBe(false);
	});

	test('keyframe antes do alvo: segura o alvo até o player alcançar', () => {
		const p = new Playhead();
		p.seek(12, 0);
		expect(p.read(11.4, 20)).toBe(12);
		expect(p.read(11.7, 40)).toBe(12);
		expect(p.read(12.1, 60)).toBe(12.1);
	});

	test('se o seek nunca chegar, volta a confiar no player depois da carência', () => {
		const p = new Playhead();
		p.seek(5, 0);
		expect(p.read(30, SEEK_GRACE_MS - 1)).toBe(5);
		expect(p.read(30, SEEK_GRACE_MS)).toBe(30);
	});

	test('tempo inválido repete o último', () => {
		const p = new Playhead();
		p.read(4, 0);
		expect(p.read(Number.NaN, 10)).toBe(4);
	});
});
