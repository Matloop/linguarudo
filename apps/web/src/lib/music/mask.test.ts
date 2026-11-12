import { describe, expect, test } from 'bun:test';
import { GAP_TEXT, lineParts, maskTokens, maskedText } from './mask.ts';
import { tokenize } from './tokenize.ts';

const tokens = tokenize('Il mare, il sole e il mare', 'it');
// tokens: Il · " " · mare · ", " · il · " " · sole · …
const gap = { token: 6 };
const answered = (ok: boolean) => [{ token: 6, result: { ok } }];

describe('lacuna aberta', () => {
	test('na letra vira uma lacuna sem texto', () => {
		const parts = lineParts(tokens, [gap]);
		expect(parts[6]).toEqual({ kind: 'gap', token: 6, initial: 's', rest: 3 });
		expect(parts.some((p) => p.kind !== 'gap' && p.text === 'sole')).toBe(false);
	});

	test('a dica da sincronia guarda só a inicial e quantas letras faltam', () => {
		const accented = tokenize('Ça été très ünïcode', 'it');
		const [ca, ete] = accented.flatMap((t, i) => (t.key === null ? [] : [i]));
		const parts = lineParts(accented, [{ token: ca }, { token: ete }]);
		expect(parts[ca]).toMatchObject({ kind: 'gap', initial: 'Ç', rest: 1 });
		expect(parts[ete]).toMatchObject({ kind: 'gap', initial: 'é', rest: 2 });
		expect(JSON.stringify(parts[ete])).not.toContain('été');
	});

	test('no cartão e no texto corrido vira traços', () => {
		expect(maskTokens(tokens, [gap])[6]).toEqual({ text: GAP_TEXT, key: null });
		expect(maskedText(tokens, [gap])).toBe(`Il mare, il ${GAP_TEXT} e il mare`);
	});
});

describe('lacuna respondida', () => {
	test('mostra a palavra com a marca de certo ou errado', () => {
		expect(lineParts(tokens, answered(true))[6]).toEqual({
			kind: 'word',
			text: 'sole',
			key: 'sole',
			token: 6,
			mark: 'ok'
		});
		expect(lineParts(tokens, answered(false))[6]).toMatchObject({ mark: 'err' });
		expect(maskedText(tokens, answered(false))).toBe('Il mare, il sole e il mare');
	});
});

test('linha sem lacuna sai inteira', () => {
	expect(maskedText(tokens)).toBe('Il mare, il sole e il mare');
	expect(lineParts(tokens)[1]).toEqual({ kind: 'sep', text: ' ' });
});

test('várias lacunas na linha: só as abertas somem', () => {
	const gaps = [{ token: 2 }, { token: 6, result: { ok: true } }, { token: 10 }];
	expect(maskedText(tokens, gaps)).toBe(`Il ${GAP_TEXT}, il sole e ${GAP_TEXT} mare`);
	expect(lineParts(tokens, gaps).filter((p) => p.kind === 'gap')).toHaveLength(2);
});
