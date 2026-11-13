import { describe, expect, test } from 'bun:test';
import { countWords } from '@linguetta/language';
import { REPEAT_GAP, selectSwaps, type Swap } from './select.ts';

const para = (i: number) => `parágrafo número ${i} tem a palavra casa e mais algumas outras aqui`;
const cand = (text: string, form: string, lemma: string): Swap => ({
	form,
	target: lemma,
	lemma,
	start: text.indexOf(form)
});

describe('escolha das trocas', () => {
	const texts = Array.from({ length: 40 }, (_, i) => para(i));
	const words = texts.reduce((n, t) => n + countWords(t, 'pt'), 0);

	test('sem cobertura, nada', () => {
		const out = selectSwaps({
			texts,
			candidates: texts.map((t) => [cand(t, 'casa', 'casa')]),
			sourceLang: 'pt',
			targetLang: 'it',
			coverage: 0
		});
		expect(out.flat()).toHaveLength(0);
	});

	test('cobertura baixa: espaçado, uma por parágrafo, perto da cota', () => {
		const coverage = 0.02;
		const out = selectSwaps({
			texts,
			candidates: texts.map((t, i) => [cand(t, 'palavra', `p${i}`)]),
			sourceLang: 'pt',
			targetLang: 'it',
			coverage
		});
		const chosen = out.flatMap((a, i) => (a.length ? [i] : []));
		expect(chosen.length).toBe(Math.round(coverage * words));
		expect(out.every((a) => a.length <= 1)).toBe(true);
		const gaps = chosen.slice(1).map((v, k) => v - chosen[k]);
		expect(Math.min(...gaps)).toBeGreaterThanOrEqual(2);
	});

	test('o mesmo lema não volta antes de REPEAT_GAP parágrafos', () => {
		const out = selectSwaps({
			texts,
			candidates: texts.map((t) => [cand(t, 'casa', 'casa')]),
			sourceLang: 'pt',
			targetLang: 'it',
			coverage: 0.2
		});
		const chosen = out.flatMap((a, i) => (a.length ? [i] : []));
		expect(chosen.length).toBeGreaterThan(1);
		chosen.slice(1).forEach((v, k) => expect(v - chosen[k]).toBeGreaterThanOrEqual(REPEAT_GAP));
	});

	test('item do banco vem antes da ordem da IA', () => {
		const t = [para(0)];
		const out = selectSwaps({
			texts: t,
			candidates: [[cand(t[0], 'palavra', 'parola'), cand(t[0], 'casa', 'casa')]],
			sourceLang: 'pt',
			targetLang: 'it',
			coverage: 0.05,
			preferWords: ['Casa']
		});
		expect(out[0].map((s) => s.lemma)).toEqual(['casa']);
	});

	test('sem banco, a ordem da IA desempata', () => {
		const t = [para(0)];
		const out = selectSwaps({
			texts: t,
			candidates: [[cand(t[0], 'palavra', 'parola'), cand(t[0], 'casa', 'casa')]],
			sourceLang: 'pt',
			targetLang: 'it',
			coverage: 0.05
		});
		expect(out[0].map((s) => s.lemma)).toEqual(['parola']);
	});

	test('trocas no mesmo parágrafo não se sobrepõem e saem em ordem', () => {
		const t = ['de novo ele voltou para casa de novo'];
		const out = selectSwaps({
			texts: t,
			candidates: [
				[
					{ form: 'casa', target: 'casa', lemma: 'casa', start: 26 },
					{ form: 'de novo', target: 'di nuovo', lemma: 'di nuovo', start: 0 },
					{ form: 'novo', target: 'nuovo', lemma: 'nuovo', start: 3 }
				]
			],
			sourceLang: 'pt',
			targetLang: 'it',
			coverage: 0.5
		});
		const starts = out[0].map((s) => s.start);
		expect(starts).toEqual([...starts].sort((a, b) => a - b));
		expect(out[0].some((s) => s.lemma === 'nuovo') && out[0].some((s) => s.lemma === 'di nuovo')).toBe(
			false
		);
	});
});
