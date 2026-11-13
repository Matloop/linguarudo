// Sugestão de campos do diálogo Guardar: a pessoa digita a palavra e a IA devolve lema,
// leitura, sentido na língua nativa e uma frase de exemplo.

import { languageName } from '@linguetta/language';
import { LIMITS } from '#lib/items.ts';
import { parseLanguage, type Language } from '#lib/languages.ts';
import type { AiChain, JsonRequest } from './ai.ts';

/** Teto do texto digitado (palavra ou expressão) e da frase de contexto. */
export const SUGGEST_LIMITS = { text: 100, sentence: LIMITS.sentence } as const;

export interface SuggestRequest {
	language: Language;
	text: string;
	/** Vazia: a IA inventa uma frase de exemplo. */
	sentence: string;
}

export interface Suggestion {
	lemma: string;
	reading: string;
	sense: string;
	sentence: string;
}

/** Corta em code points, sem partir emoji ou caractere fora do BMP. */
function cap(s: string, max: number): string {
	return [...s].slice(0, max).join('');
}

function clean(value: unknown): string {
	return typeof value === 'string' ? value.normalize('NFC').replace(/\s+/g, ' ').trim() : '';
}

/**
 * Valida o corpo do POST contra os idiomas de estudo; devolve o pedido ou a mensagem
 * de erro (400).
 */
export function parseSuggestRequest(
	body: unknown,
	studyLanguages: readonly Language[]
): SuggestRequest | { error: string } {
	if (!body || typeof body !== 'object') return { error: 'Corpo inválido.' };
	const b = body as Record<string, unknown>;
	const language = parseLanguage(b.language);
	if (!language || !studyLanguages.includes(language)) {
		return { error: 'Idioma fora dos seus idiomas de estudo.' };
	}
	const text = clean(b.text);
	if (!text) return { error: 'Digite a palavra.' };
	if ([...text].length > SUGGEST_LIMITS.text) {
		return { error: `Use no máximo ${SUGGEST_LIMITS.text} caracteres.` };
	}
	if (b.sentence != null && typeof b.sentence !== 'string') return { error: 'Frase inválida.' };
	const sentence = clean(b.sentence);
	if ([...sentence].length > SUGGEST_LIMITS.sentence) {
		return { error: `A frase pode ter no máximo ${SUGGEST_LIMITS.sentence} caracteres.` };
	}
	return { language, text, sentence };
}

const STR = { type: 'string' } as const;

/** Formato strict aceito pelos dois (Groq e Gemini aceitam additionalProperties). */
export const SUGGEST_SCHEMA = {
	type: 'object',
	properties: { lemma: STR, reading: STR, sense: STR, sentence: STR },
	required: ['lemma', 'reading', 'sense', 'sentence'],
	additionalProperties: false
};

// Regras de lema e leitura do provider do Claude no stremio-server (ADR 0004: qualquer idioma).
const LEMMA_CASE = `Write it the way a dictionary of that language writes its headwords: lowercase, except where the spelling of the language requires capitals (German nouns: "Häuser" -> "Haus"; proper nouns: "Roma", "Tokyo").`;
const LEMMA_FORM = `Use the citation form of the language: the infinitive for verbs where the language has one (Italian "voglio" -> "volere", Spanish "quiero" -> "querer"), the singular for nouns (German "Kinder" -> "Kind"), the masculine singular for gendered adjectives (French "belles" -> "beau", Russian "новая" -> "новый"), the dictionary form for Japanese verbs and adjectives ("食べました" -> "食べる"), and so on. For languages without inflection (Chinese, Thai, Vietnamese...) return the word as is. For an expression, its canonical form with the verb in the citation form (Italian "facevo finta di" -> "fare finta di", English "gave up on" -> "give up on"). Fix obvious typos and missing accents.`;
const READING = `the pronunciation in the script learners customarily use when the language is not written in the Latin alphabet: hiragana for Japanese ("食べる" -> "たべる"), pinyin with tone marks for Chinese ("学习" -> "xuéxí"), the standard romanization for Korean, Russian, Greek, Arabic, Hebrew, Hindi, Thai and similar. An empty string for languages written in the Latin alphabet.`;

function name(tag: Language): string {
	return languageName(tag, 'en');
}

/** O pedido para a cadeia de IA. */
export function suggestRequest(
	req: SuggestRequest,
	nativeLanguage: Language
): JsonRequest<Suggestion> {
	const target = name(req.language);
	const native = name(nativeLanguage);
	const system = `You help a speaker of ${native} build flashcards for learning ${target}. The learner typed a ${target} word or expression, maybe inflected or misspelled, sometimes with the sentence where they found it. Fill:
- lemma: the dictionary form of it. ${LEMMA_CASE} ${LEMMA_FORM}
- reading: for the lemma, ${READING}
- sense: its meaning in ${native}, 1 to 6 words, as used in the sentence when there is one; otherwise the most common meaning.
- sentence: ${req.sentence ? 'an empty string (the learner already has a sentence).' : `a short, natural ${target} example sentence (at most 15 words) using the word in its most common meaning.`}`;
	const user = `Language: ${target} (${req.language})
Learner's native language: ${native} (${nativeLanguage})
Word: ${req.text}${req.sentence ? `\nSentence: ${req.sentence}` : ''}`;

	return {
		system,
		user,
		schema: SUGGEST_SCHEMA,
		schemaName: 'suggestion',
		maxTokens: 2000,
		parse: (data) => parseSuggestion(data, req.sentence)
	};
}

/** Normaliza a saída do modelo; null se não tem lema (malformada). A frase enviada volta igual. */
export function parseSuggestion(data: unknown, sentence: string): Suggestion | null {
	if (!data || typeof data !== 'object') return null;
	const d = data as Record<string, unknown>;
	const lemma = cap(clean(d.lemma), LIMITS.lemma);
	if (!lemma) return null;
	return {
		lemma,
		reading: cap(clean(d.reading), LIMITS.reading),
		sense: cap(clean(d.sense), LIMITS.sense),
		sentence: sentence || cap(clean(d.sentence), LIMITS.sentence)
	};
}

export function suggestFields(
	ai: AiChain,
	req: SuggestRequest,
	nativeLanguage: Language
): Promise<Suggestion> {
	return ai.json(suggestRequest(req, nativeLanguage));
}
