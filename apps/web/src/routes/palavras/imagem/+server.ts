import { json } from '@sveltejs/kit';
import { ai, aiFailure, jsonFail, NO_STORE } from '#lib/server/ai-chain.ts';
import { CommonsError, parseImageRequest, suggestImages } from '#lib/server/image-search.ts';
import type { RequestHandler } from './$types';

/**
 * Imagens para a palavra: { language, lemma, sense?, sentence?, query? } →
 * { query, images: [{ thumb, url, title, page }] }. Com `query`, busca direto (sem IA).
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const user = await locals.getUser();
	if (!user) return jsonFail(401, 'Entre para usar a IA.');

	const body: unknown = await request.json().catch(() => null);
	const req = parseImageRequest(body);
	if ('error' in req) return jsonFail(400, req.error);

	try {
		return json(await suggestImages(ai, req), { headers: NO_STORE });
	} catch (e) {
		if (e instanceof CommonsError) {
			console.error('imagem:', e.message);
			return jsonFail(502, 'O Wikimedia Commons não respondeu agora, tente de novo.');
		}
		return aiFailure(e, 'imagem');
	}
};
