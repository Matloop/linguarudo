import { createClient } from '@supabase/supabase-js';
import { error, json, type RequestEvent } from '@sveltejs/kit';
import { PUBLIC_SUPABASE_PUBLISHABLE_KEY, PUBLIC_SUPABASE_URL } from '$app/env/public';
import type { Database } from '#lib/database.types.ts';
import { isAllowedOrigin, parseBearer } from '#lib/stremio.ts';

// Rotas /api: o fork do Stremio fala com o app usando um token (Authorization: Bearer).
// Sem cookie e sem service key: o cliente é anônimo e as funções do banco
// (security definer) validam o token e só tocam nas palavras do dono.

let client: ReturnType<typeof createClient<Database>> | undefined;

export function apiClient() {
	return (client ??= createClient<Database>(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
		auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
	}));
}

export function corsHeaders(origin: string | null): Headers {
	const headers = new Headers({ Vary: 'Origin' });
	if (isAllowedOrigin(origin)) {
		headers.set('Access-Control-Allow-Origin', origin!);
		headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
		headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
		headers.set('Access-Control-Max-Age', '600');
	}
	return headers;
}

export function requireToken(event: RequestEvent): string {
	const token = parseBearer(event.request.headers.get('authorization'));
	if (!token) error(401, 'Mande o token em Authorization: Bearer.');
	return token;
}

export async function readJson(request: Request): Promise<unknown> {
	try {
		return await request.json();
	} catch {
		error(400, 'Corpo JSON inválido.');
	}
}

/** Traduz os erros das funções api_* em status HTTP. */
export function rpcFailure(err: { message?: string } | null): never {
	if (err?.message === 'invalid_token') error(401, 'Token inválido ou revogado.');
	if (err?.message === 'bad_request') error(400, 'Requisição inválida.');
	error(500, 'Não deu para falar com o banco agora.');
}

export { json };
