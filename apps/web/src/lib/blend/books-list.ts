// Lista do GET /api/v1/sync/books (CONTRACT §13): linhas do banco (api_sync_books) →
// entradas do contrato, com o nome único do arquivo e a URL assinada.

import { uniqueFileNames } from './filename.ts';

export interface BookListRow {
	id: string;
	title: string;
	author: string;
	book_language: string;
	language: string;
	updated_at: string;
	version: number;
	size: number;
	ko_hash: string;
	path: string;
	progress: {
		spine: number;
		chapterPercent: number;
		percent: number;
		at: string;
		source: 'device' | 'web';
	} | null;
}

const iso = (s: string) => new Date(s).toISOString();

/** Livro sem URL assinada fica de fora (o aparelho tenta no próximo sync). */
export function bookListEntries(rows: readonly BookListRow[], urls: ReadonlyMap<string, string>) {
	const files = uniqueFileNames(
		rows.map((r) => ({ title: r.title, bookLanguage: r.book_language, language: r.language }))
	);
	return rows.flatMap((r, i) => {
		const downloadUrl = urls.get(r.path);
		if (!downloadUrl) return [];
		return [
			{
				id: r.id,
				title: r.title,
				author: r.author,
				bookLanguage: r.book_language,
				language: r.language,
				file: files[i],
				version: r.version,
				size: r.size,
				koHash: r.ko_hash,
				downloadUrl,
				updatedAt: iso(r.updated_at),
				progress: r.progress
					? {
							spine: r.progress.spine,
							chapterPercent: Math.round(r.progress.chapterPercent * 10) / 10,
							percent: Math.round(r.progress.percent * 10) / 10,
							at: iso(r.progress.at),
							source: r.progress.source
						}
					: null
			}
		];
	});
}
