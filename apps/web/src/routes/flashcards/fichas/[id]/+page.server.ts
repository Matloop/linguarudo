import { error, fail, redirect } from '@sveltejs/kit';
import {
	fichaHtmlToText,
	parseFichaInput,
	parseFichaMedia,
	type FichaMedia
} from '#lib/fichas.ts';
import { droppedMedia } from '#lib/media.ts';
import { fichaFormValues, fichaMediaUrls, type FichaErrors } from '#lib/server/fichas.ts';
import { releaseMedia } from '#lib/server/media.ts';
import type { Actions, PageServerLoad } from './$types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MEDIA_COLUMNS = 'front_image, front_audio, back_image, back_audio' as const;

function pickMedia(row: FichaMedia): FichaMedia {
	return {
		front_image: row.front_image,
		front_audio: row.front_audio,
		back_image: row.back_image,
		back_audio: row.back_audio
	};
}

export const load: PageServerLoad = async ({ locals, params, parent }) => {
	const { shell } = await parent();
	if (!shell) error(401, 'Entre para editar fichas.');
	const user = await locals.getUser();
	if (!user) error(401, 'Entre para editar fichas.');
	if (!UUID.test(params.id)) error(404, 'Ficha não encontrada.');

	const { data: ficha } = await locals.supabase
		.from('fichas')
		.select(`id, language, front, back, reverse, cloze_count, tags, anki_guid, ${MEDIA_COLUMNS}`)
		.eq('id', params.id)
		.eq('user_id', user.id)
		.is('deleted_at', null)
		.maybeSingle();
	if (!ficha) error(404, 'Ficha não encontrada.');

	// O idioma da ficha entra na lista mesmo se a pessoa parou de estudá-lo.
	const languages = shell.studyLanguages.includes(ficha.language)
		? shell.studyLanguages
		: [ficha.language, ...shell.studyLanguages];
	const media = pickMedia(ficha);
	return {
		id: ficha.id,
		values: {
			language: ficha.language,
			front: fichaHtmlToText(ficha.front),
			back: fichaHtmlToText(ficha.back),
			reverse: ficha.reverse,
			tags: ficha.tags.join(', '),
			media
		},
		mediaUrls: await fichaMediaUrls(locals.supabase, media),
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
		const media = parseFichaMedia(raw, user.id);
		if (!parsed.ok || !media.ok) {
			const errors: FichaErrors = {
				...(parsed.ok ? {} : parsed.errors),
				...(media.ok ? {} : media.errors)
			};
			const mediaUrls = await fichaMediaUrls(locals.supabase, values.media);
			return fail(400, { errors, values, mediaUrls });
		}

		const { data: before } = await locals.supabase
			.from('fichas')
			.select(MEDIA_COLUMNS)
			.eq('id', params.id)
			.eq('user_id', user.id)
			.is('deleted_at', null)
			.maybeSingle();

		// Desligar o inverso apaga o flashcard verso → frente (gatilho fichas_sync_flashcards).
		const { data, error: dbError } = await locals.supabase
			.from('fichas')
			.update({ ...parsed.value, ...media.value })
			.eq('id', params.id)
			.eq('user_id', user.id)
			.is('deleted_at', null)
			.select('id');
		if (dbError || data.length === 0) {
			const errors: FichaErrors = {
				form: dbError ? 'Não deu para salvar agora. Tente de novo.' : 'Ficha não encontrada.'
			};
			const mediaUrls = await fichaMediaUrls(locals.supabase, values.media);
			return fail(dbError ? 500 : 404, { errors, values, mediaUrls });
		}
		if (before) {
			await releaseMedia(
				locals.supabase,
				droppedMedia(Object.values(pickMedia(before)), Object.values(media.value))
			);
		}
		redirect(303, '/flashcards/fichas?salva=1');
	},

	delete: async ({ locals, params }) => {
		const user = await locals.getUser();
		if (!user) error(401, 'Entre para apagar fichas.');
		if (!UUID.test(params.id)) error(404, 'Ficha não encontrada.');
		// Apagar marca deleted_at, como nos itens: a exclusão precisa chegar ao sync.
		const { data, error: dbError } = await locals.supabase
			.from('fichas')
			.update({ deleted_at: new Date().toISOString() })
			.eq('id', params.id)
			.eq('user_id', user.id)
			.is('deleted_at', null)
			.select(MEDIA_COLUMNS);
		if (dbError) {
			const errors: FichaErrors = { form: 'Não deu para apagar agora.' };
			return fail(500, { errors, values: null, mediaUrls: {} });
		}
		// A mídia que só esta ficha usava sai do bucket (libera a cota).
		const gone = (data ?? []).flatMap((r) => Object.values(pickMedia(r)));
		await releaseMedia(locals.supabase, droppedMedia(gone, []));
		redirect(303, '/flashcards/fichas?apagada=1');
	}
};
