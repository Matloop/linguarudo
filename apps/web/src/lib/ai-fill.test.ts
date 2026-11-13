import { describe, expect, test } from 'bun:test';
import { mergeSuggestion, parseSuggestion, type FillFields } from './ai-fill.ts';

const blank: FillFields = { lemma: '', reading: '', sense: '', sentence: '', translation: '' };
const ai: FillFields = {
	lemma: 'volere',
	reading: '',
	sense: 'querer',
	sentence: 'Voglio un caffè.',
	translation: 'Quero um café.'
};

describe('mergeSuggestion', () => {
	test('a palavra sempre vira a forma de dicionário', () => {
		expect(mergeSuggestion({ ...blank, lemma: 'voglio' }, ai).lemma).toBe('volere');
	});

	test('preenche os campos vazios', () => {
		expect(mergeSuggestion({ ...blank, lemma: 'voglio' }, ai)).toEqual(ai);
	});

	test('não sobrescreve o que o usuário escreveu', () => {
		const current = {
			lemma: 'voglio',
			reading: 'vo',
			sense: 'desejar',
			sentence: 'Io voglio.',
			translation: 'Eu desejo.'
		};
		expect(mergeSuggestion(current, { ...ai, reading: 'vɔ' })).toEqual({
			...current,
			lemma: 'volere'
		});
	});

	test('só espaços conta como vazio', () => {
		expect(mergeSuggestion({ ...blank, lemma: 'x', sense: '  ' }, ai).sense).toBe('querer');
	});

	test('tradução da frase só entra vazia e com frase', () => {
		const mine = { ...blank, lemma: 'voglio', sentence: 'Io voglio.' };
		expect(
			mergeSuggestion(mine, { ...ai, sentence: 'Io voglio.', translation: 'Eu quero.' })
		).toMatchObject({ sentence: 'Io voglio.', translation: 'Eu quero.' });
		expect(mergeSuggestion({ ...blank, lemma: 'x' }, { ...ai, sentence: '' }).translation).toBe('');
	});

	test('sugestão vazia mantém o atual', () => {
		const current = { ...blank, lemma: 'voglio' };
		expect(mergeSuggestion(current, blank)).toEqual(current);
	});
});

describe('parseSuggestion', () => {
	test('lê a resposta e apara espaços', () => {
		expect(
			parseSuggestion({
				lemma: ' volere ',
				reading: '',
				sense: 'querer',
				sentence: '',
				translation: ' Quero. '
			})
		).toEqual({
			lemma: 'volere',
			reading: '',
			sense: 'querer',
			sentence: '',
			translation: 'Quero.'
		});
	});

	test('tipos errados viram vazio; tudo vazio é nulo', () => {
		expect(parseSuggestion({ lemma: 1, sense: null })).toBeNull();
		expect(parseSuggestion(null)).toBeNull();
		expect(parseSuggestion('x')).toBeNull();
	});
});
