import { describe, expect, test } from 'bun:test';
import {
	AUTO_SYNC_ERRORS,
	AUTO_SYNC_MESSAGES,
	autoSyncMessage,
	createAutoSync,
	type AutoAnchor,
	type AutoSyncStatus
} from './auto-sync';
import {
	CaptureError,
	type CaptureHandlers,
	type CaptureSource,
	type Transcriber,
	type Transcription
} from './contracts';
import type { MatchLine, TranscriptChunk } from './match';

// 100 amostras/s para os testes: janela de 20 s = 2000 amostras, nova a cada 15 s.
const SR = 100;
const CHUNK = 25;

const LINES: MatchLine[] = [
	'Lantern light on the quiet meadow', // @10
	'Paper boats on the silver harbor', // @14
	'Hold the lantern, hold it high tonight', // @18
	'Counting stars above the orchard', // @22
	'Whispers travel through the tunnel', // @26
	'Hold the lantern, hold it high tonight', // @30
	'Kettle singing in the morning' // @34
].map((text, index) => ({ index, start: 10 + index * 4, text }));

class FakeCapture implements CaptureSource {
	handlers: CaptureHandlers | null = null;
	stopped = 0;
	constructor(private readonly failure?: CaptureError) {}
	async start(handlers: CaptureHandlers): Promise<void> {
		if (this.failure) throw this.failure;
		this.handlers = handlers;
	}
	stop(): void {
		this.stopped++;
	}
	/** Toca `seconds` de áudio; `video` e `playing` vêm do relógio falso. */
	feed(seconds: number, clock: Clock): void {
		for (let i = 0; i < (seconds * SR) / CHUNK; i++) {
			clock.advance(CHUNK / SR);
			this.handlers?.onAudio(new Float32Array(CHUNK));
		}
	}
}

class Clock {
	video: number;
	playing = true;
	constructor(start: number) {
		this.video = start;
	}
	advance(s: number): void {
		if (this.playing) this.video += s;
	}
}

type Reply = (call: number) => TranscriptChunk[];

