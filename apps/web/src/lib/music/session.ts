// Monta o que o jogo precisa a partir da letra: linhas tokenizadas, lacunas
// escolhidas por dificuldade e as 4 opções de cada uma.

import type { MusicLanguage } from './wordlists.ts';
import { makeOptions } from './distractors.ts';
import { DIFFICULTIES, chooseGaps, countWords, gapCount, type Difficulty } from './gaps.ts';
import type { GameConfig } from './game.ts';
import type { LyricLine } from './lrc.ts';
import type { Rng } from './rng.ts';
import { tokenize, type Token } from './tokenize.ts';
import { COMMON_WORDS } from './wordlists.ts';

export interface SessionLine extends LyricLine {
	tokens: Token[];
}

export interface SessionGap {
	line: number;
	token: number;
	answer: string;
	key: string;
	inBank: boolean;
	/** Tradução do banco do usuário, quando a palavra já está lá. */
	sense: string;
	options: string[];
}

export interface Session {
	lines: SessionLine[];
	gaps: SessionGap[];
	config: GameConfig;
}

export interface SessionInput {
	lyrics: readonly LyricLine[];
	lang: MusicLanguage;
	difficulty: Difficulty;
	/** Palavra normalizada → tradução, do banco do usuário nesta língua. */
	bank: ReadonlyMap<string, string>;
	rng: Rng;
}

export function buildSession(input: SessionInput): Session {
	const { lyrics, lang, difficulty, bank, rng } = input;
	const lines: SessionLine[] = lyrics.map((l) => ({ ...l, tokens: tokenize(l.text, lang) }));

	const pool = [
		...new Set(
			lines.flatMap((l) =>
				l.tokens.map((t) => t.key).filter((k): k is string => k !== null && [...k].length >= 3)
			)
		)
	];

	const plans = chooseGaps(lines, { difficulty, lang, bank: new Set(bank.keys()) });
	const gaps: SessionGap[] = plans.map((p) => {
		const inLine = new Set(
			lines[p.line].tokens.map((t) => t.key).filter((k): k is string => k !== null)
		);
		return {
			...p,
			sense: bank.get(p.key) ?? '',
			options: makeOptions(p.answer, { pool, common: COMMON_WORDS[lang], exclude: inLine, rng })
		};
	});

	return {
		lines,
		gaps,
		config: {
			lines: lines.map((l) => ({ start: l.start, end: l.end })),
			gaps: gaps.map((g) => ({
				line: g.line,
				token: g.token,
				answer: g.answer,
				options: g.options
			}))
		}
	};
}

export interface DifficultyCounts {
	/** Palavras da letra. */
	words: number;
	gaps: Record<Difficulty, number>;
}

/** Quantas lacunas cada dificuldade dá nesta letra, para a tela de início. */
export function difficultyCounts(
	lyrics: readonly LyricLine[],
	lang: MusicLanguage
): DifficultyCounts {
	const words = countWords(lyrics.map((l, index) => ({ index, tokens: tokenize(l.text, lang) })));
	const gaps = {} as Record<Difficulty, number>;
	for (const d of DIFFICULTIES) gaps[d] = gapCount(d, words);
	return { words, gaps };
}
