import { error } from '@sveltejs/kit';
import { apiItem, apiSaveResults, parseSaveBody } from '#lib/integrations.ts';
import type { SaveEntry } from '#lib/items.ts';
import { parseLanguage } from '#lib/languages.ts';
import { apiClient, json, readJson, requireToken, rpcFailure } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

/**
 * Itens do banco num idioma, com os cartões. `preferWords` são os lemas que a
 * legenda deve trocar primeiro (aprendendo, reaprendendo ou revisão vencida).
 */
export const GET: RequestHandler = async (event) => {
	const token = requireToken(event);
	const language = parseLanguage(event.url.searchParams.get('language'));
	if (!language) error(400, 'Use ?language= com um código de idioma (en, it, ...).');

	const { data, error: dbError } = await apiClient().rpc('api_items', {
		p_token: token,
		p_language: language
	});
	if (dbError) rpcFailure(dbError);

	const now = new Date();
	const items = data.map((row) => apiItem(row, now));
	const preferWords = items.filter((i) => i.prefer).map((i) => i.lemma);
	return json({ language, items, preferWords });
};

/**
 * Salva um lote: cada entrada acha ou cria o item e, se trouxer `encounter`, ganha
 * um encontro (ligado à `work`, se vier). Uma resposta por entrada, na mesma ordem.
 * Mandar de novo o mesmo `encounter.clientId` não duplica o encontro.
 */
export const POST: RequestHandler = async (event) => {
	const token = requireToken(event);
	const parsed = parseSaveBody(await readJson(event.request));
	if (!parsed.ok) error(400, parsed.error);

	const valid: SaveEntry[] = parsed.items.flatMap((e) => (e.ok ? [e.entry] : []));
	let rows: Parameters<typeof apiSaveResults>[1] = [];
	if (valid.length > 0) {
		const { data, error: dbError } = await apiClient().rpc('api_save_items', {
			p_token: token,
			p_items: valid
		});
		if (dbError) rpcFailure(dbError);
		rows = data;
	}
	return json({ results: apiSaveResults(parsed.items, rows) });
};
