// Livros com blend no servidor: registrar o EPUB enviado, pedir as candidatas de um pedaço
// à IA, montar uma versão e apagar. Tudo com o cliente da sessão (RLS do dono); o original
// fica no Storage e é baixado de novo a cada função fria (cache curto entre pedidos).

import type { SupabaseClient } from '@supabase/supabase-js';
import { countWords } from '@linguetta/language';
import {
	buildBlend,
	chapterDoc,
	chapterInfos,
	chapterParts,
	partWords,
	wantedCandidates,
	type Candidate,
	type ChapterCandidates
} from '#lib/blend/book.ts';
import { EpubError, openEpub, type Epub } from '#lib/blend/epub.ts';
import { koHash } from '#lib/blend/kohash.ts';
import type { Database, Json } from '#lib/database.types.ts';
import { parseLanguage, type Language } from '#lib/languages.ts';
import type { AiChain } from './ai.ts';
import { partRequest } from './book-ai.ts';

type Client = SupabaseClient<Database>;
export type BookRow = Database['public']['Tables']['books']['Row'];

export const BOOKS_BUCKET = 'books';
export const EPUB_TYPE = 'application/epub+zip';
export const MAX_EPUB_BYTES = 50 * 1024 * 1024;

export class BookError extends Error {
	constructor(
		message: string,
		readonly status = 400
	) {
		super(message);
	}
}

export const originalPath = (userId: string, bookId: string) =>
	`${userId}/${bookId}/original.epub`;
export const versionPath = (userId: string, bookId: string, version: number) =>
	`${userId}/${bookId}/v${version}.epub`;

// ---------- Original ----------

/** Último original aberto: as chamadas por pedaço do mesmo livro reaproveitam. */
let cached: { path: string; size: number; epub: Epub } | null = null;

async function download(supabase: Client, path: string): Promise<Uint8Array> {
	const { data, error } = await supabase.storage.from(BOOKS_BUCKET).download(path);
	if (error || !data) throw new BookError('Não deu para baixar o arquivo do livro.', 502);
	return new Uint8Array(await data.arrayBuffer());
}

export async function loadOriginal(supabase: Client, book: BookRow): Promise<Epub> {
	if (cached && cached.path === book.original_path && cached.size === book.original_size) {
		return cached.epub;
	}
	const epub = openEpub(await download(supabase, book.original_path));
	cached = { path: book.original_path, size: book.original_size, epub };
	return epub;
}

// ---------- Registrar ----------

/**
 * O navegador já subiu o original em <user>/<id>/original.epub: abre, lê metadados e
 * capítulos e cria o livro. EPUB inválido apaga o arquivo enviado.
 */
export async function registerBook(
	supabase: Client,
	userId: string,
	id: string,
	opts: { language: Language; fallbackLanguage: Language }
): Promise<string> {
	const path = originalPath(userId, id);
	const bytes = await download(supabase, path);
	let epub: Epub;
	try {
		epub = openEpub(bytes);
	} catch (e) {
		await supabase.storage.from(BOOKS_BUCKET).remove([path]);
		throw e instanceof EpubError ? new BookError(e.message) : e;
	}
	const bookLanguage = parseLanguage(epub.language) ?? opts.fallbackLanguage;
	const chapters = chapterInfos(epub, bookLanguage);
	if (!chapters.some((c) => c.words > 0)) {
		await supabase.storage.from(BOOKS_BUCKET).remove([path]);
		throw new BookError('Não achei texto nos capítulos deste EPUB.');
	}
	const title = [...(epub.title || 'Sem título').replace(/\s+/g, ' ').trim()].slice(0, 200).join('');
	const author = [...epub.author.replace(/\s+/g, ' ').trim()].slice(0, 200).join('');
	const { error } = await supabase.rpc('create_book', {
		p_id: id,
		p_title: title,
		p_author: author,
		p_book_language: bookLanguage,
		p_language: opts.language,
		p_original_size: bytes.length,
		p_chapters: chapters as unknown as Json
	});
	if (error) {
		await supabase.storage.from(BOOKS_BUCKET).remove([path]);
		throw new BookError('Não deu para guardar o livro agora.', 500);
	}
	cached = { path, size: bytes.length, epub };
	return id;
}

// ---------- Candidatas ----------

