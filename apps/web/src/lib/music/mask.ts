// O que dá para mostrar de uma linha. Lacuna sem resposta nunca aparece em texto
// visível: nem na letra (jogo ou sincronia), nem no cartão da palavra, nem no fim de
// jogo. Toda tela que mostra uma linha passa por aqui.

import type { Token } from './tokenize.ts';

export const GAP_TEXT = '＿＿＿';

export type LinePart =
	/** Espaço, pontuação, número. */
	| { kind: 'sep'; text: string }
	| { kind: 'word'; text: string; key: string; token: number; mark: 'ok' | 'err' | null }
	/**
	 * Lacuna aberta: sem o texto. `initial` e `rest` (letras que faltam) são a dica
	 * que só a sincronia mostra, para reconhecer a linha sem entregar a palavra.
	 */
	| { kind: 'gap'; token: number; initial: string; rest: number };

export interface MaskResult {
	ok: boolean;
}

export interface MaskGap {
	token: number;
	/** Presente = a lacuna já foi respondida (ou revelada). */
	result?: MaskResult | null;
}

function byToken(gaps: readonly MaskGap[]): Map<number, MaskGap> {
	return new Map(gaps.map((g) => [g.token, g]));
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function hint(text: string): { initial: string; rest: number } {
	const letters = [...graphemes.segment(text)].map((g) => g.segment);
	return { initial: letters[0] ?? '', rest: Math.max(0, letters.length - 1) };
}

export function lineParts(tokens: readonly Token[], gaps: readonly MaskGap[] = []): LinePart[] {
	const at = byToken(gaps);
	return tokens.map((t, i): LinePart => {
		if (t.key === null) return { kind: 'sep', text: t.text };
		const gap = at.get(i);
		if (gap && !gap.result) return { kind: 'gap', token: i, ...hint(t.text) };
		return {
			kind: 'word',
			text: t.text,
			key: t.key,
			token: i,
			mark: gap?.result ? (gap.result.ok ? 'ok' : 'err') : null
		};
	});
}

/** Tokens com as lacunas abertas trocadas por traços (para o cartão da palavra). */
export function maskTokens(tokens: readonly Token[], gaps: readonly MaskGap[] = []): Token[] {
	const at = byToken(gaps);
	return tokens.map((t, i) => {
		const gap = at.get(i);
		return gap && !gap.result ? { text: GAP_TEXT, key: null } : t;
	});
}

export function maskedText(tokens: readonly Token[], gaps: readonly MaskGap[] = []): string {
	return maskTokens(tokens, gaps)
		.map((t) => t.text)
		.join('');
}
