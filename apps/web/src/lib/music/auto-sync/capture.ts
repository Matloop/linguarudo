// Captura o áudio da própria aba (getDisplayMedia) e entrega pedaços de 16 kHz mono.
// Só no Chromium de computador. O vídeo da captura é parado na hora (o navegador
// exige pedir vídeo junto). O áudio só passa pela memória: nada é gravado nem enviado.

import { CaptureError, type CaptureHandlers, type CaptureSource } from './contracts';
import { Resampler } from './resample';
import { SAMPLE_RATE } from './windows';

const PROCESSOR = 'linguetta-captura';

/** AudioWorklet que junta os canais e manda ~0,25 s de cada vez para a página. */
const WORKLET_SOURCE = `
class Captura extends AudioWorkletProcessor {
	constructor() {
		super();
		this.parts = [];
		this.size = 0;
		this.target = Math.round(sampleRate / 4);
	}
	process(inputs) {
		const input = inputs[0];
		if (input && input.length > 0) {
			const len = input[0].length;
			const mono = new Float32Array(len);
			for (const ch of input) for (let i = 0; i < len; i++) mono[i] += ch[i] / input.length;
			this.parts.push(mono);
			this.size += len;
			if (this.size >= this.target) {
				const out = new Float32Array(this.size);
				let at = 0;
				for (const p of this.parts) { out.set(p, at); at += p.length; }
				this.parts = [];
				this.size = 0;
				this.port.postMessage(out, [out.buffer]);
			}
		}
		return true;
	}
}
registerProcessor('${PROCESSOR}', Captura);
`;

function displayMediaOptions(): DisplayMediaStreamOptions {
	// Opções do Chromium que nem todo lib.dom conhece ainda.
	return {
		video: true,
		audio: true,
		preferCurrentTab: true,
		selfBrowserSurface: 'include',
		systemAudio: 'exclude'
	} as DisplayMediaStreamOptions;
}

/** AudioContext a 16 kHz se der (o Chromium reamostra sozinho); senão na taxa padrão. */
function openContext(): AudioContext {
	try {
		return new AudioContext({ sampleRate: SAMPLE_RATE });
	} catch {
		return new AudioContext();
	}
}

export function createTabCapture(): CaptureSource {
	let stream: MediaStream | null = null;
	let ctx: AudioContext | null = null;
	let nodes: AudioNode[] = [];
	let workletUrl: string | null = null;
	let stopped = false;

	function stop(): void {
		stopped = true;
		for (const n of nodes) n.disconnect();
		nodes = [];
		stream?.getTracks().forEach((t) => t.stop());
		stream = null;
		void ctx?.close().catch(() => {});
		ctx = null;
		if (workletUrl) URL.revokeObjectURL(workletUrl);
		workletUrl = null;
	}

	async function start(handlers: CaptureHandlers): Promise<void> {
		if (!navigator.mediaDevices?.getDisplayMedia) throw new CaptureError('sem-suporte');
		stopped = false;
		// O AudioContext nasce ainda dentro do clique, antes do seletor de aba,
		// para não ficar suspenso por falta de gesto.
		ctx = openContext();

		try {
			stream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions());
		} catch (err) {
			stop();
			const name = err instanceof DOMException ? err.name : '';
			if (name === 'NotAllowedError' || name === 'AbortError') throw new CaptureError('negado');
			if (name === 'NotSupportedError' || name === 'TypeError')
				throw new CaptureError('sem-suporte');
			throw new CaptureError('falhou', err instanceof Error ? err.message : String(err));
		}
		if (stopped) {
			stop();
			return;
		}

		// Só o áudio interessa.
		stream.getVideoTracks().forEach((t) => t.stop());
		const audio = stream.getAudioTracks();
		if (audio.length === 0) {
			// A pessoa desmarcou "Compartilhar áudio da aba".
			stop();
			throw new CaptureError('sem-audio');
		}
		audio[0].addEventListener('ended', () => {
			if (stopped) return;
			stop();
			handlers.onEnded();
		});

		try {
			await wire(audio[0], handlers);
		} catch (err) {
			stop();
			throw new CaptureError('falhou', err instanceof Error ? err.message : String(err));
		}
	}

	async function wire(track: MediaStreamTrack, handlers: CaptureHandlers): Promise<void> {
		if (!ctx) throw new Error('sem AudioContext');
		let source: MediaStreamAudioSourceNode;
		try {
			source = ctx.createMediaStreamSource(new MediaStream([track]));
		} catch {
			// Navegador que não reamostra a captura: taxa padrão e reamostragem aqui.
			void ctx.close().catch(() => {});
			ctx = new AudioContext();
			source = ctx.createMediaStreamSource(new MediaStream([track]));
		}
		if (ctx.state === 'suspended') await ctx.resume();

		const resampler =
			ctx.sampleRate === SAMPLE_RATE ? null : new Resampler(ctx.sampleRate, SAMPLE_RATE);
		const emit = (samples: Float32Array) => {
			if (stopped) return;
			const out = resampler ? resampler.push(samples) : samples;
			if (out.length > 0) handlers.onAudio(out);
		};

		// Saída muda: o nó precisa estar ligado ao destino para processar, mas sem eco.
		const mute = ctx.createGain();
		mute.gain.value = 0;
		mute.connect(ctx.destination);

		if (ctx.audioWorklet) {
			workletUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' }));
			await ctx.audioWorklet.addModule(workletUrl);
			const node = new AudioWorkletNode(ctx, PROCESSOR, { numberOfOutputs: 1 });
			node.port.onmessage = (e: MessageEvent<Float32Array>) => emit(e.data);
			source.connect(node);
			node.connect(mute);
			nodes = [source, node, mute];
		} else {
			// Navegadores antigos: ScriptProcessor (descontinuado, mas ainda funciona).
			const node = ctx.createScriptProcessor(4096, 2, 1);
			node.onaudioprocess = (e) => {
				const buf = e.inputBuffer;
				const mono = new Float32Array(buf.length);
				for (let c = 0; c < buf.numberOfChannels; c++) {
					const ch = buf.getChannelData(c);
					for (let i = 0; i < mono.length; i++) mono[i] += ch[i] / buf.numberOfChannels;
				}
				emit(mono);
			};
			source.connect(node);
			node.connect(mute);
			nodes = [source, node, mute];
		}
	}

	return { start, stop };
}
