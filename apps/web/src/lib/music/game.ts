// Máquina de estados do jogo de música (modo Escolha).
//
// O vídeo toca sem parar. As lacunas da linha atual podem ser respondidas
// enquanto ela toca. Se a linha acaba sem resposta, o vídeo pausa e começa um
// contador de 10 s; sem resposta nesse tempo, é fim de jogo.
//
// A classe não conhece o player nem o relógio: recebe o tempo do vídeo e o
// "agora" a cada chamada e devolve comandos para o player executar.

export const WAIT_MS = 10_000;
/** Depois de um seek, ignora o tempo antigo que o player ainda informa; confia de novo após isto. */
const SEEK_GRACE_MS = 3_000;
const SEEK_TOLERANCE_S = 1;
/** Depois do fim da última linha, espera um pouco (o final da frase) e fecha o jogo. */
const OUTRO_S = 1.5;
const MAX_COMBO = 4;
const BASE_POINTS = 100;

export type Phase = 'ready' | 'playing' | 'waiting' | 'paused' | 'gameover' | 'finished';

export type Command = { type: 'play' } | { type: 'pause' } | { type: 'seek'; to: number };

export interface GameLineTiming {
	start: number;
	end: number;
}

export interface GameGapConfig {
	/** Índice da linha em `lines`. */
	line: number;
	answer: string;
	options: readonly string[];
}

export interface GameConfig {
	lines: readonly GameLineTiming[];
	gaps: readonly GameGapConfig[];
}

export interface GapResult {
	line: number;
	answer: string;
	chosen: string;
	ok: boolean;
	points: number;
}

export interface Summary {
	total: number;
	correct: number;
	wrong: GapResult[];
	score: number;
	maxCombo: number;
	timeouts: number;
}

export class Game {
	phase: Phase = 'ready';
	/** Linha em que o tempo do vídeo está (-1 antes da primeira). */
	activeLine = -1;
	score = 0;
	combo = 1;
	maxCombo = 1;
	timeouts = 0;
	results: GapResult[] = [];
	/** Linha esperando resposta (fases "waiting" e a pausa que veio dela). */
	waitLine: number | null = null;
	/** Sobe a cada mudança visível; a tela usa para saber quando redesenhar. */
	revision = 0;

	#config: GameConfig;
	#deadline = 0;
	#frozenRemaining = 0;
	#resumeTo: 'playing' | 'waiting' = 'playing';
	#overLine = -1;
	#pending: { to: number; until: number } | null = null;

	constructor(config: GameConfig) {
		this.#config = config;
	}

	get lines() {
		return this.#config.lines;
	}

	get gaps() {
		return this.#config.gaps;
	}

	/** A lacuna que dá para responder agora, ou null. */
	get answerable(): GameGapConfig | null {
		let line: number;
		if (this.phase === 'playing') line = this.activeLine;
		else if (this.phase === 'waiting' && this.waitLine !== null) line = this.waitLine;
		else return null;
		return this.#openGap(line);
	}

	/** Linha cuja lacuna ficou sem resposta no fim de jogo (-1 se não houve). */
	get gameOverLine(): number {
		return this.#overLine;
	}

