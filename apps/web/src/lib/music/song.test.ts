import { describe, expect, test } from 'bun:test';
import { parseSongInput } from './song.ts';

const base = {
	url: 'https://youtu.be/AbC123_-xyZ',
	title: '  Canção Falsa ',
	artist: 'Banda Inventada',
	lang: 'EN'
};

describe('parseSongInput', () => {
	test('aceita e normaliza', () => {
		expect(parseSongInput(base)).toEqual({
			ok: true,
			value: {
				youtubeId: 'AbC123_-xyZ',
				title: 'Canção Falsa',
				artist: 'Banda Inventada',
				lang: 'en'
			}
		});
	});

	test('mensagens por campo em português', () => {
		const out = parseSongInput({ url: 'oi', title: '', artist: ' ', lang: 'fr' });
		expect(out.ok).toBe(false);
		if (out.ok) return;
		expect(out.errors).toEqual({
			url: 'Cole um link de vídeo do YouTube.',
			title: 'Escreva o título da música.',
			artist: 'Escreva o artista.',
			lang: 'Escolha inglês ou italiano.'
		});
		expect(out.values.url).toBe('oi');
	});

	test('recusa título e artista maiores que 200', () => {
		const out = parseSongInput({ ...base, title: 'x'.repeat(201), artist: 'y'.repeat(201) });
		expect(out.ok).toBe(false);
		if (out.ok) return;
		expect(out.errors.title).toBe('Use no máximo 200 caracteres.');
		expect(out.errors.artist).toBe('Use no máximo 200 caracteres.');
	});

	test('valores que não são texto viram vazio', () => {
		expect(parseSongInput({ url: 3, title: null, artist: undefined, lang: {} }).ok).toBe(false);
	});
});
