import { describe, expect, test } from 'bun:test';
import { guessTrack } from './track.ts';
import { parseYoutubeId } from './youtube.ts';

describe('parseYoutubeId', () => {
	const ID = 'AbC123_-xyZ';
	test('aceita as formas comuns de link', () => {
		expect(parseYoutubeId(`https://www.youtube.com/watch?v=${ID}`)).toBe(ID);
		expect(parseYoutubeId(`https://www.youtube.com/watch?v=${ID}&t=42s&list=PL1`)).toBe(ID);
		expect(parseYoutubeId(`https://youtu.be/${ID}?si=abc`)).toBe(ID);
		expect(parseYoutubeId(`https://music.youtube.com/watch?v=${ID}`)).toBe(ID);
		expect(parseYoutubeId(`https://m.youtube.com/watch?v=${ID}`)).toBe(ID);
		expect(parseYoutubeId(`https://www.youtube.com/embed/${ID}`)).toBe(ID);
		expect(parseYoutubeId(`https://www.youtube.com/shorts/${ID}`)).toBe(ID);
		expect(parseYoutubeId(`youtube.com/watch?v=${ID}`)).toBe(ID);
		expect(parseYoutubeId(`  ${ID}  `)).toBe(ID);
	});

	test('recusa o que não é vídeo do YouTube', () => {
		expect(parseYoutubeId('')).toBeNull();
		expect(parseYoutubeId('https://example.com/watch?v=AbC123_-xyZ')).toBeNull();
		expect(parseYoutubeId('https://www.youtube.com/watch?v=curto')).toBeNull();
		expect(parseYoutubeId('https://www.youtube.com/@canal')).toBeNull();
		expect(parseYoutubeId('javascript:alert(1)')).toBeNull();
		expect(parseYoutubeId('muito longo para ser um id de vídeo')).toBeNull();
	});
});

describe('guessTrack', () => {
	test('separa "Artista - Faixa" e tira ruído entre parênteses e colchetes', () => {
		expect(
			guessTrack('Banda Inventada - Canção Falsa (Official Music Video)', 'BandaInventadaVEVO')
		).toEqual({
			artist: 'Banda Inventada',
			title: 'Canção Falsa'
		});
		expect(guessTrack('Banda Inventada – Canção Falsa [HD] (Lyrics)', 'Qualquer Canal')).toEqual({
			artist: 'Banda Inventada',
			title: 'Canção Falsa'
		});
	});

	test('sem separador, usa o canal como artista (sem Topic/VEVO)', () => {
		expect(guessTrack('Canção Falsa', 'Banda Inventada - Topic')).toEqual({
			artist: 'Banda Inventada',
			title: 'Canção Falsa'
		});
		expect(guessTrack('Canção Falsa (Official Video)', 'BandaInventadaVEVO')).toEqual({
			artist: 'BandaInventada',
			title: 'Canção Falsa'
		});
	});

	test('mantém hífens que fazem parte do nome quando não há espaços em volta', () => {
		expect(guessTrack('Banda - Spider-Man Theme', 'x').title).toBe('Spider-Man Theme');
	});

	test('título vazio ou só ruído devolve campos vazios para o usuário preencher', () => {
		expect(guessTrack('', '')).toEqual({ artist: '', title: '' });
	});
});
