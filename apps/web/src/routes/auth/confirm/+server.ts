import { redirect } from '@sveltejs/kit';
import type { EmailOtpType } from '@supabase/supabase-js';
import { safeNext } from '#lib/auth.ts';
import type { RequestHandler } from './$types';

const OTP_TYPES: EmailOtpType[] = ['email', 'magiclink', 'signup', 'invite', 'recovery'];

// Link mágico com token_hash (template em supabase/templates/magic_link.html).
export const GET: RequestHandler = async ({ url, locals }) => {
	const tokenHash = url.searchParams.get('token_hash');
	const type = url.searchParams.get('type') as EmailOtpType | null;
	const next = safeNext(url.searchParams.get('next'));

	if (tokenHash && type && OTP_TYPES.includes(type)) {
		const { error } = await locals.supabase.auth.verifyOtp({ token_hash: tokenHash, type });
		if (!error) redirect(303, next);
	}
	redirect(303, `/entrar?erro=link&next=${encodeURIComponent(next)}`);
};
