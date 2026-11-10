import { describe, expect, test } from 'bun:test';
import { isProtectedPath, parseEmail, safeNext } from './auth';

describe('safeNext', () => {
	test('aceita caminho interno com query', () => {
		expect(safeNext('/palavras?lang=it')).toBe('/palavras?lang=it');
	});

	test('sem valor cai no padrão', () => {
		expect(safeNext(null)).toBe('/palavras');
		expect(safeNext('')).toBe('/palavras');
	});

	test('recusa URLs externas e protocol-relative', () => {
		expect(safeNext('https://evil.example')).toBe('/palavras');
		expect(safeNext('//evil.example')).toBe('/palavras');
		expect(safeNext('/\\evil.example')).toBe('/palavras');
		expect(safeNext('javascript:alert(1)')).toBe('/palavras');
	});
});

describe('isProtectedPath', () => {
	test('/palavras e subrotas exigem login', () => {
		expect(isProtectedPath('/palavras')).toBe(true);
		expect(isProtectedPath('/palavras/123')).toBe(true);
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
