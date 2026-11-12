// Player do YouTube de mentira, com relógio virtual, para os testes do cérebro.
// Imita as manias do player de verdade que já quebraram o jogo:
// - seek assíncrono: o tempo antigo continua aparecendo por um tempo;
// - seek cai no keyframe antes do alvo;
// - seekTo fora da pausa (playing, cued, unstarted) começa a tocar;
// - buffering depois de seek/play, sem o tempo andar;
// - eventos de estado chegam atrasados (postMessage);
// - play automático bloqueado pelo navegador;
// - duração 0 até os metadados chegarem;
// - tremidas pequenas para trás no currentTime.

import type { PlayerAdapter, PlayerState } from '../youtube.ts';

export interface FakePlayerOptions {
	duration: number;
	seekLagMs?: number;
	keyframeS?: number;
	/** seekTo fora da pausa toca (como o YouTube). Padrão: true. */
	seekPlays?: boolean;
	bufferMs?: number;
	stateLagMs?: number;
	autoplayBlocked?: boolean;
	metadataDelayMs?: number;
	/** A cada leitura, recua até isto (s) de vez em quando. */
	jitterS?: number;
	/** Gerador determinístico para a tremida. */
	random?: () => number;
}

export type PlayerSignal =
	{ type: 'state'; state: PlayerState } | { type: 'ended' } | { type: 'autoplayBlocked' };

export class FakePlayer implements PlayerAdapter {
	now = 0;
	state: PlayerState = 'unstarted';
	/** O que o jogo mandou fazer, em ordem. */
	readonly log: string[] = [];
	rate = 1;

	#o: Required<Omit<FakePlayerOptions, 'random'>> & { random: () => number };
	#time = 0;
	#seek: { to: number; at: number } | null = null;
	#bufferUntil = 0;
	#queue: { at: number; signal: PlayerSignal }[] = [];
	#gesture = false;
	#playingWhenBuffered = false;

	constructor(options: FakePlayerOptions) {
		this.#o = {
			seekLagMs: 0,
			keyframeS: 0,
			seekPlays: true,
			bufferMs: 0,
			stateLagMs: 0,
			autoplayBlocked: false,
			metadataDelayMs: 0,
			jitterS: 0,
			random: Math.random,
			...options
		};
	}

	/** Tempo real do vídeo (o que se ouve), sem as mentiras do currentTime. */
	get trueTime(): number {
		return this.#time;
	}

	get playing(): boolean {
		return this.state === 'playing' || (this.state === 'buffering' && this.#playingWhenBuffered);
	}

	/** Um clique da pessoa na página: libera o play automático. */
	userGesture() {
		this.#gesture = true;
	}

	// ---------- PlayerAdapter ----------

	play() {
		this.log.push('play');
		if (this.state === 'ended') this.#time = 0;
		if (this.#o.autoplayBlocked && !this.#gesture) {
			this.#emit({ type: 'autoplayBlocked' });
			return;
		}
		this.#startPlaying();
	}

	pause() {
		this.log.push('pause');
		this.#playingWhenBuffered = false;
		this.#setState('paused');
	}

	seekTo(seconds: number) {
		this.log.push(`seek:${round(seconds)}`);
		const kf = this.#o.keyframeS;
		const to = Math.max(
			0,
			Math.min(this.#o.duration, kf > 0 ? Math.floor(seconds / kf) * kf : seconds)
		);
		this.#seek = { to, at: this.now + this.#o.seekLagMs };
		if (this.#o.seekLagMs === 0) this.#landSeek();
		const plays =
			this.state === 'playing' ||
			this.state === 'buffering' ||
			(this.#o.seekPlays && this.state !== 'paused');
		if (plays) {
			if (this.#o.autoplayBlocked && !this.#gesture && this.state !== 'playing') {
				this.#emit({ type: 'autoplayBlocked' });
				return;
			}
			this.#startPlaying();
		}
	}

	currentTime(): number {
		// Enquanto o seek não chega, o player segue informando a posição antiga.
		const shown = this.#time;
		const j = this.#o.jitterS;
		if (j > 0 && this.#o.random() < 0.2) return Math.max(0, shown - this.#o.random() * j);
		return shown;
	}

	duration(): number {
		return this.now >= this.#o.metadataDelayMs ? this.#o.duration : 0;
	}

	setRate(rate: number) {
		this.log.push(`rate:${rate}`);
		this.rate = rate;
	}

	destroy() {}

	// ---------- relógio virtual ----------

	/** Anda `ms` milissegundos e devolve os eventos que chegaram nesse tempo. */
	advance(ms: number): PlayerSignal[] {
		const end = this.now + ms;
		if (this.#seek && end >= this.#seek.at) this.#landSeek();
		if (this.state === 'buffering' && end >= this.#bufferUntil && this.#playingWhenBuffered) {
			this.#setState('playing');
		}
		if (this.state === 'playing') {
			const from = Math.max(this.now, this.#bufferUntil);
			const dt = Math.max(0, end - from) / 1000;
			this.#time = Math.min(this.#o.duration, this.#time + dt * this.rate);
			if (this.#time >= this.#o.duration) {
				this.#playingWhenBuffered = false;
				this.#setState('ended');
				this.#emit({ type: 'ended' });
			}
		}
		this.now = end;
		const due = this.#queue.filter((q) => q.at <= end).map((q) => q.signal);
		this.#queue = this.#queue.filter((q) => q.at > end);
		return due;
	}

	#landSeek() {
		if (!this.#seek) return;
		this.#time = this.#seek.to;
		this.#seek = null;
	}

	#startPlaying() {
		this.#playingWhenBuffered = true;
		if (this.#o.bufferMs > 0) {
			this.#bufferUntil = this.now + this.#o.bufferMs;
			this.#setState('buffering');
		} else {
			this.#setState('playing');
		}
	}

	#setState(state: PlayerState) {
		if (state === this.state) return;
		this.state = state;
		this.#emit({ type: 'state', state });
	}

	#emit(signal: PlayerSignal) {
		this.#queue.push({ at: this.now + this.#o.stateLagMs, signal });
	}
}

const round = (v: number) => Math.round(v * 100) / 100;
