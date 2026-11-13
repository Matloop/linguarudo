import { error, fail } from '@sveltejs/kit';
import { droppedMedia } from '#lib/media.ts';
import {
	FICHA_MEDIA_COLUMNS,
	fichaSaveError,
	isFichaId,
	loadFichaEdit,
	pickFichaMedia,
	readFichaForm,
	type FichaErrors
} from '#lib/server/fichas.ts';
import { releaseMedia } from '#lib/server/media.ts';
import type { Actions, PageServerLoad } from './$types';

// A ficha abre no FichaDialog em modo edição: por cima da lista (/flashcards/fichas, com
// pushState) ou aqui, quando o link chega direto. As actions servem aos dois e à revisão.

export const load: PageServerLoad = async ({ locals, params, parent }) => {
	const { shell } = await parent();
	if (!shell) error(401, 'Entre para editar fichas.');
	const user = await locals.getUser();
	if (!user) error(401, 'Entre para editar fichas.');
	const ficha = await loadFichaEdit(locals.supabase, user.id, params.id);
	if (!ficha) error(404, 'Ficha não encontrada.');
	return { ficha, ui: shell.uiLanguage };
};

export const actions: Actions = {
	save: async ({ locals, request, params }) => {
		const user = await locals.getUser();
		if (!user) error(401, 'Entre para editar fichas.');
		if (!isFichaId(params.id)) error(404, 'Ficha não encontrada.');
		const form = readFichaForm(Object.fromEntries(await request.formData()), user.id);
		if (!form.ok) return fail(400, { errors: form.errors });

		const { data: before } = await locals.supabase
			.from('fichas')
			.select(FICHA_MEDIA_COLUMNS)
			.eq('id', params.id)
			.eq('user_id', user.id)
			.is('deleted_at', null)
			.maybeSingle();

		// Desligar o inverso apaga o flashcard verso → frente (gatilho fichas_sync_flashcards).
		const { data, error: dbError } = await locals.supabase
			.from('fichas')
			.update({ ...form.value, ...(form.deck ? { deck_id: form.deck } : {}) })
			.eq('id', params.id)
			.eq('user_id', user.id)
			.is('deleted_at', null)
			.select('id');
		if (dbError || data.length === 0) {
			const errors: FichaErrors = dbError
				? fichaSaveError(dbError)
				: { form: 'Ficha não encontrada.' };
			return fail(dbError ? 500 : 404, { errors });
		}
		if (before) {
			await releaseMedia(
				locals.supabase,
				droppedMedia(
					Object.values(pickFichaMedia(before)),
					Object.values(pickFichaMedia(form.value))
				)
			);
		}
		return { message: 'Ficha salva' };
	},

	delete: async ({ locals, params }) => {
		const user = await locals.getUser();
		if (!user) error(401, 'Entre para apagar fichas.');
		if (!isFichaId(params.id)) error(404, 'Ficha não encontrada.');
		// Apagar marca deleted_at, como nos itens: a exclusão precisa chegar ao sync.
		const { data, error: dbError } = await locals.supabase
			.from('fichas')
			.update({ deleted_at: new Date().toISOString() })
			.eq('id', params.id)
			.eq('user_id', user.id)
			.is('deleted_at', null)
			.select(FICHA_MEDIA_COLUMNS);
		if (dbError) return fail(500, { message: 'Não deu para apagar agora.' });
		// A mídia que só esta ficha usava sai do bucket (libera a cota).
		const gone = (data ?? []).flatMap((r) => Object.values(pickFichaMedia(r)));
		await releaseMedia(locals.supabase, droppedMedia(gone, []));
		return { message: 'Ficha apagada' };
	}
};
