// "✦ Completar com IA" da frase de um encontro: devolve a frase inteira no idioma de
// estudo (reescreve a frase misturada do Blend, mantém a que já está certa, inventa um
// exemplo se não há frase) e a tradução dela na língua nativa. Nada é salvo aqui.

import { languageName } from '@linguetta/language';
import { LIMITS } from '#lib/items.ts';
import { parseLanguage, type Language } from '#lib/languages.ts';
import { normalizeSentence, type SentencePair } from '#lib/sentence.ts';
import type { AiChain, JsonRequest } from './ai.ts';

export interface SentenceRequest {
	language: Language;
	lemma: string;
	/** Sentido do item na língua nativa; vazio se não há. */
	sense: string;
	/** Vazia: a IA escreve um exemplo. */
	sentence: string;
	/** Tradução que já existe (ajuda a reescrever a frase misturada). */
	translation: string;
}

const LIMIT = {
	lemma: LIMITS.lemma,
	sense: LIMITS.sense,
	sentence: LIMITS.sentence,
	translation: LIMITS.translation
} as const;

/** Corta em code points, sem partir emoji ou caractere fora do BMP. */
function cap(s: string, max: number): string {
	return [...s].slice(0, max).join('');
}

/** Valida o corpo do POST contra os idiomas de estudo; devolve o pedido ou o erro (400). */
export function parseSentenceRequest(
	body: unknown,
	studyLanguages: readonly Language[]
): SentenceRequest | { error: string } {
	if (!body || typeof body !== 'object') return { error: 'Corpo inválido.' };
	const b = body as Record<string, unknown>;
	const language = parseLanguage(b.language);
	if (!language || !studyLanguages.includes(language)) {
		return { error: 'Idioma fora dos seus idiomas de estudo.' };
	}
	for (const key of ['lemma', 'sense', 'sentence', 'translation'] as const) {
		if (b[key] != null && typeof b[key] !== 'string') return { error: 'Corpo inválido.' };
	}
	const req = {
		language,
		lemma: normalizeSentence(b.lemma),
		sense: normalizeSentence(b.sense),
		sentence: normalizeSentence(b.sentence),
		translation: normalizeSentence(b.translation)
	};
	if (!req.lemma) return { error: 'Falta a palavra.' };
	for (const key of ['lemma', 'sense', 'sentence', 'translation'] as const) {
		if ([...req[key]].length > LIMIT[key]) {
			return { error: `Texto longo demais (${key}): no máximo ${LIMIT[key]} caracteres.` };
		}
	}
	return req;
}

const STR = { type: 'string' } as const;

export const SENTENCE_SCHEMA = {
	type: 'object',
	properties: { sentence: STR, translation: STR },
	required: ['sentence', 'translation'],
	additionalProperties: false
};

function name(tag: Language): string {
	return languageName(tag, 'en');
}

/** O pedido para a cadeia de IA. */
export function sentenceRequest(
	req: SentenceRequest,
	nativeLanguage: Language
): JsonRequest<SentencePair> {
	const target = name(req.language);
	const native = name(nativeLanguage);
	const meaning = req.sense ? `with the meaning "${req.sense}"` : 'in its most common meaning';
	const sentenceRule = req.sentence
		? `the learner's sentence, fully in natural ${target}. It may already be proper ${target}: then return it unchanged (fix only obvious typos). It may be mixed, mostly ${native} with a few ${target} words swapped in (subtitles from a language-blending tool): then rewrite the whole sentence in ${target}, keeping its meaning and keeping the word "${req.lemma}" (or the inflected form the sentence needs).`
		: `a short, natural ${target} example sentence (at most 15 words) using the word "${req.lemma}" ${meaning}.`;
	const system = `You help a speaker of ${native} study ${target} with sentences from films, songs and books. Fill:
- sentence: ${sentenceRule} At most ${LIMITS.sentence} characters.
- translation: a natural ${native} translation of your sentence, translating the word ${meaning}. At most ${LIMITS.translation} characters.`;
	const lines = [
		`Language: ${target} (${req.language})`,
		`Learner's native language: ${native} (${nativeLanguage})`,
		`Word: ${req.lemma}`
	];
	if (req.sense) lines.push(`Meaning: ${req.sense}`);
	if (req.sentence) lines.push(`Sentence: ${req.sentence}`);
	if (req.sentence && req.translation) lines.push(`Current translation: ${req.translation}`);

	return {
		system,
		user: lines.join('\n'),
		schema: SENTENCE_SCHEMA,
		schemaName: 'sentence_pair',
		maxTokens: 2000,
		parse: parseSentenceResult
	};
}

/** Normaliza a saída do modelo; null se não veio frase (malformada). */
export function parseSentenceResult(data: unknown): SentencePair | null {
	if (!data || typeof data !== 'object') return null;
	const d = data as Record<string, unknown>;
	const sentence = cap(normalizeSentence(d.sentence), LIMITS.sentence);
	if (!sentence) return null;
	return { sentence, translation: cap(normalizeSentence(d.translation), LIMITS.translation) };
}

export function completeSentence(
	ai: AiChain,
	req: SentenceRequest,
	nativeLanguage: Language
): Promise<SentencePair> {
	return ai.json(sentenceRequest(req, nativeLanguage));
}
