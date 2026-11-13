import { fail } from '@sveltejs/kit';
import { lemmaKey } from '@linguetta/language';
import { parseItemInput, type ItemField, type SaveEntry } from '#lib/items.ts';
import { parseMediaField, type MediaKind } from '#lib/media.ts';
import { releaseMedia } from '#lib/server/media.ts';
import { loadSettings } from '#lib/server/settings.ts';
import type { Database } from '#lib/database.types.ts';

export type AddErrors = Partial<Record<ItemField | MediaKind | 'form', string>>;

type ItemUpdate = Database['public']['Tables']['items']['Update'];

/**
 * Guardar uma palavra à mão (diálogo Guardar). Lema, leitura, tradução e frase vão pelo
 * save_items; o que vem de "Mais campos" (nota, tags, mídia, deck) entra logo depois,
 * só quando o item é novo: num item que já existia a frase vira encontro e o resto fica.
 */
export async function addItem(locals: App.Locals, userId: string, form: FormData) {
	const settings = await loadSettings(locals.supabase, userId);
	const parsed = parseItemInput(Object.fromEntries(form), settings.studyLanguages);
	const media: { image?: string; audio?: string } = {};
	const mediaErrors: AddErrors = {};
	for (const kind of ['image', 'audio'] as const) {
		const r = parseMediaField(form.get(kind), userId, kind);
		if (!r.ok) mediaErrors[kind] = r.error;
		else if (r.value) media[kind] = r.value;
	}
	if (!parsed.ok || Object.keys(mediaErrors).length > 0) {
		const errors: AddErrors = { ...(parsed.ok ? {} : parsed.errors), ...mediaErrors };
		const values = parsed.ok ? {} : parsed.values;
		return fail(400, { action: 'add' as const, errors, values });
	}

	const { language, lemma, reading, sense, sentence, translation, note, tags, deck } = parsed.value;
	const values = { ...parsed.value, tags: tags.join(', '), deck: deck ?? '' };
	// Deck de outro idioma ou de outra pessoa: recusa antes de criar o item.
	if (deck) {
		const { data: found } = await locals.supabase
			.from('decks')
			.select('id')
			.eq('id', deck)
			.eq('language', language)
			.maybeSingle();
		if (!found) {
			const errors: AddErrors = { deck: 'Escolha um baralho deste idioma.' };
			return fail(400, { action: 'add' as const, errors, values });
		}
	}

	const entry: SaveEntry = {
		language,
		lemma,
		lemma_key: lemmaKey(lemma, language),
		reading,
		sense,
		note,
		ipa: '',
		part_of_speech: ''
	};
	if (sentence) {
		entry.encounter = {
			form: '',
			sentence,
			highlight: '',
			sense,
			translation,
			position: {},
			origin: 'manual',
			seen_at: null,
			client_id: null
		};
	}
	const uploaded = [media.image, media.audio].filter((p): p is string => !!p);
	const { data, error: dbError } = await locals.supabase.rpc('save_items', { p_items: [entry] });
	const saved = data?.[0];
	if (dbError || !saved) {
		await releaseMedia(locals.supabase, uploaded);
		const errors: AddErrors = { form: 'Não deu para salvar agora. Tente de novo.' };
		return fail(500, { action: 'add' as const, errors, values });
	}
	if (!saved.created) {
		// Item que já existia: a mídia enviada agora não ficou em lugar nenhum.
		await releaseMedia(locals.supabase, uploaded);
		if (!saved.encounter_id) {
			const errors: AddErrors = { lemma: `“${saved.lemma}” já está no seu banco.` };
			return fail(409, { action: 'add' as const, errors, values });
		}
		return {
			action: 'add' as const,
			added: saved.lemma,
			message: `“${saved.lemma}” já estava no banco. A frase entrou como novo encontro.`
		};
	}

	// save_items já gravou a nota; o resto de "Mais campos" é um update no item novo.
	const extras: ItemUpdate = {};
	if (tags.length > 0) extras.tags = tags;
	if (media.image) extras.image = media.image;
	if (media.audio) extras.audio = media.audio;
	if (deck) extras.deck_id = deck;
	if (Object.keys(extras).length > 0) {
		const { error: extraError } = await locals.supabase
			.from('items')
			.update(extras)
			.eq('id', saved.item_id)
			.eq('user_id', userId);
		if (extraError) {
			await releaseMedia(locals.supabase, uploaded);
			return {
				action: 'add' as const,
				added: saved.lemma,
				message: `“${saved.lemma}” guardada, mas sem tags, mídia ou baralho. Complete no painel.`
			};
		}
	}
	return { action: 'add' as const, added: saved.lemma, message: `“${saved.lemma}” guardada.` };
}
