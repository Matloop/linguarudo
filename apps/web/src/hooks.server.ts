import { redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { HOME_AFTER_LOGIN, isProtectedPath } from '#lib/auth.ts';
import { createRequestClient } from '#lib/server/supabase.ts';

export const handle: Handle = async ({ event, resolve }) => {
	const pendingHeaders = new Headers();
	const supabase = createRequestClient(event.cookies, pendingHeaders);
	event.locals.supabase = supabase;

	let user: Promise<SessionUser | null> | undefined;
	event.locals.getUser = () => (user ??= readUser());

	// getClaims confere a assinatura do JWT (getSession sozinho não confere nada).
	async function readUser(): Promise<SessionUser | null> {
		const { data, error } = await supabase.auth.getClaims();
		if (error || !data) return null;
		const { sub, email } = data.claims;
		return { id: sub, email: typeof email === 'string' ? email : null };
	}

	const { pathname, search } = event.url;
	if (isProtectedPath(pathname) && !(await event.locals.getUser())) {
		redirect(303, `/entrar?next=${encodeURIComponent(pathname + search)}`);
	}
	if (pathname === '/entrar' && (await event.locals.getUser())) {
		redirect(303, HOME_AFTER_LOGIN);
	}

	const response = await resolve(event, {
		filterSerializedResponseHeaders: (name) =>
			name === 'content-range' || name === 'x-supabase-api-version'
	});
	pendingHeaders.forEach((value, key) => response.headers.set(key, value));
	return response;
};