class FakeTranscriber implements Transcriber {
	calls: { samples: number; language?: string }[] = [];
	disposed = false;
	/** Pedidos de transcrição ainda sem resposta (o teste resolve quando quiser). */
	waiting: ((t: Transcription) => void)[] = [];
	constructor(
		private readonly reply: Reply,
		private readonly opts: { failLoad?: boolean; manual?: boolean } = {}
	) {}
	async load(onProgress: (p: number) => void) {
		onProgress(0.5);
		if (this.opts.failLoad) throw new Error('rede');
		onProgress(1);
		return { device: 'wasm' as const, loadMs: 10 };
	}
	transcribe(audio: Float32Array, language?: string): Promise<Transcription> {
		const call = this.calls.length;
		this.calls.push({ samples: audio.length, language });
		const result = { chunks: this.reply(call), ms: 5 };
		if (!this.opts.manual) return Promise.resolve(result);
		return new Promise((resolve) => this.waiting.push(() => resolve(result)));
	}
	dispose(): void {
		this.disposed = true;
	}
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(
	options: {
		reply?: Reply;
		failure?: CaptureError;
		failLoad?: boolean;
		manual?: boolean;
		videoStart?: number;
		expected?: (v: number) => number | undefined;
	} = {}
) {
	const clock = new Clock(options.videoStart ?? 100);
	const capture = new FakeCapture(options.failure);
	const transcriber = new FakeTranscriber(options.reply ?? (() => []), {
		failLoad: options.failLoad,
		manual: options.manual
	});
	const statuses: AutoSyncStatus[] = [];
	const anchors: AutoAnchor[] = [];
	const expectedCalls: number[] = [];
	let created = 0;
	const sync = createAutoSync(
		{
			lines: LINES,
			lang: 'en-US',
			model: 'tiny',
			getVideoTime: () => clock.video,
			isPlaying: () => clock.playing,
			expectedLyricTime: options.expected
				? (v) => {
						expectedCalls.push(v);
						return options.expected!(v);
					}
				: undefined,
			onAnchor: (a) => anchors.push(a),
			onStatus: (s) => statuses.push(s)
		},
		{
			capture: () => capture,
			transcriber: () => {
				created++;
				return transcriber;
			},
			windower: { sampleRate: SR }
		}
	);
	return {
		sync,
		clock,
		capture,
		transcriber,
		statuses,
		anchors,
		expectedCalls,
		created: () => created
	};
}

describe('createAutoSync', () => {
	test('pede a aba, carrega o modelo, ouve e emite âncora com o tempo do vídeo', async () => {
		const t = setup({
			reply: () => [{ text: 'Paper boats on the silver harbor', start: 2, end: 5 }]
		});
		await t.sync.start();
		expect(t.statuses).toEqual([
			{ kind: 'pedindo-aba' },
			{ kind: 'carregando-modelo', progress: 0 },
			{ kind: 'carregando-modelo', progress: 0.5 },
			{ kind: 'carregando-modelo', progress: 1 },
			{ kind: 'ouvindo' }
		]);
		t.capture.feed(20, t.clock);
		await flush();
		expect(t.transcriber.calls).toEqual([{ samples: 2000, language: 'english' }]);
		// A janela começou no vídeo em 100 s; o trecho, 2 s depois.
		expect(t.anchors).toEqual([{ line: 1, video: 102, score: expect.any(Number) }]);
	});

	test('janela com pausa no meio é descartada', async () => {
		const t = setup({
			reply: () => [{ text: 'Paper boats on the silver harbor', start: 2, end: 5 }]
		});
		await t.sync.start();
		t.capture.feed(10, t.clock);
		t.clock.playing = false;
		t.capture.feed(3, t.clock);
		t.clock.playing = true;
		t.capture.feed(10, t.clock);
		await flush();
		expect(t.transcriber.calls).toEqual([]);
		// Depois de 20 s seguidos tocando, volta a transcrever, a partir do vídeo em 110 s.
		t.capture.feed(10, t.clock);
		await flush();
		expect(t.transcriber.calls.length).toBe(1);
		expect(t.anchors.map((a) => a.video)).toEqual([112]);
	});

	test('salto no vídeo também descarta', async () => {
		const t = setup();
		await t.sync.start();
		t.capture.feed(12, t.clock);
		t.clock.video += 40;
		t.capture.feed(12, t.clock);
		await flush();
		expect(t.transcriber.calls).toEqual([]);
	});

	test('stop solta a aba, encerra o worker e ignora o que chegar depois', async () => {
		const t = setup({
			manual: true,
			reply: () => [{ text: 'Paper boats on the silver harbor', start: 2, end: 5 }]
		});
		await t.sync.start();
		t.capture.feed(20, t.clock);
		await flush();
		expect(t.transcriber.waiting.length).toBe(1);
		t.sync.stop();
		expect(t.capture.stopped).toBe(1);
		expect(t.transcriber.disposed).toBe(true);
		expect(t.statuses.at(-1)).toEqual({ kind: 'parado' });
		// A resposta atrasada não vira âncora, e áudio novo não é transcrito.
		t.transcriber.waiting[0]({ chunks: [], ms: 0 });
		t.capture.feed(40, t.clock);
		await flush();
		expect(t.anchors).toEqual([]);
		expect(t.transcriber.calls.length).toBe(1);
		// stop de novo não repete o aviso.
		t.sync.stop();
		expect(t.statuses.filter((s) => s.kind === 'parado').length).toBe(1);
	});

	test('sem áudio da aba: avisa e nem carrega o modelo', async () => {
		const t = setup({ failure: new CaptureError('sem-audio') });
		await t.sync.start();
		expect(t.statuses).toEqual([{ kind: 'pedindo-aba' }, { kind: 'sem-audio' }]);
		expect(t.created()).toBe(0);
	});

	test('compartilhamento cancelado vira erro com mensagem', async () => {
		const t = setup({ failure: new CaptureError('negado') });
		await t.sync.start();
		expect(t.statuses.at(-1)).toEqual({ kind: 'erro', message: AUTO_SYNC_ERRORS.negado });
	});

	test('falha ao carregar o modelo: erro e solta a aba', async () => {
		const t = setup({ failLoad: true });
		await t.sync.start();
		expect(t.statuses.at(-1)).toEqual({ kind: 'erro', message: AUTO_SYNC_ERRORS.modelo });
		expect(t.capture.stopped).toBe(1);
		expect(t.transcriber.disposed).toBe(true);
	});

	test('a pessoa para de compartilhar pela barra do navegador', async () => {
		const t = setup();
		await t.sync.start();
		t.capture.handlers?.onEnded();
		expect(t.statuses.at(-1)).toEqual({ kind: 'parado' });
		expect(t.transcriber.disposed).toBe(true);
	});

	test('tempo esperado chega ao casamento e desempata o refrão', async () => {
		// Vídeo 20 s adiantado em relação à letra.
		const t = setup({
			videoStart: 30,
			expected: (v) => v - 20,
			reply: () => [{ text: 'Hold the lantern, hold it high tonight', start: 3, end: 6 }]
		});
		await t.sync.start();
		t.capture.feed(20, t.clock);
		await flush();
		expect(t.expectedCalls).toEqual([30]);
		// Esperado: letra em 10 + 3 = 13 s → primeira vez do refrão (linha 2, @18), não a linha 5 (@30).
		expect(t.anchors.map((a) => [a.line, a.video])).toEqual([[2, 33]]);
	});

	test('a mesma âncora vinda da sobreposição de janelas não repete', async () => {
		// Trecho em 17 s da 1ª janela = 2 s da 2ª (que começa 15 s depois).
		const t = setup({
			reply: (call) => [
				{ text: 'Paper boats on the silver harbor', start: call === 0 ? 17 : 2, end: null }
			]
		});
		await t.sync.start();
		t.capture.feed(35, t.clock);
		await flush();
		expect(t.transcriber.calls.length).toBe(2);
		expect(t.anchors).toEqual([{ line: 1, video: 117, score: expect.any(Number) }]);
	});

	test('janelas que chegam durante o download esperam (só as 2 mais novas)', async () => {
		let release: () => void = () => {};
		const t = setup({ reply: () => [] });
		const load = t.transcriber.load.bind(t.transcriber);
		t.transcriber.load = (p) =>
			new Promise((resolve) => {
				release = () => void load(p).then(resolve);
			});
		const started = t.sync.start();
		await flush();
		t.capture.feed(65, t.clock); // 4 janelas
		await flush();
		expect(t.transcriber.calls).toEqual([]);
		release();
		await started;
		await flush();
		expect(t.transcriber.calls.length).toBe(2);
	});
});

describe('autoSyncMessage', () => {
	test('mensagens em PT-BR para cada estado', () => {
		expect(autoSyncMessage({ kind: 'ouvindo' })).toBe(AUTO_SYNC_MESSAGES.ouvindo);
		expect(autoSyncMessage({ kind: 'carregando-modelo', progress: 0 })).toBe(
			AUTO_SYNC_MESSAGES['carregando-modelo']
		);
		expect(autoSyncMessage({ kind: 'carregando-modelo', progress: 0.42 })).toBe(
			'Baixando o reconhecedor de voz… 42%'
		);
		expect(autoSyncMessage({ kind: 'erro', message: 'x' })).toBe('x');
		expect(autoSyncMessage({ kind: 'sem-audio' })).toContain('áudio da aba');
	});
});
