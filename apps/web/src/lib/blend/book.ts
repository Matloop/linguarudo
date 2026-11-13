// O livro com blend, do EPUB aberto ao EPUB novo: capítulos, pedaços para a IA, validação
// das candidatas, escolha (select.ts) e inserção dos links (xhtml.ts). Tudo puro: o
// servidor só busca e guarda os bytes.

import { countWords, languageProfile } from '@linguetta/language';
import { blendAnchor } from './link.ts';
import { readText, writeEpub, type Epub, type SpineItem } from './epub.ts';
import { selectSwaps, type Frequency } from './select.ts';
import { parseXhtml, type Replacement, type XhtmlDoc } from './xhtml.ts';

/** O que a IA propõe para um trecho do parágrafo `para` do capítulo. */
export interface Candidate {
	/** Índice do parágrafo no capítulo. */
	para: number;
	/** Trecho exato do texto do livro que sai. */
	form: string;
	/** Palavra ou expressão na língua-alvo que entra, flexionada para caber na frase. */
	target: string;
	/** Forma de dicionário na língua-alvo. */
	lemma: string;
	/** Sentido curto na língua do livro. */
	translation: string;
	note: string;
}

/** Como fica em book_chapters.candidates. */
export interface ChapterCandidates {
	parts: number;
	/** Pedaços já respondidos (para a tela ler sem baixar as candidatas). */
	done: number;
	coverage: number;
	byPart: Record<string, Candidate[]>;
}

export const CANDIDATE_LIMITS = { form: 80, target: 80, lemma: 80, translation: 120, note: 120 };

const XHTML_TYPES = new Set(['application/xhtml+xml', 'text/html', 'application/xml']);

export function isTextChapter(item: SpineItem): boolean {
	return !item.nav && (XHTML_TYPES.has(item.mediaType) || /\.x?html?$/i.test(item.path));
}

export interface ChapterInfo {
	spine: number;
	title: string;
	words: number;
}

const cap = (s: string, max: number) => [...s].slice(0, max).join('').trim();

export function chapterDoc(epub: Epub, item: SpineItem): XhtmlDoc | null {
	return isTextChapter(item) ? parseXhtml(readText(epub, item.path)) : null;
}

/** Título e palavras de cada item do spine (o sumário entra com 0 palavras). */
export function chapterInfos(epub: Epub, bookLanguage: string): ChapterInfo[] {
	return epub.spine.map((item) => {
		const doc = chapterDoc(epub, item);
		const words = doc ? doc.paragraphs.reduce((n, p) => n + countWords(p.text, bookLanguage), 0) : 0;
		const title =
			epub.tocTitles.get(item.path) ||
			doc?.heading ||
			(item.nav ? 'Sumário' : `Capítulo ${item.index + 1}`);
		return { spine: item.index, title: cap(title, 200), words };
	});
}

/** Texto do parágrafo como vai para a IA: espaços colapsados. */
export const paragraphText = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Parte das palavras que a IA propõe: mais do que a cota, para a escolha ter folga. */
export function candidateShare(coverage: number): number {
	return Math.max(0.05, Math.min(0.6, coverage * 1.5));
}

/**
 * Palavras por pedaço: cada chamada da IA responde umas 40 candidatas, o que cabe no tempo
 * da função da Vercel e no limite de tokens do plano grátis. Mais cobertura, pedaço menor.
 */
export function partWords(coverage: number): number {
	return Math.round(Math.max(100, Math.min(600, 40 / candidateShare(coverage))));
}

/** Pedaços do capítulo: faixas [de, até) de parágrafos, com até `size` palavras cada. */
export function chapterParts(wordsPerParagraph: readonly number[], size: number): [number, number][] {
	const parts: [number, number][] = [];
	let from = 0;
	let acc = 0;
	wordsPerParagraph.forEach((w, i) => {
		if (acc > 0 && acc + w > size) {
			parts.push([from, i]);
			from = i;
			acc = 0;
		}
		acc += w;
	});
	if (wordsPerParagraph.length > from) parts.push([from, wordsPerParagraph.length]);
	return parts;
}

