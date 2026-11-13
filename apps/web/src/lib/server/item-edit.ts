import { fail } from '@sveltejs/kit';
import { lemmaKey } from '@linguetta/language';
import { isDuplicateError, parseItemEdit, type ItemEditField } from '#lib/items.ts';
import { droppedMedia, parseMediaField, type MediaKind } from '#lib/media.ts';
import { releaseMedia } from '#lib/server/media.ts';

export type EditErrors = Partial<Record<ItemEditField | MediaKind | 'form', string>>;

/** Edição de uma palavra (lema, leitura, tradução, nota, tags, mídia). Usada em /palavras e na revisão. */
export async function editItem(locals: App.Locals, userId: string, form: FormData) {
	const rawId = form.get('id');
	const id = typeof rawId === 'string' && rawId !== '' ? rawId : null;
	const parsed = parseItemEdit(Object.fromEntries(form));
	if (!id)
		return fail(400, {
			action: 'edit' as const,
			id,
			errors: { form: 'Palavra não encontrada.' } as EditErrors
		});
	// Mídia só muda se o formulário trouxer os campos (como as tags).
	const media: { image?: string | null; audio?: string | null } = {};
	const mediaErrors: EditErrors = {};
	for (const kind of ['image', 'audio'] as const) {
		if (!form.has(kind)) continue;
		const r = parseMediaField(form.get(kind), userId, kind);
		if (r.ok) media[kind] = r.value;
		else mediaErrors[kind] = r.error;
	}
	if (!parsed.ok || Object.keys(mediaErrors).length > 0) {
		const errors: EditErrors = { ...(parsed.ok ? {} : parsed.errors), ...mediaErrors };
		return fail(400, { action: 'edit' as const, id, errors });
	}

	// A chave de identidade sai do lema e do idioma do item (ADR 0004).
	const { data: current } = await locals.supabase
		.from('items')
		.select('language, image, audio')
		.eq('id', id)
		.eq('user_id', userId)
		.is('deleted_at', null)
		.maybeSingle();
	if (!current) {
		const errors: EditErrors = { form: 'Palavra não encontrada.' };
		return fail(404, { action: 'edit' as const, id, errors });
	}

	const { data, error: dbError } = await locals.supabase
		.from('items')
		.update({
			...parsed.value,
			...media,
			lemma_key: lemmaKey(parsed.value.lemma, current.language)
		})
		.eq('id', id)
		.eq('user_id', userId)
		.is('deleted_at', null)
		.select('id');
	if (dbError || data.length === 0) {
		const errors: EditErrors = isDuplicateError(dbError)
			? { lemma: `“${parsed.value.lemma}” já está no seu banco.` }
			: { form: 'Não deu para salvar agora. Tente de novo.' };
		return fail(isDuplicateError(dbError) ? 409 : dbError ? 500 : 404, {
			action: 'edit' as const,
			id,
			errors
		});
	}
	const kept = [
		'image' in media ? (media.image ?? null) : current.image,
		'audio' in media ? (media.audio ?? null) : current.audio
	];
	await releaseMedia(locals.supabase, droppedMedia([current.image, current.audio], kept));
	return { action: 'edit' as const, id, edited: parsed.value.lemma };
}
