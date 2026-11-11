import { error } from '@sveltejs/kit';
import { parseSeenBody } from '#lib/integrations.ts';
import { apiClient, json, readJson, requireToken, rpcFailure } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

/** "Visto": itens que apareceram na legenda. Soma no contador do item; não mexe no FSRS. */
export const POST: RequestHandler = async (event) => {
	const token = requireToken(event);
	const body = parseSeenBody(await readJson(event.request));
	if (!body) error(400, 'Mande { language, lemmas: [...] } com até 500 lemas.');
	if (body.lemmas.length === 0) return json({ updated: 0 });

	const { data, error: dbError } = await apiClient().rpc('api_mark_seen', {
		p_token: token,
		p_language: body.language,
		p_lemmas: body.lemmas
	});
	if (dbError) rpcFailure(dbError);
	return json({ updated: data });
};
