// O que dá para mostrar de uma linha. Lacuna sem resposta nunca aparece em texto
// visível: nem na letra (jogo ou sincronia), nem no cartão da palavra, nem no fim de
// jogo. Toda tela que mostra uma linha passa por aqui.

import type { Token } from './tokenize.ts';

export const GAP_TEXT = '＿＿＿';

export type LinePart =
	/** Espaço, pontuação, número. */
	| { kind: 'sep'; text: string }
	| { kind: 'word'; text: string; key: string; token: number; mark: 'ok' | 'err' | null }
	/** Lacuna aberta: sem texto. */
	| { kind: 'gap'; token: number };

export interface MaskGap {
	token: number;
}

export interface MaskResult {
	ok: boolean;
}

/** `result` presente = a lacuna já foi respondida (ou revelada). */
export function lineParts(
	tokens: readonly Token[],
	gap?: MaskGap | null,
	result?: MaskResult | null
): LinePart[] {
	return tokens.map((t, i): LinePart => {
		if (t.key === null) return { kind: 'sep', text: t.text };
		const isGap = gap?.token === i;
		if (isGap && !result) return { kind: 'gap', token: i };
		return {
			kind: 'word',
			text: t.text,
			key: t.key,
			token: i,
			mark: isGap && result ? (result.ok ? 'ok' : 'err') : null
		};
	});
}

/** Tokens com a lacuna aberta trocada por traços (para o cartão da palavra). */
export function maskTokens(
	tokens: readonly Token[],
	gap?: MaskGap | null,
	result?: MaskResult | null
): Token[] {
	return tokens.map((t, i) => (gap?.token === i && !result ? { text: GAP_TEXT, key: null } : t));
}

export function maskedText(
	tokens: readonly Token[],
	gap?: MaskGap | null,
	result?: MaskResult | null
): string {
	return maskTokens(tokens, gap, result)
		.map((t) => t.text)
		.join('');
}
