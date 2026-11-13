// Posição de leitura do livro (book_progress, CONTRACT §13 `progress`). Puro.

export type ReadingPosition = {
	/** Índice do capítulo no spine do EPUB. */
	spine: number;
	/** 0–100 dentro do capítulo, uma casa decimal. */
	chapterPercent: number;
	/** 0–100 no livro, uma casa decimal. */
	percent: number;
};

const percent = (v: unknown): number | null =>
	typeof v === 'number' && Number.isFinite(v)
		? Math.round(Math.min(100, Math.max(0, v)) * 10) / 10
		: null;

/** Valida e arredonda o que veio do cliente. null se não for uma posição. */
export function parsePosition(raw: unknown): ReadingPosition | null {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;
	const spine = r.spine;
	if (typeof spine !== 'number' || !Number.isInteger(spine) || spine < 0 || spine > 100_000) {
		return null;
	}
	const chapterPercent = percent(r.chapterPercent);
	const book = percent(r.percent);
	if (chapterPercent === null || book === null) return null;
	return { spine, chapterPercent, percent: book };
}

/** Frações do foliate (0–1) para a posição guardada. */
export function positionFrom(spine: number, chapterFraction: number, bookFraction: number) {
	return parsePosition({
		spine,
		chapterPercent: chapterFraction * 100,
		percent: bookFraction * 100
	});
}

export const samePosition = (a: ReadingPosition | null, b: ReadingPosition | null) =>
	!!a && !!b && a.spine === b.spine && a.chapterPercent === b.chapterPercent;

/** De quanto em quanto tempo de leitura a posição vai para o servidor. */
export const SAVE_EVERY_MS = 30_000;

/**
 * Decide quando gravar: ao trocar de capítulo, a cada 30 s se a posição mudou, e no
 * `flush` (sair da página). Nada é gravado se a posição não mudou desde a última.
 */
export class ProgressSaver {
	#saved: ReadingPosition | null;
	#pending: { pos: ReadingPosition; at: Date } | null = null;
	#lastSaveAt: number;
	readonly #save: (pos: ReadingPosition, at: Date) => void;
	readonly #now: () => number;

	constructor(opts: {
		initial: ReadingPosition | null;
		save: (pos: ReadingPosition, at: Date) => void;
		now?: () => number;
	}) {
		this.#saved = opts.initial;
		this.#save = opts.save;
		this.#now = opts.now ?? Date.now;
		this.#lastSaveAt = this.#now();
	}

	/** A pessoa chegou numa posição nova (relocate do leitor). */
	update(pos: ReadingPosition) {
		if (samePosition(pos, this.#saved)) {
			this.#pending = null;
			return;
		}
		const chapterChanged = !this.#saved || pos.spine !== this.#saved.spine;
		this.#pending = { pos, at: new Date(this.#now()) };
		if (chapterChanged) this.flush();
	}

	/** Chamado de tempos em tempos: grava se passou o intervalo. */
	tick() {
		if (this.#pending && this.#now() - this.#lastSaveAt >= SAVE_EVERY_MS) this.flush();
	}

	/** Grava já o que estiver pendente. */
	flush() {
		const p = this.#pending;
		if (!p) return;
		this.#pending = null;
		this.#saved = p.pos;
		this.#lastSaveAt = this.#now();
		this.#save(p.pos, p.at);
	}
}
