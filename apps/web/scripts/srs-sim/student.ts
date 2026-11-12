// Aluno virtual. Espelho exato de student.py: mesmo hash, mesmas fórmulas.
// A memória NÃO é FSRS (curva exponencial com ganho por espaçamento), para não
// favorecer nenhum dos agendadores por construção.
import type { Grade } from '#lib/review.ts';

const DAY = 86400;

function fnv1a(s: string): number {
	let h = 0x811c9dc5;
	for (const b of new TextEncoder().encode(s)) {
		h ^= b;
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h >>> 0;
}

export function uniform(key: string): number {
	let t = (fnv1a(key) + 0x6d2b79f5) >>> 0;
	t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
	t = (t ^ ((t + Math.imul(t ^ (t >>> 7), t | 61)) >>> 0)) >>> 0;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

type Mem = { S: number; last: number; n: number };

export class Student {
	readonly mem = new Map<string, Mem>();
	constructor(readonly seed: string) {}

	difficulty(key: string) {
		return uniform(`${this.seed}:${key}:d`);
	}

	recallProb(key: string, now: number) {
		const m = this.mem.get(key);
		return m ? 0.9 ** ((now - m.last) / DAY / m.S) : 0;
	}

	/** Responde ao cartão no instante now (s). Devolve [nota, segundos gastos]. */
	answer(key: string, now: number): [Grade, number] {
		const d = this.difficulty(key);
		const m = this.mem.get(key);
		const n = m ? m.n : 0;
		const u = uniform(`${this.seed}:${key}:${n}:r`);
		let ok: boolean, S: number, spent: number;
		if (!m) {
			ok = u < 0.2 * (1 - d);
			S = ok ? 3 : 0.6 * (1.2 - d);
			spent = 20;
		} else {
			const R = 0.9 ** ((now - m.last) / DAY / m.S);
			ok = u < R;
			S = ok ? m.S * (1 + 5 * (1 - 0.5 * d) * (1 - R) ** 0.35) : Math.max(0.05, 0.3 * m.S);
			spent = ok ? 8 : 20;
		}
		this.mem.set(key, { S, last: now, n: n + 1 });
		if (!ok) return [1, spent];
		const g = uniform(`${this.seed}:${key}:${n}:g`);
		return [g < 0.15 ? 2 : g < 0.9 ? 3 : 4, spent];
	}

	known(now: number) {
		let sum = 0;
		for (const k of this.mem.keys()) sum += this.recallProb(k, now);
		return sum;
	}
}
