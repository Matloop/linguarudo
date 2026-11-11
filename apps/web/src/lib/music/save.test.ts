import { describe, expect, test } from 'bun:test';
import { MAX_WORDS_PER_SAVE, parseMusicWords } from './save.ts';

const base = {
	term: 'Harbor',
	translation: ' porto ',
	lang: 'en',
	context: 'Paper boats on the silver harbor',
	highlight: 'harbor',
	sourceTitle: 'Canção de Teste — Banda Inventada',
	sourceTime: 83.7
};

describe('parseMusicWords', () => {
	test('normaliza e devolve as palavras válidas', () => {
		const out = parseMusicWords({ words: [base] });
		expect(out).toEqual({
			ok: true,
			words: [
				{
					term: 'Harbor',
					translation: 'porto',
					lang: 'en',
					context: 'Paper boats on the silver harbor',
					context_highlight: 'harbor',
					source_title: 'Canção de Teste — Banda Inventada',
					source_time_s: 83
				}
			]
		});
	});

	test('corta contexto e título longos em vez de recusar', () => {
		const out = parseMusicWords({
			words: [
				{
					...base,
					context: 'x'.repeat(900),
					sourceTitle: 'y'.repeat(400),
					highlight: 'z'.repeat(200)
				}
			]
		});
		expect(out.ok).toBe(true);
		if (!out.ok) return;
		expect([...out.words[0].context]).toHaveLength(500);
		expect([...out.words[0].source_title]).toHaveLength(200);
		expect(out.words[0].context_highlight).toBe('');
	});

	test('tempo inválido vira null', () => {
		for (const sourceTime of [-1, 'abc', null, 2_000_000, Number.NaN]) {
			const out = parseMusicWords({ words: [{ ...base, sourceTime }] });
			expect(out.ok && out.words[0].source_time_s).toBeNull();
		}
	});

	test('recusa palavra vazia, língua inválida, tradução enorme e corpo fora do formato', () => {
		expect(parseMusicWords({ words: [{ ...base, term: '  ' }] }).ok).toBe(false);
		expect(parseMusicWords({ words: [{ ...base, lang: 'fr' }] }).ok).toBe(false);
		expect(parseMusicWords({ words: [{ ...base, translation: 'a'.repeat(201) }] }).ok).toBe(false);
		expect(parseMusicWords({ words: 'nope' }).ok).toBe(false);
		expect(parseMusicWords(null).ok).toBe(false);
		expect(parseMusicWords({ words: [] }).ok).toBe(false);
	});

	test('limita o lote', () => {
		const many = Array.from({ length: MAX_WORDS_PER_SAVE + 1 }, (_, i) => ({
			...base,
			term: `w${i}`
		}));
		expect(parseMusicWords({ words: many }).ok).toBe(false);
		expect(parseMusicWords({ words: many.slice(0, MAX_WORDS_PER_SAVE) }).ok).toBe(true);
	});
});
