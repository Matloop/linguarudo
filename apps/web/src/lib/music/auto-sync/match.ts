// Casa a transcrição de uma janela de áudio com as linhas da letra.
//
// O Whisper devolve trechos ("chunks") com texto e início/fim relativos à janela.
// Os trechos não coincidem com as linhas: um trecho pode cobrir duas linhas, metade
// de uma, ou começar no meio de outra. Por isso a pergunta feita a cada trecho é:
// "o texto deste trecho parece o começo da letra a partir da linha i?". Se sim, e
// com folga sobre a segunda melhor resposta, a linha i começa no início do trecho:
// isso vira uma âncora { linha, segundo do vídeo }.
//
// Só o início dos trechos vira âncora: é o tempo que o Whisper marca melhor.
// Não usamos tempo por palavra (instável no transformers.js).

export interface MatchLine {
	index: number;
	start: number;
	text: string;
}

/** Trecho da transcrição; tempos em segundos desde o início da janela. */
export interface TranscriptChunk {
	text: string;
	start: number;
	end: number | null;
}

export interface AutoAnchor {
	/** `index` da linha da letra. */
	line: number;
	/** Segundo do vídeo em que a linha começa. */
	video: number;
	/** Confiança entre 0 e 1. */
	score: number;
}

export interface MatchInput {
	chunks: readonly TranscriptChunk[];
	/** Segundo do vídeo na primeira amostra da janela. */
	windowVideoStart: number;
	/** Tempo da letra esperado no início da janela, pelas âncoras atuais. Desempata refrões. */
	expectedLyricTime?: number;
}

export interface MatchOptions {
	/** Nota mínima (Dice ponderado entre o trecho e o começo da letra a partir da linha). */
	minScore: number;
	/** Folga mínima sobre a melhor linha concorrente. */
	margin: number;
	/** Palavras mínimas no trecho; trechos curtos ("oh oh") casam com qualquer coisa. */
	minTokens: number;
	/** Peso mínimo casado (soma das semelhanças das palavras). */
	minMatched: number;
	/** Trechos que começam antes disto (s) podem ter sido cortados no meio pela janela. */
	minChunkStart: number;
	/** Ao desempatar pelo tempo esperado, a linha escolhida precisa estar a no máximo isto (s). */
	maxExpectedDistance: number;
	/** ...e a concorrente empatada precisa estar pelo menos isto (s) mais longe. */
	minExpectedSeparation: number;
	/** Âncoras da mesma janela devem concordar no deslocamento vídeo − letra até isto (s). */
	maxOffsetSpread: number;
	/** Âncoras por janela, no máximo. */
	maxAnchors: number;
}

export const MATCH_DEFAULTS: MatchOptions = {
	minScore: 0.55,
	margin: 0.08,
	minTokens: 3,
	minMatched: 2.5,
	minChunkStart: 0.5,
	maxExpectedDistance: 20,
	minExpectedSeparation: 6,
	maxOffsetSpread: 3,
	maxAnchors: 4
};

// ---------------------------------------------------------------------------
// Texto

/** Minúsculas, sem acento nem pontuação, espaços simples. */
export function normalizeText(text: string): string {
	return text
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();
}

/** Escritas sem espaço entre palavras: cada caractere vira uma "palavra". */
const UNSPACED =
	/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
const UNSPACED_G = new RegExp(UNSPACED.source, 'gu');

export function tokenize(text: string): string[] {
	const norm = normalizeText(text);
	if (norm === '') return [];
	const spaced = UNSPACED.test(norm) ? norm.replace(UNSPACED_G, ' $& ') : norm;
	return spaced.split(/\s+/).filter(Boolean);
}

/** Marcas que o Whisper escreve em trecho instrumental. */
const NON_SPEECH = /^\s*[[(♪*].*[\])♪*]\s*$|^\s*♪+\s*$/u;

function levenshtein(a: string, b: string): number {
	if (a === b) return 0;
	let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		const cur = [i];
		for (let j = 1; j <= b.length; j++) {
			cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
		}
		prev = cur;
	}
	return prev[b.length];
}

