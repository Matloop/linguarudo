import { error, json } from '@sveltejs/kit';
import { deckTree } from '#lib/decks.ts';
import { parseLanguage } from '#lib/languages.ts';
import { listDecks } from '#lib/server/decks.ts';
import type { DeckOption } from '#lib/word-fields.ts';
import type { RequestHandler } from './$types';

/** ?idioma=: decks do idioma, em árvore, para o campo Deck do diálogo Guardar. */
export const GET: RequestHandler = async ({ locals, url }) => {
	if (!(await locals.getUser())) error(401, 'Entre para ver seus decks.');
	const language = parseLanguage(url.searchParams.get('idioma'));
	if (!language) error(400, 'Idioma inválido.');
	const decks = await listDecks(locals.supabase, language).catch(() => null);
	if (!decks) error(500, 'Não deu para carregar os decks agora.');
	const options: DeckOption[] = deckTree(decks).map((d) => ({
		id: d.id,
		name: d.name,
		depth: d.parentId ? 1 : 0,
		isDefault: d.isDefault
	}));
	return json(options, { headers: { 'Cache-Control': 'no-store' } });
};
