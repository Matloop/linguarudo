import { describe, expect, test } from 'bun:test';
import { readBlendLink as parseBlendHref } from './blend-link';

describe('readBlendLink', () => {
	test('lema, tradução e nota', () => {
		expect(parseBlendHref('#lb:il mare|o mar|masculino')).toEqual({
			lemma: 'il mare',
			translation: 'o mar',
			note: 'masculino'
		});
	});

	test('nota ausente ou vazia', () => {
		const want = { lemma: 'sorridere', translation: 'sorrir', note: '' };
		expect(parseBlendHref('#lb:sorridere|sorrir')).toEqual(want);
		expect(parseBlendHref('#lb:sorridere|sorrir|')).toEqual(want);
	});

	test('só %7C e %25 são decodificados', () => {
		expect(parseBlendHref('#lb:a%7Cb|50%25 off|x%20y')).toEqual({
			lemma: 'a|b',
			translation: '50% off',
			note: 'x%20y'
		});
		expect(parseBlendHref('#lb:a%7cb|c')?.lemma).toBe('a|b');
		// %257C é "%7C" literal, não uma barra.
		expect(parseBlendHref('#lb:x%257C|y')?.lemma).toBe('x%7C');
	});

	test('UTF-8 cru e espaços aparados', () => {
		expect(parseBlendHref('#lb: perché |porquê|')).toEqual({
			lemma: 'perché',
			translation: 'porquê',
			note: ''
		});
	});

	test('recusa o que não é link do blend', () => {
		expect(parseBlendHref(null)).toBeNull();
		expect(parseBlendHref('')).toBeNull();
		expect(parseBlendHref('#cap2')).toBeNull();
		expect(parseBlendHref('cap2.xhtml#lb:a|b')).toBeNull();
		expect(parseBlendHref('#lb:sorridere')).toBeNull();
		expect(parseBlendHref('#lb:|sorrir')).toBeNull();
		expect(parseBlendHref('#lb:sorridere|  ')).toBeNull();
		expect(parseBlendHref('#lb:a|b|c|d')).toBeNull();
	});

	test('href acima de 255 bytes não vale', () => {
		const ok = `#lb:a|${'b'.repeat(255 - 6)}`;
		expect(new TextEncoder().encode(ok).length).toBe(255);
		expect(parseBlendHref(ok)).not.toBeNull();
		expect(parseBlendHref(`${ok}b`)).toBeNull();
		// Conta bytes, não caracteres: "é" vale 2.
		expect(parseBlendHref(`#lb:a|${'é'.repeat(125)}`)).toBeNull();
	});
});
