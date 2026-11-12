// Web Worker do reconhecimento de voz. Carrega o Whisper (transformers.js) uma vez
// e transcreve janelas de áudio 16 kHz mono. Os arquivos do modelo vêm do CDN do
// Hugging Face só quando a pessoa liga a sincronização, e o navegador guarda em cache.
// O áudio só passa pela memória: nada é enviado nem guardado.

import { pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import {
	MODEL_IDS,
	modelDtype,
	type AsrDevice,
	type WorkerRequest,
	type WorkerResponse
} from './contracts';
import type { TranscriptChunk } from './match';

const scope = self as unknown as {
	postMessage(message: WorkerResponse): void;
	onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
	navigator: { gpu?: { requestAdapter(): Promise<unknown> } };
};

let asr: AutomaticSpeechRecognitionPipeline | null = null;
/** As mensagens são tratadas uma de cada vez, na ordem em que chegam. */
let queue: Promise<void> = Promise.resolve();

function post(message: WorkerResponse): void {
	scope.postMessage(message);
}

async function hasWebGpu(): Promise<boolean> {
	try {
		return Boolean(await scope.navigator.gpu?.requestAdapter());
	} catch {
		return false;
	}
}

async function load(model: keyof typeof MODEL_IDS): Promise<void> {
	if (asr) return;
	const started = performance.now();
	const files = new Map<string, { loaded: number; total: number }>();
	let last = -1;
	const progress_callback = (info: {
		status: string;
		file?: string;
		loaded?: number;
		total?: number;
	}) => {
		if (info.status !== 'progress' || !info.file || !info.total) return;
		files.set(info.file, { loaded: info.loaded ?? 0, total: info.total });
		let loaded = 0;
		let total = 0;
		for (const f of files.values()) {
			loaded += f.loaded;
			total += f.total;
		}
		const p = Math.floor((loaded / total) * 100) / 100;
		if (p !== last) {
			last = p;
			post({ type: 'progress', progress: p });
		}
	};

	const devices: AsrDevice[] = (await hasWebGpu()) ? ['webgpu', 'wasm'] : ['wasm'];
	let lastError: unknown = null;
	for (const device of devices) {
		try {
			asr = (await pipeline('automatic-speech-recognition', MODEL_IDS[model], {
				device,
				dtype: modelDtype(device),
				progress_callback
			})) as AutomaticSpeechRecognitionPipeline;
			post({ type: 'ready', device, loadMs: Math.round(performance.now() - started) });
			return;
		} catch (err) {
			// WebGPU às vezes falha na hora de criar a sessão; tenta de novo no WASM.
			lastError = err;
		}
	}
	throw lastError;
}

async function transcribe(id: number, audio: Float32Array, language?: string): Promise<void> {
	if (!asr) throw new Error('modelo não carregado');
	const started = performance.now();
	const output = await asr(audio, {
		return_timestamps: true,
		task: 'transcribe',
		...(language ? { language } : {})
	});
	const chunks: TranscriptChunk[] = (output.chunks ?? []).map((c) => ({
		text: c.text,
		start: c.timestamp[0],
		end: c.timestamp[1] ?? null
	}));
	post({ type: 'result', id, chunks, ms: Math.round(performance.now() - started) });
}

scope.onmessage = (event) => {
	const msg = event.data;
	queue = queue.then(async () => {
		try {
			if (msg.type === 'load') await load(msg.model);
			else await transcribe(msg.id, msg.audio, msg.language);
		} catch (err) {
			post({
				type: 'error',
				id: msg.type === 'transcribe' ? msg.id : undefined,
				message: err instanceof Error ? err.message : String(err)
			});
		}
	});
};