/** Quantas candidatas pedir para um pedaço. */
export function wantedCandidates(words: number, coverage: number): number {
	return Math.max(3, Math.ceil(words * candidateShare(coverage)));
}

const SENTENCE_START = /(^|[.!?…:;"“”«»—–(\n]\s*)$/;

/**
 * Candidata utilizável no parágrafo: campos dentro dos limites, forma achada numa palavra
 * inteira e editável, troca que muda o texto, e sem cara de nome próprio (maiúscula fora do
 * começo da frase, em escrita com caixa). Devolve a posição.
 */
export function locateCandidate(
	doc: XhtmlDoc,
	c: Candidate,
	bookLanguage: string,
	taken: { start: number; end: number }[] = []
): { start: number; end: number } | null {
	if (!c.form || !c.target || !c.lemma || !c.translation) return null;
	if (c.form.toLocaleLowerCase() === c.target.toLocaleLowerCase()) return null;
	const at = doc.locate(c.para, c.form, bookLanguage, taken);
	if (!at) return null;
	const text = doc.paragraphs[c.para].text;
	const found = text.slice(at.start, at.end);
	if (languageProfile(bookLanguage).cased) {
		const first = String.fromCodePoint(found.codePointAt(0) ?? 32);
		const upper = first !== first.toLocaleLowerCase() && first === first.toLocaleUpperCase();
		if (upper && !SENTENCE_START.test(text.slice(0, at.start))) return null;
	}
	return at;
}

export interface BuildChapter {
	spine: number;
	candidates: Candidate[];
}

export interface BuildOptions {
	bookLanguage: string;
	language: string;
	coverage: number;
	preferWords?: readonly string[];
	frequency?: Frequency | null;
}

type Located = Candidate & { start: number; global: number };

/**
 * O EPUB inteiro com blend nos capítulos dados. A escolha corre sobre todos os parágrafos
 * desses capítulos em sequência, para o espaçamento e a repetição atravessarem capítulos.
 */
export function buildBlend(
	epub: Epub,
	chapters: readonly BuildChapter[],
	opts: BuildOptions
): { bytes: Uint8Array; links: number } {
	const docs: { item: SpineItem; doc: XhtmlDoc; offset: number }[] = [];
	const texts: string[] = [];
	const candidates: Located[][] = [];
	for (const ch of [...chapters].sort((a, b) => a.spine - b.spine)) {
		const item = epub.spine[ch.spine];
		const doc = item ? chapterDoc(epub, item) : null;
		if (!item || !doc) continue;
		const offset = texts.length;
		docs.push({ item, doc, offset });
		const per: Located[][] = doc.paragraphs.map(() => []);
		for (const c of ch.candidates) {
			if (!per[c.para]) continue;
			const same = per[c.para].filter((x) => x.form === c.form);
			const at = locateCandidate(
				doc,
				c,
				opts.bookLanguage,
				same.map((x) => ({ start: x.start, end: x.start + x.form.length }))
			);
			if (!at) continue;
			const form = doc.paragraphs[c.para].text.slice(at.start, at.end);
			per[c.para].push({ ...c, form, start: at.start, global: offset + c.para });
		}
		for (const p of doc.paragraphs) texts.push(p.text);
		candidates.push(...per);
	}

	const chosen = selectSwaps({
		texts,
		candidates,
		sourceLang: opts.bookLanguage,
		targetLang: opts.language,
		coverage: opts.coverage,
		preferWords: opts.preferWords,
		frequency: opts.frequency
	});

	const changed = new Map<string, string>();
	let links = 0;
	for (const { item, doc, offset } of docs) {
		const replacements: Replacement[] = [];
		doc.paragraphs.forEach((_, para) => {
			for (const c of chosen[offset + para] ?? []) {
				const html = blendAnchor(c.target, c.lemma, c.translation, c.note);
				if (!html) continue;
				replacements.push({ para, start: c.start, end: c.start + c.form.length, html });
			}
		});
		if (replacements.length === 0) continue;
		links += replacements.length;
		changed.set(item.path, doc.render(replacements));
	}
	return { bytes: writeEpub(epub, changed), links };
}
