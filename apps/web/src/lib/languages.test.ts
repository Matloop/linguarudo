import { describe, expect, test } from 'bun:test';
import { LANGUAGES, LANGUAGE_LABELS, parseLanguage, parseStudyLanguages } from './languages';

describe('LANGUAGES', () => {
	test('todo idioma tem nome em português', () => {
		expect(Object.keys(LANGUAGE_LABELS).sort()).toEqual([...LANGUAGES].sort());
	});
});

describe('parseLanguage', () => {
	test('aceita os códigos da lista, sem diferenciar caixa', () => {
		expect(parseLanguage('it')).toBe('it');
		expect(parseLanguage(' JA ')).toBe('ja');
	});

	test('qualquer outra coisa vira null', () => {
		expect(parseLanguage(null)).toBeNull();
		expect(parseLanguage('')).toBeNull();
		expect(parseLanguage('xx')).toBeNull();
		expect(parseLanguage('pt-BR')).toBeNull();
	});
});

describe('parseStudyLanguages', () => {
	test('mantém só os conhecidos, sem repetir, na ordem da lista', () => {
		expect(parseStudyLanguages(['fr', 'en', 'xx', 'fr', 'IT'])).toEqual(['en', 'it', 'fr']);
	});

	test('a língua nativa não entra como idioma de estudo', () => {
		expect(parseStudyLanguages(['pt', 'es'], 'pt')).toEqual(['es']);
	});

	test('vazio é inválido', () => {
		expect(parseStudyLanguages([])).toBeNull();
		expect(parseStudyLanguages(['pt'], 'pt')).toBeNull();
		expect(parseStudyLanguages([new Blob(['en'])])).toBeNull();
	});
});
