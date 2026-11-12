// Máquina de estados do jogo de música (modo Escolha).
//
// O vídeo toca sem parar. As lacunas da linha atual podem ser respondidas
// enquanto ela toca, da esquerda para a direita. Se a linha acaba com lacuna aberta,
// o vídeo pausa e começa um contador de 10 s (que recomeça a cada resposta, quando a
// linha tem mais de uma); sem resposta nesse tempo, é fim de jogo.
//
// A classe não conhece o player nem o relógio: recebe o tempo do vídeo (já filtrado
// pelo Playhead) e o "agora" a cada chamada e devolve comandos para o player executar.
// As linhas vêm em tempo do vídeo (a sincronia já aplicada); linha ausente (o clipe
// cortou) é pulada e a lacuna dela não conta.

export const WAIT_MS = 10_000;
/** Depois do fim da última linha, espera um pouco (o final da frase) e fecha o jogo. */
const OUTRO_S = 1.5;
const MAX_COMBO = 4;
const BASE_POINTS = 100;

export type Phase = 'ready' | 'playing' | 'waiting' | 'paused' | 'gameover' | 'finished';

export type Command = { type: 'play' } | { type: 'pause' } | { type: 'seek'; to: number };

export interface GameLineTiming {
	start: number;
	end: number;
	/** false: o clipe cortou a linha. Padrão: true. */
	present?: boolean;
}

export interface GameGapConfig {
	/** Índice da linha em `lines`. */
	line: number;
	/** Posição da palavra nos tokens da linha. As lacunas vêm em ordem de linha e token. */
	token: number;
	answer: string;
	options: readonly string[];
}

export interface GameConfig {
	lines: readonly GameLineTiming[];
	gaps: readonly GameGapConfig[];
}

/** Lacuna com a posição dela em `gaps`. */
export interface OpenGap extends GameGapConfig {
	index: number;
}

export interface GapResult {
	/** Índice da lacuna em `gaps`. */
	gap: number;
	line: number;
	answer: string;
	chosen: string;
	ok: boolean;
	points: number;
	/** O vídeo passou da linha sem dar chance de responder (seek, sincronia). */
	skipped?: boolean;
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
	#suspended = false;
	/** Índices das lacunas que já têm resultado. */
	#done = new Set<number>();

	constructor(config: GameConfig) {
		this.#config = config;
	}