	/** Milissegundos que faltam do contador; null fora da espera. */
	waitRemainingMs(now: number): number | null {
		if (this.phase === 'waiting') return Math.max(0, this.#deadline - now);
		if (this.phase === 'paused' && this.#resumeTo === 'waiting') return this.#frozenRemaining;
		return null;
	}

	start(): Command[] {
		if (this.phase !== 'ready') return [];
		this.#changed();
		this.phase = 'playing';
		return [{ type: 'seek', to: 0 }, { type: 'play' }];
	}

	tick(time: number, now: number): Command[] {
		if (this.phase !== 'playing' && this.phase !== 'waiting') return [];

		if (this.#pending) {
			const arrived = Math.abs(time - this.#pending.to) <= SEEK_TOLERANCE_S;
			if (!arrived && now < this.#pending.until) return [];
			this.#pending = null;
		}

		if (this.phase === 'waiting') {
			if (now >= this.#deadline) {
				this.#changed();
				this.timeouts++;
				this.combo = 1;
				this.#overLine = this.waitLine ?? this.activeLine;
				this.waitLine = null;
				this.phase = 'gameover';
			}
			return [];
		}

		const prev = this.activeLine;
		if (prev >= 0 && this.#openGap(prev) && time >= this.lines[prev].end) {
			this.#changed();
			this.phase = 'waiting';
			this.waitLine = prev;
			this.#deadline = now + WAIT_MS;
			return [{ type: 'pause' }];
		}

		const line = this.#lineAt(time);
		if (line !== this.activeLine) {
			this.#changed();
			this.activeLine = line;
		}

		const last = this.lines[this.lines.length - 1];
		if (last && time >= last.end + OUTRO_S) {
			this.#changed();
			this.phase = 'finished';
			return [{ type: 'pause' }];
		}
		return [];
	}

	answer(option: string): Command[] {
		const gap = this.answerable;
		if (!gap || !gap.options.includes(option)) return [];
		this.#changed();

		const ok = option === gap.answer;
		let points = 0;
		if (ok) {
			points = BASE_POINTS * this.combo;
			this.score += points;
			this.combo = Math.min(MAX_COMBO, this.combo + 1);
			this.maxCombo = Math.max(this.maxCombo, this.combo);
		} else {
			this.combo = 1;
		}
		this.results.push({ line: gap.line, answer: gap.answer, chosen: option, ok, points });

		if (this.phase === 'waiting') {
			this.phase = 'playing';
			this.waitLine = null;
			return [{ type: 'play' }];
		}
		return [];
	}

	pause(now: number): Command[] {
		if (this.phase === 'playing') {
			this.#changed();
			this.phase = 'paused';
			this.#resumeTo = 'playing';
			return [{ type: 'pause' }];
		}
		if (this.phase === 'waiting') {
			this.#changed();
			this.#frozenRemaining = Math.max(0, this.#deadline - now);
			this.phase = 'paused';
			this.#resumeTo = 'waiting';
			return [];
		}
		return [];
	}

	resume(now: number): Command[] {
		if (this.phase !== 'paused') return [];
		this.#changed();
		if (this.#resumeTo === 'waiting') {
			this.phase = 'waiting';
			this.#deadline = now + this.#frozenRemaining;
			return [];
		}
		this.phase = 'playing';
		return [{ type: 'play' }];
	}

	/** Volta o vídeo ao início da linha atual e toca. */
	repeatLine(now: number): Command[] {
		if (this.phase !== 'playing' && this.phase !== 'waiting' && this.phase !== 'paused') return [];
		// Na espera (ou na pausa que veio dela) a linha é a que aguarda resposta.
		const index = this.waitLine ?? this.activeLine;
		if (index < 0) return [];

		const wasPlaying = this.phase === 'playing';
		this.#changed();
		this.phase = 'playing';
		this.waitLine = null;
		this.activeLine = index;
		return this.#seek(this.lines[index].start, now, !wasPlaying);
	}

	/** Fim de jogo → continuar: volta ao início da linha e segue. */
	continueAfterGameOver(now: number): Command[] {
		if (this.phase !== 'gameover') return [];
		this.#changed();
		const line = Math.max(0, this.#overLine);
		this.phase = 'playing';
		this.activeLine = line;
		return this.#seek(this.lines[line].start, now, true);
	}

	/** Recomeça a música do zero (fim de jogo ou resumo). */
	retry(now: number): Command[] {
		if (this.phase !== 'gameover' && this.phase !== 'finished') return [];
		this.#changed();
		this.phase = 'playing';
		this.activeLine = -1;
		this.score = 0;
		this.combo = 1;
		this.maxCombo = 1;
		this.timeouts = 0;
		this.results = [];
		this.waitLine = null;
		this.#overLine = -1;
		return this.#seek(0, now, true);
	}

	/** Encerra e mostra o resumo (Sair do fim de jogo, ou o vídeo acabou). */
	finishNow(): Command[] {
		if (this.phase === 'ready' || this.phase === 'finished') return [];
		this.#changed();
		this.phase = 'finished';
		this.waitLine = null;
		return [{ type: 'pause' }];
	}

	summary(): Summary {
		return {
			total: this.gaps.length,
			correct: this.results.filter((r) => r.ok).length,
			wrong: this.results.filter((r) => !r.ok),
			score: this.score,
			maxCombo: this.maxCombo,
			timeouts: this.timeouts
		};
	}

	// ---------- internos ----------

	#changed() {
		this.revision++;
	}

	#seek(to: number, now: number, play: boolean): Command[] {
		this.#pending = { to, until: now + SEEK_GRACE_MS };
		return play ? [{ type: 'seek', to }, { type: 'play' }] : [{ type: 'seek', to }];
	}

	#lineAt(time: number): number {
		let found = -1;
		for (let i = 0; i < this.lines.length; i++) {
			if (this.lines[i].start <= time) found = i;
			else break;
		}
		return found;
	}

	#openGap(line: number): GameGapConfig | null {
		if (line < 0) return null;
		const gap = this.gaps.find((g) => g.line === line);
		if (!gap || this.results.some((r) => r.line === line)) return null;
		return gap;
	}
}
