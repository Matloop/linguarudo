import { createHash, randomBytes } from 'node:crypto';

// Token de integração (fork do Stremio). Só o hash vai para o banco; o token
// aparece uma vez para o usuário copiar.

export function hashToken(token: string): string {
	return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function generateToken(): { token: string; hash: string; hint: string } {
	const token = `lr_${randomBytes(32).toString('base64url')}`;
	return { token, hash: hashToken(token), hint: token.slice(-4) };
}
