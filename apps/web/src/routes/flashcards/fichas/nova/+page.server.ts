import { error, fail, redirect } from '@sveltejs/kit';
import { parseFichaInput, parseFichaMedia } from '#lib/fichas.ts';
import { defaultDeckId } from '#lib/server/decks.ts';
import { fichaFormValues, fichaMediaUrls, type FichaErrors } from '#lib/server/fichas.ts';
import type { Actions, PageServerLoad } from './$types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const load: PageServerLoad = async ({ parent }) => {
	const { shell } = await parent();
	if (!shell) error(401, 'Entre para criar fichas.');
	if (!shell.active) redirect(303, '/inicio');
	return { language: shell.active, languages: shell.studyLanguages, ui: shell.uiLanguage };
};

export const actions: Actions = {
	default: async ({ locals, request }) => {
		const user = await locals.getUser();
		if (!user) error(401, 'Entre para criar fichas.');
		const raw = Object.fromEntries(await request.formData());
		const values = fichaFormValues(raw);
		const parsed = parseFichaInput(raw);
		const media = parseFichaMedia(raw, user.id);
		if (!parsed.ok || !media.ok) {
			const errors: FichaErrors = {
				...(parsed.ok ? {} : parsed.errors),
				...(media.ok ? {} : media.errors)
			};
			const mediaUrls = await fichaMediaUrls(locals.supabase, values.media);
			return fail(400, { errors, values, mediaUrls });
		}

		// Deck escolhido (campo "deck") ou o padrão do idioma; o banco confere dono e idioma.
		const deck =
			typeof raw.deck === 'string' && UUID.test(raw.deck)
				? raw.deck
				: await defaultDeckId(locals.supabase, parsed.value.language);
		// O gatilho fichas_sync_flashcards cria os flashcards (frente e, se pedido, inverso).
		const { error: dbError } = await locals.supabase
			.from('fichas')
			.insert({ ...parsed.value, ...media.value, user_id: user.id, deck_id: deck });
		if (dbError) {
			const errors: FichaErrors = { form: 'Não deu para salvar agora. Tente de novo.' };
			const mediaUrls = await fichaMediaUrls(locals.supabase, values.media);
			return fail(500, { errors, values, mediaUrls });
		}
		redirect(303, '/flashcards/fichas?criada=1');
	}
};
