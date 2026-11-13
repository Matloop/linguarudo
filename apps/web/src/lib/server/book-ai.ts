// O pedido de candidatas do blend de livro para a cadeia de IA. A IA só vê os parágrafos
// numerados (texto puro) e devolve trechos para trocar; quem escolhe e escreve o XHTML é o
// código (lib/blend). A ordem da resposta conta: sem lista de frequência no app web, ela é
// o desempate da escolha.

import { languageName } from '@linguetta/language';
import { CANDIDATE_LIMITS, paragraphText, type Candidate } from '#lib/blend/book.ts';
import type { JsonRequest } from './ai.ts';

/** Cada provider tem até 25 s: dois na cadeia cabem nos 60 s da função. */
export const BOOK_AI_TIMEOUT_MS = 25_000;

const STR = { type: 'string' } as const;

export const CANDIDATES_SCHEMA = {
	type: 'object',
	properties: {
		candidates: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					para: { type: 'integer' },
					form: STR,
					target: STR,
					lemma: STR,
					translation: STR,
					note: STR
				},
				required: ['para', 'form', 'target', 'lemma', 'translation', 'note'],
				additionalProperties: false
			}
		}
	},
	required: ['candidates'],
	additionalProperties: false
};

export interface PartRequest {
	bookLanguage: string;
	language: string;
	/** Parágrafos do pedaço com o índice deles no capítulo. */
	paragraphs: { para: number; text: string }[];
	wanted: number;
}

const clean = (v: unknown, max: number) =>
	typeof v === 'string' ? [...v.normalize('NFC').replace(/\s+/g, ' ').trim()].slice(0, max).join('') : '';

/** Normaliza a resposta; descarta candidata fora dos parágrafos pedidos ou sem campo. */
export function parseCandidates(data: unknown, paras: ReadonlySet<number>): Candidate[] | null {
	const list = (data as { candidates?: unknown } | null)?.candidates;
	if (!Array.isArray(list)) return null;
	const out: Candidate[] = [];
	for (const raw of list) {
		if (!raw || typeof raw !== 'object') continue;
		const r = raw as Record<string, unknown>;
		const para = r.para;
		if (typeof para !== 'number' || !Number.isInteger(para) || !paras.has(para)) continue;
		const c: Candidate = {
			para,
			form: clean(r.form, CANDIDATE_LIMITS.form),
			target: clean(r.target, CANDIDATE_LIMITS.target),
			lemma: clean(r.lemma, CANDIDATE_LIMITS.lemma),
			translation: clean(r.translation, CANDIDATE_LIMITS.translation),
			note: clean(r.note, CANDIDATE_LIMITS.note)
		};
		if (!c.form || !c.target || !c.lemma || !c.translation) continue;
		out.push(c);
	}
	return out;
}

export function partRequest(req: PartRequest): JsonRequest<Candidate[]> {
	const book = languageName(req.bookLanguage, 'en');
	const target = languageName(req.language, 'en');
	const system = `You prepare a language-blending ebook: a ${book} book where some words are swapped into ${target}, so a ${book} speaker learns ${target} while reading. From the numbered paragraphs, propose about ${req.wanted} words or short expressions to swap. For each:
- para: the paragraph number.
- form: the exact text to replace, copied character by character from that paragraph (same spelling, same case), a whole word or a fixed expression of at most 4 words.
- target: the ${target} equivalent inflected to fit that sentence in place of form (gender, number, tense, person).
- lemma: the ${target} dictionary form of target (infinitive, singular, masculine where it applies).
- translation: a short meaning of the lemma in ${book} (1 to 4 words).
- note: an optional very short grammar note in ${book} (e.g. gender, irregular form), or "".
Rules: never proper nouns (people, places, titles, brands), numbers, interjections or words that are already ${target}. Prefer everyday vocabulary that helps a learner: nouns, verbs, adjectives, adverbs and common phrases. Spread the picks across the paragraphs. List the most useful first. The same lemma at most twice.`;
	const user = req.paragraphs.map((p) => `[${p.para}] ${paragraphText(p.text)}`).join('\n\n');
	const paras = new Set(req.paragraphs.map((p) => p.para));
	return {
		system,
		user,
		schema: CANDIDATES_SCHEMA,
		schemaName: 'blend_candidates',
		maxTokens: Math.min(16_000, 2_000 + req.wanted * 90),
		timeoutMs: BOOK_AI_TIMEOUT_MS,
		parse: (data) => parseCandidates(data, paras)
	};
}
