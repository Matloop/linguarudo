// Textos e contas da tela /livros. Puro.

import { plural } from '#lib/decks-ui.ts';

export interface ChapterRow {
	spine: number;
	title: string;
	words: number;
	status: 'pendente' | 'feito' | 'erro';
	/** Pedaços prontos e total (0/0 antes do primeiro pedido). */
	partsDone: number;
	parts: number;
}

const nf = new Intl.NumberFormat('pt-BR');

/** Capítulos com texto dentro do intervalo (o sumário e páginas vazias ficam de fora). */
export function inRange<T extends { spine: number; words: number }>(
	chapters: readonly T[],
	from: number,
	to: number
): T[] {
	return chapters.filter((c) => c.spine >= from && c.spine <= to && c.words > 0);
}

/** "13 capítulos, 16.463 palavras". */
export function rangeSummary(chapters: readonly ChapterRow[], from: number, to: number): string {
	const list = inRange(chapters, from, to);
	const words = list.reduce((n, c) => n + c.words, 0);
	return `${plural(list.length, 'capítulo', 'capítulos')}, ${nf.format(words)} ${words === 1 ? 'palavra' : 'palavras'}`;
}

/** Fração pronta do intervalo, pesada por palavras (capítulo pela metade conta os pedaços). */
export function rangeProgress(chapters: readonly ChapterRow[], from: number, to: number): number {
	const list = inRange(chapters, from, to);
	const total = list.reduce((n, c) => n + c.words, 0);
	if (!total) return 0;
	const done = list.reduce((n, c) => {
		if (c.status === 'feito') return n + c.words;
		return n + (c.parts ? (c.words * c.partsDone) / c.parts : 0);
	}, 0);
	return Math.min(1, done / total);
}

/** "3 de 13 capítulos prontos". */
export function rangeState(chapters: readonly ChapterRow[], from: number, to: number): string {
	const list = inRange(chapters, from, to);
	const done = list.filter((c) => c.status === 'feito').length;
	if (list.length && done === list.length) return `${plural(done, 'capítulo pronto', 'capítulos prontos')}`;
	return `${done} de ${plural(list.length, 'capítulo pronto', 'capítulos prontos')}`;
}

export const coverageLabel = (coverage: number) => `${Math.round(coverage * 100)}%`;
