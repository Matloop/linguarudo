// Escolha das lacunas: quantas dependem da dificuldade, no máximo uma por linha,
// palavras que o usuário já tem no banco vêm primeiro e o resto se espalha pela música.

import type { MusicLanguage } from './wordlists.ts';
import type { Rng } from './rng.ts';
import { STOPWORDS } from './wordlists.ts';
import type { Token } from './tokenize.ts';

export type Difficulty = 'facil' | 'medio' | 'dificil';

export const DIFFICULTIES: readonly Difficulty[] = ['facil', 'medio', 'dificil'];

export const GAP_COUNTS: Record<Difficulty, number> = { facil: 4, medio: 6, dificil: 10 };

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
	facil: 'Fácil',
	medio: 'Médio',
	dificil: 'Difícil'
};

export function isDifficulty(v: unknown): v is Difficulty {
	return typeof v === 'string' && (DIFFICULTIES as readonly string[]).includes(v);
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
	rng: Rng;
}

const MIN_LETTERS = 4;

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

function pick<T>(items: readonly T[], rng: Rng): T {
	return items[Math.floor(rng() * items.length)];
}

export function chooseGaps(lines: readonly GapLine[], options: ChooseOptions): GapPlan[] {
	const { difficulty, lang, bank, rng } = options;

	const eligible = lines
		.map((line) => {
			const words = line.tokens
				.map((t, token) => ({ token, key: t.key, text: t.text }))
				.filter(
					(w): w is { token: number; key: string; text: string } =>
						w.key !== null && isGapCandidate(w.key, lang)
				);
			return { line: line.index, words };
		})
		.filter((l) => l.words.length > 0);

	const total = Math.min(GAP_COUNTS[difficulty], eligible.length);
	const withBank = eligible.filter((l) => l.words.some((w) => bank.has(w.key)));
	const withoutBank = eligible.filter((l) => !l.words.some((w) => bank.has(w.key)));

	const fromBank = spread(withBank, total);
	const chosen = new Set(fromBank.map((l) => l.line));
	for (const l of spread(withoutBank, total - fromBank.length)) chosen.add(l.line);

	const used = new Set<string>();
	const plans: GapPlan[] = [];
	for (const l of eligible) {
		if (!chosen.has(l.line)) continue;
		const inBank = l.words.filter((w) => bank.has(w.key));
		const pool = inBank.length > 0 ? inBank : l.words;
		const fresh = pool.filter((w) => !used.has(w.key));
		const word = pick(fresh.length > 0 ? fresh : pool, rng);
		used.add(word.key);
		plans.push({
			line: l.line,
			token: word.token,
			answer: word.text,
			key: word.key,
			inBank: bank.has(word.key)
		});
	}
	return plans;
}
