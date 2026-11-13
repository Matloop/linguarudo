import { expect, test } from 'bun:test';
import fixture from '../../../../../docs/sync/fixtures/books.response.json';
import { bookListEntries, type BookListRow } from './books-list.ts';

const expected = fixture.books as ReturnType<typeof bookListEntries>;

test('linhas do banco viram a lista do fixture', () => {
	const rows: BookListRow[] = fixture.books.map((b) => ({
		id: b.id,
		title: b.title,
		author: b.author,
		book_language: b.bookLanguage,
		language: b.language,
		updated_at: b.updatedAt.replace('.000Z', '+00:00'),
		version: b.version,
		size: b.size,
		ko_hash: b.koHash,
		path: `u/${b.id}/v${b.version}.epub`,
		progress: b.progress
			? { ...b.progress, at: '2026-11-11T20:40:00+00:00', source: b.progress.source as 'web' }
			: null
	}));
	const urls = new Map(fixture.books.map((b) => [`u/${b.id}/v${b.version}.epub`, b.downloadUrl]));
	expect(bookListEntries(rows, urls)).toEqual(expected);
	// Sem URL assinada, o livro fica de fora.
	expect(bookListEntries(rows, new Map([...urls].slice(1)))).toEqual(expected.slice(1));
});
