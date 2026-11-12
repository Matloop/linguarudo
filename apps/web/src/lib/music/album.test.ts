import { describe, expect, test } from 'bun:test';
import { albumFromWork, parseAlbumInput } from './album.ts';

const track = (n: number, language = 'it') => ({
	youtubeId: `AAAAAAAAAA${n}`,
	title: `Faixa ${n}`,
	artist: 'Franco Battiato',
	language
});

const raw = (over: Record<string, unknown> = {}) => ({
	url: 'https://www.youtube.com/playlist?list=PL06EFF001748030B8',
	title: ' La voce del padrone ',
	artist: 'Franco Battiato',
	language: 'it',
	tracks: JSON.stringify([track(1, 'en'), track(2)]),
	...over
});

describe('parseAlbumInput', () => {
	test('vira o pedido de open_album, com a língua de cada faixa', () => {
		const out = parseAlbumInput(raw());
		expect(out).toEqual({
			ok: true,
			value: {
				playlist_id: 'PL06EFF001748030B8',
				title: 'La voce del padrone',
				subtitle: 'Franco Battiato',
				language: 'it',
				tracks: [
					{
						youtube_id: 'AAAAAAAAAA1',
						title: 'Faixa 1',
						subtitle: 'Franco Battiato',
						language: 'en'
					},
					{
						youtube_id: 'AAAAAAAAAA2',
						title: 'Faixa 2',
						subtitle: 'Franco Battiato',
						language: 'it'
					}
				]
			}
		});
	});

	test('nomeia o campo que falhou', () => {
		const out = parseAlbumInput(
			raw({ url: 'https://www.youtube.com/watch?v=AbC123_-xyZ', title: '', tracks: '[]' })
		);
		expect(out.ok).toBe(false);
		if (out.ok) return;
		expect(out.errors).toEqual({
			url: 'Cole o link de uma playlist do YouTube.',
			title: 'Escreva o nome do álbum.',
			tracks: 'Escolha pelo menos uma faixa.'
		});
	});

	test('faixa com vídeo ou língua inválida e lixo no JSON são recusados', () => {
		expect(parseAlbumInput(raw({ tracks: JSON.stringify([track(1, 'xx')]) })).ok).toBe(false);
		expect(
			parseAlbumInput(raw({ tracks: JSON.stringify([{ ...track(1), youtubeId: 'curto' }]) })).ok
		).toBe(false);
		expect(parseAlbumInput(raw({ tracks: '{nao é json' })).ok).toBe(false);
		const many = JSON.stringify(Array.from({ length: 51 }, (_, i) => track(i % 10)));
		expect(parseAlbumInput(raw({ tracks: many })).ok).toBe(false);
	});
});

describe('albumFromWork', () => {
	const row = {
		id: 'w1',
		title: 'La voce del padrone',
		subtitle: 'Franco Battiato',
		language: 'it',
		played_at: '2026-11-12T10:00:00Z',
		refs: {
			playlist_id: 'PL06EFF001',
			cover: 'AAAAAAAAAA1',
			tracks: ['t1', 't2', 't3'],
			position: 1
		}
	};

	test('lê capa, faixas e posição', () => {
		expect(albumFromWork(row)).toEqual({
			id: 'w1',
			title: 'La voce del padrone',
			artist: 'Franco Battiato',
			language: 'it',
			playedAt: '2026-11-12T10:00:00Z',
			cover: 'AAAAAAAAAA1',
			tracks: ['t1', 't2', 't3'],
			position: 1
		});
	});

	test('sem faixas não dá para jogar', () => {
		expect(albumFromWork({ ...row, refs: { playlist_id: 'PL06EFF001', tracks: [] } })).toBe(null);
	});
});
