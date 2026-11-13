import { describe, expect, test } from 'bun:test';
import fixture from '../../../../../docs/sync/fixtures/books.response.json';
import { bookFileName, cleanTitle, uniqueFileNames } from './filename.ts';

describe('nome do arquivo', () => {
	test('bate com o fixture', () => {
		const names = uniqueFileNames(
			fixture.books.map((b) => ({ title: b.title, bookLanguage: b.bookLanguage, language: b.language }))
		);
		expect(names).toEqual(fixture.books.map((b) => b.file));
	});

	test('limpa caracteres proibidos e controles', () => {
		expect(cleanTitle('A/B\\C:D*E?F"G<H>I|J\u0007K')).toBe('A B C D E F G H I J K');
	});

	test('corta em 80 code points', () => {
		const title = '🙂'.repeat(100);
		expect([...cleanTitle(title)]).toHaveLength(80);
	});

	test('par usa o primeiro subtag de cada língua', () => {
		expect(bookFileName('Dom Casmurro', 'pt-BR', 'zh-Hant')).toBe('Dom Casmurro.PT-ZH.epub');
	});

	test('título vazio vira Livro', () => {
		expect(bookFileName('???', 'en', 'it')).toBe('Livro.EN-IT.epub');
	});

	test('colisão ganha (2) antes do par', () => {
		const names = uniqueFileNames([
			{ title: 'Emma', bookLanguage: 'en', language: 'it' },
			{ title: 'emma', bookLanguage: 'en', language: 'it' },
			{ title: 'Emma', bookLanguage: 'en', language: 'fr' },
			{ title: 'Emma', bookLanguage: 'en', language: 'it' }
		]);
		expect(names).toEqual([
			'Emma.EN-IT.epub',
			'emma (2).EN-IT.epub',
			'Emma.EN-FR.epub',
			'Emma (3).EN-IT.epub'
		]);
	});
});
