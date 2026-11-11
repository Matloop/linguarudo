import { error, json } from '@sveltejs/kit';
import { parseImportBatch } from '#lib/anki/batch.ts';
import { parseLanguage } from '#lib/languages.ts';
import { importAnkiBatch } from '#lib/server/anki-import.ts';
import { loadSettings } from '#lib/server/settings.ts';
import type { RequestHandler } from './$types';

/** Um lote de notas do Anki, já com a mídia no bucket. */
export const POST: RequestHandler = async ({ locals, request }) => {
	const user = await locals.getUser();
	if (!user) error(401, 'Entre para importar.');
	const body = (await request.json().catch(() => null)) as {
		language?: unknown;
		notes?: unknown;
	} | null;

	const language = parseLanguage(body?.language);
	const { studyLanguages } = await loadSettings(locals.supabase, user.id);
	if (!language || !studyLanguages.includes(language)) {
		error(400, 'Esse idioma não está nos seus idiomas.');
	}
	const parsed = parseImportBatch(body?.notes, user.id);
	if (!parsed.ok) error(400, parsed.error);

	try {
		return json(await importAnkiBatch(locals.supabase, language, parsed.notes));
	} catch (e) {
		console.error(e);
		error(500, 'Não deu para importar esse lote agora.');
	}
};
