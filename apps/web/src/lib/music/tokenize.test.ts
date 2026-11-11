import { describe, expect, test } from 'bun:test';
import { tokenize, wordKey } from './tokenize.ts';

const words = (text: string, lang: 'en' | 'it') =>
	tokenize(text, lang)
		.filter((t) => t.key !== null)
		.map((t) => t.key);

describe('wordKey', () => {
	test('minúsculas, NFC e apóstrofo reto', () => {
		expect(wordKey('Don’t')).toBe("don't");
		expect(wordKey('CAFÈ')).toBe('cafè');
		expect(wordKey('è')).toBe('è');
	});

	test('tira apóstrofos e hífens das pontas', () => {
		expect(wordKey("'tis")).toBe('tis');
		expect(wordKey("believin'")).toBe('believin');
	});
});

describe('tokenize', () => {
	test('a concatenação dos tokens reproduz o texto original', () => {
		const text = 'Oh, "quiet" nights — and 3 lamps; (really?)';
		for (const lang of ['en', 'it'] as const) {
			expect(
				tokenize(text, lang)
					.map((t) => t.text)
					.join('')
			).toBe(text);
		}
	});

	test('inglês mantém contrações numa palavra só', () => {
		expect(words("Don't stop, believin' now", 'en')).toEqual(["don't", 'stop', 'believin', 'now']);
	});

	test('italiano separa a elisão: l’amore vira l + amore', () => {
		expect(words("Sento l'amore dell’acqua", 'it')).toEqual([
			'sento',
			'l',
			'amore',
			'dell',
			'acqua'
		]);
	});

	test('letras acentuadas fazem parte da palavra', () => {
		expect(words('Città più lontana', 'it')).toEqual(['città', 'più', 'lontana']);
	});

	test('números e pontuação não são palavras', () => {
		const t = tokenize('Room 42, please!', 'en');
		expect(t.find((x) => x.text === '42')?.key).toBeNull();
		expect(t.find((x) => x.text === ', ')?.key).toBeNull();
	});
});
