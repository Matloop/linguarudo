import { describe, expect, test } from 'bun:test';
import {
	matchWindow,
	normalizeText,
	tokenize,
	tokenSimilarity,
	type MatchLine,
	type TranscriptChunk
} from './match';

// Letras inventadas (nunca letra de música real).
function song(texts: readonly string[], first = 10, gap = 4): MatchLine[] {
	return texts.map((text, index) => ({ index, start: first + index * gap, text }));
}

const VERSES = song([
	'Lantern light on the quiet meadow',
	'Paper boats on the silver harbor',
	'Counting stars above the orchard',
	'Whispers travel through the tunnel',
	'Gentle thunder over the compass',
	'Pocket full of ribbon and feathers',
	'Blanket folded by the window',
	'Kettle singing in the morning'
]);

/** Refrão que volta igual: linhas 2-3 e 7-8 são idênticas, os versos em volta não. */
const CHORUS = song([
	'Walking slowly past the bakery door', // 0  @10
	'Pigeons gather on the painted roof', // 1  @14
	'Hold the lantern, hold it high tonight', // 2  @18
	'Every river finds the sea', // 3  @22
	'Muddy boots beside the garden gate', // 4  @26
	'Grandma hums a tune about the rain', // 5  @30
	'Bicycle bells across the empty square', // 6  @34
	'Hold the lantern, hold it high tonight', // 7  @38
	'Every river finds the sea', // 8  @42
	'Quiet streetlights blinking one by one' // 9  @46
]);

const ITALIANO = song([
	'Perché la città dorme già?',
	'Le finestre parlano di te',
	'Un caffè amaro sul balcone',
	"L'autunno porta via le foglie",
	'Più lontano della luna, più vicino al mare'
]);

const PORTUGUES = song([
	'Não há canção que dure para sempre',
	'O pão de queijo esfria na janela',
	'Coração, você já sabe o caminho',
	'A maré sobe devagar à tarde'
]);

/** Trecho que o Whisper devolveria; tempos relativos à janela. */
function chunk(text: string, start: number, end: number | null = start + 3): TranscriptChunk {
	return { text, start, end };
}

describe('normalizeText e tokenize', () => {
	test('sem acento, pontuação nem maiúsculas', () => {
		expect(normalizeText('Perché la città dorme già?')).toBe('perche la citta dorme gia');
		expect(normalizeText("L'autunno — porta  via!")).toBe('l autunno porta via');
		expect(normalizeText('Coração, você já SABE')).toBe('coracao voce ja sabe');
		expect(tokenize('  ¡Hola,  mundo!  ')).toEqual(['hola', 'mundo']);
	});

	test('escrita sem espaços vira um token por caractere', () => {
		expect(tokenize('夜空の星')).toEqual(['夜', '空', 'の', '星']);
		expect(tokenize('ABC 夜空')).toEqual(['abc', '夜', '空']);
	});

	test('semelhança de palavra tolera erro pequeno e ignora palavra curta diferente', () => {
		expect(tokenSimilarity('lantern', 'lantern')).toBe(1);
		expect(tokenSimilarity('lantern', 'lanterns')).toBeGreaterThan(0.8);
		expect(tokenSimilarity('meadow', 'meddow')).toBeGreaterThan(0.6);
		expect(tokenSimilarity('on', 'in')).toBe(0);
		expect(tokenSimilarity('harbor', 'window')).toBe(0);
	});
});

