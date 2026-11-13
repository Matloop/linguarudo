import { describe, expect, test } from 'bun:test';
import { mergeSuggestion, parseSuggestion, type FillFields } from './ai-fill.ts';

const blank: FillFields = { lemma: '', reading: '', sense: '', sentence: '' };
const ai: FillFields = {
	lemma: 'volere',
	reading: '',
	sense: 'querer',
	sentence: 'Voglio un caffè.'
};

describe('mergeSuggestion', () => {
	test('a palavra sempre vira a forma de dicionário', () => {
		expect(mergeSuggestion({ ...blank, lemma: 'voglio' }, ai).lemma).toBe('volere');
	});

	test('preenche os campos vazios', () => {
		expect(mergeSuggestion({ ...blank, lemma: 'voglio' }, ai)).toEqual(ai);
	});

	test('não sobrescreve o que o usuário escreveu', () => {
		const current = { lemma: 'voglio', reading: 'vo', sense: 'desejar', sentence: 'Io voglio.' };
		expect(mergeSuggestion(current, { ...ai, reading: 'vɔ' })).toEqual({
			...current,
			lemma: 'volere'
		});
	});

	test('só espaços conta como vazio', () => {
		expect(mergeSuggestion({ ...blank, lemma: 'x', sense: '  ' }, ai).sense).toBe('querer');
	});

	test('sugestão vazia mantém o atual', () => {
		const current = { ...blank, lemma: 'voglio' };
		expect(mergeSuggestion(current, blank)).toEqual(current);
	});
});

describe('parseSuggestion', () => {
	test('lê a resposta e apara espaços', () => {
		expect(
			parseSuggestion({ lemma: ' volere ', reading: '', sense: 'querer', sentence: '' })
		).toEqual({ lemma: 'volere', reading: '', sense: 'querer', sentence: '' });
	});

	test('tipos errados viram vazio; tudo vazio é nulo', () => {
		expect(parseSuggestion({ lemma: 1, sense: null })).toBeNull();
		expect(parseSuggestion(null)).toBeNull();
		expect(parseSuggestion('x')).toBeNull();
	});
});
