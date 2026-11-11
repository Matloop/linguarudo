// Opções erradas para uma lacuna: palavras parecidas por forma (distância de
// edição, mesmo começo ou fim), tiradas da própria letra e de uma lista comum.

import type { Rng } from './rng.ts';

export function editDistance(a: string, b: string): number {
	const x = [...a];
	const y = [...b];
	let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
	for (let i = 1; i <= x.length; i++) {
		const row = [i];
		for (let j = 1; j <= y.length; j++) {
			row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
		}
		prev = row;
	}
	return prev[y.length];
}

function commonPrefix(a: string, b: string): number {
	let n = 0;
	while (n < a.length && n < b.length && a[n] === b[n]) n++;
	return n;
}

function commonSuffix(a: string, b: string): number {
	let n = 0;
	while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
	return n;
}

/** 1 para palavras iguais; cai com a distância e sobe com começo e fim em comum. */
export function similarity(a: string, b: string): number {
	if (a === b) return 1;
	const longest = Math.max([...a].length, [...b].length);
	if (longest === 0) return 1;
	const edit = 1 - editDistance(a, b) / longest;
	const shape = (commonPrefix(a, b) + commonSuffix(a, b)) / longest;
	return Math.max(0, Math.min(0.99, edit * 0.7 + Math.min(1, shape) * 0.3));
}

export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
	const out = [...items];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

export interface OptionSources {
	/** Palavras da própria letra. */
	pool: readonly string[];
	/** Palavras comuns da língua. */
	common: readonly string[];
	/** Palavras que não podem virar opção (as que já aparecem na linha). */
	exclude?: ReadonlySet<string>;
	rng: Rng;
	/** Total de opções, com a resposta. */
	count?: number;
}

function isCapitalized(word: string): boolean {
	const first = [...word][0] ?? '';
	return first !== first.toLowerCase() && first === first.toUpperCase();
}

function capitalize(word: string): string {
	const [first = '', ...rest] = [...word];
	return first.toUpperCase() + rest.join('');
}

/** Uma palavra é "perto" da resposta quando muda pouco: até 2 edições ou até metade do tamanho. */
function isNear(answer: string, candidate: string): boolean {
	const limit = Math.max(2, Math.floor(Math.min([...answer].length, [...candidate].length) / 2));
	return editDistance(answer, candidate) <= Math.min(limit, 3) || sharesEdge(answer, candidate);
}

function sharesEdge(a: string, b: string): boolean {
	const shortest = Math.min([...a].length, [...b].length);
	return shortest >= 4 && (commonPrefix(a, b) >= 4 || commonSuffix(a, b) >= 4);
}

export function makeOptions(answer: string, sources: OptionSources): string[] {
	const { rng, count = 4 } = sources;
	const answerKey = answer.toLowerCase();
	const exclude = sources.exclude ?? new Set<string>();
	const capitalized = isCapitalized(answer);

	const seen = new Set<string>([answerKey]);
	const candidates: string[] = [];
	for (const raw of [...sources.pool, ...sources.common]) {
		const key = raw.toLowerCase();
		if (key === '' || seen.has(key) || exclude.has(key)) continue;
		seen.add(key);
		candidates.push(key);
	}

	const ranked = candidates
		.map((c) => ({ c, score: similarity(answerKey, c), near: isNear(answerKey, c) }))
		.sort((p, q) => q.score - p.score);

	const need = count - 1;
	const near = shuffle(
		ranked.filter((r) => r.near),
		rng
	);
	const picked = near.slice(0, need);
	if (picked.length < need) {
		// Faltou parecida: completa com as mais próximas das que sobraram.
		const rest = ranked.filter((r) => !r.near).slice(0, need * 4);
		picked.push(...shuffle(rest, rng).slice(0, need - picked.length));
	}

	const distractors = picked.map((p) => (capitalized ? capitalize(p.c) : p.c));
	return shuffle([answer, ...distractors], rng);
}