describe('matchWindow', () => {
	test('transcrição exata: cada trecho ancora a linha no início dele', () => {
		const anchors = matchWindow(VERSES, {
			windowVideoStart: 100,
			chunks: [
				chunk('Paper boats on the silver harbor', 1.2),
				chunk('Counting stars above the orchard', 5.1),
				chunk('Whispers travel through the tunnel.', 9.0)
			]
		});
		expect(anchors.map((a) => a.line)).toEqual([1, 2, 3]);
		expect(anchors.map((a) => a.video)).toEqual([101.2, 105.1, 109]);
		for (const a of anchors) expect(a.score).toBeGreaterThan(0.95);
	});

	test('transcrição com ~40% de erro ainda acha a linha certa', () => {
		const anchors = matchWindow(VERSES, {
			windowVideoStart: 50,
			chunks: [
				// "Gentle thunder over the compass" + "Pocket full of ribbon and feathers"
				chunk('gentle thunda over a compass pocket for ribbons and feather', 2),
				// "Blanket folded by the window" com palavras trocadas e perdidas
				chunk('blankets fold it by window', 9.5),
				// "Kettle singing in the morning" com uma palavra inventada no meio
				chunk('kettle sing yeah in the mornin', 13)
			]
		});
		expect(anchors.map((a) => a.line)).toEqual([4, 6, 7]);
		expect(anchors.map((a) => a.video)).toEqual([52, 59.5, 63]);
	});

	test('trecho que cobre duas linhas ancora a primeira', () => {
		const anchors = matchWindow(VERSES, {
			windowVideoStart: 0,
			chunks: [chunk('Counting stars above the orchard, whispers travel through the tunnel', 3, 11)]
		});
		expect(anchors).toEqual([{ line: 2, video: 3, score: expect.any(Number) }]);
	});

	test('trecho que começa no meio da linha não vira âncora', () => {
		const anchors = matchWindow(VERSES, {
			windowVideoStart: 0,
			chunks: [chunk('the silver harbor counting stars above', 4)]
		});
		expect(anchors).toEqual([]);
		// O fim da linha anterior no começo do trecho também: a linha 2 só começa depois.
		const tail = matchWindow(VERSES, {
			windowVideoStart: 0,
			chunks: [chunk('silver harbor counting stars above the orchard', 4)]
		});
		expect(tail).toEqual([]);
	});

	test('refrão: o que vem depois desempata sem precisar de tempo esperado', () => {
		const anchors = matchWindow(CHORUS, {
			windowVideoStart: 0,
			chunks: [chunk('Every river finds the sea, quiet streetlights blinking one by one', 2)]
		});
		expect(anchors.map((a) => a.line)).toEqual([8]);
	});

	test('refrão igual: sem tempo esperado não arrisca', () => {
		const anchors = matchWindow(CHORUS, {
			windowVideoStart: 200,
			chunks: [chunk('Hold the lantern, hold it high tonight', 3, 6)]
		});
		expect(anchors).toEqual([]);
	});

	test('refrão igual: o tempo esperado escolhe a repetição certa', () => {
		const input = (expectedLyricTime: number) => ({
			windowVideoStart: 200,
			expectedLyricTime,
			chunks: [chunk('Hold the lantern, hold it high tonight', 3, 6)]
		});
		// Janela começa em ~15 s da letra → trecho em ~18 s → primeira vez (linha 2).
		expect(matchWindow(CHORUS, input(15)).map((a) => a.line)).toEqual([2]);
		// ~35 s → segunda vez (linha 7).
		expect(matchWindow(CHORUS, input(35)).map((a) => a.line)).toEqual([7]);
		// Bem no meio das duas: ambíguo, pula.
		expect(matchWindow(CHORUS, input(25))).toEqual([]);
		// Longe de tudo: não confia.
		expect(matchWindow(CHORUS, input(150))).toEqual([]);
	});

	test('nada confiável: texto alheio, trecho curto, marca instrumental', () => {
		const anchors = matchWindow(VERSES, {
			windowVideoStart: 0,
			chunks: [
				chunk('Thank you for watching, see you next time', 2),
				chunk('the the', 6),
				chunk('[Music]', 8),
				chunk('♪♪♪', 10),
				chunk('', 12)
			]
		});
		expect(anchors).toEqual([]);
	});

	test('trecho logo no começo da janela pode estar cortado: ignora', () => {
		const anchors = matchWindow(VERSES, {
			windowVideoStart: 0,
			chunks: [chunk('Paper boats on the silver harbor', 0.1)]
		});
		expect(anchors).toEqual([]);
	});

	test('acentos e pontuação não atrapalham (italiano)', () => {
		const anchors = matchWindow(ITALIANO, {
			windowVideoStart: 30,
			chunks: [
				chunk('perche la citta dorme gia', 1),
				chunk('Le finestre parlano di te...', 5),
				chunk('L autunno porta via le foglie', 13.4),
				chunk('Piu lontano della luna piu vicino al mare', 17)
			]
		});
		expect(anchors.map((a) => [a.line, a.video])).toEqual([
			[0, 31],
			[1, 35],
			[3, 43.4],
			[4, 47]
		]);
	});

	test('português com erro de transcrição', () => {
		const anchors = matchWindow(PORTUGUES, {
			windowVideoStart: 0,
			chunks: [
				chunk('nao a cancao que dura pra sempre', 1),
				chunk('o pao de queijo esfria na janela', 5),
				chunk('Coração você já sabe o caminho.', 9)
			]
		});
		expect(anchors.map((a) => a.line)).toEqual([0, 1, 2]);
	});

	test('âncora que destoa do deslocamento das outras sai', () => {
		const anchors = matchWindow(VERSES, {
			windowVideoStart: 0,
			chunks: [
				chunk('Lantern light on the quiet meadow', 1), // offset −9
				chunk('Paper boats on the silver harbor', 5), // offset −9
				chunk('Kettle singing in the morning', 9), // offset −29: destoa
				chunk('Whispers travel through the tunnel', 13) // offset −9
			]
		});
		expect(anchors.map((a) => a.line)).toEqual([0, 1, 3]);
	});

	test('a mesma linha em dois trechos fica uma vez só, a de maior nota', () => {
		const anchors = matchWindow(VERSES, {
			windowVideoStart: 0,
			chunks: [
				chunk('paper bats on a silver harbour', 1),
				chunk('Paper boats on the silver harbor', 1.4)
			]
		});
		expect(anchors).toEqual([{ line: 1, video: 1.4, score: expect.any(Number) }]);
	});

	test('letra vazia ou sem trechos', () => {
		expect(matchWindow([], { windowVideoStart: 0, chunks: [chunk('abc def ghi', 2)] })).toEqual([]);
		expect(matchWindow(VERSES, { windowVideoStart: 0, chunks: [] })).toEqual([]);
	});

	test('usa o index da linha, não a posição na lista', () => {
		const partial = VERSES.slice(4);
		const anchors = matchWindow(partial, {
			windowVideoStart: 0,
			chunks: [chunk('Blanket folded by the window', 2)]
		});
		expect(anchors.map((a) => a.line)).toEqual([6]);
	});
});
