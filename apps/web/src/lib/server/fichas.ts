// Fichas no servidor: ler a ficha para o diálogo de edição e validar o formulário dele
// (criar em /flashcards/fichas?/create, salvar em /flashcards/fichas/[id]?/save).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '#lib/database.types.ts';
import {
	FICHA_MEDIA_FIELDS,
	fichaHtmlToText,
	parseFichaInput,
	parseFichaMedia,
	type FichaEdit,
	type FichaField,
	type FichaInput,
	type FichaMedia,
	type FichaMediaField
} from '#lib/fichas.ts';
import { signMedia } from './media.ts';

type Client = SupabaseClient<Database>;

export type FichaErrors = Partial<Record<FichaField | FichaMediaField | 'deck' | 'form', string>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const FICHA_MEDIA_COLUMNS = 'front_image, front_audio, back_image, back_audio' as const;

export function isFichaId(id: string): boolean {
	return UUID.test(id);
}

export function pickFichaMedia(row: FichaMedia): FichaMedia {
	return {
		front_image: row.front_image,
		front_audio: row.front_audio,
		back_image: row.back_image,
		back_audio: row.back_audio
	};
}

/** URLs assinadas da mídia da ficha, por campo (para mostrar no formulário). */
export async function fichaMediaUrls(
	supabase: Client,
	media: FichaMedia
): Promise<Partial<Record<FichaMediaField, string>>> {
	const urls = await signMedia(supabase, Object.values(media));
	const out: Partial<Record<FichaMediaField, string>> = {};
	for (const f of FICHA_MEDIA_FIELDS) {
		const url = media[f] ? urls.get(media[f]) : undefined;
		if (url) out[f] = url;
	}
	return out;
}

/** A ficha do usuário pronta para o diálogo em modo edição; null se não existe. */
export async function loadFichaEdit(
	supabase: Client,
	userId: string,
	id: string
): Promise<FichaEdit | null> {
	if (!isFichaId(id)) return null;
	const { data: f } = await supabase
		.from('fichas')
		.select(
			`id, language, front, back, reverse, cloze_count, tags, deck_id, ${FICHA_MEDIA_COLUMNS}`
		)
		.eq('id', id)
		.eq('user_id', userId)
		.is('deleted_at', null)
		.maybeSingle();
	if (!f) return null;
	const media = pickFichaMedia(f);
	return {
		id: f.id,
		language: f.language,
		front: fichaHtmlToText(f.front),
		back: fichaHtmlToText(f.back),
		reverse: f.reverse,
		tags: f.tags,
		cloze: f.cloze_count > 0,
		deckId: f.deck_id,
		media,
		mediaUrls: await fichaMediaUrls(supabase, media)
	};
}

export type FichaFormRead =
	| { ok: true; value: FichaInput & FichaMedia; deck: string | null }
	| { ok: false; errors: FichaErrors };

/**
 * Formulário do diálogo da ficha: texto, mídia e o deck escolhido (null = não mudou / o
 * padrão do idioma). O banco confere dono e idioma do deck (gatilho fichas_deck).
 */
export function readFichaForm(raw: Record<string, unknown>, userId: string): FichaFormRead {
	const parsed = parseFichaInput(raw);
	const media = parseFichaMedia(raw, userId);
	if (!parsed.ok || !media.ok) {
		return {
			ok: false,
			errors: { ...(parsed.ok ? {} : parsed.errors), ...(media.ok ? {} : media.errors) }
		};
	}
	const deck = typeof raw.deck === 'string' && UUID.test(raw.deck) ? raw.deck : null;
	return { ok: true, value: { ...parsed.value, ...media.value }, deck };
}

/** Erro do banco ao gravar a ficha, no campo certo (deck de outro idioma vem do gatilho). */
export function fichaSaveError(dbError: { message: string }): FichaErrors {
	return dbError.message.includes('deck_language')
		? { deck: 'Esse baralho é de outro idioma.' }
		: { form: 'Não deu para salvar agora. Tente de novo.' };
}