export function readCandidates(raw: Json | null, coverage: number): ChapterCandidates | null {
	const c = raw as unknown as ChapterCandidates | null;
	if (!c || typeof c !== 'object' || typeof c.parts !== 'number' || !c.byPart) return null;
	return Math.abs(c.coverage - coverage) < 1e-6 ? c : null;
}

export interface PartResult {
	spine: number;
	part: number;
	parts: number;
	done: boolean;
}

/**
 * Pede à IA o próximo pedaço que falta do capítulo e guarda. Capítulo sem texto fecha
 * na hora. Erro da IA sobe (a rota traduz); o que já veio fica guardado.
 */
export async function runPart(
	supabase: Client,
	ai: AiChain,
	book: BookRow,
	spine: number
): Promise<PartResult> {
	const { data: row, error } = await supabase
		.from('book_chapters')
		.select('spine, status, candidates')
		.eq('book_id', book.id)
		.eq('spine', spine)
		.maybeSingle();
	if (error) throw new BookError('Não deu para ler o capítulo.', 500);
	if (!row) throw new BookError('Capítulo não encontrado.', 404);

	const epub = await loadOriginal(supabase, book);
	const item = epub.spine[spine];
	const doc = item ? chapterDoc(epub, item) : null;
	const words = doc ? doc.paragraphs.map((p) => countWords(p.text, book.book_language)) : [];
	const ranges = chapterParts(words, partWords(book.coverage));

	const stored = readCandidates(row.candidates, book.coverage);
	let saved: ChapterCandidates =
		stored && stored.parts === ranges.length
			? stored
			: { parts: ranges.length, done: 0, coverage: book.coverage, byPart: {} };
	const next = ranges.findIndex((_, i) => !saved.byPart[String(i)]);
	if (next >= 0 && doc) {
		const [from, to] = ranges[next];
		const paragraphs = doc.paragraphs
			.slice(from, to)
			.map((p, k) => ({ para: from + k, text: p.text }))
			.filter((p) => countWords(p.text, book.book_language) >= 3);
		const partWordCount = words.slice(from, to).reduce((a, b) => a + b, 0);
		let candidates: Candidate[] = [];
		if (paragraphs.length > 0) {
			candidates = await ai.json(
				partRequest({
					bookLanguage: book.book_language,
					language: book.language,
					paragraphs,
					wanted: wantedCandidates(partWordCount, book.coverage)
				})
			);
		}
		const byPart = { ...saved.byPart, [String(next)]: candidates };
		saved = { ...saved, byPart, done: Object.keys(byPart).length };
	}
	const done = saved.done >= saved.parts;
	const { error: saveError } = await supabase
		.from('book_chapters')
		.update({
			candidates: saved as unknown as Json,
			status: done ? 'feito' : 'pendente',
			error: null
		})
		.eq('book_id', book.id)
		.eq('spine', spine);
	if (saveError) throw new BookError('Não deu para guardar o progresso.', 500);
	return { spine, part: next < 0 ? saved.parts : next + 1, parts: saved.parts, done };
}

export async function markChapterError(
	supabase: Client,
	bookId: string,
	spine: number,
	message: string
) {
	await supabase
		.from('book_chapters')
		.update({ status: 'erro', error: message.slice(0, 500) })
		.eq('book_id', bookId)
		.eq('spine', spine);
}

/** Língua ou cobertura mudou: as candidatas guardadas não servem mais. */
export async function resetCandidates(supabase: Client, bookId: string) {
	await supabase
		.from('book_chapters')
		.update({ status: 'pendente', candidates: null, error: null })
		.eq('book_id', bookId);
}

// ---------- Versão ----------

/** Lemas do banco do usuário no idioma do blend: entram primeiro na escolha. */
async function bankLemmas(supabase: Client, userId: string, language: string): Promise<string[]> {
	const { data } = await supabase
		.from('items')
		.select('lemma')
		.eq('user_id', userId)
		.eq('language', language)
		.is('deleted_at', null)
		.limit(5000);
	return (data ?? []).map((r) => r.lemma);
}

export interface VersionResult {
	version: number;
	links: number;
	size: number;
	koHash: string;
}

/**
 * Gera o EPUB inteiro com blend nos capítulos prontos do intervalo e troca a versão atual.
 * As linhas das versões velhas ficam (o koHash de um arquivo antigo no aparelho ainda acha
 * o livro); os arquivos velhos saem do Storage.
 */
