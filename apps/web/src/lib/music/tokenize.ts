// Divide uma linha em palavras e separadores sem perder nenhum caractere:
// juntar o texto de todos os tokens devolve a linha original.

import type { Lang } from '../words.ts';

export interface Token {
	text: string;
	/** Forma normalizada da palavra; null para espaço, pontuação e números. */
	key: string | null;
}

const WORD = {
	en: "[\\p{L}\\p{M}]+(?:['’][\\p{L}\\p{M}]+)*",
	// Em italiano o apóstrofo é elisão (l'amore, dell'acqua): separa as duas palavras.
	it: '[\\p{L}\\p{M}]+'
} as const;

const PATTERNS = {
	en: new RegExp(`(${WORD.en})|(\\p{N}+)|([^\\p{L}\\p{M}\\p{N}]+)`, 'gu'),
	it: new RegExp(`(${WORD.it})|(\\p{N}+)|([^\\p{L}\\p{M}\\p{N}]+)`, 'gu')
};

export function wordKey(raw: string): string {
	return raw
		.normalize('NFC')
		.toLowerCase()
		.replace(/’/g, "'")
		.replace(/^['-]+|['-]+$/g, '');
}

export function tokenize(text: string, lang: Lang): Token[] {
	return [...text.matchAll(PATTERNS[lang])].map((m) => ({
		text: m[0],
		key: m[1] !== undefined ? wordKey(m[1]) : null
	}));
}
