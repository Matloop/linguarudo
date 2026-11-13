import { json } from '@sveltejs/kit';
import { ai, aiFailure, jsonFail, NO_STORE } from '#lib/server/ai-chain.ts';
import { loadSettings } from '#lib/server/settings.ts';
import { completeSentence, parseSentenceRequest } from '#lib/server/sentence-ai.ts';
import type { RequestHandler } from './$types';

/**
 * "✦ Completar com IA" da frase de um encontro:
 * { language, lemma, sense?, sentence, translation? } → { sentence, translation }.
 * Frase misturada vira frase inteira no idioma de estudo; frase certa volta igual;
 * sem frase, um exemplo. Não salva: o editor mostra e o usuário salva.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const user = await locals.getUser();
	if (!user) return jsonFail(401, 'Entre para usar a IA.');

	const body: unknown = await request.json().catch(() => null);
	const settings = await loadSettings(locals.supabase, user.id);
	const req = parseSentenceRequest(body, settings.studyLanguages);
	if ('error' in req) return jsonFail(400, req.error);

	try {
		const pair = await completeSentence(ai, req, settings.nativeLanguage ?? settings.uiLanguage);
		return json(pair, { headers: NO_STORE });
	} catch (e) {
		return aiFailure(e, 'frase');
	}
};
