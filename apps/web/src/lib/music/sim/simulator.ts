// Liga o cérebro (MusicController) ao player falso num relógio virtual, como a página
// faz com o player de verdade: quadro a quadro, executando os efeitos e repassando os
// eventos do player. Cada passo vira um registro, para as regras (invariants.ts)
// conferirem.

import { MusicController, type Effect, type MusicEvent, type MusicView } from '../controller.ts';
import { mulberry32 } from '../rng.ts';
import { buildSession, type Session } from '../session.ts';
import { EMPTY_SYNC, type StoredSync, type Timeline } from '../timeline.ts';
import { FakePlayer, type FakePlayerOptions, type PlayerSignal } from './fake-player.ts';

/** Versos inventados (nenhuma letra real): 8 linhas de 3 s a partir de 1 s. */
export const SIM_VERSES = [
	'Lantern light on the quiet meadow',
	'Paper boats on the silver harbor',
	'Counting stars above the orchard',
	'Whispers travel through the tunnel',
	'Gentle thunder over the compass',
	'Pocket full of ribbon and feathers',
	'Blanket folded by the window',
	'Kettle singing in the morning'
];

export const SIM_LYRICS = SIM_VERSES.map((text, i) => ({
	index: i,
	start: 1 + 3 * i,
	end: 4 + 3 * i,
	text
}));

export interface Step {
	at: number;
	/** null = um quadro. */
	event: MusicEvent | null;
	effects: Effect[];
	before: Snapshot;
	after: Snapshot;
}

export interface Snapshot {
	view: MusicView;
	timeline: Timeline;
	time: number;
	videoPlaying: boolean;
}

export interface SimOptions {
	player?: Partial<FakePlayerOptions>;
	stored?: StoredSync;
	lyrics?: typeof SIM_LYRICS;
	session?: Session;
	/** Milissegundos por quadro. */
	frameMs?: number;
}

export class Simulator {
	readonly player: FakePlayer;
	readonly ctl: MusicController;
	readonly session: Session;
	readonly steps: Step[] = [];
	readonly saves: StoredSync[] = [];
	now = 0;
	#frameMs: number;

	constructor(options: SimOptions = {}) {
		const lyrics = options.lyrics ?? SIM_LYRICS;
		this.player = new FakePlayer({ duration: 40, random: mulberry32(7), ...options.player });
		this.ctl = new MusicController({ lines: lyrics, stored: options.stored ?? EMPTY_SYNC });
		this.session =
			options.session ??
			buildSession({
				lyrics,
				lang: 'en',
				difficulty: 'dificil',
				bank: new Map(),
				rng: mulberry32(3)
			});
		this.#frameMs = options.frameMs ?? 16;
	}

	get view(): MusicView {
		return this.ctl.view();
	}

	snapshot(): Snapshot {
		return {
			view: this.ctl.view(),
			timeline: this.ctl.timeline,
			time: this.ctl.time,
			videoPlaying: this.ctl.videoPlaying
		};
	}

	/** Uma ação da pessoa (clique/tecla): conta como gesto para o play automático. */
	send(event: MusicEvent): Effect[] {
		this.player.userGesture();
		return this.#dispatch(event);
	}

	start(): Effect[] {
		return this.send({ type: 'start', session: this.session });
	}

	/** Anda `ms` milissegundos, quadro a quadro. */
	run(ms: number) {
		const end = this.now + ms;
		while (this.now < end) {
			const dt = Math.min(this.#frameMs, end - this.now);
			const signals = this.player.advance(dt);
			this.now += dt;
			for (const s of signals) this.#signal(s);
			const before = this.snapshot();
			const effects = this.ctl.frame(this.player.currentTime(), this.now);
			this.#apply(effects);
			this.steps.push({ at: this.now, event: null, effects, before, after: this.snapshot() });
		}
	}

	/** Anda até o vídeo (de verdade) chegar em `t`, ou até `maxMs`. */
	runUntilVideo(t: number, maxMs = 120_000) {
		const limit = this.now + maxMs;
		while (this.player.trueTime < t && this.now < limit) this.run(this.#frameMs);
	}

	#signal(s: PlayerSignal) {
		if (s.type === 'state') this.#dispatch({ type: 'playerState', state: s.state });
		else if (s.type === 'ended') this.#dispatch({ type: 'ended' });
		else this.#dispatch({ type: 'autoplayBlocked' });
	}

	#dispatch(event: MusicEvent): Effect[] {
		const before = this.snapshot();
		const effects = this.ctl.send(event, this.now);
		this.#apply(effects);
		this.steps.push({ at: this.now, event, effects, before, after: this.snapshot() });
		return effects;
	}

	#apply(effects: Effect[]) {
		for (const e of effects) {
			if (e.type === 'play') this.player.play();
			else if (e.type === 'pause') this.player.pause();
			else if (e.type === 'seek') this.player.seekTo(e.to);
			else if (e.type === 'rate') this.player.setRate(e.rate);
			else {
				this.saves.push(e.sync);
				this.#dispatch({ type: 'saved', ok: true });
			}
		}
	}
}
