import { describe, expect, test } from 'bun:test';
import { editDistance, makeOptions, shuffle, similarity } from './distractors.ts';
import { mulberry32 } from './rng.ts';

describe('editDistance', () => {
	test('casos clássicos', () => {
		expect(editDistance('kitten', 'sitting')).toBe(3);
		expect(editDistance('', 'abc')).toBe(3);
		expect(editDistance('abc', '')).toBe(3);
		expect(editDistance('same', 'same')).toBe(0);
	});
});

describe('similarity', () => {
	test('1 para iguais, perto de 0 para muito diferentes', () => {
		expect(similarity('light', 'light')).toBe(1);
		expect(similarity('light', 'night')).toBeGreaterThan(similarity('light', 'elephant'));
		expect(similarity('abc', 'xyz')).toBe(0);
	});
});

describe('shuffle', () => {
	test('mantém os elementos, não muda a entrada e é reproduzível com a mesma semente', () => {
		const input = [1, 2, 3, 4, 5, 6];
		const a = shuffle(input, mulberry32(7));
		const b = shuffle(input, mulberry32(7));
		expect(input).toEqual([1, 2, 3, 4, 5, 6]);
		expect([...a].sort()).toEqual([1, 2, 3, 4, 5, 6]);
		expect(a).toEqual(b);
	});
});

describe('makeOptions', () => {
	const common = ['water', 'house', 'green', 'garden', 'window', 'bridge', 'flower', 'summer'];

	test('devolve 4 opções únicas com a resposta uma vez só', () => {
		for (let seed = 1; seed <= 30; seed++) {
			const opts = makeOptions('light', {
				pool: ['night', 'fight', 'sight'],
				common,
				rng: mulberry32(seed)
			});
			expect(opts).toHaveLength(4);
			expect(new Set(opts.map((o) => o.toLowerCase())).size).toBe(4);
			expect(opts.filter((o) => o === 'light')).toHaveLength(1);
		}
	});

	test('prefere palavras parecidas por forma (distância de edição)', () => {
		for (let seed = 1; seed <= 30; seed++) {
			const opts = makeOptions('light', {
				pool: ['night', 'fight', 'sight', 'right', 'banana', 'elephant'],
				common: [],
				rng: mulberry32(seed)
			});
			for (const o of opts.filter((x) => x !== 'light')) {
				expect(editDistance('light', o)).toBeLessThanOrEqual(2);
			}
		}
	});

	test('mesmo começo e mesmo fim também contam como parecido', () => {
		const opts = makeOptions('station', {
			pool: ['stationary', 'stations', 'nation', 'ration', 'purple', 'orange'],
			common: [],
			rng: mulberry32(3)
		});
		expect(opts).toContain('station');
		expect(opts).not.toContain('purple');
		expect(opts).not.toContain('orange');
	});

	test('nunca repete a resposta, mesmo em outra caixa ou vinda do pool', () => {
		const opts = makeOptions('Light', {
			pool: ['light', 'LIGHT', 'Night', 'fight', 'sight'],
			common,
			rng: mulberry32(9)
		});
		expect(opts.filter((o) => o.toLowerCase() === 'light')).toHaveLength(1);
	});

	test('respeita a caixa inicial da resposta', () => {
		const opts = makeOptions('Monday', {
			pool: ['sunday', 'friday', 'holiday', 'someday'],
			common: [],
			rng: mulberry32(2)
		});
		for (const o of opts) expect(o[0]).toBe(o[0].toUpperCase());
	});

	test('não usa palavras proibidas (as que já aparecem na própria linha)', () => {
		const opts = makeOptions('light', {
			pool: ['night', 'fight', 'sight', 'right', 'might'],
			common: [],
			exclude: new Set(['night', 'fight']),
			rng: mulberry32(5)
		});
		expect(opts).not.toContain('night');
		expect(opts).not.toContain('fight');
	});

	test('com pool vazio completa com as palavras comuns', () => {
		const opts = makeOptions('light', { pool: [], common, rng: mulberry32(1) });
		expect(opts).toHaveLength(4);
	});

	test('com pouca matéria-prima devolve menos de 4, sem repetir nem quebrar', () => {
		const opts = makeOptions('light', { pool: ['night'], common: ['night'], rng: mulberry32(1) });
		expect(opts.sort()).toEqual(['light', 'night']);
	});

	test('a posição da resposta varia entre sementes', () => {
		const positions = new Set<number>();
		for (let seed = 1; seed <= 40; seed++) {
			const opts = makeOptions('light', {
				pool: ['night', 'fight', 'sight'],
				common,
				rng: mulberry32(seed)
			});
			positions.add(opts.indexOf('light'));
		}
		expect(positions.size).toBeGreaterThanOrEqual(3);
	});
});
