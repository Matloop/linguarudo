// EPUB aberto na memória (fflate): container → OPF → metadados, spine e títulos do
// sumário. Escrever de volta mantém a ordem e os bytes de todo arquivo que não mudou; o
// mimetype vai primeiro e sem compressão, como pede o OCF.

import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { decodeText } from './xhtml.ts';

export interface SpineItem {
	/** Índice no spine (o `spine` do contrato). */
	index: number;
	/** Caminho dentro do zip. */
	path: string;
	mediaType: string;
	/** Documento de navegação (sumário do EPUB 3): nunca recebe blend. */
	nav: boolean;
}

export interface Epub {
	files: Record<string, Uint8Array>;
	opfPath: string;
	title: string;
	author: string;
	/** dc:language como veio (pode não ser BCP 47 válido). */
	language: string;
	spine: SpineItem[];
	/** Caminho → título no sumário (nav do EPUB 3 ou NCX). */
	tocTitles: Map<string, string>;
}

export class EpubError extends Error {}

function attr(tag: string, name: string): string | null {
	const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
	return m ? decodeText(m[2] ?? m[3] ?? '') : null;
}

function dirOf(path: string): string {
	const i = path.lastIndexOf('/');
	return i < 0 ? '' : path.slice(0, i + 1);
}

/** Resolve um href relativo a um arquivo do zip (sem o #fragmento). */
export function resolvePath(base: string, href: string): string {
	let h = href.split('#')[0];
	try {
		h = decodeURIComponent(h);
	} catch {
		/* href com % solto: usa como veio */
	}
	const parts = (dirOf(base) + h).split('/');
	const out: string[] = [];
	for (const p of parts) {
		if (p === '..') out.pop();
		else if (p !== '.' && p !== '') out.push(p);
	}
	return out.join('/');
}

const stripTags = (s: string) => decodeText(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

function firstText(opf: string, tag: string): string {
	const m = new RegExp(`<(?:[a-z]+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:[a-z]+:)?${tag}>`, 'i').exec(opf);
	return m ? stripTags(m[1]) : '';
}

export function openEpub(bytes: Uint8Array): Epub {
	let files: Record<string, Uint8Array>;
	try {
		files = unzipSync(bytes);
	} catch {
		throw new EpubError('O arquivo não é um EPUB (zip) válido.');
	}
	const container = files['META-INF/container.xml'];
	if (!container) throw new EpubError('EPUB sem META-INF/container.xml.');
	const rootfile = /<(?:[a-z]+:)?rootfile\b[^>]*>/i.exec(strFromU8(container));
	const opfPath = rootfile ? attr(rootfile[0], 'full-path') : null;
	if (!opfPath || !files[opfPath]) throw new EpubError('EPUB sem o arquivo OPF.');
	const opf = strFromU8(files[opfPath]);

	const metadata = /<(?:[a-z]+:)?metadata\b[\s\S]*?<\/(?:[a-z]+:)?metadata>/i.exec(opf)?.[0] ?? opf;
	const title = firstText(metadata, 'title');
	const author = firstText(metadata, 'creator');
	const language = firstText(metadata, 'language');

	const manifest = new Map<string, { path: string; mediaType: string; properties: string }>();
	for (const m of opf.matchAll(/<(?:[a-z]+:)?item\b[^>]*>/gi)) {
		const id = attr(m[0], 'id');
		const href = attr(m[0], 'href');
		if (!id || !href) continue;
		manifest.set(id, {
			path: resolvePath(opfPath, href),
			mediaType: attr(m[0], 'media-type') ?? '',
			properties: attr(m[0], 'properties') ?? ''
		});
	}

	const spineTag = /<(?:[a-z]+:)?spine\b[^>]*>/i.exec(opf)?.[0] ?? '';
	const spine: SpineItem[] = [];
	for (const m of opf.matchAll(/<(?:[a-z]+:)?itemref\b[^>]*>/gi)) {
		const item = manifest.get(attr(m[0], 'idref') ?? '');
		if (!item || !files[item.path]) continue;
		spine.push({
			index: spine.length,
			path: item.path,
			mediaType: item.mediaType,
			nav: /\bnav\b/.test(item.properties)
		});
	}
	if (spine.length === 0) throw new EpubError('EPUB sem capítulos no spine.');

	const tocTitles = new Map<string, string>();
	const setTitle = (path: string, label: string) => {
		if (label && !tocTitles.has(path)) tocTitles.set(path, label);
	};
	const navItem = [...manifest.values()].find((i) => /\bnav\b/.test(i.properties));
	if (navItem && files[navItem.path]) {
		const nav = strFromU8(files[navItem.path]);
		const toc =
			/<nav\b[^>]*epub:type\s*=\s*["'][^"']*\btoc\b[^"']*["'][^>]*>[\s\S]*?<\/nav>/i.exec(nav)?.[0] ??
			nav;
		for (const a of toc.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)) {
			const href = attr(a[0].slice(0, a[0].indexOf('>') + 1), 'href');
			if (href) setTitle(resolvePath(navItem.path, href), stripTags(a[1]));
		}
	}
	const ncxId = attr(spineTag, 'toc');
	const ncx =
		(ncxId ? manifest.get(ncxId) : undefined) ??
		[...manifest.values()].find((i) => i.mediaType === 'application/x-dtbncx+xml');
	if (ncx && files[ncx.path]) {
		const text = strFromU8(files[ncx.path]);
		for (const p of text.matchAll(
			/<navLabel\b[^>]*>\s*<text\b[^>]*>([\s\S]*?)<\/text>\s*<\/navLabel>\s*<content\b[^>]*>/gi
		)) {
			const src = attr(p[0].slice(p[0].lastIndexOf('<content')), 'src');
			if (src) setTitle(resolvePath(ncx.path, src), stripTags(p[1]));
		}
	}

	return { files, opfPath, title, author, language, spine, tocTitles };
}

export function readText(epub: Epub, path: string): string {
	return strFromU8(epub.files[path]);
}

/** O EPUB com os arquivos trocados; o mimetype primeiro e guardado sem compressão. */
export function writeEpub(epub: Epub, changed: ReadonlyMap<string, string>): Uint8Array {
	const out: Zippable = {};
	if (epub.files.mimetype) out.mimetype = [epub.files.mimetype, { level: 0 }];
	else out.mimetype = [strToU8('application/epub+zip'), { level: 0 }];
	for (const [path, data] of Object.entries(epub.files)) {
		if (path === 'mimetype' || path.endsWith('/')) continue;
		const next = changed.get(path);
		out[path] = next === undefined ? data : strToU8(next);
	}
	return zipSync(out, { level: 6, mtime: new Date('2026-01-01T00:00:00Z') });
}
