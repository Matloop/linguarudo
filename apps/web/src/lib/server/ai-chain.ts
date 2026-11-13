// A cadeia de IA grátis dos endpoints (/palavras/sugerir, /palavras/frase) e o mapa de
// AiError para HTTP. Uma cadeia por instância: o cooldown depois de um 429 vale entre
// requisições e entre os endpoints.

import { json } from '@sveltejs/kit';
import { GEMINI_API_KEY, GEMINI_MODEL, GROQ_API_KEY, GROQ_MODEL } from '$app/env/private';
import { AiError, createAiChain, geminiProvider, groqProvider } from './ai.ts';

export const ai = createAiChain([
	groqProvider(GROQ_API_KEY, GROQ_MODEL),
	geminiProvider(GEMINI_API_KEY, GEMINI_MODEL)
]);

export const NO_STORE = { 'Cache-Control': 'no-store' };

/** Erro em JSON { message }, sem cache. */
export function jsonFail(status: number, message: string) {
	return json({ message }, { status, headers: NO_STORE });
}

const AI_ERRORS = {
	unavailable: [503, 'IA não configurada (GROQ_API_KEY/GEMINI_API_KEY)'],
	rate_limit: [429, 'Limite grátis da IA atingido, tente mais tarde'],
	upstream: [502, 'A IA não respondeu agora, tente de novo.']
} as const;

/** Resposta para uma falha da cadeia; o que não é AiError sobe. `tag` vai para o log. */
export function aiFailure(e: unknown, tag: string) {
	if (!(e instanceof AiError)) throw e;
	if (e.kind === 'upstream') console.error(`${tag}:`, e.message);
	const [status, message] = AI_ERRORS[e.kind];
	return jsonFail(status, message);
}
