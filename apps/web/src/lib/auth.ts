export const HOME_AFTER_LOGIN = '/inicio';

const PROTECTED_PREFIXES = [
	'/inicio',
	'/palavras',
	'/revisar',
	'/integracoes',
	'/musica',
	'/perfil',
	'/parear'
];

/** Só aceita caminhos internos ("/algo"), para não virar open redirect. */
export function safeNext(next: string | null | undefined): string {
	if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
		return HOME_AFTER_LOGIN;
	}
	return next;
}

export function isProtectedPath(pathname: string): boolean {
	return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Validação leve: o Supabase valida de verdade ao mandar o link. */
export function parseEmail(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	const email = raw.trim().toLowerCase();
	if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
	return email;
}
