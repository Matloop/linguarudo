// Imagem sugerida para a palavra. A IA grátis não desenha: ela só escreve uma busca curta
// em inglês que mostre o sentido da palavra, e as fotos vêm do Wikimedia Commons (livre,
// sem chave). Quem escolhe a foto é a pessoa; o navegador baixa a escolhida e sobe para o
// Storage pelo mesmo caminho de um arquivo enviado.

import { languageName } from '@linguetta/language';
import { LIMITS } from '#lib/items.ts';
import { parseLanguage, type Language } from '#lib/languages.ts';
import type { AiChain, JsonRequest } from './ai.ts';

const API = 'https://commons.wikimedia.org/w/api.php';
const USER_AGENT = 'Linguetta/1.0 (image suggestions)';
const TIMEOUT_MS = 6000;

/** Fotos devolvidas e quantas pedir ao Commons (sobra para o filtro). */
export const MAX_IMAGES = 6;
const SEARCH_LIMIT = 12;
/** Largura pedida da miniatura; o Commons arredonda para o tamanho padrão mais próximo. */
const THUMB_WIDTH = 400;
/** Busca digitada ou da IA: até 4 palavras, como no prompt; o resto é cortado. */
export const QUERY_LIMITS = { words: 4, chars: 80 } as const;
/** Lado menor mínimo do original e a proporção aceita (largura / altura). */
const MIN_SIDE = 240;
const MIN_RATIO = 0.5;
const MAX_RATIO = 2.2;
const MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
/** Hosts de onde o navegador baixa a foto (os dois mandam Access-Control-Allow-Origin: *). */
const IMAGE_HOSTS = new Set(['thumb.wikimedia.org', 'upload.wikimedia.org']);

export interface ImageRequest {
	language: Language;
	lemma: string;
	sense: string;
	sentence: string;
	/** Busca já escrita pela pessoa: pula a IA. Vazia: a IA escreve. */
	query: string;
}

export interface ImageHit {
	/** Miniatura (~400 px) para a grade. */
	thumb: string;
	/** Versão maior (~960 px) que o navegador baixa e converte em WebP. */
	url: string;
	/** Título do arquivo, sem "File:" e sem extensão. */
	title: string;
	/** Página do arquivo no Commons (autor e licença). */
	page: string;
}

export interface ImageSuggestion {
	query: string;
	images: ImageHit[];
}

type Fetch = typeof globalThis.fetch;

/** Corta em code points, sem partir emoji ou caractere fora do BMP. */
function cap(s: string, max: number): string {
	return [...s].slice(0, max).join('');
}

function clean(value: unknown): string {
	return typeof value === 'string' ? value.normalize('NFC').replace(/\s+/g, ' ').trim() : '';
}

/**
 * Normaliza a busca: sem aspas nem operadores do CirrusSearch (o filetype quem põe somos
 * nós), até 4 palavras. Vazia se não sobrar nada.
 */
