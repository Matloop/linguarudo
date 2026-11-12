// Tipos compartilhados entre a orquestração, o worker e a captura. Sem código de
// navegador nem do transformers.js: os testes importam daqui à vontade.

import type { TranscriptChunk } from './match';

export type AutoSyncModel = 'tiny' | 'base';

/** Modelos ONNX do Whisper multilíngue prontos para o transformers.js. */
export const MODEL_IDS: Record<AutoSyncModel, string> = {
	tiny: 'onnx-community/whisper-tiny',
	base: 'onnx-community/whisper-base'
};

export type AsrDevice = 'webgpu' | 'wasm';

/**
 * Precisão de cada arquivo do modelo. Na WebGPU, o codificador em fp32 e o
 * decodificador em q4 (o que o exemplo oficial de Whisper na WebGPU usa: o
 * codificador quantizado erra muito na GPU). No WASM, q8 nos dois (menor e rápido na CPU).
 */
export function modelDtype(device: AsrDevice): Record<string, 'fp32' | 'q4' | 'q8'> {
	return device === 'webgpu'
		? { encoder_model: 'fp32', decoder_model_merged: 'q4' }
		: { encoder_model: 'q8', decoder_model_merged: 'q8' };
}

// ---------------------------------------------------------------------------
// Mensagens do worker

export type WorkerRequest =
	| { type: 'load'; model: AutoSyncModel }
	| { type: 'transcribe'; id: number; audio: Float32Array; language?: string };

export type WorkerResponse =
	/** Download do modelo, de 0 a 1. */
	| { type: 'progress'; progress: number }
	| { type: 'ready'; device: AsrDevice; loadMs: number }
	| { type: 'result'; id: number; chunks: TranscriptChunk[]; ms: number }
	| { type: 'error'; id?: number; message: string };

// ---------------------------------------------------------------------------
// Peças trocáveis (os testes usam falsas)

export interface TranscriberLoad {
	device: AsrDevice;
	loadMs: number;
}

export interface Transcription {
	chunks: TranscriptChunk[];
	/** Tempo de transcrição no worker. */
	ms: number;
}

export interface Transcriber {
	load(onProgress: (progress: number) => void): Promise<TranscriberLoad>;
	/** Áudio 16 kHz mono. `language` é o nome do Whisper ("italian"). */
	transcribe(audio: Float32Array, language?: string): Promise<Transcription>;
	/** Encerra o worker e rejeita o que estiver pendente. */
	dispose(): void;
}

export interface CaptureHandlers {
	/** Pedaço de áudio 16 kHz mono (~0,25 s). */
	onAudio(samples: Float32Array): void;
	/** A pessoa parou de compartilhar pela barra do navegador. */
	onEnded(): void;
}

export interface CaptureSource {
	/** Pede a aba. Rejeita com CaptureError. Precisa ser chamado direto do clique. */
	start(handlers: CaptureHandlers): Promise<void>;
	/** Para tudo e solta a aba. Pode ser chamado mais de uma vez. */
	stop(): void;
}

export type CaptureErrorCode = 'sem-suporte' | 'negado' | 'sem-audio' | 'falhou';

export class CaptureError extends Error {
	readonly code: CaptureErrorCode;
	constructor(code: CaptureErrorCode, message: string = code) {
		super(message);
		this.name = 'CaptureError';
		this.code = code;
	}
}
