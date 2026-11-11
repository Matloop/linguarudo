// Mídia no servidor: URLs assinadas para mostrar e limpeza do que ficou sem uso.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '#lib/database.types.ts';
import { MEDIA_BUCKET } from '#lib/media.ts';

type Client = SupabaseClient<Database>;

/** Validade das URLs assinadas: cobre uma sessão longa de revisão. */
export const SIGNED_URL_SECONDS = 3 * 60 * 60;

/** URL assinada de cada caminho (os que falharem ficam de fora). */
export async function signMedia(
	supabase: Client,
	paths: readonly (string | null | undefined)[]
): Promise<Map<string, string>> {
	const unique = [...new Set(paths.filter((p): p is string => !!p))];
	const urls = new Map<string, string>();
	if (unique.length === 0) return urls;
	const { data } = await supabase.storage
		.from(MEDIA_BUCKET)
		.createSignedUrls(unique, SIGNED_URL_SECONDS);
	for (const s of data ?? []) {
		if (s.path && s.signedUrl && !s.error) urls.set(s.path, s.signedUrl);
	}
	return urls;
}

/** Apaga do bucket os arquivos que nenhum item ou ficha do usuário usa mais. */
export async function releaseMedia(supabase: Client, paths: readonly string[]): Promise<void> {
	if (paths.length === 0) return;
	const { data: inUse, error } = await supabase.rpc('media_in_use', { p_paths: [...paths] });
	if (error) return;
	const used = new Set(inUse ?? []);
	const orphans = paths.filter((p) => !used.has(p));
	if (orphans.length > 0) await supabase.storage.from(MEDIA_BUCKET).remove(orphans);
}
