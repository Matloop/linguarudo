import { describe, expect, test } from 'bun:test';
import { Game, WAIT_MS, type GameConfig } from './game.ts';

// 4 linhas de 4 s (a primeira começa em 2 s). Lacunas nas linhas 1 e 3.
const OPTIONS = ['alpha', 'bravo', 'charlie', 'delta'];
const config = (over: Partial<GameConfig> = {}): GameConfig => ({
	lines: [
		{ start: 2, end: 6 },
		{ start: 6, end: 10 },
		{ start: 10, end: 14 },
		{ start: 14, end: 18 }
	],
	gaps: [
		{ line: 1, answer: 'bravo', options: OPTIONS },
		{ line: 3, answer: 'delta', options: OPTIONS }
	],
	...over
});

function started(over: Partial<GameConfig> = {}) {
	const game = new Game(config(over));
	game.start();
	return game;
}

describe('início', () => {
	test('começa em "ready" e o start manda o vídeo do zero tocar', () => {
		const game = new Game(config());
		expect(game.phase).toBe('ready');
		expect(game.start()).toEqual([{ type: 'seek', to: 0 }, { type: 'play' }]);
		expect(game.phase).toBe('playing');
	});

	test('tick antes do start não faz nada', () => {
		const game = new Game(config());
		expect(game.tick(7, 0)).toEqual([]);
		expect(game.phase).toBe('ready');
	});
});

describe('linha atual', () => {
	test('antes da primeira linha não há linha atual; depois acompanha o tempo', () => {
		const game = started();
		game.tick(1, 10);
		expect(game.activeLine).toBe(-1);
		game.tick(3, 20);
		expect(game.activeLine).toBe(0);
		game.tick(6.5, 30);
		expect(game.activeLine).toBe(1);
	});

	test('só há lacuna respondível dentro da linha dela', () => {
		const game = started();
		game.tick(3, 10);
		expect(game.answerable).toBeNull();
		game.tick(7, 20);
		expect(game.answerable?.line).toBe(1);
		expect(game.answerable?.options).toEqual(OPTIONS);
	});
});

describe('responder enquanto a linha toca', () => {
	test('acertar soma 100 × combo e sobe o combo; a música segue tocando', () => {
		const game = started();
		game.tick(7, 10);
		expect(game.answer('bravo')).toEqual([]);
		expect(game.score).toBe(100);
		expect(game.combo).toBe(2);
		expect(game.phase).toBe('playing');
		expect(game.results).toEqual([
			{ line: 1, answer: 'bravo', chosen: 'bravo', ok: true, points: 100 }
		]);
		// Já respondida: a linha termina e o jogo não espera.
		expect(game.tick(10.05, 1000)).toEqual([]);
		expect(game.phase).toBe('playing');
		expect(game.answerable).toBeNull();
	});

	test('o combo vai até ×4 e os pontos acompanham', () => {
		const lines = Array.from({ length: 6 }, (_, i) => ({ start: i * 4, end: i * 4 + 4 }));
		const gaps = lines.map((_, line) => ({ line, answer: 'bravo', options: OPTIONS }));
		const game = new Game({ lines, gaps });
		game.start();
		lines.forEach((l, i) => {
			game.tick(l.start + 1, i * 100);
			game.answer('bravo');
		});
		expect(game.results.map((r) => r.points)).toEqual([100, 200, 300, 400, 400, 400]);
		expect(game.score).toBe(1800);
		expect(game.combo).toBe(4);
		expect(game.maxCombo).toBe(4);
	});

	test('errar zera o combo, não dá ponto e não tem segunda tentativa', () => {
		const game = started();
		game.tick(7, 10);
		game.answer('charlie');
		expect(game.score).toBe(0);
		expect(game.combo).toBe(1);
		expect(game.results[0]).toEqual({
			line: 1,
			answer: 'bravo',
			chosen: 'charlie',
			ok: false,
			points: 0
		});
		expect(game.answer('bravo')).toEqual([]);
		expect(game.results).toHaveLength(1);
		expect(game.score).toBe(0);
	});

	test('sem lacuna aberta, responder é ignorado', () => {
		const game = started();
		game.tick(3, 10);
		game.answer('bravo');
		expect(game.results).toEqual([]);
	});

	test('opção que não existe é ignorada', () => {
		const game = started();
		game.tick(7, 10);
		game.answer('zulu');
		expect(game.results).toEqual([]);
		expect(game.answerable?.line).toBe(1);
	});
});

