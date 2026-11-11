import { error, fail, redirect } from '@sveltejs/kit';
import { parseFichaInput } from '#lib/fichas.ts';
import { fichaFormValues, type FichaErrors } from '#lib/server/fichas.ts';
import type { Actions, PageServerLoad } from './$types';

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
		if (!parsed.ok) return fail(400, { errors: parsed.errors as FichaErrors, values });

		// O gatilho fichas_sync_flashcards cria os flashcards (frente e, se pedido, inverso).
		const { error: dbError } = await locals.supabase
			.from('fichas')
			.insert({ ...parsed.value, user_id: user.id });
		if (dbError) {
			const errors: FichaErrors = { form: 'Não deu para salvar agora. Tente de novo.' };
			return fail(500, { errors, values });
		}
		redirect(303, '/flashcards/fichas?criada=1');
	}
};
