// Quais parágrafos ganham troca e qual palavra entra em cada um: o porte do select.js do
// LingoBlend (packages/stremio-server/server/src/blend/select.js), com o parágrafo no lugar da
// fala da legenda. Mesmas regras:
//
//   1. cobertura: coverage (0–MAX_COVERAGE) é a parte das PALAVRAS trocadas; a cota é
//      round(coverage × palavras), contando todas as palavras da troca ("de novo" vale 2).
//   2. curva: enquanto a cota cabe em uma troca por parágrafo, parte dos parágrafos ganha uma,
//      espaçados em janelas (parágrafos/cota parágrafos pela posição global). Acima disso todo
//      parágrafo ganha troca e o teto dele é round(coverage × palavras dele), no mínimo 1 e no
//      máximo metade.
//   3. o teto é limite, não obrigação: troca extra num parágrafo só com candidata boa
//      (nota ≥ EXTRA_MIN).
//   4. compensação: o que faltou vai para o parágrafo sem troca mais longe dos escolhidos; sem
//      parágrafo livre, para o com mais espaço proporcional, até metade das palavras.
//   5. nota: item do banco do usuário muito acima de tudo; depois a frequência do lema, se houver
//      lista. No app web NÃO há lista de frequência (as do LingoBlend ficam no servidor local do
//      Stremio): sem lista toda candidata vale 2 e o desempate é a ordem da IA, que o pedido manda
//      ser "as mais úteis para o nível primeiro".
//   6. repetição: o mesmo lema só volta a REPEAT_GAP parágrafos da última vez. Na legenda eram 20
//      falas (~1–2 min); aqui 6 parágrafos dão uma ou duas páginas.

import { countWords, lemmaKey } from '@linguetta/language';

export const DEFAULT_COVERAGE = 0.1;
export const MAX_COVERAGE = 0.5;
export const REPEAT_GAP = 6;
export const VERY_COMMON = 300;
export const COMMON = 5000;

const BANK = 100;
const EXTRA_MIN = 1.5;

export interface Frequency {
	rank(word: string): number | null;
}

/** O mínimo que a escolha precisa de uma candidata. */
export interface Swap {
	/** Trecho do texto original que sai. */
	form: string;
	/** Palavra na língua-alvo que entra (texto do link). */
	target: string;
	lemma: string;
	/** Posição do trecho no parágrafo (ordena o resultado). */
	start: number;
}

export function frequencyScore(frequency: Frequency | null, ...words: string[]): number {
	if (!frequency) return 2;
	const ranks = words
		.filter(Boolean)
		.map((w) => frequency.rank(w))
		.filter((r): r is number => r !== null);
	if (!ranks.length) return 0.5;
	const r = Math.min(...ranks);
	if (r <= VERY_COMMON) return 2;
	if (r <= COMMON) return 3;
	return 1.5;
}

const halfOf = (words: number) => Math.max(1, Math.floor(words / 2));

export function blendPlan(texts: readonly string[], sourceLang: string, coverage: number) {
	const perText = texts.map((t) => countWords(t, sourceLang));
	const words = perText.reduce((a, b) => a + b, 0);
	const quota = coverage > 0 ? Math.round(coverage * words) : 0;
	const perCue = quota > texts.length;
	const caps = perText.map((w) =>
		perCue ? Math.max(1, Math.min(Math.floor(w / 2), Math.round(coverage * w))) : 1
	);
	return {
		perText,
		words,
		quota,
		perCue,
		cueFraction: texts.length ? Math.min(1, quota / texts.length) : 0,
		caps
	};
}

export interface SelectInput<T extends Swap> {
	texts: readonly string[];
	/** Por parágrafo, as candidatas já validadas, na ordem de preferência da IA. */
	candidates: readonly (readonly T[])[];
	sourceLang: string;
	targetLang: string;
	coverage: number;
	/** Lemas dos itens em estudo do usuário no idioma-alvo. */
	preferWords?: readonly string[];
	frequency?: Frequency | null;
}