/** Semelhança entre duas palavras normalizadas, de 0 a 1. Abaixo de 0,5 conta como 0. */
export function tokenSimilarity(a: string, b: string): number {
	if (a === b) return 1;
	// Palavras curtas ("a", "il", "de") só valem se forem iguais.
	if (Math.min(a.length, b.length) <= 2) return 0;
	const s = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
	return s >= 0.5 ? s : 0;
}

// ---------------------------------------------------------------------------
// Letra preparada

interface Prepared {
	/** Palavras da letra inteira, em ordem. */
	tokens: string[];
	/** Posição em `tokens` da primeira palavra de cada linha (mesma ordem de `lines`). */
	lineStarts: number[];
	lines: readonly MatchLine[];
}

const cache = new WeakMap<readonly MatchLine[], Prepared>();

function prepare(lines: readonly MatchLine[]): Prepared {
	const hit = cache.get(lines);
	if (hit) return hit;
	const tokens: string[] = [];
	const lineStarts: number[] = [];
	for (const line of lines) {
		lineStarts.push(tokens.length);
		tokens.push(...tokenize(line.text));
	}
	const prepared = { tokens, lineStarts, lines };
	cache.set(lines, prepared);
	return prepared;
}

// ---------------------------------------------------------------------------
// Alinhamento

interface Alignment {
	score: number;
	matched: number;
	/** Primeira palavra casada no trecho e na letra (relativas ao começo de cada um). */
	firstChunk: number;
	firstLyric: number;
}

/**
 * Alinha as palavras do trecho com o começo de `lyric` (subsequência comum com
 * semelhança aproximada) e escolhe até onde da letra o trecho vai. Nota = Dice:
 * 2·casado / (palavras do trecho + palavras da letra consumidas). Palavras da letra
 * puladas no começo contam como consumidas, então um trecho que começa no meio
 * da linha perde nota.
 */
function alignPrefix(chunk: readonly string[], lyric: readonly string[]): Alignment | null {
	const n = chunk.length;
	const m = lyric.length;
	if (n === 0 || m === 0) return null;
	const sim: number[][] = chunk.map((c) => lyric.map((l) => tokenSimilarity(c, l)));
	// dp[i][j]: melhor soma com chunk[0..i) e lyric[0..j).
	const dp: Float64Array[] = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
	for (let i = 1; i <= n; i++) {
		for (let j = 1; j <= m; j++) {
			const s = sim[i - 1][j - 1];
			dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1], s > 0 ? dp[i - 1][j - 1] + s : 0);
		}
	}
	let bestEnd = 0;
	let best = -1;
	for (let j = 1; j <= m; j++) {
		const dice = (2 * dp[n][j]) / (n + j);
		if (dice > best + 1e-9) {
			best = dice;
			bestEnd = j;
		}
	}
	if (dp[n][bestEnd] <= 0) return null;

	// Volta pelo caminho para achar o primeiro par casado.
	let i = n;
	let j = bestEnd;
	let firstChunk = -1;
	let firstLyric = -1;
	while (i > 0 && j > 0) {
		const s = sim[i - 1][j - 1];
		if (s > 0 && Math.abs(dp[i][j] - (dp[i - 1][j - 1] + s)) < 1e-9) {
			firstChunk = i - 1;
			firstLyric = j - 1;
			i--;
			j--;
		} else if (dp[i][j] === dp[i - 1][j]) {
			i--;
		} else {
			j--;
		}
	}
	return { score: best, matched: dp[n][bestEnd], firstChunk, firstLyric };
}

interface Candidate {
	/** Posição em `lines`. */
	pos: number;
	score: number;
}

