// Formulário de ficha no servidor: o que volta para a tela quando a validação falha.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '#lib/database.types.ts';
import {
	FICHA_MEDIA_FIELDS,
	type FichaField,
	type FichaMedia,
	type FichaMediaField
} from '#lib/fichas.ts';
import { signMedia } from './media.ts';

export type FichaErrors = Partial<Record<FichaField | FichaMediaField | 'form', string>>;

/** O que a pessoa digitou, como veio, para repreencher o formulário. */
export function fichaFormValues(raw: Record<string, unknown>) {
	const str = (v: unknown) => (typeof v === 'string' ? v : '');
	const media = Object.fromEntries(
		FICHA_MEDIA_FIELDS.map((f) => [f, str(raw[f]) || null])
	) as FichaMedia;
	return {
		language: str(raw.language),
		front: str(raw.front),
		back: str(raw.back),
		reverse: raw.reverse === 'on',
		tags: str(raw.tags),
		media
	};
}

/** URLs assinadas da mídia da ficha, por campo (para mostrar no formulário). */
export async function fichaMediaUrls(
	supabase: SupabaseClient<Database>,
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
