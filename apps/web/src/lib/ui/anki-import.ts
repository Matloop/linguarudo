// Import do Anki no navegador: abre o pacote (sql.js em WebAssembly), sobe a mídia
// citada pelas notas e manda as notas em lotes para /flashcards/importar/lote.

import { resolve } from '$app/paths';
import { IMPORT_BATCH_SIZE } from '#lib/anki/batch.ts';
import type { ImportNote } from '#lib/anki/mapping.ts';
import { readPackage, type AnkiPackage } from '#lib/anki/package.ts';
import type { Language } from '#lib/languages.ts';
import { isAudioName, isImageName } from '#lib/media.ts';
import { MediaError, prepareMedia, uploadMedia } from './media-upload.ts';

export async function openAnkiPackage(file: File): Promise<AnkiPackage> {
	const [{ default: initSqlJs }, { default: wasmUrl }] = await Promise.all([
		import('sql.js'),
		import('sql.js/dist/sql-wasm-browser.wasm?url')
	]);
	const SQL = await initSqlJs({ locateFile: () => wasmUrl });
	return readPackage(new Uint8Array(await file.arrayBuffer()), SQL);
}

export interface MediaUploadReport {
	/** Nome no pacote → caminho no bucket (ou null se não subiu). */
	paths: Map<string, string | null>;
	uploaded: number;
	/** Arquivos que não subiram por formato, tamanho ou erro. */
	failed: number;
	/** A cota acabou no meio: o resto ficou sem mídia. */
	quota: boolean;
}

export async function uploadPackageMedia(
	userId: string,
	pkg: AnkiPackage,
	names: Iterable<string>,
	onProgress: (done: number, total: number) => void
): Promise<MediaUploadReport> {
	const list = [...names];
	const report: MediaUploadReport = { paths: new Map(), uploaded: 0, failed: 0, quota: false };
	let done = 0;
	// Poucos em paralelo: imagem é convertida no canvas e isso pesa.
	const queue = [...list];
	const worker = async () => {
		for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
			let path: string | null = null;
			if (!report.quota) {
				try {
					const kind = isImageName(name) ? 'image' : isAudioName(name) ? 'audio' : null;
					if (kind) {
						const blob = new Blob([pkg.media.get(name)!() as BlobPart]);
						path = await uploadMedia(userId, await prepareMedia(kind, blob, name));
						report.uploaded++;
					}
				} catch (e) {
					if (e instanceof MediaError && e.code === 'quota') report.quota = true;
				}
			}
			if (!path) report.failed++;
			report.paths.set(name, path);
			onProgress(++done, list.length);
		}
	};
	await Promise.all(Array.from({ length: 4 }, worker));
	if (report.quota) report.failed = list.length - report.uploaded;
	return report;
}

/** Troca nomes do pacote pelos caminhos no bucket; o que não subiu fica sem mídia. */
export function withMediaPaths(note: ImportNote, paths: Map<string, string | null>): ImportNote {
	const p = (name: string | null) => (name ? (paths.get(name) ?? null) : null);
	if (note.type === 'item') return { ...note, image: p(note.image), audio: p(note.audio) };
	return {
		...note,
		front_image: p(note.front_image),
		front_audio: p(note.front_audio),
		back_image: p(note.back_image),
		back_audio: p(note.back_audio)
	};
}

export interface ImportTotals {
	items: number;
	fichas: number;
	scheduled: number;
}

export async function sendImport(
	language: Language,
	notes: ImportNote[],
	onProgress: (done: number, total: number) => void
): Promise<ImportTotals> {
	const totals: ImportTotals = { items: 0, fichas: 0, scheduled: 0 };
	for (let i = 0; i < notes.length; i += IMPORT_BATCH_SIZE) {
		const batch = notes.slice(i, i + IMPORT_BATCH_SIZE);
		const res = await fetch(resolve('/flashcards/importar/lote'), {
			method: 'POST',
			headers: { 'content-type': 'application/json', accept: 'application/json' },
			body: JSON.stringify({ language, notes: batch })
		});
		if (!res.ok) {
			const body = (await res.json().catch(() => null)) as { message?: string } | null;
			throw new Error(body?.message ?? 'Não deu para importar agora.');
		}
		const r = (await res.json()) as ImportTotals;
		totals.items += r.items;
		totals.fichas += r.fichas;
		totals.scheduled += r.scheduled;
		onProgress(Math.min(i + batch.length, notes.length), notes.length);
	}
	return totals;
}
