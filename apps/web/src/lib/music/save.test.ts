import { describe, expect, test } from 'bun:test';
import { MAX_WORDS_PER_SAVE, musicEntries, parseMusicSave } from './save.ts';

const workId = '7d1f0e2a-0000-4000-8000-000000000009';
const base = {
	lemma: 'Harbor',
	sense: ' porto ',
	sentence: 'Paper boats on the silver harbor',
	highlight: 'harbor',
	seconds: 83.7
};

describe('parseMusicSave', () => {
	test('normaliza e devolve as palavras válidas', () => {
		expect(parseMusicSave({ workId, words: [base] })).toEqual({
			ok: true,
			workId,
			words: [
				{
					lemma: 'Harbor',
					sense: 'porto',
					sentence: 'Paper boats on the silver harbor',
					highlight: 'harbor',
					seconds: 83
				}
			]
		});
	});

	test('corta frase longa e some com destaque longo, em vez de recusar', () => {
		const out = parseMusicSave({
			workId,
			words: [{ ...base, sentence: 'x'.repeat(900), highlight: 'z'.repeat(200) }]
		});
		expect(out.ok).toBe(true);
		if (!out.ok) return;
		expect([...out.words[0].sentence]).toHaveLength(500);
		expect(out.words[0].highlight).toBe('');
	});

	test('tempo inválido vira null', () => {
		for (const seconds of [-1, 'abc', null, 2_000_000, Number.NaN]) {
			const out = parseMusicSave({ workId, words: [{ ...base, seconds }] });
			expect(out.ok && out.words[0].seconds).toBeNull();
		}
	});

	test('recusa lema vazio, sentido enorme, obra inválida e corpo fora do formato', () => {
		expect(parseMusicSave({ workId, words: [{ ...base, lemma: '  ' }] }).ok).toBe(false);
		expect(parseMusicSave({ workId, words: [{ ...base, sense: 'a'.repeat(201) }] }).ok).toBe(false);
		expect(parseMusicSave({ workId: 'x', words: [base] }).ok).toBe(false);
		expect(parseMusicSave({ workId, words: 'nope' }).ok).toBe(false);
		expect(parseMusicSave(null).ok).toBe(false);
		expect(parseMusicSave({ workId, words: [] }).ok).toBe(false);
	});

	test('limita o lote', () => {
		const many = Array.from({ length: MAX_WORDS_PER_SAVE + 1 }, (_, i) => ({
			...base,
			lemma: `w${i}`
		}));
		expect(parseMusicSave({ workId, words: many }).ok).toBe(false);
		expect(parseMusicSave({ workId, words: many.slice(0, MAX_WORDS_PER_SAVE) }).ok).toBe(true);
	});
});

describe('musicEntries', () => {
	test('cada palavra vira item com encontro de música ligado à obra', () => {
		const out = parseMusicSave({ workId, words: [base, { ...base, seconds: null }] });
		if (!out.ok) throw new Error('entrada de teste inválida');
		const [first, second] = musicEntries(out.words, { id: workId, language: 'en' });
		expect(first).toEqual({
			language: 'en',
			lemma: 'Harbor',
			sense: 'porto',
			note: '',
			ipa: '',
			part_of_speech: '',
			encounter: {
				form: 'harbor',
				sentence: 'Paper boats on the silver harbor',
				highlight: 'harbor',
				sense: 'porto',
				position: { seconds: 83 },
				origin: 'musica',
				seen_at: null,
				client_id: null
			},
			work: { id: workId }
		});
		expect(second.encounter?.position).toEqual({});
	});
});
