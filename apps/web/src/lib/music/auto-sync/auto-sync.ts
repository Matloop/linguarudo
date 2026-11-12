// "Sincronizar sozinho": ouve o áudio da aba, transcreve com o Whisper no próprio
// navegador e transforma os trechos reconhecidos em âncoras { linha, segundo do vídeo }.
//
// Fluxo: captura (16 kHz mono) → janelas de 20 s com 5 s de sobra → worker do
// Whisper → casamento com a letra → onAnchor. Toque manual sempre vence: quem
// chama decide o que fazer com cada âncora automática.
//
// A captura e o reconhecedor são injetáveis; os testes usam versões falsas.

import { createTabCapture } from './capture';
import {
	CaptureError,
	type AutoSyncModel,
	type CaptureSource,
	type Transcriber
} from './contracts';
import { whisperLanguage } from './languages';
import {
	matchWindow,
	type AutoAnchor,
	type MatchLine,
	type MatchOptions,
	type TranscriptChunk
} from './match';
import { createWorkerTranscriber } from './transcriber';
import { Windower, type AudioWindow, type WindowerOptions } from './windows';

export type { AutoAnchor } from './match';
export type { AutoSyncModel } from './contracts';

export type AutoSyncStatus =
	| { kind: 'pedindo-aba' }
	/** `progress` de 0 a 1. */
	| { kind: 'carregando-modelo'; progress: number }
	| { kind: 'ouvindo' }
	| { kind: 'sem-audio' }
	| { kind: 'erro'; message: string }
	| { kind: 'parado' };

export const AUTO_SYNC_MESSAGES = {
	'pedindo-aba': 'Escolha esta aba e deixe “Compartilhar áudio da aba” marcado.',
	'carregando-modelo': 'Baixando o reconhecedor de voz…',
	ouvindo: 'Ouvindo a música para acertar a letra…',
	'sem-audio':
		'Sem o áudio da aba não dá para ouvir. Compartilhe de novo e marque “Compartilhar áudio da aba”.',
	parado: 'Sincronização automática desligada.'
} as const;

export const AUTO_SYNC_ERRORS = {
	negado: 'Você não compartilhou a aba.',
	'sem-suporte': 'Este navegador não consegue ouvir a aba. Use o Chrome ou o Edge no computador.',
	falhou: 'A captura do áudio falhou. Tente de novo.',
	modelo: 'Não deu para carregar o reconhecedor de voz. Confira a conexão e tente de novo.',
	transcricao: 'O reconhecedor de voz parou. Tente de novo.'
} as const;

/** Texto para mostrar ao lado do botão. */
export function autoSyncMessage(status: AutoSyncStatus): string {
	switch (status.kind) {
		case 'erro':
			return status.message;
		case 'carregando-modelo':
			return status.progress > 0
				? `${AUTO_SYNC_MESSAGES['carregando-modelo']} ${Math.round(status.progress * 100)}%`
				: AUTO_SYNC_MESSAGES['carregando-modelo'];
		default:
			return AUTO_SYNC_MESSAGES[status.kind];
	}
}

export interface AutoSyncOptions {
	lines: readonly MatchLine[];
	/** BCP 47 da música ("it", "pt-BR"). */
	lang: string;
	model: AutoSyncModel;
	getVideoTime(): number;
	isPlaying(): boolean;
	/** Tempo da letra esperado nesse segundo do vídeo, pelas âncoras atuais. */
	expectedLyricTime?(videoTime: number): number | undefined;
	onAnchor(anchor: AutoAnchor): void;
	onStatus(status: AutoSyncStatus): void;
}

export interface AutoSync {
	/** Chame direto do clique: o navegador só abre o seletor de aba com gesto. */
	start(): Promise<void>;
	stop(): void;
}

export interface AutoSyncDeps {
	capture(): CaptureSource;
	transcriber(model: AutoSyncModel): Transcriber;
	windower?: Partial<WindowerOptions>;
	match?: Partial<MatchOptions>;
}

/** Janelas esperando o reconhecedor; se ele atrasar, as mais velhas saem. */
const MAX_QUEUE = 2;
/** Mesma linha de novo com diferença menor que isto (s): repetida pela sobreposição. */
const SAME_ANCHOR_S = 0.25;

