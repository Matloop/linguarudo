import { describe, expect, test } from 'bun:test';
import {
	LIMITS,
	isDuplicateError,
	normalizeText,
	normalizeTerm,
	parseLangFilter,
	parseWordInput
} from './words';

describe('normalizeTerm', () => {
	test('tira espaços das pontas e junta espaços repetidos', () => {
		expect(normalizeTerm('  give   up \n')).toBe('give up');
	});

	test('mantém maiúsculas (a unicidade ignora caixa no banco)', () => {
		expect(normalizeTerm('London')).toBe('London');
	});

	test('normaliza acentos para NFC', () => {
		const decomposto = 'perché';
		expect(normalizeTerm(decomposto)).toBe('perché');
		expect(normalizeTerm(decomposto).length).toBe(6);
	});
});

describe('normalizeText', () => {
	test('tira espaços das pontas mas preserva quebras internas', () => {
		expect(normalizeText('  primeira linha\nsegunda  ')).toBe('primeira linha\nsegunda');
	});
});

describe('parseLangFilter', () => {
	test('aceita en e it', () => {
		expect(parseLangFilter('en')).toBe('en');
		expect(parseLangFilter('it')).toBe('it');
	});

	test('ignora caixa', () => {
		expect(parseLangFilter('IT')).toBe('it');
	});

	test('qualquer outra coisa vira null (sem filtro)', () => {
		expect(parseLangFilter(null)).toBeNull();
		expect(parseLangFilter('')).toBeNull();
		expect(parseLangFilter('fr')).toBeNull();
	});
});

describe('parseWordInput', () => {
	test('entrada válida volta normalizada', () => {
		const r = parseWordInput({
			term: '  give up ',
			translation: ' desistir ',
			lang: 'en',
			context: ''
		});
		expect(r).toEqual({
			ok: true,
			value: { term: 'give up', translation: 'desistir', lang: 'en', context: '' }
		});
	});

	test('contexto e tradução são opcionais', () => {
		const r = parseWordInput({ term: 'allora', lang: 'it' });
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value).toEqual({ term: 'allora', translation: '', lang: 'it', context: '' });
	});

	test('termo vazio é erro', () => {
		const r = parseWordInput({ term: '   ', lang: 'en' });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.errors.term).toBeString();
	});

	test('idioma inválido é erro', () => {
		const r = parseWordInput({ term: 'hola', lang: 'es' });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.errors.lang).toBeString();
	});

	test('limites batem com os checks do SQL, contando caracteres e não unidades UTF-16', () => {
		const noLimite = 'é'.repeat(LIMITS.term);
		expect(parseWordInput({ term: noLimite, lang: 'it' }).ok).toBe(true);

		const emoji = '🐸'.repeat(LIMITS.term);
		expect(emoji.length).toBe(LIMITS.term * 2);
		expect(parseWordInput({ term: emoji, lang: 'en' }).ok).toBe(true);

		const r = parseWordInput({
			term: 'a'.repeat(LIMITS.term + 1),
			translation: 'b'.repeat(LIMITS.translation + 1),
			context: 'c'.repeat(LIMITS.context + 1),
			lang: 'en'
		});
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(Object.keys(r.errors).sort()).toEqual(['context', 'term', 'translation']);
		}
	});

	test('erro devolve os valores digitados para o formulário', () => {
		const r = parseWordInput({ term: '', translation: 'oi', lang: 'en', context: 'ctx' });
		expect(r.ok).toBe(false);
		if (!r.ok)
			expect(r.values).toEqual({ term: '', translation: 'oi', lang: 'en', context: 'ctx' });
	});

	test('valores que não são texto (ex.: File) contam como vazios', () => {
		const r = parseWordInput({ term: new Blob(['x']), lang: 'en' });
		expect(r.ok).toBe(false);
	});
});

describe('isDuplicateError', () => {
	test('reconhece unique_violation do Postgres', () => {
		expect(isDuplicateError({ code: '23505', message: 'duplicate key' })).toBe(true);
	});

	test('outros erros não são duplicata', () => {
		expect(isDuplicateError({ code: '23514' })).toBe(false);
		expect(isDuplicateError(null)).toBe(false);
	});
});
