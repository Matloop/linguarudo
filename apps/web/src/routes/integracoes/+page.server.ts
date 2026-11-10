import { error, fail } from '@sveltejs/kit';
import { generateToken } from '#lib/server/tokens.ts';
import { normalizeTerm } from '#lib/words.ts';
import type { Actions, PageServerLoad } from './$types';

const LABEL_MAX = 60;

async function requireUser(locals: App.Locals) {
	const user = await locals.getUser();
	if (!user) error(401, 'Entre para ver suas integrações.');
	return user;
}

export const load: PageServerLoad = async ({ locals }) => {
	const user = await requireUser(locals);
	const { data, error: dbError } = await locals.supabase
		.from('api_tokens')
		.select('id, label, token_hint, created_at, last_used_at')
		.eq('user_id', user.id)
		.order('created_at', { ascending: false });
	if (dbError) error(500, 'Não deu para carregar suas integrações agora.');
	return { tokens: data };
};

export const actions: Actions = {
	create: async ({ locals, request }) => {
		const user = await requireUser(locals);
		const raw = (await request.formData()).get('label');
		const label =
			[...normalizeTerm(typeof raw === 'string' ? raw : '')].slice(0, LABEL_MAX).join('') ||
			'Stremio';

		const { token, hash, hint } = generateToken();
		const { error: dbError } = await locals.supabase
			.from('api_tokens')
			.insert({ user_id: user.id, label, token_hash: hash, token_hint: hint });
		if (dbError) {
			return fail(500, { action: 'create' as const, message: 'Não deu para gerar agora.' });
		}
		// Só aqui o token aparece. O banco guarda o hash.
		return { action: 'create' as const, token, label };
	},

	revoke: async ({ locals, request }) => {
		const user = await requireUser(locals);
		const id = (await request.formData()).get('id');
		if (typeof id !== 'string' || id === '') {
			return fail(400, { action: 'revoke' as const, message: 'Token não encontrado.' });
		}
		const { data, error: dbError } = await locals.supabase
			.from('api_tokens')
			.delete()
			.eq('id', id)
			.eq('user_id', user.id)
			.select('id');
		if (dbError || data.length === 0) {
			return fail(dbError ? 500 : 404, {
				action: 'revoke' as const,
				message: 'Não deu para revogar agora.'
			});
		}
		return { action: 'revoke' as const, revoked: id };
	}
};