const DEFAULT_DEPS: AutoSyncDeps = {
	capture: createTabCapture,
	transcriber: createWorkerTranscriber
};

export function createAutoSync(opts: AutoSyncOptions, deps?: AutoSyncDeps): AutoSync {
	const language = whisperLanguage(opts.lang);
	/** Sobe a cada start/stop; o que voltar de uma rodada antiga é ignorado. */
	let round = 0;
	let running = false;
	let capture: CaptureSource | null = null;
	let transcriber: Transcriber | null = null;
	let windower: Windower | null = null;
	let ready = false;
	let busy = false;
	let queue: AudioWindow[] = [];
	const emitted = new Map<number, number>();

	function teardown(): void {
		round++;
		running = false;
		ready = false;
		busy = false;
		queue = [];
		windower?.reset();
		windower = null;
		capture?.stop();
		capture = null;
		transcriber?.dispose();
		transcriber = null;
	}

	function fail(status: AutoSyncStatus): void {
		teardown();
		opts.onStatus(status);
	}

	function onAudio(samples: Float32Array): void {
		if (!windower) return;
		const events = windower.push(samples, {
			video: opts.getVideoTime(),
			playing: opts.isPlaying()
		});
		for (const e of events) {
			if (e.kind !== 'janela') continue;
			queue.push(e.window);
			if (queue.length > MAX_QUEUE) queue.shift();
		}
		void pump();
	}

	async function pump(): Promise<void> {
		if (!ready || busy || !transcriber) return;
		const win = queue.shift();
		if (!win) return;
		const mine = round;
		busy = true;
		let chunks: TranscriptChunk[];
		try {
			({ chunks } = await transcriber.transcribe(win.samples, language));
		} catch {
			if (mine === round) fail({ kind: 'erro', message: AUTO_SYNC_ERRORS.transcricao });
			return;
		}
		if (mine !== round) return;
		busy = false;
		const anchors = matchWindow(
			opts.lines,
			{
				chunks,
				windowVideoStart: win.videoStart,
				expectedLyricTime: opts.expectedLyricTime?.(win.videoStart)
			},
			deps?.match
		);
		for (const a of anchors) {
			const prev = emitted.get(a.line);
			if (prev !== undefined && Math.abs(prev - a.video) < SAME_ANCHOR_S) continue;
			emitted.set(a.line, a.video);
			opts.onAnchor(a);
		}
		void pump();
	}

	async function start(): Promise<void> {
		if (running) return;
		running = true;
		const mine = ++round;
		emitted.clear();
		opts.onStatus({ kind: 'pedindo-aba' });

		// Nada de await antes de pedir a aba: o seletor exige o gesto do clique.
		const d = deps ?? DEFAULT_DEPS;
		capture = d.capture();
		windower = new Windower(d.windower);
		try {
			await capture.start({
				onAudio: (samples) => {
					if (mine === round) onAudio(samples);
				},
				onEnded: () => {
					if (mine === round) stop();
				}
			});
		} catch (err) {
			if (mine !== round) return;
			const code = err instanceof CaptureError ? err.code : 'falhou';
			fail(
				code === 'sem-audio'
					? { kind: 'sem-audio' }
					: { kind: 'erro', message: AUTO_SYNC_ERRORS[code] }
			);
			return;
		}
		if (mine !== round) return;

		opts.onStatus({ kind: 'carregando-modelo', progress: 0 });
		const t = d.transcriber(opts.model);
		transcriber = t;
		try {
			await t.load((progress) => {
				if (mine === round) opts.onStatus({ kind: 'carregando-modelo', progress });
			});
		} catch {
			if (mine === round) fail({ kind: 'erro', message: AUTO_SYNC_ERRORS.modelo });
			return;
		}
		if (mine !== round) return;
		ready = true;
		opts.onStatus({ kind: 'ouvindo' });
		void pump();
	}

	function stop(): void {
		if (!running) return;
		teardown();
		opts.onStatus({ kind: 'parado' });
	}

	return { start, stop };
}
