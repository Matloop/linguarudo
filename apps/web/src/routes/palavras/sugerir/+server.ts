import { json } from '@sveltejs/kit';
import { ai, aiFailure, jsonFail, NO_STORE } from '#lib/server/ai-chain.ts';
import { loadSettings } from '#lib/server/settings.ts';
import { parseSuggestRequest, suggestFields } from '#lib/server/suggest.ts';
import type { RequestHandler } from './$types';

/**
 * Preenche o diálogo Guardar: { language, text, sentence? } →
 * { lemma, reading, sense, sentence, translation }. A frase enviada volta igual; sem
 * frase, a IA dá um exemplo. translation é a frase na língua nativa.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const user = await locals.getUser();
	if (!user) return jsonFail(401, 'Entre para usar a IA.');

	const body: unknown = await request.json().catch(() => null);
	const settings = await loadSettings(locals.supabase, user.id);
	const req = parseSuggestRequest(body, settings.studyLanguages);
	if ('error' in req) return jsonFail(400, req.error);

	try {
		const suggestion = await suggestFields(ai, req, settings.nativeLanguage ?? settings.uiLanguage);
		return json(suggestion, { headers: NO_STORE });
	} catch (e) {
		return aiFailure(e, 'sugerir');
	}
};