export function normalizeQuery(value: unknown): string {
	const words = clean(value)
		.split(' ')
		.filter((w) => !w.startsWith('-') && !w.includes(':'))
		.flatMap((w) => w.replace(/[^\p{L}\p{M}\p{N}'-]/gu, ' ').split(' '))
		.filter(Boolean)
		.slice(0, QUERY_LIMITS.words);
	return cap(words.join(' '), QUERY_LIMITS.chars).trim();
}

/** Valida o corpo do POST; devolve o pedido ou a mensagem de erro (400). */
export function parseImageRequest(body: unknown): ImageRequest | { error: string } {
	if (!body || typeof body !== 'object') return { error: 'Corpo inválido.' };
	const b = body as Record<string, unknown>;
	const language = parseLanguage(b.language);
	if (!language) return { error: 'Idioma inválido.' };
	for (const key of ['lemma', 'sense', 'sentence', 'query'] as const) {
		if (b[key] != null && typeof b[key] !== 'string') return { error: 'Corpo inválido.' };
	}
	const lemma = clean(b.lemma);
	const query = normalizeQuery(b.query);
	if (!lemma && !query) return { error: 'Digite a palavra.' };
	if ([...lemma].length > LIMITS.lemma) {
		return { error: `Use no máximo ${LIMITS.lemma} caracteres.` };
	}
	return {
		language,
		lemma,
		sense: cap(clean(b.sense), LIMITS.sense),
		sentence: cap(clean(b.sentence), LIMITS.sentence),
		query
	};
}

export const QUERY_SCHEMA = {
	type: 'object',
	properties: { query: { type: 'string' } },
	required: ['query'],
	additionalProperties: false
};

/** O pedido para a cadeia de IA: a busca em inglês, já normalizada. */
export function imageQueryRequest(req: ImageRequest): JsonRequest<string> {
	const target = languageName(req.language, 'en');
	const system = `You pick a search query for a stock photo that illustrates a ${target} word on a learner's flashcard. Return:
- query: 1 to 4 English words naming something concrete that a photo or illustration can show, so that seeing it recalls the word's meaning. For a concrete noun, the thing itself ("letto" -> "bed"; "cioccolato" -> "chocolate bar"). For a verb, adjective or abstract word, a typical scene that shows it ("correre" -> "man running"; "felice" -> "smiling child"; "modulo" as a form to fill -> "paper form"). Use the meaning in the sentence when there is one. No quotes, no punctuation, no search operators.`;
	const user = `Language: ${target} (${req.language})
Word: ${req.lemma}${req.sense ? `\nMeaning: ${req.sense}` : ''}${req.sentence ? `\nSentence: ${req.sentence}` : ''}`;
	return {
		system,
		user,
		schema: QUERY_SCHEMA,
		schemaName: 'image_query',
		maxTokens: 800,
		parse: parseQuery
	};
}

/** Saída do modelo → busca; null se vazia (malformada). */
export function parseQuery(data: unknown): string | null {
	if (!data || typeof data !== 'object') return null;
	return normalizeQuery((data as Record<string, unknown>).query) || null;
}

/** URL da busca de arquivos de imagem no Commons, com a miniatura já calculada. */
export function commonsImageSearchUrl(query: string): string {
	const url = new URL(API);
	url.search = new URLSearchParams({
		action: 'query',
		format: 'json',
		formatversion: '2',
		origin: '*',
		generator: 'search',
		gsrnamespace: '6',
		gsrlimit: String(SEARCH_LIMIT),
		gsrsearch: `${query} filetype:bitmap`,
		prop: 'imageinfo',
		iiprop: 'url|mime|size',
		iiurlwidth: String(THUMB_WIDTH)
	}).toString();
	return url.href;
}

export type CommonsImagePage = {
	title: string;
	/** Posição no resultado da busca (o generator não devolve em ordem). */
	index?: number;
	imageinfo?: {
		url?: string;
		descriptionurl?: string;
		mime?: string;
		width?: number;
		height?: number;
		thumburl?: string;
		/** Versões maiores da miniatura: { '1.5': url, '2': url }. */
		responsiveUrls?: Record<string, string>;
	}[];
};

function wikimediaUrl(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	try {
		const url = new URL(value);
		return url.protocol === 'https:' && IMAGE_HOSTS.has(url.hostname) ? url.href : null;
	} catch {
		return null;
	}
}

function fileTitle(title: string): string {
	return title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '');
}

/**
 * As fotos que servem, na ordem da busca: JPEG/PNG/WebP, sem miniatura minúscula nem
 * proporção estranha (panorama, tira), só de hosts do Wikimedia. Até MAX_IMAGES.
 */
export function pickImages(pages: CommonsImagePage[]): ImageHit[] {
	const hits: ImageHit[] = [];
	const sorted = [...pages].sort((a, b) => (a.index ?? Infinity) - (b.index ?? Infinity));
	for (const p of sorted) {
		const info = p.imageinfo?.[0];
		if (!info || !MIMES.has(info.mime ?? '')) continue;
		const { width = 0, height = 0 } = info;
		if (Math.min(width, height) < MIN_SIDE) continue;
		const ratio = width / height;
		if (ratio < MIN_RATIO || ratio > MAX_RATIO) continue;
		const thumb = wikimediaUrl(info.thumburl);
		const large = wikimediaUrl(info.responsiveUrls?.['2'] ?? info.responsiveUrls?.['1.5']);
		if (!thumb) continue;
		hits.push({
			thumb,
			url: large ?? thumb,
			title: fileTitle(p.title),
			page:
				info.descriptionurl ??
				`https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`
		});
		if (hits.length === MAX_IMAGES) break;
	}
	return hits;
}

/** Erro do Commons (rede, HTTP, JSON); a rota responde 502. */
export class CommonsError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = 'CommonsError';
	}
}

/** Busca fotos no Commons. Nenhum resultado é lista vazia; falha é CommonsError. */
export async function searchCommonsImages(
	query: string,
	fetch: Fetch = globalThis.fetch
): Promise<ImageHit[]> {
	let res: Response;
	try {
		res = await fetch(commonsImageSearchUrl(query), {
			headers: { 'User-Agent': USER_AGENT },
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
	} catch (e) {
		throw new CommonsError(`Commons sem resposta: ${String(e)}`, { cause: e });
	}
	if (!res.ok) throw new CommonsError(`Commons HTTP ${res.status}`);
	let body: { query?: { pages?: CommonsImagePage[] } };
	try {
		body = await res.json();
	} catch (e) {
		throw new CommonsError('Commons: resposta não é JSON', { cause: e });
	}
	return pickImages(body?.query?.pages ?? []);
}

/** Busca da pessoa ou da IA, e as fotos dela. Erros: AiError ou CommonsError. */
export async function suggestImages(
	ai: AiChain,
	req: ImageRequest,
	fetch: Fetch = globalThis.fetch
): Promise<ImageSuggestion> {
	const query = req.query || (await ai.json(imageQueryRequest(req)));
	return { query, images: await searchCommonsImages(query, fetch) };
}
