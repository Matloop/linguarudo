import { error } from '@sveltejs/kit';
import { apiClient, json, readJson, requireToken, rpcFailure } from '#lib/server/api.ts';
import { parseSeenBody } from '#lib/stremio.ts';
import type { RequestHandler } from './$types';

/** "Visto": palavras do banco que apareceram na legenda. Não mexe no FSRS. */
export const POST: RequestHandler = async (event) => {
	const token = requireToken(event);
	const body = parseSeenBody(await readJson(event.request));
	if (!body) error(400, 'Mande { lang: "en"|"it", terms: [...] } com até 500 termos.');
	if (body.terms.length === 0) return json({ updated: 0 });

	const { data, error: dbError } = await apiClient().rpc('api_mark_seen', {
		p_token: token,
		p_lang: body.lang,
		p_terms: body.terms
	});
	if (dbError) rpcFailure(dbError);
	return json({ updated: data });
};
