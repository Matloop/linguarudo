import { redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { HOME_AFTER_LOGIN, isProtectedPath } from '#lib/auth.ts';
import { createRequestClient } from '#lib/server/supabase.ts';
import { corsHeaders } from '#lib/server/api.ts';
import { THEME_COOKIE, parseTheme, themeClass } from '#lib/prefs.ts';

/** /api: só token (sem cookie de sessão) e CORS para as origens do fork. */
const handleApi: Handle = async ({ event, resolve }) => {
	const cors = corsHeaders(event.request.headers.get('origin'));
	if (event.request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
	// Sem rota, o resolve renderizaria a página de erro, que precisa da sessão que /api não monta.
	const response = event.route.id
		? await resolve(event)
		: Response.json({ message: 'Rota não encontrada.' }, { status: 404 });
	cors.forEach((value, key) => response.headers.set(key, value));
	response.headers.set('Cache-Control', 'no-store');
	return response;
};

export const handle: Handle = async ({ event, resolve }) => {
	if (event.url.pathname.startsWith('/api/')) return handleApi({ event, resolve });

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

	// O tema escolhido entra como classe na raiz, já no HTML do servidor (sem piscar).
	const theme = themeClass(parseTheme(event.cookies.get(THEME_COOKIE)));
	const response = await resolve(event, {
		filterSerializedResponseHeaders: (name) =>
			name === 'content-range' || name === 'x-supabase-api-version',
		transformPageChunk: ({ html }) => html.replace('%linguetta.tema%', theme)
	});
	pendingHeaders.forEach((value, key) => response.headers.set(key, value));
	return response;
};
