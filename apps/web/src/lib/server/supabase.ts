import { createServerClient } from '@supabase/ssr';
import type { Cookies } from '@sveltejs/kit';
import { PUBLIC_SUPABASE_PUBLISHABLE_KEY, PUBLIC_SUPABASE_URL } from '$app/env/public';
import type { Database } from '#lib/database.types.ts';

/**
 * Um cliente por request. Os cabeçalhos anti-cache que o @supabase/ssr pede
 * quando grava cookie de sessão vão para `pendingHeaders`, aplicados na resposta.
 */
export function createRequestClient(cookies: Cookies, pendingHeaders: Headers) {
	return createServerClient<Database>(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
		cookies: {
			getAll: () => cookies.getAll(),
			setAll: (cookiesToSet, headers) => {
				for (const { name, value, options } of cookiesToSet) {
					cookies.set(name, value, { ...options, path: '/' });
				}
				for (const [key, value] of Object.entries(headers)) pendingHeaders.set(key, value);
			}
		}
	});
}
