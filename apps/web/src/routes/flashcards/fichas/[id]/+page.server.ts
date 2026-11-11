import { error, fail, redirect } from '@sveltejs/kit';
import { fichaHtmlToText, parseFichaInput } from '#lib/fichas.ts';
import { fichaFormValues, type FichaErrors } from '#lib/server/fichas.ts';
import type { Actions, PageServerLoad } from './$types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const load: PageServerLoad = async ({ locals, params, parent }) => {
	const { shell } = await parent();
	if (!shell) error(401, 'Entre para editar fichas.');
	const user = await locals.getUser();
	if (!user) error(401, 'Entre para editar fichas.');
	if (!UUID.test(params.id)) error(404, 'Ficha não encontrada.');

	const { data: ficha } = await locals.supabase
		.from('fichas')
		.select('id, language, front, back, reverse, cloze_count, tags, anki_guid')
		.eq('id', params.id)
		.eq('user_id', user.id)
		.is('deleted_at', null)
		.maybeSingle();
	if (!ficha) error(404, 'Ficha não encontrada.');

	// O idioma da ficha entra na lista mesmo se a pessoa parou de estudá-lo.
	const languages = shell.studyLanguages.includes(ficha.language)
		? shell.studyLanguages
		: [ficha.language, ...shell.studyLanguages];
	return {
		id: ficha.id,
		values: {
			language: ficha.language,
			front: fichaHtmlToText(ficha.front),
			back: fichaHtmlToText(ficha.back),
			reverse: ficha.reverse,
			tags: ficha.tags.join(', ')
		},
		cloze: ficha.cloze_count > 0,
		fromAnki: ficha.anki_guid !== null,
		languages,
		ui: shell.uiLanguage
	};
};

export const actions: Actions = {
	save: async ({ locals, request, params }) => {
		const user = await locals.getUser();
		if (!user) error(401, 'Entre para editar fichas.');
		if (!UUID.test(params.id)) error(404, 'Ficha não encontrada.');
		const raw = Object.fromEntries(await request.formData());
		const values = fichaFormValues(raw);
		const parsed = parseFichaInput(raw);
		if (!parsed.ok) return fail(400, { errors: parsed.errors as FichaErrors, values });

		// Desligar o inverso apaga o flashcard verso → frente (gatilho fichas_sync_flashcards).
		const { data, error: dbError } = await locals.supabase
			.from('fichas')
			.update(parsed.value)
			.eq('id', params.id)
			.eq('user_id', user.id)
			.is('deleted_at', null)
			.select('id');
		if (dbError || data.length === 0) {
			const errors: FichaErrors = {
				form: dbError ? 'Não deu para salvar agora. Tente de novo.' : 'Ficha não encontrada.'
			};
			return fail(dbError ? 500 : 404, { errors, values });
		}
		redirect(303, '/flashcards/fichas?salva=1');
	},

	delete: async ({ locals, params }) => {
		const user = await locals.getUser();
		if (!user) error(401, 'Entre para apagar fichas.');
		if (!UUID.test(params.id)) error(404, 'Ficha não encontrada.');
		// Apagar marca deleted_at, como nos itens: a exclusão precisa chegar ao sync.
		const { error: dbError } = await locals.supabase
			.from('fichas')
			.update({ deleted_at: new Date().toISOString() })
			.eq('id', params.id)
			.eq('user_id', user.id)
			.is('deleted_at', null);
		if (dbError) {
			const errors: FichaErrors = { form: 'Não deu para apagar agora.' };
			return fail(500, { errors, values: null });
		}
		redirect(303, '/flashcards/fichas?apagada=1');
	}
};
