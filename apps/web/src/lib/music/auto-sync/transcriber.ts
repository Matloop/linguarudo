// Lado da página do worker de reconhecimento: uma promessa por pedido.

import type {
	AutoSyncModel,
	Transcriber,
	TranscriberLoad,
	Transcription,
	WorkerRequest,
	WorkerResponse
} from './contracts';

export function createWorkerTranscriber(model: AutoSyncModel): Transcriber {
	const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
	let nextId = 1;
	let loading: {
		resolve(v: TranscriberLoad): void;
		reject(e: Error): void;
		onProgress(p: number): void;
	} | null = null;
	const pending = new Map<number, { resolve(v: Transcription): void; reject(e: Error): void }>();
	let disposed = false;

	function send(message: WorkerRequest, transfer: Transferable[] = []): void {
		worker.postMessage(message, transfer);
	}

	function failAll(error: Error): void {
		loading?.reject(error);
		loading = null;
		for (const p of pending.values()) p.reject(error);
		pending.clear();
	}

	worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
		const msg = event.data;
		if (msg.type === 'progress') loading?.onProgress(msg.progress);
		else if (msg.type === 'ready') {
			loading?.resolve({ device: msg.device, loadMs: msg.loadMs });
			loading = null;
		} else if (msg.type === 'result') {
			pending.get(msg.id)?.resolve({ chunks: msg.chunks, ms: msg.ms });
			pending.delete(msg.id);
		} else if (msg.id !== undefined) {
			pending.get(msg.id)?.reject(new Error(msg.message));
			pending.delete(msg.id);
		} else {
			loading?.reject(new Error(msg.message));
			loading = null;
		}
	};
	worker.onerror = (event) => failAll(new Error(event.message || 'o worker de voz falhou'));

	return {
		load(onProgress) {
			if (disposed) return Promise.reject(new Error('encerrado'));
			return new Promise<TranscriberLoad>((resolve, reject) => {
				loading = { resolve, reject, onProgress };
				send({ type: 'load', model });
			});
		},
		transcribe(audio, language) {
			if (disposed) return Promise.reject(new Error('encerrado'));
			const id = nextId++;
			// Cópia própria: quem chama pode mandar a mesma janela para mais de um worker.
			const copy = audio.slice();
			return new Promise<Transcription>((resolve, reject) => {
				pending.set(id, { resolve, reject });
				send({ type: 'transcribe', id, audio: copy, language }, [copy.buffer]);
			});
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			worker.terminate();
			failAll(new Error('encerrado'));
		}
	};
}
