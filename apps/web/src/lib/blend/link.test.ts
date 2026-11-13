import { describe, expect, test } from 'bun:test';
import { blendAnchor, blendHref, HREF_MAX_BYTES, parseBlendHref } from './link.ts';

const bytes = (s: string) => new TextEncoder().encode(s).length;

describe('link do blend', () => {
	test('forma básica', () => {
		expect(blendAnchor('casa', 'casa', 'house', 'f.')).toBe('<a href="#lb:casa|house|f.">casa</a>');
		expect(blendHref('andare', 'ir')).toBe('#lb:andare|ir');
	});

	test('escapa | e % nos campos e & < > " no XML', () => {
		const href = blendHref('a|b', '50% & "x"', '<n>')!;
		expect(href).toBe('#lb:a%7Cb|50%25 & "x"|<n>');
		expect(parseBlendHref(href)).toEqual({ lemma: 'a|b', translation: '50% & "x"', note: '<n>' });
		const a = blendAnchor('l\'acqua & <c>', 'a|b', '50% & "x"', '<n>')!;
		expect(a).toBe(
			'<a href="#lb:a%7Cb|50%25 &amp; &quot;x&quot;|&lt;n&gt;">l\'acqua &amp; &lt;c&gt;</a>'
		);
	});

	test('respeita os limites de cada campo e o href de 255 bytes', () => {
		const long = 'ã'.repeat(200);
		const href = blendHref(long, long, long)!;
		expect(bytes(href)).toBeLessThanOrEqual(HREF_MAX_BYTES);
		const p = parseBlendHref(href)!;
		expect(bytes(p.lemma)).toBeLessThanOrEqual(47);
		expect(bytes(p.translation)).toBeLessThanOrEqual(63);
		expect(bytes(p.note)).toBeLessThanOrEqual(95);
		expect(p.lemma).toMatch(/^ã+$/);
	});

	test('não deixa escape pela metade ao cortar', () => {
		const href = blendHref('x', '|'.repeat(40))!;
		expect(href).toMatch(/^#lb:x\|(%7C)+$/);
	});

	test('sem lema ou tradução não há link', () => {
		expect(blendHref('', 'x')).toBeNull();
		expect(blendHref('x', '  ')).toBeNull();
		expect(blendAnchor('', 'x', 'y')).toBeNull();
	});
});
