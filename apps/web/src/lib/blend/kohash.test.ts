import { describe, expect, test } from 'bun:test';
import vectors from '../../../../../docs/sync/fixtures/kosync-hash-vectors.json';
import { koHash } from './kohash.ts';

describe('koHash', () => {
	for (const c of vectors.cases) {
		test(`bate com o vetor de ${c.size} bytes`, () => {
			const bytes = new Uint8Array(c.size);
			for (let k = 0; k < c.size; k++) bytes[k] = (k * 31 + 7) % 256;
			expect(koHash(bytes)).toBe(c.hash);
		});
	}
});
