// O tempo do vídeo em que o jogo confia.
//
// O player do YouTube mente por um tempo depois de um seek: continua informando o
// tempo antigo (o seek é assíncrono), cai num keyframe antes do alvo e oscila uns
// centésimos para trás. Sem filtro, a linha acesa pisca e o jogo acha que a linha
// acabou. Este relógio devolve o alvo enquanto o seek não chega, segura o alvo se o
// player parou um pouco antes e ignora tremidas pequenas para trás. Pulo grande é de
// verdade (a pessoa arrastou a barra do próprio vídeo) e vale na hora.

/** Depois de um seek, ignora o tempo antigo; confia de novo no player após isto. */
export const SEEK_GRACE_MS = 3_000;
/** O player "chegou" quando informa algo a até isto do alvo. */
const ARRIVE_S = 1;
/** Recuo menor que isto é tremida do player, não um seek. */
const JITTER_S = 0.3;

export class Playhead {
	#pending: { to: number; until: number } | null = null;
	/** Depois de chegar antes do alvo (keyframe), segura o alvo até o player alcançar. */
	#floor: number | null = null;
	#last = 0;

	/** O jogo (ou a pessoa, por um botão nosso) pediu um seek. */
	seek(to: number, now: number) {
		const target = Math.max(0, to);
		this.#pending = { to: target, until: now + SEEK_GRACE_MS };
		this.#floor = null;
		this.#last = target;
	}

	get seeking(): boolean {
		return this.#pending !== null;
	}

	/** Lê o tempo do player e devolve o tempo em que dá para confiar. */
	read(raw: number, now: number): number {
		if (!Number.isFinite(raw)) return this.#last;
		if (this.#pending) {
			const { to, until } = this.#pending;
			if (Math.abs(raw - to) > ARRIVE_S && now < until) return this.#keep(to);
			this.#pending = null;
			if (raw < to && to - raw <= ARRIVE_S) {
				this.#floor = to;
				return this.#keep(to);
			}
			return this.#keep(raw);
		}
		if (this.#floor !== null) {
			const floor = this.#floor;
			if (raw >= floor || floor - raw > ARRIVE_S) this.#floor = null;
			else return this.#keep(floor);
		}
		if (raw < this.#last && this.#last - raw < JITTER_S) return this.#last;
		return this.#keep(raw);
	}

	#keep(t: number): number {
		this.#last = t;
		return t;
	}
}
