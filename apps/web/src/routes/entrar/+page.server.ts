import { fail, redirect } from '@sveltejs/kit';
import { parseEmail, safeNext } from '#lib/auth.ts';
import type { Actions, PageServerLoad } from './$types';

const AUTH_ERRORS: Record<string, string> = {
	link: 'Esse link expirou ou já foi usado. Peça outro abaixo.',
	google: 'Não deu para entrar com o Google. Tente de novo.'
};

export const load: PageServerLoad = ({ url }) => {
	const erro = url.searchParams.get('erro');
	return {
		next: safeNext(url.searchParams.get('next')),
		authError: erro ? (AUTH_ERRORS[erro] ?? AUTH_ERRORS.link) : null
	};
};

function callbackUrl(origin: string, next: string) {
	return `${origin}/auth/callback?next=${encodeURIComponent(next)}`;
}

export const actions: Actions = {
	google: async ({ locals, url, request }) => {
		const form = await request.formData();
		const next = safeNext(form.get('next')?.toString());

		const { data, error } = await locals.supabase.auth.signInWithOAuth({
			provider: 'google',
			options: { redirectTo: callbackUrl(url.origin, next) }
		});
		if (error || !data.url) {
			return fail(502, { google: true, message: 'O Google não respondeu. Tente de novo.' });
		}
		redirect(303, data.url, { external: true });
	},

	magic: async ({ locals, url, request }) => {
		const form = await request.formData();
		const next = safeNext(form.get('next')?.toString());
		const typed = form.get('email')?.toString() ?? '';
		const email = parseEmail(typed);
		if (!email) {
			return fail(400, { email: typed, message: 'Confira o e-mail digitado.' });
		}

		const { error } = await locals.supabase.auth.signInWithOtp({
			email,
			options: { emailRedirectTo: callbackUrl(url.origin, next) }
		});
		if (error) {
			const message =
				error.status === 429
					? 'Muitos pedidos seguidos. Espere um minuto e tente de novo.'
					: 'Não deu para mandar o link agora. Tente de novo.';
			return fail(error.status === 429 ? 429 : 502, { email: typed, message });
		}
		return { sent: email };
	}
};