describe('a linha acaba sem resposta', () => {
	function waiting() {
		const game = started();
		game.tick(7, 500);
		const commands = game.tick(10.05, 1000);
		return { game, commands };
	}

	test('o vídeo pausa sozinho e o contador de 10 s começa', () => {
		const { game, commands } = waiting();
		expect(commands).toEqual([{ type: 'pause' }]);
		expect(game.phase).toBe('waiting');
		expect(game.waitLine).toBe(1);
		expect(WAIT_MS).toBe(10_000);
		expect(game.waitRemainingMs(1000)).toBe(10_000);
		expect(game.waitRemainingMs(4000)).toBe(7_000);
		expect(game.answerable?.line).toBe(1);
	});

	test('responder durante a espera retoma o vídeo', () => {
		const { game } = waiting();
		expect(game.answer('bravo')).toEqual([{ type: 'play' }]);
		expect(game.phase).toBe('playing');
		expect(game.score).toBe(100);
		expect(game.waitLine).toBeNull();
	});

	test('errar durante a espera também retoma, mostrando a resposta', () => {
		const { game } = waiting();
		expect(game.answer('alpha')).toEqual([{ type: 'play' }]);
		expect(game.results[0].ok).toBe(false);
		expect(game.phase).toBe('playing');
	});

	test('passados 10 s sem resposta, fim de jogo', () => {
		const { game } = waiting();
		game.tick(10.05, 10_999);
		expect(game.phase).toBe('waiting');
		game.tick(10.05, 11_000);
		expect(game.phase).toBe('gameover');
		expect(game.timeouts).toBe(1);
		expect(game.gameOverLine).toBe(1);
		expect(game.combo).toBe(1);
		expect(game.answerable).toBeNull();
	});

	test('o tempo esgotado também zera o combo e não dá pontos', () => {
		const game = started();
		game.tick(7, 10);
		game.answer('bravo');
		expect(game.combo).toBe(2);
		game.tick(14.5, 20);
		game.tick(18.05, 1000);
		game.tick(18.05, 11_000);
		expect(game.phase).toBe('gameover');
		expect(game.combo).toBe(1);
		expect(game.score).toBe(100);
		expect(game.maxCombo).toBe(2);
	});

	test('pausa manual congela o contador e a retomada continua de onde parou', () => {
		const { game } = waiting();
		expect(game.pause(4000)).toEqual([]);
		expect(game.phase).toBe('paused');
		game.tick(10.05, 60_000);
		expect(game.phase).toBe('paused');
		expect(game.resume(100_000)).toEqual([]);
		expect(game.phase).toBe('waiting');
		expect(game.waitRemainingMs(100_000)).toBe(7_000);
		game.tick(10.05, 106_999);
		expect(game.phase).toBe('waiting');
		game.tick(10.05, 107_000);
		expect(game.phase).toBe('gameover');
	});

	test('"Continuar jogando" volta ao início da linha e segue, com a lacuna ainda aberta', () => {
		const { game } = waiting();
		game.tick(10.05, 11_000);
		expect(game.continueAfterGameOver(12_000)).toEqual([{ type: 'seek', to: 6 }, { type: 'play' }]);
		expect(game.phase).toBe('playing');
		// O player ainda informa o tempo antigo por um instante: não vale esperar de novo.
		expect(game.tick(10.2, 12_050)).toEqual([]);
		expect(game.phase).toBe('playing');
		// Assim que o seek chega, o jogo volta ao normal.
		game.tick(6.1, 12_100);
		expect(game.answerable?.line).toBe(1);
		expect(game.tick(10.05, 15_000)).toEqual([{ type: 'pause' }]);
		expect(game.phase).toBe('waiting');
		expect(game.waitRemainingMs(15_000)).toBe(10_000);
	});

	test('se o seek nunca chegar, o jogo volta a confiar no relógio depois de 3 s', () => {
		const { game } = waiting();
		game.tick(10.05, 11_000);
		game.continueAfterGameOver(12_000);
		expect(game.tick(10.2, 14_000)).toEqual([]);
		expect(game.tick(10.3, 15_001)).toEqual([{ type: 'pause' }]);
	});

	test('"Tentar de novo" zera tudo e recomeça a música', () => {
		const game = started();
		game.tick(7, 10);
		game.answer('bravo');
		game.tick(14.5, 30);
		game.tick(18.05, 40);
		game.tick(18.05, 11_000);
		expect(game.phase).toBe('gameover');
		expect(game.retry(12_000)).toEqual([{ type: 'seek', to: 0 }, { type: 'play' }]);
		expect(game.phase).toBe('playing');
		expect(game.score).toBe(0);
		expect(game.combo).toBe(1);
		expect(game.results).toEqual([]);
		expect(game.timeouts).toBe(0);
		expect(game.waitLine).toBeNull();
	});
});

