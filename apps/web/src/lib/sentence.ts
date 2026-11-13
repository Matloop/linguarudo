// Frase nos dois idiomas: a frase do encontro, no idioma de estudo, e a tradução dela, na
// língua nativa. Regras puras usadas no painel de Minhas palavras, na revisão e na action
// ?/editEncounter. Os limites espelham os checks de encounters (sentence, translation, highlight).

import { findWord } from '@linguetta/language';
import { LIMITS, charLength, type Origin } from './items.ts';
import type { Language } from './languages.ts';
import type { TextPart } from './review.ts';

// ---------- Editar um encontro ----------

export interface EncounterEdit {
	id: string;
	sentence: string;
	translation: string;
}

export type EncounterEditField = 'sentence' | 'translation' | 'form';

export type EncounterEditResult =
	| { ok: true; value: EncounterEdit }
	| { ok: false; errors: Partial<Record<EncounterEditField, string>> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Frase e tradução são uma linha só: NFC, espaços (e quebras) colapsados, sem pontas. */
export function normalizeSentence(raw: unknown): string {
	return typeof raw === 'string' ? raw.normalize('NFC').replace(/\s+/g, ' ').trim() : '';
}

/** Corpo do ?/editEncounter: id, frase (obrigatória) e tradução (opcional). */
export function parseEncounterEdit(raw: Record<string, unknown>): EncounterEditResult {
	const id = typeof raw.id === 'string' ? raw.id.trim() : '';
	if (!UUID.test(id)) return { ok: false, errors: { form: 'Frase não encontrada.' } };
	const sentence = normalizeSentence(raw.sentence);
	const translation = normalizeSentence(raw.translation);
	const errors: Partial<Record<EncounterEditField, string>> = {};
	if (sentence === '') errors.sentence = 'Escreva a frase.';
	else if (charLength(sentence) > LIMITS.sentence)
		errors.sentence = `Use no máximo ${LIMITS.sentence} caracteres.`;
	if (charLength(translation) > LIMITS.translation)
		errors.translation = `Use no máximo ${LIMITS.translation} caracteres.`;
	if (Object.keys(errors).length > 0) return { ok: false, errors };
	return { ok: true, value: { id: id.toLowerCase(), sentence, translation } };
}

/**
 * O trecho a destacar numa frase nova: o primeiro candidato (destaque antigo, forma vista,
 * lema) achado como palavra inteira, com a grafia que está na frase. Nenhum achado, ou
 * trecho acima do limite: '' (a tela destaca o lema, ver highlightParts).
 */
export function findHighlight(
	sentence: string,
	candidates: readonly string[],
	language: Language
): string {
	for (const term of candidates) {
		if (!term.trim()) continue;
		const hit = findWord(sentence, term, language);
		if (!hit || hit.length === 0) continue;
		const text = sentence.slice(hit.index, hit.index + hit.length);
		return charLength(text) <= LIMITS.highlight ? text : '';
	}
	return '';
}

// ---------- Frase misturada ----------

/**
 * Frase do Blend sem tradução: é a fala na língua nativa com só algumas palavras trocadas
 * ("Eu corro até meus muscoli bruciano…"). A IA passa ela inteira para o idioma de estudo.
 */
export function isMixedSentence(e: {
	origin: Origin | null;
	sentence: string;
	translation: string;
}) {
	return e.origin === 'blend' && e.translation === '' && e.sentence !== '';
}

// ---------- Tradução com o sentido em negrito ----------

/** Minúsculo e sem acentos, caractere a caractere, com o índice de cada um no original. */
function fold(text: string): { folded: string; at: number[] } {
	let folded = '';
	const at: number[] = [];
	let i = 0;
	for (const ch of text) {
		const f = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
		for (let k = 0; k < f.length; k++) at.push(i);
		folded += f;
		i += ch.length;
	}
	at.push(i);
	return { folded, at };
}

const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u;

/** Termos do sentido: "ficha, cartão; (de papel) formulário" → ficha, cartão, formulário. */
export function senseTerms(sense: string): string[] {
	const terms = sense
		.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
		.split(/[,;/]/)
		.map((t) => t.replace(/\s+/g, ' ').trim())
		.filter((t) => [...t].length >= 2);
	return [...new Set(terms)].sort((a, b) => b.length - a.length);
}

/**
 * Quebra a tradução da frase marcando onde aparece algum termo do sentido do item como
 * palavra inteira, sem ligar para caixa nem acento ("Ficha" bate com "ficha"). O termo
 * mais longo ganha quando dois se sobrepõem.
 */
export function senseParts(translation: string, sense: string): TextPart[] {
	const terms = senseTerms(sense);
	if (!translation || terms.length === 0) return [{ text: translation, hit: false }];
	const { folded, at } = fold(translation);
	const hits: [number, number][] = [];
	for (const term of terms) {
		const needle = fold(term).folded;
		let from = 0;
		while (needle && from <= folded.length) {
			const i = folded.indexOf(needle, from);
			if (i < 0) break;
			const end = i + needle.length;
			from = i + 1;
			if (i > 0 && WORD_CHAR.test(folded[i - 1])) continue;
			if (end < folded.length && WORD_CHAR.test(folded[end])) continue;
			const start = at[i];
			const stop = at[end];
			if (hits.some(([s, e]) => start < e && stop > s)) continue;
			hits.push([start, stop]);
		}
	}
	if (hits.length === 0) return [{ text: translation, hit: false }];
	hits.sort((a, b) => a[0] - b[0]);
	const parts: TextPart[] = [];
	let pos = 0;
	for (const [s, e] of hits) {
		if (s > pos) parts.push({ text: translation.slice(pos, s), hit: false });
		parts.push({ text: translation.slice(s, e), hit: true });
		pos = e;
	}
	if (pos < translation.length) parts.push({ text: translation.slice(pos), hit: false });
	return parts;
}

// ---------- ✦ Completar com IA ----------

export interface SentencePair {
	sentence: string;
	translation: string;
}

/** Lê a resposta 200 de /palavras/frase; null se não veio frase. */
export function parseSentencePair(raw: unknown): SentencePair | null {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;
	const sentence = normalizeSentence(r.sentence);
	if (!sentence) return null;
	return { sentence, translation: normalizeSentence(r.translation) };
}

/**
 * O que a IA preenche no editor: a frase vira a dela (igual se já estava certa, reescrita
 * se estava misturada); a tradução que o usuário escreveu só fica se a frase não mudou.
 */
export function mergeSentencePair(current: SentencePair, ai: SentencePair): SentencePair {
	const sentence = ai.sentence || current.sentence;
	const keep =
		current.translation.trim() !== '' &&
		normalizeSentence(current.sentence) === normalizeSentence(sentence);
	return {
		sentence,
		translation: keep ? current.translation : ai.translation || current.translation
	};
}
