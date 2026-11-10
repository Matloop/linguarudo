import { redirect } from '@sveltejs/kit';
import { safeNext } from '#lib/auth.ts';
import type { RequestHandler } from './$types';

// Volta do Google (e do link mágico no modelo padrão do Supabase): troca o ?code pela sessão.
export const GET: RequestHandler = async ({ url, locals }) => {
	const code = url.searchParams.get('code');
	const next = safeNext(url.searchParams.get('next'));

	if (code) {
		const { error } = await locals.supabase.auth.exchangeCodeForSession(code);
		if (!error) redirect(303, next);
	}
	redirect(303, `/entrar?erro=google&next=${encodeURIComponent(next)}`);
};