type Scored<T> = { ann: T; key: string; base: number; score: number; words: number };

export function selectSwaps<T extends Swap>(input: SelectInput<T>): T[][] {
	const { texts, candidates, sourceLang, targetLang, coverage } = input;
	const frequency = input.frequency ?? null;
	const out: T[][] = texts.map(() => []);
	const plan = blendPlan(texts, sourceLang, coverage);
	if (!plan.quota) return out;
	const prefer = new Set((input.preferWords ?? []).map((w) => lemmaKey(w, targetLang)));
	const scored: Scored<T>[][] = texts.map((_, i) =>
		(candidates[i] ?? []).map((ann, k) => {
			const key = lemmaKey(ann.lemma, targetLang);
			const base = (prefer.has(key) ? BANK : 0) + frequencyScore(frequency, ann.lemma, ann.target);
			return {
				ann,
				key,
				base,
				score: base - k * 0.01,
				words: Math.max(1, countWords(ann.form, sourceLang))
			};
		})
	);

	const seenAt = new Map<string, number[]>();
	const used = texts.map(() => 0);
	const dist = texts.map(() => Infinity);
	let total = 0;
	const eligible = (c: Scored<T>, g: number) =>
		(seenAt.get(c.key) ?? []).every((p) => Math.abs(g - p) >= REPEAT_GAP);
	// Duas trocas no mesmo parágrafo não podem disputar o mesmo trecho.
	const overlaps = (i: number, c: Scored<T>) =>
		out[i].some(
			(a) =>
				c.ann.start < a.start + a.form.length && a.start < c.ann.start + c.ann.form.length
		);
	const best = (i: number) => {
		const first = out[i].length === 0;
		let top: Scored<T> | null = null;
		for (const c of scored[i]) {
			if (out[i].includes(c.ann) || !eligible(c, i) || overlaps(i, c)) continue;
			if (!first && (c.base < EXTRA_MIN || used[i] + c.words > halfOf(plan.perText[i]))) continue;
			if (!top || c.score > top.score) top = c;
		}
		return top;
	};
	const take = (i: number, c: Scored<T>) => {
		out[i].push(c.ann);
		used[i] += c.words;
		total += c.words;
		seenAt.set(c.key, [...(seenAt.get(c.key) ?? []), i]);
		for (let j = 0; j < texts.length; j++) dist[j] = Math.min(dist[j], Math.abs(i - j));
	};

	// Primeira passada: uma troca por janela, a melhor delas.
	const f = plan.cueFraction;
	const windows = new Map<number, number[]>();
	texts.forEach((_, i) => {
		const k = Math.floor(i * f + 1e-9);
		if (!windows.has(k)) windows.set(k, []);
		windows.get(k)!.push(i);
	});
	for (const cues of windows.values()) {
		let pick: { i: number; c: Scored<T> } | null = null;
		for (const i of cues) {
			const c = best(i);
			if (c && (!pick || c.score > pick.c.score)) pick = { i, c };
		}
		if (pick) take(pick.i, pick.c);
	}

	// Depois, até fechar a cota.
	while (total < plan.quota) {
		let pick: { i: number; c: Scored<T>; rank: number[] } | null = null;
		for (let i = 0; i < texts.length; i++) {
			const c = best(i);
			if (!c) continue;
			const free = out[i].length === 0;
			const rank = [
				free ? 1 : 0,
				free ? dist[i] : out[i].length < plan.caps[i] ? 1 : 0,
				free ? 0 : -(used[i] + c.words) / Math.max(1, plan.perText[i]),
				c.score
			];
			if (!pick || greater(rank, pick.rank)) pick = { i, c, rank };
		}
		if (!pick) break;
		take(pick.i, pick.c);
	}
	return out.map((anns) => anns.sort((a, b) => a.start - b.start));
}

function greater(a: number[], b: number[]): boolean {
	for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] > b[k];
	return false;
}
