import { describe, expect, test } from 'bun:test';
import { isProtectedPath, parseEmail, safeNext } from './auth';

describe('safeNext', () => {
	test('aceita caminho interno com query', () => {
		expect(safeNext('/palavras?lang=it')).toBe('/palavras?lang=it');
	});

	test('sem valor cai no padrão', () => {
		expect(safeNext(null)).toBe('/inicio');
		expect(safeNext('')).toBe('/inicio');
	});

	test('recusa URLs externas e protocol-relative', () => {
		expect(safeNext('https://evil.example')).toBe('/inicio');
		expect(safeNext('//evil.example')).toBe('/inicio');
		expect(safeNext('/\\evil.example')).toBe('/inicio');
		expect(safeNext('javascript:alert(1)')).toBe('/inicio');
	});
});

describe('isProtectedPath', () => {
	test('/palavras e subrotas exigem login', () => {
		expect(isProtectedPath('/palavras')).toBe(true);
		expect(isProtectedPath('/palavras/123')).toBe(true);
	});

	test('/inicio e /perfil exigem login', () => {
		expect(isProtectedPath('/inicio')).toBe(true);
		expect(isProtectedPath('/perfil')).toBe(true);
	});

	test('/flashcards exige login', () => {
		expect(isProtectedPath('/flashcards')).toBe(true);
	});

	test('/musica e subrotas exigem login', () => {
		expect(isProtectedPath('/musica')).toBe(true);
		expect(isProtectedPath('/musica/abc')).toBe(true);
		expect(isProtectedPath('/musicaa')).toBe(false);
	});

	test('/integracoes exige login; /api usa token, não sessão', () => {
		expect(isProtectedPath('/integracoes')).toBe(true);
		expect(isProtectedPath('/api/v1/items')).toBe(false);
	});

	test('rotas públicas não exigem', () => {
		expect(isProtectedPath('/')).toBe(false);
		expect(isProtectedPath('/entrar')).toBe(false);
		expect(isProtectedPath('/palavrasx')).toBe(false);
	});
});

describe('parseEmail', () => {
	test('normaliza para minúsculas e sem espaços', () => {
		expect(parseEmail('  Ana@Exemplo.COM ')).toBe('ana@exemplo.com');
	});

	test('recusa vazio, sem @ e não-texto', () => {
		expect(parseEmail('')).toBeNull();
		expect(parseEmail('ana.exemplo.com')).toBeNull();
		expect(parseEmail('ana@')).toBeNull();
		expect(parseEmail('a b@x.com')).toBeNull();
		expect(parseEmail(null)).toBeNull();
	});
});
