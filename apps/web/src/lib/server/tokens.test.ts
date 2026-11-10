import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { generateToken, hashToken } from './tokens';

describe('generateToken', () => {
	test('formato lr_ + 43 caracteres base64url', () => {
		const { token } = generateToken();
		expect(token).toMatch(/^lr_[A-Za-z0-9_-]{43}$/);
	});

	test('hash é o sha256 hex do token (o mesmo que o banco calcula)', () => {
		const { token, hash } = generateToken();
		expect(hash).toBe(createHash('sha256').update(token, 'utf8').digest('hex'));
		expect(hashToken(token)).toBe(hash);
	});

	test('dica são os 4 últimos caracteres', () => {
		const { token, hint } = generateToken();
		expect(hint).toBe(token.slice(-4));
	});

	test('cada token é diferente', () => {
		expect(generateToken().token).not.toBe(generateToken().token);
	});
});