export async function buildVersion(
	supabase: Client,
	userId: string,
	book: BookRow
): Promise<VersionResult> {
	const [{ data: chapters, error }, { data: versions }, prefer] = await Promise.all([
		supabase
			.from('book_chapters')
			.select('spine, status, candidates')
			.eq('book_id', book.id)
			.gte('spine', book.range_from)
			.lte('spine', book.range_to)
			.order('spine'),
		supabase.from('book_versions').select('version, path').eq('book_id', book.id),
		bankLemmas(supabase, userId, book.language)
	]);
	if (error) throw new BookError('Não deu para ler os capítulos.', 500);
	const ready = (chapters ?? []).flatMap((c) => {
		const saved = c.status === 'feito' ? readCandidates(c.candidates, book.coverage) : null;
		return saved ? [{ spine: c.spine, candidates: Object.values(saved.byPart).flat() }] : [];
	});
	if (ready.length === 0) throw new BookError('Nenhum capítulo do intervalo está pronto ainda.');

	const epub = await loadOriginal(supabase, book);
	const { bytes, links } = buildBlend(epub, ready, {
		bookLanguage: book.book_language,
		language: book.language,
		coverage: book.coverage,
		preferWords: prefer
	});
	const version = Math.max(0, ...(versions ?? []).map((v) => v.version)) + 1;
	const path = versionPath(userId, book.id, version);
	const hash = koHash(bytes);

	const { error: upError } = await supabase.storage
		.from(BOOKS_BUCKET)
		.upload(path, new Blob([bytes as BlobPart], { type: EPUB_TYPE }), {
			contentType: EPUB_TYPE,
			upsert: true
		});
	if (upError) throw new BookError('Não deu para guardar o livro gerado.', 502);
	const { error: insError } = await supabase.from('book_versions').insert({
		book_id: book.id,
		user_id: userId,
		version,
		path,
		ko_hash: hash,
		size: bytes.length
	});
	if (insError) {
		await supabase.storage.from(BOOKS_BUCKET).remove([path]);
		throw new BookError('Não deu para registrar a versão.', 500);
	}
	await supabase.from('books').update({ current_version: version }).eq('id', book.id);
	const old = (versions ?? []).map((v) => v.path).filter((p) => p !== path);
	if (old.length) await supabase.storage.from(BOOKS_BUCKET).remove(old);
	return { version, links, size: bytes.length, koHash: hash };
}

// ---------- Apagar ----------

/** Apaga o livro e os arquivos dele; a obra e os encontros ficam. */
export async function deleteBook(supabase: Client, userId: string, bookId: string) {
	const folder = `${userId}/${bookId}`;
	const { data: files } = await supabase.storage.from(BOOKS_BUCKET).list(folder, { limit: 1000 });
	const paths = (files ?? []).map((f) => `${folder}/${f.name}`);
	if (paths.length) await supabase.storage.from(BOOKS_BUCKET).remove(paths);
	const { error } = await supabase.from('books').delete().eq('id', bookId);
	if (error) throw new BookError('Não deu para apagar o livro.', 500);
	if (cached?.path.startsWith(`${folder}/`)) cached = null;
}

// ---------- Tela ----------

/** O livro da sessão; 404 se não é do usuário. */
export async function requireBook(supabase: Client, id: string): Promise<BookRow> {
	if (!/^[0-9a-f-]{36}$/i.test(id)) throw new BookError('Livro não encontrado.', 404);
	const { data, error } = await supabase.from('books').select('*').eq('id', id).maybeSingle();
	if (error) throw new BookError('Não deu para abrir o livro agora.', 500);
	if (!data) throw new BookError('Livro não encontrado.', 404);
	return data;
}

/** Capítulos para a tela, sem as candidatas (só o contador de pedaços). */
export async function chapterRows(supabase: Client, bookIds: readonly string[]) {
	if (bookIds.length === 0) return [];
	const { data, error } = await supabase
		.from('book_chapters')
		.select('book_id, spine, title, words, status, parts:candidates->parts, done:candidates->done')
		.in('book_id', [...bookIds])
		.order('spine');
	if (error) throw new BookError('Não deu para ler os capítulos.', 500);
	return (data ?? []).map((c) => ({
		bookId: c.book_id,
		spine: c.spine,
		title: c.title,
		words: c.words,
		status: c.status as 'pendente' | 'feito' | 'erro',
		parts: typeof c.parts === 'number' ? c.parts : 0,
		partsDone: typeof c.done === 'number' ? c.done : 0
	}));
}
