import { error, fail } from '@sveltejs/kit';
import { formatUserCode, normalizeUserCode } from '#lib/sync.ts';
import type { Actions, PageServerLoad } from './$types';

// Página do pareamento do e-reader (docs/sync/CONTRACT.md, seção 3). O aparelho mostra
// o código e um QR para /parear?code=K7Q4MP; a pessoa, logada, aprova ou recusa.

async function requireUser(locals: App.Locals) {
	const user = await locals.getUser();
	if (!user) error(401, 'Entre para parear um aparelho.');
	return user;
}

export const load: PageServerLoad = async ({ locals, url }) => {
	await requireUser(locals);
	const raw = url.searchParams.get('code');
	if (raw === null || raw.trim() === '') return { code: null, pairing: null, invalid: false };

	const code = normalizeUserCode(raw);
	if (!code) return { code: null, pairing: null, invalid: true };
	const { data, error: dbError } = await locals.supabase.rpc('sync_pair_lookup', {
		p_user_code: code
	});
	if (dbError) error(500, 'Não deu para conferir o código agora.');
	const row = data[0];
	if (!row) return { code: null, pairing: null, invalid: true };
	return {
		code: formatUserCode(code),
		pairing: {
			deviceName: row.device_name,
			deviceModel: row.device_model,
			createdAt: row.created_at
		},
		invalid: false,
		now: new Date().toISOString()
	};
};

async function decide(locals: App.Locals, request: Request, approve: boolean) {
	await requireUser(locals);
	const form = await request.formData();
	const code = normalizeUserCode(form.get('code'));
	const deviceName = String(form.get('deviceName') ?? '').slice(0, 60);
	if (!code) return fail(400, { message: 'Código inválido ou vencido. Gere outro no aparelho.' });
	const { data, error: dbError } = await locals.supabase.rpc('sync_pair_decide', {
		p_user_code: code,
		p_approve: approve
	});
	if (dbError) return fail(500, { message: 'Não deu para responder agora. Tente de novo.' });
	if (data === 'invalid') {
		return fail(410, { message: 'Código inválido ou vencido. Gere outro no aparelho.' });
	}
	return { decided: data as 'approved' | 'denied', deviceName };
}

export const actions: Actions = {
	approve: ({ locals, request }) => decide(locals, request, true),
	deny: ({ locals, request }) => decide(locals, request, false)
};
