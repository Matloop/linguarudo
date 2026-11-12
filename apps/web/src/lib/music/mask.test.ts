import { describe, expect, test } from 'bun:test';
import { GAP_TEXT, lineParts, maskTokens, maskedText } from './mask.ts';
import { tokenize } from './tokenize.ts';

const tokens = tokenize('Il mare, il sole e il mare', 'it');
// tokens: Il · " " · mare · ", " · il · " " · sole · …
const gap = { token: 6 };

describe('lacuna aberta', () => {
	test('na letra vira uma lacuna sem texto', () => {
		const parts = lineParts(tokens, gap, null);
		expect(parts[6]).toEqual({ kind: 'gap', token: 6 });
		expect(parts.some((p) => p.kind !== 'gap' && p.text === 'sole')).toBe(false);
	});

	test('no cartão e no texto corrido vira traços', () => {
		expect(maskTokens(tokens, gap, null)[6]).toEqual({ text: GAP_TEXT, key: null });
		expect(maskedText(tokens, gap, null)).toBe(`Il mare, il ${GAP_TEXT} e il mare`);
	});
});

describe('lacuna respondida', () => {
	test('mostra a palavra com a marca de certo ou errado', () => {
		expect(lineParts(tokens, gap, { ok: true })[6]).toEqual({
			kind: 'word',
			text: 'sole',
			key: 'sole',
			token: 6,
			mark: 'ok'
		});
		expect(lineParts(tokens, gap, { ok: false })[6]).toMatchObject({ mark: 'err' });
		expect(maskedText(tokens, gap, { ok: false })).toBe('Il mare, il sole e il mare');
	});
});

test('linha sem lacuna sai inteira', () => {
	expect(maskedText(tokens)).toBe('Il mare, il sole e il mare');
	expect(lineParts(tokens)[1]).toEqual({ kind: 'sep', text: ' ' });
});
