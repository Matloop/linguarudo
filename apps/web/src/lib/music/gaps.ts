// Escolha das lacunas, contando todas as palavras da letra: Iniciante esconde 15%
// delas, Intermediário 30%, Avançado metade e Especialista todas. Uma linha pode ter várias lacunas. Palavras que o usuário já tem
// no banco vêm primeiro, depois as de conteúdo, por fim as funcionais; cada grupo se
// espalha pela música.

import type { MusicLanguage } from './wordlists.ts';
import { STOPWORDS } from './wordlists.ts';
import type { Token } from './tokenize.ts';

export type Difficulty = 'iniciante' | 'intermediario' | 'avancado' | 'especialista';

export const DIFFICULTIES: readonly Difficulty[] = [
	'iniciante',
	'intermediario',
	'avancado',
	'especialista'
];

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
	iniciante: 'Iniciante',
	intermediario: 'Intermediário',
	avancado: 'Avançado',
	especialista: 'Especialista'
};

/** Parte das palavras da letra que vira lacuna em cada dificuldade. */
const SHARE: Record<Difficulty, number> = {
	iniciante: 0.15,
	intermediario: 0.3,
	avancado: 0.5,
	especialista: 1
};

/** Quantas lacunas a dificuldade dá numa letra com `words` palavras. */
export function gapCount(difficulty: Difficulty, words: number): number {
	return Math.min(words, Math.max(1, Math.round(words * SHARE[difficulty])));
}

export interface GapLine {
	index: number;
	tokens: readonly Token[];
}

export interface GapPlan {
	line: number;
	/** Posição da palavra em tokens da linha. */
	token: number;
	answer: string;
	key: string;
	inBank: boolean;
}

export interface ChooseOptions {
	difficulty: Difficulty;
	lang: MusicLanguage;
	/** Palavras (normalizadas) que o usuário já tem no banco. */
	bank: ReadonlySet<string>;
}

const MIN_LETTERS = 4;

/** Palavra de conteúdo: 4+ letras e não funcional. Tem prioridade depois das do banco. */
export function isGapCandidate(key: string, lang: MusicLanguage): boolean {
	return (
		[...key].length >= MIN_LETTERS && /^[\p{L}\p{M}'-]+$/u.test(key) && !STOPWORDS[lang].has(key)
	);
}

/** k itens espalhados de modo uniforme, na ordem original. */
export function spread<T>(items: readonly T[], k: number): T[] {
	if (k <= 0) return [];
	if (k >= items.length) return [...items];
	return Array.from({ length: k }, (_, i) => items[Math.floor(((i + 0.5) * items.length) / k)]);
}

interface Slot {
	line: number;
	token: number;
	key: string;
	text: string;
}

function slots(lines: readonly GapLine[]): Slot[] {
	return lines.flatMap((line) =>
		line.tokens.flatMap((t, token) =>
			t.key === null ? [] : [{ line: line.index, token, key: t.key, text: t.text }]
		)
	);
}

/** Palavras da letra (o "de N" do LingoClip). */
export function countWords(lines: readonly GapLine[]): number {
	return slots(lines).length;
}

export function chooseGaps(lines: readonly GapLine[], options: ChooseOptions): GapPlan[] {
	const { difficulty, lang, bank } = options;
	const all = slots(lines);
	let left = gapCount(difficulty, all.length);

	const tiers = [
		all.filter((w) => bank.has(w.key)),
		all.filter((w) => !bank.has(w.key) && isGapCandidate(w.key, lang)),
		all.filter((w) => !bank.has(w.key) && !isGapCandidate(w.key, lang))
	];
	const chosen: Slot[] = [];
	for (const tier of tiers) {
		const picked = spread(tier, left);
		chosen.push(...picked);
		left -= picked.length;
	}

	return chosen
		.sort((a, b) => a.line - b.line || a.token - b.token)
		.map((w) => ({
			line: w.line,
			token: w.token,
			answer: w.text,
			key: w.key,
			inBank: bank.has(w.key)
		}));
}