function candidatesFor(prep: Prepared, chunk: readonly string[], opts: MatchOptions): Candidate[] {
	const out: Candidate[] = [];
	// Letra suficiente para cobrir o trecho mesmo com palavras que o Whisper perdeu.
	const span = Math.ceil(chunk.length * 1.6) + 4;
	prep.lineStarts.forEach((from, pos) => {
		if (from >= prep.tokens.length) return;
		const nextFrom = prep.lineStarts[pos + 1] ?? prep.tokens.length;
		if (nextFrom === from) return; // linha sem palavras
		const a = alignPrefix(chunk, prep.tokens.slice(from, from + span));
		if (!a) return;
		// O trecho precisa começar onde a linha começa: aceita uma palavra perdida
		// no começo da letra ou uma palavra a mais (resto da linha anterior, "oh").
		if (a.firstLyric > 1 || a.firstChunk > 1) return;
		if (a.matched < opts.minMatched) return;
		out.push({ pos, score: a.score });
	});
	return out.sort((a, b) => b.score - a.score);
}

function pick(
	cands: readonly Candidate[],
	lines: readonly MatchLine[],
	expected: number | undefined,
	opts: MatchOptions
): Candidate | null {
	const best = cands[0];
	if (!best || best.score < opts.minScore) return null;
	const tied = cands.filter((c) => c.score >= best.score - opts.margin);
	if (tied.length === 1) return best;
	// Empate (refrão repetido, versos parecidos): só o tempo esperado decide.
	if (expected === undefined) return null;
	const byDistance = tied
		.map((c) => ({ c, d: Math.abs(lines[c.pos].start - expected) }))
		.sort((a, b) => a.d - b.d);
	const [near, next] = byDistance;
	if (near.d > opts.maxExpectedDistance) return null;
	if (next.d - near.d < opts.minExpectedSeparation) return null;
	if (near.c.score < opts.minScore) return null;
	return near.c;
}

function median(values: readonly number[]): number {
	const s = [...values].sort((a, b) => a - b);
	const mid = s.length >> 1;
	return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Âncoras confiáveis de uma janela: no máximo uma por trecho, uma por linha, em
 * ordem, e concordando entre si sobre o deslocamento vídeo − letra.
 */
export function matchWindow(
	lines: readonly MatchLine[],
	input: MatchInput,
	options: Partial<MatchOptions> = {}
): AutoAnchor[] {
	const opts = { ...MATCH_DEFAULTS, ...options };
	const prep = prepare(lines);
	if (prep.tokens.length === 0) return [];

	const picked: (AutoAnchor & { lyricStart: number })[] = [];
	for (const chunk of input.chunks) {
		if (!Number.isFinite(chunk.start) || chunk.start < opts.minChunkStart) continue;
		if (NON_SPEECH.test(chunk.text)) continue;
		const tokens = tokenize(chunk.text);
		if (tokens.length < opts.minTokens) continue;
		const expected =
			input.expectedLyricTime === undefined ? undefined : input.expectedLyricTime + chunk.start;
		const choice = pick(candidatesFor(prep, tokens, opts), lines, expected, opts);
		if (!choice) continue;
		const line = lines[choice.pos];
		picked.push({
			line: line.index,
			video: input.windowVideoStart + chunk.start,
			score: Math.min(1, choice.score),
			lyricStart: line.start
		});
	}
	if (picked.length === 0) return [];

	// Uma âncora por linha: fica a de maior nota.
	const byLine = new Map<number, (typeof picked)[number]>();
	for (const a of picked) {
		const prev = byLine.get(a.line);
		if (!prev || a.score > prev.score) byLine.set(a.line, a);
	}
	let anchors = [...byLine.values()];

	// Todas devem concordar sobre o deslocamento; quem destoa da mediana sai.
	// Com duas que discordam, fica a de maior nota.
	if (anchors.length === 2) {
		const [a, b] = anchors;
		if (Math.abs(a.video - a.lyricStart - (b.video - b.lyricStart)) > opts.maxOffsetSpread) {
			anchors = [a.score >= b.score ? a : b];
		}
	} else if (anchors.length > 2) {
		const mid = median(anchors.map((a) => a.video - a.lyricStart));
		anchors = anchors.filter((a) => Math.abs(a.video - a.lyricStart - mid) <= opts.maxOffsetSpread);
	}

	return anchors
		.sort((a, b) => b.score - a.score)
		.slice(0, opts.maxAnchors)
		.sort((a, b) => a.video - b.video)
		.map(({ line, video, score }) => ({ line, video, score }));
}
