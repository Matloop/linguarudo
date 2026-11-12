// Um teste por bug relatado na sincronia da letra. Rodam com o player falso cheio de
// manias (seek atrasado, keyframe, buffering, eventos atrasados, tremida).

import { describe, expect, test } from 'bun:test';
import { checkAll } from './invariants.ts';
import { SIM_LYRICS, Simulator } from './simulator.ts';

const QUIRKY = { seekLagMs: 400, keyframeS: 2, bufferMs: 250, stateLagMs: 60, jitterS: 0.1 };

/** Responde certo o que der para responder, para a música seguir. */
function answerAll(sim: Simulator) {
	const a = sim.view.answerable;
	if (a) sim.send({ type: 'answer', option: a.answer });
}

function noViolations(sim: Simulator) {
	expect(checkAll(sim.steps, sim.session)).toEqual([]);
}

describe('bug: a letra sai do tempo no meio da música', () => {
	// O clipe tem intro 10 s maior e uma pausa de 8 s inserida antes da 5ª linha.
	const truth = (i: number) => SIM_LYRICS[i].start + 10 + (i >= 4 ? 8 : 0);

	test('tocando duas linhas, a música inteira fica no tempo', () => {
		const sim = new Simulator({ player: { ...QUIRKY, duration: 60 } });
		sim.start();
		sim.run(500);
		sim.send({ type: 'openSync' });
		sim.runUntilVideo(truth(0));
		sim.send({ type: 'selectLine', line: 0 });
		sim.runUntilVideo(truth(4));
		sim.send({ type: 'selectLine', line: 4 });
		sim.send({ type: 'closeSync', conclude: true });

		for (let i = 0; i < SIM_LYRICS.length; i++) {
			expect(Math.abs(sim.ctl.lineStart(i) - truth(i))).toBeLessThan(0.2);
		}
		// Daqui para a frente o jogo acompanha o vídeo de verdade em cada linha.
		for (let i = 5; i < SIM_LYRICS.length; i++) {
			while (sim.player.trueTime < truth(i) + 0.6 && sim.now < 200_000) {
				answerAll(sim);
				sim.run(16);
			}
			expect(sim.view.shownLine).toBe(i);
		}
		noViolations(sim);
	});
});

describe('bug: a sincronia mostra as palavras das lacunas', () => {
	test('na sincronia as lacunas sem resposta continuam lacunas', () => {
		const sim = new Simulator({ player: QUIRKY });
		sim.start();
		sim.run(2_000);
		sim.send({ type: 'openSync' });
		const open = sim.view.lines.filter((l) => l.hasGap && !l.result);
		expect(open.length).toBeGreaterThan(0);
		for (const line of open) {
			const gap = sim.session.gaps.find((g) => g.line === line.index)!;
			expect(line.parts[gap.token]).toEqual({ kind: 'gap', token: gap.token });
		}
		noViolations(sim);
	});
});

describe('bug: abrir a sincronia pausa, despausa e pula o vídeo', () => {
	test('abrir e fechar não mandam nada para o player e o vídeo segue', () => {
		const sim = new Simulator({ player: QUIRKY });
		sim.start();
		sim.run(2_500);
		expect(sim.player.playing).toBe(true);
		const calls = sim.player.log.length;
		const at = sim.player.trueTime;
		expect(sim.send({ type: 'openSync' })).toEqual([]);
		sim.run(3_000);
		expect(sim.send({ type: 'closeSync', conclude: true })).toEqual([]);
		expect(sim.send({ type: 'openSync' })).toEqual([]);
		expect(sim.send({ type: 'closeSync', conclude: false })).toEqual([]);
		expect(sim.player.log.length).toBe(calls);
		expect(sim.player.playing).toBe(true);
		expect(sim.player.trueTime).toBeGreaterThan(at + 2.9);
		noViolations(sim);
	});

	test('com o vídeo pausado, fecha a sincronia pausado e sem seek', () => {
		const sim = new Simulator({ player: QUIRKY });
		sim.start();
		sim.run(3_000);
		sim.send({ type: 'togglePause' });
		sim.run(500);
		const calls = sim.player.log.length;
		sim.send({ type: 'openSync' });
		sim.send({ type: 'closeSync', conclude: true });
		expect(sim.player.log.length).toBe(calls);
		expect(sim.view.phase).toBe('paused');
		noViolations(sim);
	});
});

describe('bug: a linha escolhida muda sozinha depois de marcar', () => {
	test('marcar não troca a linha e ela continua acesa', () => {
		const sim = new Simulator({ player: QUIRKY });
		sim.start();
		sim.run(4_000);
		sim.send({ type: 'openSync' });
		sim.send({ type: 'selectLine', line: 2 });
		expect(sim.view.sync?.selected).toBe(2);
		sim.run(16);
		expect(sim.view.shownLine).toBe(2);
		sim.run(6_000);
		expect(sim.view.sync?.selected).toBe(2);
		sim.send({ type: 'mark' });
		expect(sim.view.sync?.selected).toBe(2);
		sim.run(16);
		expect(sim.view.shownLine).toBe(2);
		noViolations(sim);
	});

	test('voltar ao começo pelo painel: a linha acesa não pisca com o tempo antigo', () => {
		const sim = new Simulator({ player: QUIRKY });
		sim.start();
		sim.run(12_000);
		sim.send({ type: 'openSync' });
		sim.send({ type: 'syncRestart' });
		const shown: number[] = [];
		for (let i = 0; i < 40; i++) {
			sim.run(16);
			shown.push(sim.view.shownLine);
		}
		expect(shown.every((l) => l === -1)).toBe(true);
		noViolations(sim);
	});
});
