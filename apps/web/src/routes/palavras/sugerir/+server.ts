import { json } from '@sveltejs/kit';
import { GEMINI_API_KEY, GEMINI_MODEL, GROQ_API_KEY, GROQ_MODEL } from '$app/env/private';
import { AiError, createAiChain, geminiProvider, groqProvider } from '#lib/server/ai.ts';
import { loadSettings } from '#lib/server/settings.ts';
import { parseSuggestRequest, suggestFields } from '#lib/server/suggest.ts';
import type { RequestHandler } from './$types';

const NO_STORE = { 'Cache-Control': 'no-store' };

// Uma cadeia por instância: o cooldown depois de um 429 vale entre requisições.
const ai = createAiChain([
	groqProvider(GROQ_API_KEY, GROQ_MODEL),
	geminiProvider(GEMINI_API_KEY, GEMINI_MODEL)
]);

function fail(status: number, message: string) {
	return json({ message }, { status, headers: NO_STORE });
}

const AI_ERRORS = {
	unavailable: [503, 'IA não configurada (GROQ_API_KEY/GEMINI_API_KEY)'],
	rate_limit: [429, 'Limite grátis da IA atingido, tente mais tarde'],
	upstream: [502, 'A IA não respondeu agora, tente de novo.']
} as const;

/**
 * Preenche o diálogo Guardar: { language, text, sentence? } → { lemma, reading, sense, sentence }.
 * A frase enviada volta igual; sem frase, a IA dá um exemplo.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const user = await locals.getUser();
	if (!user) return fail(401, 'Entre para usar a IA.');

	const body: unknown = await request.json().catch(() => null);
	const settings = await loadSettings(locals.supabase, user.id);
	const req = parseSuggestRequest(body, settings.studyLanguages);
	if ('error' in req) return fail(400, req.error);

	try {
		const suggestion = await suggestFields(ai, req, settings.nativeLanguage ?? settings.uiLanguage);
		return json(suggestion, { headers: NO_STORE });
	} catch (e) {
		if (!(e instanceof AiError)) throw e;
		if (e.kind === 'upstream') console.error('sugerir:', e.message);
		const [status, message] = AI_ERRORS[e.kind];
		return fail(status, message);
	}
};
