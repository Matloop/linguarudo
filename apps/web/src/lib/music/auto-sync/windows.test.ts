import { describe, expect, test } from 'bun:test';
import { Windower, type AudioWindow, type WindowEvent } from './windows';

// Taxa pequena para os testes: 100 amostras/s, janela de 20 s com 5 s de sobra.
const SR = 100;
const CHUNK = 25; // 0,25 s por pedaço

function windows(events: WindowEvent[]): AudioWindow[] {
	return events.flatMap((e) => (e.kind === 'janela' ? [e.window] : []));
}

/** Simula o vídeo tocando de `from` por `seconds`, pedaço a pedaço. */
function play(w: Windower, from: number, seconds: number, jitter = () => 0): WindowEvent[] {
	const events: WindowEvent[] = [];
	const n = Math.round((seconds * SR) / CHUNK);
	for (let i = 1; i <= n; i++) {
		const samples = new Float32Array(CHUNK).fill(i);
		events.push(...w.push(samples, { video: from + (i * CHUNK) / SR + jitter(), playing: true }));
	}
	return events;
}

function pause(w: Windower, at: number, seconds: number): WindowEvent[] {
	const events: WindowEvent[] = [];
	for (let i = 0; i < (seconds * SR) / CHUNK; i++) {
		events.push(...w.push(new Float32Array(CHUNK), { video: at, playing: false }));
	}
	return events;
}

describe('Windower', () => {
	test('janelas de 20 s a cada 15 s, com o tempo do vídeo da primeira amostra', () => {
		const w = new Windower({ sampleRate: SR });
		const got = windows(play(w, 42, 50));
		expect(got.map((x) => x.id)).toEqual([1, 2, 3]);
		expect(got.map((x) => x.samples.length)).toEqual([2000, 2000, 2000]);
		expect(got[0].videoStart).toBeCloseTo(42, 6);
		expect(got[1].videoStart).toBeCloseTo(57, 6);
		expect(got[2].videoStart).toBeCloseTo(72, 6);
		expect(got[0].duration).toBe(20);
	});

	test('a sobreposição repete os últimos 5 s', () => {
		const w = new Windower({ sampleRate: SR });
		const [a, b] = windows(play(w, 0, 35));
		expect(b.samples.subarray(0, 500)).toEqual(a.samples.subarray(1500));
	});

	test('oscilação pequena do tempo do player não quebra nem desloca', () => {
		const w = new Windower({ sampleRate: SR });
		let k = 0;
		const jitter = () => [0.2, -0.15, 0.1, -0.2, 0][k++ % 5];
		const events = play(w, 10, 36, jitter);
		expect(events.some((e) => e.kind === 'descartada')).toBe(false);
		const got = windows(events);
		expect(got.length).toBe(2);
		expect(Math.abs(got[0].videoStart - 10)).toBeLessThan(0.2);
		expect(Math.abs(got[1].videoStart - 25)).toBeLessThan(0.2);
	});

	test('atraso da captura é descontado', () => {
		const w = new Windower({ sampleRate: SR, latencySeconds: 0.3 });
		const [first] = windows(play(w, 5, 21));
		expect(first.videoStart).toBeCloseTo(4.7, 6);
	});

	test('pausa no meio descarta o acumulado e recomeça ao voltar', () => {
		const w = new Windower({ sampleRate: SR });
		const before = play(w, 0, 12);
		expect(windows(before)).toEqual([]);
		const paused = pause(w, 12, 3);
		// Um aviso só, mesmo com vários pedaços pausados.
		expect(paused).toEqual([{ kind: 'descartada', reason: 'pausa', seconds: 12.25 }]);
		const after = windows(play(w, 12, 21));
		expect(after.length).toBe(1);
		expect(after[0].videoStart).toBeCloseTo(12, 6);
	});

	test('salto (seek) descarta e a janela seguinte usa o tempo novo', () => {
		const w = new Windower({ sampleRate: SR });
		play(w, 0, 8);
		const events = play(w, 90, 22);
		expect(events[0]).toEqual({ kind: 'descartada', reason: 'salto', seconds: 8.25 });
		const got = windows(events);
		expect(got.length).toBe(1);
		// O pedaço do salto também é descartado: a janela começa no fim dele.
		expect(got[0].videoStart).toBeCloseTo(90.25, 6);
	});

	test('vídeo parado mas dizendo "tocando" (travou) conta como salto', () => {
		const w = new Windower({ sampleRate: SR });
		play(w, 0, 5);
		const events: WindowEvent[] = [];
		for (let i = 0; i < 8; i++) {
			events.push(...w.push(new Float32Array(CHUNK), { video: 5, playing: true }));
		}
		expect(events.some((e) => e.kind === 'descartada' && e.reason === 'salto')).toBe(true);
	});

	test('reset esquece o acumulado', () => {
		const w = new Windower({ sampleRate: SR });
		play(w, 0, 15);
		w.reset();
		expect(windows(play(w, 15, 10))).toEqual([]);
		expect(windows(play(w, 25, 10)).length).toBe(1);
	});
});