describe('pausa manual', () => {
	test('pausa e retoma o vídeo', () => {
		const game = started();
		game.tick(3, 10);
		expect(game.pause(20)).toEqual([{ type: 'pause' }]);
		expect(game.phase).toBe('paused');
		expect(game.tick(12, 30)).toEqual([]);
		expect(game.resume(40)).toEqual([{ type: 'play' }]);
		expect(game.phase).toBe('playing');
	});

	test('com o jogo pausado não dá para responder', () => {
		const game = started();
		game.tick(7, 10);
		game.pause(20);
		game.answer('bravo');
		expect(game.results).toEqual([]);
	});

	test('pausar fora de "tocando/esperando" não faz nada', () => {
		const game = new Game(config());
		expect(game.pause(0)).toEqual([]);
		expect(game.phase).toBe('ready');
	});
});

describe('repetir a linha', () => {
	test('tocando: volta ao início da linha atual', () => {
		const game = started();
		game.tick(8.5, 10);
		expect(game.repeatLine(20)).toEqual([{ type: 'seek', to: 6 }]);
		expect(game.phase).toBe('playing');
	});

	test('esperando: abandona a espera e toca a linha de novo', () => {
		const game = started();
		game.tick(7, 10);
		game.tick(10.05, 1000);
		expect(game.repeatLine(2000)).toEqual([{ type: 'seek', to: 6 }, { type: 'play' }]);
		expect(game.phase).toBe('playing');
		expect(game.waitLine).toBeNull();
		game.tick(6.1, 2100);
		expect(game.tick(10.05, 6000)).toEqual([{ type: 'pause' }]);
		expect(game.waitRemainingMs(6000)).toBe(10_000);
	});

	test('pausado: também volta e toca', () => {
		const game = started();
		game.tick(12, 10);
		game.pause(20);
		expect(game.repeatLine(30)).toEqual([{ type: 'seek', to: 10 }, { type: 'play' }]);
		expect(game.phase).toBe('playing');
	});

	test('antes da primeira linha não há o que repetir', () => {
		const game = started();
		game.tick(1, 10);
		expect(game.repeatLine(20)).toEqual([]);
	});
});

describe('fim', () => {
	test('com tudo respondido, o jogo termina logo depois da última linha', () => {
		const game = started();
		game.tick(7, 10);
		game.answer('bravo');
		game.tick(15, 30);
		game.answer('delta');
		expect(game.tick(18.5, 50)).toEqual([]);
		expect(game.phase).toBe('playing');
		expect(game.tick(19.6, 60)).toEqual([{ type: 'pause' }]);
		expect(game.phase).toBe('finished');
	});

	test('lacuna aberta na última linha espera antes de terminar', () => {
		const game = started();
		game.tick(7, 10);
		game.answer('bravo');
		game.tick(17.9, 30);
		game.tick(19.6, 40);
		expect(game.phase).toBe('waiting');
		expect(game.waitLine).toBe(3);
	});

	test('o fim do vídeo termina o jogo em qualquer fase ativa', () => {
		for (const setup of [(g: Game) => g.tick(7, 10), (g: Game) => g.pause(10)]) {
			const game = started();
			setup(game);
			game.finishNow();
			expect(game.phase).toBe('finished');
		}
	});

	test('"Jogar de novo" depois do resumo recomeça', () => {
		const game = started();
		game.finishNow();
		expect(game.retry(5)).toEqual([{ type: 'seek', to: 0 }, { type: 'play' }]);
		expect(game.phase).toBe('playing');
	});
});

describe('resumo', () => {
	test('conta acertos de primeira, erradas e pontos', () => {
		const game = started();
		game.tick(7, 10);
		game.answer('bravo');
		game.tick(15, 30);
		game.answer('alpha');
		expect(game.summary()).toEqual({
			total: 2,
			correct: 1,
			wrong: [{ line: 3, answer: 'delta', chosen: 'alpha', ok: false, points: 0 }],
			score: 100,
			maxCombo: 2,
			timeouts: 0
		});
	});
});
