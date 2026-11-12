import { describe, expect, test } from 'bun:test';
import { whisperLanguage } from './languages';

describe('whisperLanguage', () => {
	test('usa só a subtag principal', () => {
		expect(whisperLanguage('it')).toBe('italian');
		expect(whisperLanguage('pt-BR')).toBe('portuguese');
		expect(whisperLanguage('es_419')).toBe('spanish');
		expect(whisperLanguage('zh-Hant-TW')).toBe('chinese');
		expect(whisperLanguage(' EN-us ')).toBe('english');
	});

	test('códigos que o BCP 47 escreve diferente', () => {
		expect(whisperLanguage('nb-NO')).toBe('norwegian');
		expect(whisperLanguage('nn')).toBe('nynorsk');
		expect(whisperLanguage('jv')).toBe('javanese');
		expect(whisperLanguage('fil')).toBe('tagalog');
		expect(whisperLanguage('iw')).toBe('hebrew');
		expect(whisperLanguage('haw')).toBe('hawaiian');
		expect(whisperLanguage('ht')).toBe('haitiancreole');
	});

	test('desconhecido ou vazio deixa o Whisper detectar', () => {
		expect(whisperLanguage('')).toBeUndefined();
		expect(whisperLanguage(null)).toBeUndefined();
		expect(whisperLanguage(undefined)).toBeUndefined();
		expect(whisperLanguage('und')).toBeUndefined();
		expect(whisperLanguage('tlh')).toBeUndefined();
		expect(whisperLanguage('constructor')).toBeUndefined();
	});
});
