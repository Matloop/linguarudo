import { describe, expect, test } from 'bun:test';
import { shortcutFor, type KeyContext } from './shortcuts';

const base: KeyContext = { screen: 'outra', typing: false, dialogOpen: false };
const key = (k: string, over: Record<string, unknown> = {}) => ({ key: k, ...over });

describe('atalhos globais', () => {
	test('N abre o Guardar em qualquer tela, maiúsculo ou não', () => {
		expect(shortcutFor(key('n'), base)).toEqual({ type: 'guardar' });
		expect(shortcutFor(key('N'), { ...base, screen: 'revisar' })).toEqual({ type: 'guardar' });
	});

	test('[ recolhe e abre a barra lateral', () => {
		expect(shortcutFor(key('['), base)).toEqual({ type: 'barra' });
	});

	test('nada dispara digitando, com diálogo aberto ou com modificador', () => {
		expect(shortcutFor(key('n'), { ...base, typing: true })).toBeNull();
		expect(shortcutFor(key('n'), { ...base, dialogOpen: true })).toBeNull();
		expect(shortcutFor(key('n', { ctrlKey: true }), base)).toBeNull();
		expect(shortcutFor(key('n', { metaKey: true }), base)).toBeNull();
		expect(shortcutFor(key('n', { altKey: true }), base)).toBeNull();
	});

	test('tecla segurada não repete o atalho', () => {
		expect(shortcutFor(key('n', { repeat: true }), base)).toBeNull();
	});
});

describe('atalhos por tela', () => {
	test('R no Início abre a revisão; fora dele não faz nada', () => {
		expect(shortcutFor(key('r'), { ...base, screen: 'inicio' })).toEqual({ type: 'revisar' });
		expect(shortcutFor(key('r'), base)).toBeNull();
	});

	test('/ em Minhas palavras vai para a busca', () => {
		expect(shortcutFor(key('/'), { ...base, screen: 'palavras' })).toEqual({ type: 'buscar' });
		expect(shortcutFor(key('/'), base)).toBeNull();
	});

	test('na revisão: Espaço vira, 1–4 avaliam só com o cartão virado, Z desfaz', () => {
		const rv: KeyContext = { ...base, screen: 'revisar', flipped: false };
		expect(shortcutFor(key(' '), rv)).toEqual({ type: 'virar' });
		expect(shortcutFor(key('3'), rv)).toBeNull();
		expect(shortcutFor(key('3'), { ...rv, flipped: true })).toEqual({ type: 'nota', grade: 3 });
		expect(shortcutFor(key('1'), { ...rv, flipped: true })).toEqual({ type: 'nota', grade: 1 });
		expect(shortcutFor(key('5'), { ...rv, flipped: true })).toBeNull();
		expect(shortcutFor(key('z'), rv)).toEqual({ type: 'desfazer' });
		expect(shortcutFor(key('Z'), rv)).toEqual({ type: 'desfazer' });
	});

	test('Espaço com o cartão já virado não faz nada', () => {
		expect(shortcutFor(key(' '), { ...base, screen: 'revisar', flipped: true })).toBeNull();
	});
});
