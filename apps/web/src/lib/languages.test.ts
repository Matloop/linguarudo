import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { LANGUAGE_TAG_RE } from '@linguetta/language';
import {
	acceptedLanguages,
	languageDefaults,
	languageInline,
	languageLabel,
	parseLanguage,
	parseStudyLanguages,
	parseUiLanguage
} from './languages';

describe('parseLanguage', () => {
	test('aceita qualquer tag BCP 47 e devolve a forma canônica', () => {
		expect(parseLanguage('it')).toBe('it');
		expect(parseLanguage(' JA ')).toBe('ja');
		expect(parseLanguage('pt-br')).toBe('pt-BR');
		expect(parseLanguage('tet')).toBe('tet');
		expect(parseLanguage('zh-hant')).toBe('zh-Hant');
	});

	test('o que não é tag vira null', () => {
		expect(parseLanguage(null)).toBeNull();
		expect(parseLanguage('')).toBeNull();
		expect(parseLanguage('xx!!')).toBeNull();
		expect(parseLanguage('português')).toBeNull();
		expect(parseLanguage(42)).toBeNull();
	});
});

describe('parseUiLanguage', () => {
	test('só português e inglês', () => {
		expect(parseUiLanguage('pt')).toBe('pt');
		expect(parseUiLanguage('en')).toBe('en');
		expect(parseUiLanguage('it')).toBeNull();
		expect(parseUiLanguage(undefined)).toBeNull();
	});
});

describe('languageLabel', () => {
	test('nome na língua da interface, com inicial maiúscula nos dois motores', () => {
		expect(languageLabel('it', 'pt')).toBe('Italiano');
		expect(languageLabel('it', 'en')).toBe('Italian');
		expect(languageInline('it', 'pt')).toBe('italiano');
		expect(languageInline('it', 'en')).toBe('Italian');
	});
});

describe('parseStudyLanguages', () => {
	test('canoniza, não repete e mantém a ordem recebida', () => {
		expect(parseStudyLanguages(['fr', 'EN', 'fr', 'pt-br'])).toEqual(['fr', 'en', 'pt-BR']);
	});

	test('a língua nativa não entra como idioma de estudo', () => {
		expect(parseStudyLanguages(['pt', 'es'], 'pt')).toEqual(['es']);
	});

	test('vazio vale; valor inválido ou mais de 20 recusa', () => {
		expect(parseStudyLanguages([])).toEqual([]);
		expect(parseStudyLanguages(['pt'], 'pt')).toEqual([]);
		expect(parseStudyLanguages(['en', 'xx!!'])).toBeNull();
		expect(parseStudyLanguages([new Blob(['en'])])).toBeNull();
		const many = 'af ar bg ca cs da de el en es et fa fi fr he hi hr hu id it ja'.split(' ');
		expect(parseStudyLanguages(many)).toBeNull();
		expect(parseStudyLanguages(many.slice(0, 20))).toHaveLength(20);
	});
});

describe('Accept-Language', () => {
	test('ordena por q e descarta o inválido', () => {
		expect(acceptedLanguages('en;q=0.5, pt-BR, *, de;q=0.8')).toEqual(['pt-BR', 'de', 'en']);
		expect(acceptedLanguages(null)).toEqual([]);
	});

	test('interface pt se o navegador prefere algum pt; nativa = base da primeira tag', () => {
		expect(languageDefaults('pt-BR,pt;q=0.9,en;q=0.8')).toEqual({ ui: 'pt', native: 'pt' });
		expect(languageDefaults('de-AT,en;q=0.5,pt;q=0.4')).toEqual({ ui: 'en', native: 'de' });
		expect(languageDefaults('ja')).toEqual({ ui: 'en', native: 'ja' });
		expect(languageDefaults('')).toEqual({ ui: 'en', native: 'en' });
	});
});

describe('migration qualquer_idioma', () => {
	test('o domínio language_code usa exatamente LANGUAGE_TAG_RE', () => {
		const sql = readFileSync(
			new URL(
				'../../../../supabase/migrations/20261112000000_qualquer_idioma.sql',
				import.meta.url
			),
			'utf8'
		);
		const m = sql.match(/add constraint language_code_check check \(\s*value ~ '([^']+)'/);
		expect(m?.[1]).toBe(LANGUAGE_TAG_RE);
	});
});
