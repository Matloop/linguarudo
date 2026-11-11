import { describe, expect, test } from 'bun:test';
import { parseSongInput, songFromWork, songWork } from './song.ts';

const base = {
	url: 'https://youtu.be/AbC123_-xyZ',
	title: '  Canção Falsa ',
	artist: 'Banda Inventada',
	language: 'EN'
};

describe('parseSongInput', () => {
	test('aceita e normaliza', () => {
		expect(parseSongInput(base)).toEqual({
			ok: true,
			value: {
				youtubeId: 'AbC123_-xyZ',
				title: 'Canção Falsa',
				artist: 'Banda Inventada',
				language: 'en'
			}
		});
	});

	test('mensagens por campo em português', () => {
		const out = parseSongInput({ url: 'oi', title: '', artist: ' ', language: 'fr' });
		expect(out.ok).toBe(false);
		if (out.ok) return;
		expect(out.errors).toEqual({
			url: 'Cole um link de vídeo do YouTube.',
			title: 'Escreva o título da música.',
			artist: 'Escreva o artista.',
			language: 'Escolha inglês ou italiano.'
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
		expect(parseSongInput({ url: 3, title: null, artist: undefined, language: {} }).ok).toBe(false);
	});
});

describe('songWork', () => {
	test('vira uma obra do tipo musica, identificada pelo vídeo', () => {
		const out = parseSongInput(base);
		if (!out.ok) throw new Error('entrada de teste inválida');
		expect(songWork(out.value)).toEqual({
			kind: 'musica',
			title: 'Canção Falsa',
			subtitle: 'Banda Inventada',
			refs: { youtube_id: 'AbC123_-xyZ' },
			language: 'en'
		});
	});
});

describe('songFromWork', () => {
	const row = {
		id: 'w1',
		title: 'Canção Falsa',
		subtitle: 'Banda Inventada',
		refs: { youtube_id: 'AbC123_-xyZ' },
		language: 'it',
		played_at: '2026-11-11T10:00:00Z'
	};

	test('lê a obra do tipo musica como música do jogo', () => {
		expect(songFromWork(row)).toEqual({
			id: 'w1',
			youtubeId: 'AbC123_-xyZ',
			title: 'Canção Falsa',
			artist: 'Banda Inventada',
			language: 'it',
			playedAt: '2026-11-11T10:00:00Z'
		});
	});

	test('sem vídeo ou com idioma fora do jogo, não é música jogável', () => {
		expect(songFromWork({ ...row, refs: {} })).toBeNull();
		expect(songFromWork({ ...row, refs: null })).toBeNull();
		expect(songFromWork({ ...row, language: 'ja' })).toBeNull();
		expect(songFromWork({ ...row, language: null })).toBeNull();
	});
});