	/** A sincronia mudou: novos tempos (do vídeo) para as mesmas linhas. */
	setTiming(lines: readonly GameLineTiming[]) {
		if (lines.length !== this.#config.lines.length) return;
		this.#config = { ...this.#config, lines };
		this.#changed();
	}

	/** Enquanto a pessoa sincroniza, o jogo congela: nada de pontos, lacunas ou comandos. */
	get suspended(): boolean {
		return this.#suspended;
	}

	get lines() {
		return this.#config.lines;
	}

	get gaps() {
		return this.#config.gaps;
	}

	/** A lacuna que dá para responder agora, ou null. */
	get answerable(): OpenGap | null {
		let line: number;
		if (this.phase === 'playing') line = this.activeLine;
		else if (this.phase === 'waiting' && this.waitLine !== null) line = this.waitLine;
		else return null;
		if (this.#suspended) return null;
		return this.#openGap(line);
	}

	/** Lacunas desta linha que ainda não têm resultado, em ordem. */
	openGaps(line: number): OpenGap[] {
		const out: OpenGap[] = [];
		this.gaps.forEach((g, index) => {
			if (g.line === line && !this.#done.has(index)) out.push({ ...g, index });
		});
		return out;
	}

	/** Linha cuja lacuna ficou sem resposta no fim de jogo (-1 se não houve). */
	get gameOverLine(): number {
		return this.#overLine;
	}

	/** Milissegundos que faltam do contador; null fora da espera. */
	waitRemainingMs(now: number): number | null {
		if (this.phase === 'waiting' && this.#suspended) return this.#frozenRemaining;
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
		if (this.#suspended) return [];

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
			// Pulo para a frente (a pessoa arrastou a barra do vídeo): as lacunas do meio ficam puladas.
			this.#skipBefore(line, prev + 1);
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

	answer(option: string, now: number): Command[] {
		if (this.#suspended) return [];
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
		this.#record({
			gap: gap.index,
			line: gap.line,
			answer: gap.answer,
			chosen: option,
			ok,
			points
		});

		if (this.phase === 'waiting') {
			// A linha ainda tem lacuna: continua parado, com o contador de novo.
			if (this.#openGap(gap.line)) {
				this.#deadline = now + WAIT_MS;
				return [];
			}
			this.phase = 'playing';
			this.waitLine = null;
			return [{ type: 'play' }];
		}
		return [];
	}

	pause(now: number): Command[] {
		if (this.#suspended) return [];
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
		if (this.phase !== 'paused' || this.#suspended) return [];
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
	repeatLine(): Command[] {
		if (this.#suspended) return [];
		if (this.phase !== 'playing' && this.phase !== 'waiting' && this.phase !== 'paused') return [];
		// Na espera (ou na pausa que veio dela) a linha é a que aguarda resposta.
		const index = this.waitLine ?? this.activeLine;
		if (index < 0) return [];

		const wasPlaying = this.phase === 'playing';
		this.#changed();
		this.phase = 'playing';
		this.waitLine = null;
		this.activeLine = index;
		return this.#seek(this.lines[index].start, !wasPlaying);
	}

	/** Abre a sincronia: congela tudo, inclusive o contador da espera. Não mexe no vídeo. */
	suspend(now: number) {
		if (this.#suspended) return;
		if (this.phase === 'ready' || this.phase === 'gameover' || this.phase === 'finished') return;
		this.#changed();
		if (this.phase === 'waiting') this.#frozenRemaining = Math.max(0, this.#deadline - now);
		this.#suspended = true;
	}

	/**
	 * Fecha a sincronia: o jogo continua de onde o vídeo está, com os tempos novos, sem
	 * mexer no vídeo. Lacunas de linhas que já passaram ficam puladas (sem ponto, sem
	 * zerar o combo). Pausa se o vídeo está parado.
	 */
	relocate(time: number, playing: boolean) {
		if (!this.#suspended) return;
		this.#suspended = false;
		this.#changed();
		const line = this.#lineAt(time);
		this.#skipBefore(line, 0);
		this.activeLine = line;
		this.waitLine = null;
		this.#resumeTo = 'playing';
		this.phase = playing ? 'playing' : 'paused';
	}

	/** Fim de jogo → continuar: volta ao início da linha e segue. */
	continueAfterGameOver(): Command[] {
		if (this.phase !== 'gameover') return [];
		this.#changed();
		const line = Math.max(0, this.#overLine);
		this.phase = 'playing';
		this.activeLine = line;
		return this.#seek(this.lines[line].start, true);
	}

	/** Recomeça a música do zero (fim de jogo ou resumo). */
	retry(): Command[] {
		if (this.phase !== 'gameover' && this.phase !== 'finished') return [];
		this.#changed();
		this.phase = 'playing';
		this.activeLine = -1;
		this.score = 0;
		this.combo = 1;
		this.maxCombo = 1;
		this.timeouts = 0;
		this.results = [];
		this.#done.clear();
		this.waitLine = null;
		this.#overLine = -1;
		this.#suspended = false;
		return this.#seek(0, true);
	}

	/** Encerra e mostra o resumo (Sair do fim de jogo, ou o vídeo acabou). */
	finishNow(): Command[] {
		if (this.phase === 'ready' || this.phase === 'finished') return [];
		this.#changed();
		this.phase = 'finished';
		this.waitLine = null;
		this.#suspended = false;
		return [{ type: 'pause' }];
	}

	/** Lacunas que contam: as de linhas presentes, mais as já respondidas. */
	get total(): number {
		return this.gaps.filter((g, i) => this.#present(g.line) || this.#done.has(i)).length;
	}

	summary(): Summary {
		return {
			total: this.total,
			correct: this.results.filter((r) => r.ok).length,
			wrong: this.results.filter((r) => !r.ok && !r.skipped),
			score: this.score,
			maxCombo: this.maxCombo,
			timeouts: this.timeouts
		};
	}

	// ---------- internos ----------

	#record(result: GapResult) {
		this.results.push(result);
		this.#done.add(result.gap);
	}

	#changed() {
		this.revision++;
	}

	#seek(to: number, play: boolean): Command[] {
		const at = Math.max(0, to);
		return play ? [{ type: 'seek', to: at }, { type: 'play' }] : [{ type: 'seek', to: at }];
	}

	#present(line: number): boolean {
		return this.lines[line]?.present !== false;
	}

	#lineAt(time: number): number {
		let found = -1;
		for (let i = 0; i < this.lines.length; i++) {
			if (!this.#present(i)) continue;
			if (this.lines[i].start <= time) found = i;
			else break;
		}
		return found;
	}

	/** Lacunas abertas em linhas de `from` até antes de `line` ficam puladas. */
	#skipBefore(line: number, from: number) {
		for (let i = from; i < line; i++) {
			if (!this.#present(i)) continue;
			for (const gap of this.openGaps(i))
				this.#record({
					gap: gap.index,
					line: i,
					answer: gap.answer,
					chosen: '',
					ok: false,
					points: 0,
					skipped: true
				});
		}
	}

	/** A próxima lacuna aberta da linha (a mais à esquerda). */
	#openGap(line: number): OpenGap | null {
		if (line < 0 || !this.#present(line)) return null;
		const index = this.gaps.findIndex((g, i) => g.line === line && !this.#done.has(i));
		return index < 0 ? null : { ...this.gaps[index], index };
	}
}
