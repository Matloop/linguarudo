import { describe, expect, test } from 'bun:test';
import {
	addStudyLanguage,
	cookieString,
	nextTheme,
	parseCollapsed,
	parseTheme,
	resolveActiveLanguage,
	themeClass
} from './prefs';

describe('tema', () => {
	test('parseTheme aceita só claro ou escuro', () => {
		expect(parseTheme('claro')).toBe('claro');
		expect(parseTheme('escuro')).toBe('escuro');
		expect(parseTheme('dark')).toBeNull();
		expect(parseTheme('')).toBeNull();
		expect(parseTheme(undefined)).toBeNull();
	});

	test('sem escolha, a raiz fica sem classe e segue o sistema', () => {
		expect(themeClass(null)).toBe('');
		expect(themeClass('claro')).toBe('tema-claro');
		expect(themeClass('escuro')).toBe('tema-escuro');
	});

	test('trocar inverte o tema que está na tela', () => {
		expect(nextTheme('claro', true)).toBe('escuro');
		expect(nextTheme('escuro', false)).toBe('claro');
		// Sem escolha salva, o que está na tela é o do sistema.
		expect(nextTheme(null, true)).toBe('claro');
		expect(nextTheme(null, false)).toBe('escuro');
	});
});

describe('barra lateral', () => {
	test('recolhida só com o valor exato', () => {
		expect(parseCollapsed('recolhida')).toBe(true);
		expect(parseCollapsed('aberta')).toBe(false);
		expect(parseCollapsed(undefined)).toBe(false);
	});
});

describe('idioma ativo', () => {
	test('usa o do cookie se ele é um idioma de estudo', () => {
		expect(resolveActiveLanguage('it', ['en', 'it'])).toBe('it');
		expect(resolveActiveLanguage('IT', ['en', 'it'])).toBe('it');
	});

	test('cookie ausente, inválido ou fora dos idiomas de estudo cai no primeiro', () => {
		expect(resolveActiveLanguage(undefined, ['en', 'it'])).toBe('en');
		expect(resolveActiveLanguage('xx', ['it', 'en'])).toBe('it');
		expect(resolveActiveLanguage('es', ['en', 'it'])).toBe('en');
	});
});

describe('adicionar idioma', () => {
	test('acrescenta no fim, sem repetir', () => {
		expect(addStudyLanguage(['en', 'it'], 'es', 'pt')).toEqual(['en', 'it', 'es']);
		expect(addStudyLanguage(['en'], 'FR', 'pt')).toEqual(['en', 'fr']);
	});

	test('recusa idioma fora da lista, já presente ou igual à língua nativa', () => {
		expect(addStudyLanguage(['en'], 'xx', 'pt')).toBeNull();
		expect(addStudyLanguage(['en', 'it'], 'it', 'pt')).toBeNull();
		expect(addStudyLanguage(['en'], 'pt', 'pt')).toBeNull();
		expect(addStudyLanguage(['en'], null, 'pt')).toBeNull();
	});
});

describe('cookieString', () => {
	test('vale para o site todo por um ano', () => {
		expect(cookieString('tema', 'escuro')).toBe(
			'tema=escuro; Path=/; Max-Age=31536000; SameSite=Lax'
		);
	});
});
