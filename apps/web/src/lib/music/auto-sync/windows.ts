// Corta o áudio capturado (16 kHz mono) em janelas de ~20 s com sobreposição e
// descobre em que segundo do vídeo cada janela começa.
//
// A cada pedaço de áudio que chega, quem chama anota o tempo do vídeo e se ele
// está tocando. O relógio é o próprio áudio: n amostras = n/16000 s. Enquanto o
// vídeo toca normal, "tempo do vídeo − tempo do áudio" fica constante; uma pausa
// ou um salto mudam essa diferença. Quando muda mais que a tolerância (ou o vídeo
// não está tocando), o que estava acumulado é descartado e a contagem recomeça.

export const SAMPLE_RATE = 16_000;
export const WINDOW_SECONDS = 20;
export const OVERLAP_SECONDS = 5;
/** Quanto a diferença vídeo − áudio pode variar sem ser pausa ou salto. */
export const DRIFT_TOLERANCE_S = 0.5;

export interface WindowerOptions {
	sampleRate: number;
	windowSeconds: number;
	overlapSeconds: number;
	toleranceSeconds: number;
	/**
	 * Atraso entre o áudio sair no vídeo e chegar até nós (s). Subtraído do tempo
	 * do vídeo anotado; a bancada ajuda a calibrar.
	 */
	latencySeconds: number;
}

/** O que quem chama observou quando o pedaço de áudio chegou. */
export interface Stamp {
	video: number;
	playing: boolean;
}

export interface AudioWindow {
	/** Sobe de 1 em 1, por janela entregue. */
	id: number;
	samples: Float32Array;
	/** Segundo do vídeo na primeira amostra da janela. */
	videoStart: number;
	duration: number;
}

export type WindowEvent =
	| { kind: 'janela'; window: AudioWindow }
	| { kind: 'descartada'; reason: 'pausa' | 'salto'; seconds: number };

const DEFAULTS: WindowerOptions = {
	sampleRate: SAMPLE_RATE,
	windowSeconds: WINDOW_SECONDS,
	overlapSeconds: OVERLAP_SECONDS,
	toleranceSeconds: DRIFT_TOLERANCE_S,
	latencySeconds: 0
};

function median(values: readonly number[]): number {
	const s = [...values].sort((a, b) => a - b);
	const mid = s.length >> 1;
	return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Quantas diferenças recentes formam a referência para achar pausa ou salto. */
const REFERENCE_STAMPS = 8;

export class Windower {
	readonly options: WindowerOptions;
	#size: number;
	#hop: number;
	/** Amostras acumuladas; a primeira é a amostra número #bufStart do áudio todo. */
	#buf: Float32Array;
	#len = 0;
	#bufStart = 0;
	/** Total de amostras recebidas desde o começo. */
	#total = 0;
	/** "tempo do vídeo − tempo do áudio" anotado no fim de cada pedaço aceito. */
	#offsets: { end: number; offset: number }[] = [];
	/** Se o trecho atual teve áudio aceito (para não avisar descarte a cada pedaço de uma pausa). */
	#hadAudio = false;
	#nextId = 1;

	constructor(options: Partial<WindowerOptions> = {}) {
		this.options = { ...DEFAULTS, ...options };
		const { sampleRate, windowSeconds, overlapSeconds } = this.options;
		this.#size = Math.round(windowSeconds * sampleRate);
		this.#hop = Math.max(1, this.#size - Math.round(overlapSeconds * sampleRate));
		this.#buf = new Float32Array(this.#size * 2);
	}

	/** Recebe um pedaço de áudio e o que se viu do vídeo ao recebê-lo. */
	push(samples: Float32Array, stamp: Stamp): WindowEvent[] {
		const { sampleRate, toleranceSeconds, latencySeconds } = this.options;
		this.#total += samples.length;
		const end = this.#total;
		const offset = stamp.video - latencySeconds - end / sampleRate;

		const paused = !stamp.playing || !Number.isFinite(stamp.video);
		// Compara com a mediana recente, não só com o último: o tempo que o player
		// informa oscila um pouco entre uma leitura e outra.
		const reference = this.#offsets.slice(-REFERENCE_STAMPS).map((o) => o.offset);
		const jumped =
			!paused && reference.length > 0 && Math.abs(offset - median(reference)) > toleranceSeconds;

		if (paused || jumped) {
			// O pedaço atravessou a pausa ou o salto: não dá para confiar nele nem no acumulado.
			const lost = this.#len + samples.length;
			const report = jumped || this.#hadAudio;
			this.#restart(end);
			if (jumped) this.#offsets.push({ end, offset });
			return report
				? [{ kind: 'descartada', reason: paused ? 'pausa' : 'salto', seconds: lost / sampleRate }]
				: [];
		}

		this.#offsets.push({ end, offset });
		this.#append(samples);
		this.#hadAudio = true;

		const events: WindowEvent[] = [];
		while (this.#len >= this.#size) {
			const off = median(this.#offsets.map((o) => o.offset));
			events.push({
				kind: 'janela',
				window: {
					id: this.#nextId++,
					samples: this.#buf.slice(0, this.#size),
					videoStart: off + this.#bufStart / sampleRate,
					duration: this.#size / sampleRate
				}
			});
			this.#drop(this.#hop);
		}
		return events;
	}

	/** Esquece tudo o que estava acumulado (ex.: ao parar). */
	reset(): void {
		this.#restart(this.#total);
	}

	#restart(at: number): void {
		this.#len = 0;
		this.#bufStart = at;
		this.#offsets = [];
		this.#hadAudio = false;
	}

	#append(samples: Float32Array): void {
		if (this.#len + samples.length > this.#buf.length) {
			const bigger = new Float32Array(Math.max(this.#buf.length * 2, this.#len + samples.length));
			bigger.set(this.#buf.subarray(0, this.#len));
			this.#buf = bigger;
		}
		this.#buf.set(samples, this.#len);
		this.#len += samples.length;
	}

	#drop(n: number): void {
		this.#buf.copyWithin(0, n, this.#len);
		this.#len -= n;
		this.#bufStart += n;
		// Só as diferenças dos pedaços que ainda têm amostras no acumulado.
		this.#offsets = this.#offsets.filter((o) => o.end > this.#bufStart);
	}
}
