// Sincronia da letra com o vídeo, por âncoras.
//
// Uma âncora diz "a linha N começa no segundo V do vídeo". Cada âncora vale da sua
// linha até a próxima âncora, com deslocamento constante (o modelo do alass): cobre
// intro mais longa, pausa inserida no meio do clipe e trecho cortado. A primeira
// âncora também vale para trás. Velocidade diferente da faixa (rate) só entra quando
// a pessoa aceita a sugestão; nunca sozinha.
//
// Linha que, pelo trecho dela, começaria depois da próxima âncora não está no vídeo
// (o clipe cortou): fica "ausente", esmaecida e sem lacuna.
//
// Fica na obra do usuário, em refs.lyrics_sync. As âncoras guardam o tempo da letra
// e um hash do texto da linha, para reencontrar a linha se a letra mudar.

export interface Anchor {
	/** Índice da linha. */
	line: number;
	/** Segundo do vídeo em que a linha começa. */
	video: number;
}

export interface Timeline {
	/** Em ordem de linha e de vídeo (as duas crescentes). */
	anchors: readonly Anchor[];
	rate: number;
}

export interface TimedLine {
	start: number;
	end: number;
	text: string;
}

export interface LineTiming {
	/** Tempo do vídeo (s). */
	start: number;
	end: number;
	/** false: o clipe cortou esta linha. */
	present: boolean;
}

export const EMPTY_TIMELINE: Timeline = { anchors: [], rate: 1 };
export const MAX_ANCHORS = 64;
export const OFFSET_LIMIT_S = 300;
export const RATE_MIN = 0.9;
export const RATE_MAX = 1.1;
export const MAX_SECONDS = 3600;
/** Diferenças menores que isto entre vídeo e faixa não valem um aviso. */
export const HINT_MIN_S = 2;
/** Duas âncoras vizinhas ficam pelo menos isto separadas no vídeo. */
const MIN_GAP_S = 0.05;

const round2 = (v: number) => Math.round(v * 100) / 100;

// ---------- mapa letra → vídeo ----------

/** Índice da âncora cujo trecho contém a linha (a primeira vale para trás); -1 sem âncoras. */
export function segmentOf(tl: Timeline, line: number): number {
	if (tl.anchors.length === 0) return -1;
	let k = 0;
	for (let i = 0; i < tl.anchors.length; i++) {
		if (tl.anchors[i].line <= line) k = i;
		else break;
	}
	return k;
}

/** Deslocamento (vídeo − letra) do trecho que contém a linha. */
export function offsetAt(tl: Timeline, lines: readonly TimedLine[], line: number): number {
	const k = segmentOf(tl, line);
	if (k < 0) return 0;
	const a = tl.anchors[k];
	return round2(a.video - (lines[a.line]?.start ?? 0));
}

export function lineTimings(tl: Timeline, lines: readonly TimedLine[]): LineTiming[] {
	const r = tl.rate;
	return lines.map((l, i) => {
		const k = segmentOf(tl, i);
		if (k < 0) return { start: l.start * r, end: l.end * r, present: true };
		const a = tl.anchors[k];
		const base = lines[a.line].start;
		const start = a.video + (l.start - base) * r;
		let end = a.video + (l.end - base) * r;
		const next = tl.anchors[k + 1];
		if (next && i < next.line) {
			if (start >= next.video) return { start, end, present: false };
			end = Math.min(end, next.video);
		}
		return { start, end, present: true };
	});
}

/** Tempo da letra que toca no segundo `video` (o inverso do mapa): o trecho é o da
 * última âncora que já passou; antes da primeira, vale a primeira. */
export function lyricTimeAt(tl: Timeline, lines: readonly TimedLine[], video: number): number {
	const r = tl.rate;
	if (tl.anchors.length === 0) return video / r;
	let a = tl.anchors[0];
	for (const b of tl.anchors) {
		if (b.video <= video) a = b;
		else break;
	}
	return (lines[a.line]?.start ?? 0) + (video - a.video) / r;
}

/** Última linha presente que já começou no tempo `t` do vídeo; -1 antes da primeira. */
export function lineAt(timings: readonly LineTiming[], t: number): number {
	let found = -1;
	for (let i = 0; i < timings.length; i++) {
		if (!timings[i].present) continue;
		if (timings[i].start <= t) found = i;
		else break;
	}
	return found;
}

// ---------- edição ----------

function inOrder(a: Anchor, b: Anchor): boolean {
	if (a.line < b.line) return a.video + MIN_GAP_S <= b.video;
	if (a.line > b.line) return a.video >= b.video + MIN_GAP_S;
	return false;
}

/**
 * Marca a linha no tempo dado. Substitui a âncora da mesma linha e tira as que ficariam
 * fora de ordem.
 */
export function withAnchor(tl: Timeline, lines: readonly TimedLine[], anchor: Anchor): Timeline {
	if (!Number.isInteger(anchor.line) || anchor.line < 0 || anchor.line >= lines.length) return tl;
	if (!Number.isFinite(anchor.video)) return tl;
	const video = round2(Math.max(0, Math.min(MAX_SECONDS, anchor.video)));
	if (Math.abs(video - lines[anchor.line].start) > OFFSET_LIMIT_S) return tl;
	const next: Anchor = { line: anchor.line, video };

	const others = tl.anchors.filter((a) => a.line !== next.line);
	const kept = others.filter((a) => inOrder(a, next));
	if (kept.length >= MAX_ANCHORS) return tl;
	const anchors = [...kept, next].sort((a, b) => a.line - b.line);
	return { ...tl, anchors };
}

export function withoutAnchor(tl: Timeline, index: number): Timeline {
	if (index < 0 || index >= tl.anchors.length) return tl;
	return { ...tl, anchors: tl.anchors.filter((_, i) => i !== index) };
}

/**
 * Ajuste fino do trecho que contém a linha. Sem âncoras, cria uma na linha.
 * O trecho não passa das âncoras vizinhas.
 */
export function nudgeSegment(
	tl: Timeline,
	lines: readonly TimedLine[],
	line: number,
	delta: number
): Timeline {
	if (lines.length === 0 || !Number.isFinite(delta) || delta === 0) return tl;
	const k = segmentOf(tl, line);
	if (k < 0) {
		const at = Math.max(0, Math.min(lines.length - 1, line));
		return withAnchor(tl, lines, { line: at, video: lines[at].start * tl.rate + delta });
	}
	const a = tl.anchors[k];
	const prev = tl.anchors[k - 1];
	const next = tl.anchors[k + 1];
	let video = a.video + delta;
	if (prev) video = Math.max(video, prev.video + MIN_GAP_S);
	if (next) video = Math.min(video, next.video - MIN_GAP_S);
	video = round2(Math.max(0, video));
	if (Math.abs(video - lines[a.line].start) > OFFSET_LIMIT_S) return tl;
	const anchors = tl.anchors.map((x, i) => (i === k ? { ...x, video } : x));
	return { ...tl, anchors };
}

export function withRate(tl: Timeline, rate: number): Timeline {
	if (!Number.isFinite(rate)) return tl;
	return { ...tl, rate: Math.round(Math.max(RATE_MIN, Math.min(RATE_MAX, rate)) * 10000) / 10000 };
}

// ---------- sugestão de velocidade ----------

const RATE_MIN_ANCHORS = 3;
const RATE_MIN_DIFF = 0.005;
const RATE_MAX_RESIDUAL_S = 0.3;

/**
 * Se 3+ âncoras caem numa reta com inclinação diferente de 1 (o vídeo toca a faixa
 * mais rápido ou mais devagar) e o modelo por trechos explica pior, sugere o fator.
 * Theil–Sen: mediana das inclinações entre pares, resistente a um toque errado.
 */
export function suggestRate(tl: Timeline, lines: readonly TimedLine[]): number | null {
	const pts = tl.anchors.map((a) => ({ x: lines[a.line]?.start ?? 0, y: a.video }));
	if (pts.length < RATE_MIN_ANCHORS) return null;
	const slopes: number[] = [];
	for (let i = 0; i < pts.length; i++)
		for (let j = i + 1; j < pts.length; j++) {
			const dx = pts[j].x - pts[i].x;
			if (dx > 0) slopes.push((pts[j].y - pts[i].y) / dx);
		}
	if (slopes.length === 0) return null;
	const slope = median(slopes);
	if (slope < RATE_MIN || slope > RATE_MAX) return null;
	if (Math.abs(slope - tl.rate) < RATE_MIN_DIFF) return null;
	const intercept = median(pts.map((p) => p.y - slope * p.x));
	const residuals = pts.map((p) => Math.abs(p.y - (intercept + slope * p.x)));
	if (Math.max(...residuals) >= RATE_MAX_RESIDUAL_S) return null;
	// Trechos com a velocidade atual: quanto cada âncora erra prevista pela anterior.
	let stepError = 0;
	for (let i = 1; i < pts.length; i++) {
		stepError += Math.abs(pts[i].y - (pts[i - 1].y + (pts[i].x - pts[i - 1].x) * tl.rate));
	}
	stepError /= pts.length - 1;
	const lineError = residuals.reduce((s, v) => s + v, 0) / residuals.length;
	if (stepError < RATE_MAX_RESIDUAL_S || stepError < 2 * lineError) return null;
	return Math.round(slope * 10000) / 10000;
}

function median(values: number[]): number {
	const s = [...values].sort((a, b) => a - b);
	const m = s.length >> 1;
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ---------- palpite e formato ----------

/**
 * Palpite pela duração: quanto o vídeo tem a mais que a faixa. Só um palpite, porque
 * a sobra pode estar no fim do clipe. null quando não dá para saber ou é pequena demais.
 */
export function durationHint(videoSeconds: number, trackSeconds: number | null): number | null {
	if (!(videoSeconds > 0) || trackSeconds === null || !(trackSeconds > 0)) return null;
	const diff = Math.round((videoSeconds - trackSeconds) * 10) / 10;
	return Math.abs(diff) > HINT_MIN_S ? diff : null;
}

/** "+12,6 s" / "−0,4 s". */
export function formatOffset(seconds: number): string {
	const v = Math.round((Number.isFinite(seconds) ? seconds : 0) * 10) / 10 || 0;
	return `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(1).replace('.', ',')} s`;
}

// ---------- guardar e reencontrar ----------

export interface StoredAnchor {
	/** Começo da linha na letra (s). */
	lyric: number;
	video: number;
	/** Hash do texto da linha (FNV-1a, 8 dígitos hex). */
	hash: string;
}

export interface StoredSync {
	v: 1;
	rate: number;
	anchors: StoredAnchor[];
	hintDismissed: boolean;
	/** Versão da letra no LRCLIB que a pessoa escolheu; null = a automática. */
	lrclibId: number | null;
}

export const EMPTY_SYNC: StoredSync = {
	v: 1,
	rate: 1,
	anchors: [],
	hintDismissed: false,
	lrclibId: null
};

/** Texto da linha sem acento, pontuação e caixa: o que importa para reconhecer a linha. */
export function normalizeLine(text: string): string {
	return text
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();
}

export function lineHash(text: string): string {
	let h = 0x811c9dc5;
	for (const ch of normalizeLine(text)) {
		const code = ch.codePointAt(0) ?? 0;
		h ^= code;
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h.toString(16).padStart(8, '0');
}

export function serializeSync(
	tl: Timeline,
	lines: readonly TimedLine[],
	extra: Pick<StoredSync, 'hintDismissed' | 'lrclibId'>
): StoredSync {
	return {
		v: 1,
		rate: tl.rate,
		anchors: tl.anchors.map((a) => ({
			lyric: round2(lines[a.line].start),
			video: round2(a.video),
			hash: lineHash(lines[a.line].text)
		})),
		...extra
	};
}

const NEAR_S = 0.5;
const FAR_S = 5;

/**
 * Reencontra as âncoras guardadas na letra de agora: mesma linha (tempo e texto) ou,
 * se a letra mudou um pouco, a linha de mesmo texto até 5 s dali, mantendo o
 * deslocamento. As que não acham linha caem (a tela avisa).
 */
export function resolveSync(
	stored: StoredSync,
	lines: readonly TimedLine[]
): { timeline: Timeline; dropped: number } {
	let tl: Timeline = { anchors: [], rate: stored.rate };
	let dropped = 0;
	const hashes = lines.map((l) => lineHash(l.text));
	for (const s of stored.anchors) {
		let best = -1;
		let bestDist = Infinity;
		for (let i = 0; i < lines.length; i++) {
			if (hashes[i] !== s.hash) continue;
			const d = Math.abs(lines[i].start - s.lyric);
			if (d <= FAR_S && d < bestDist) {
				best = i;
				bestDist = d;
			}
		}
		if (best < 0) {
			dropped++;
			continue;
		}
		const video = bestDist <= NEAR_S ? s.video : s.video + (lines[best].start - s.lyric);
		const before = tl.anchors.length;
		tl = withAnchor(tl, lines, { line: best, video });
		if (tl.anchors.length <= before) dropped++;
	}
	return { timeline: tl, dropped };
}

const HASH = /^[0-9a-f]{8}$/;

function isNum(v: unknown, min: number, max: number): v is number {
	return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
}

/** Valida a sincronia guardada (ou mandada pelo cliente). null se algo não confere. */
export function parseStoredSync(raw: unknown): StoredSync | null {
	if (typeof raw !== 'object' || raw === null) return null;
	const r = raw as Record<string, unknown>;
	if (r.v !== 1 || !isNum(r.rate, RATE_MIN, RATE_MAX)) return null;
	if (typeof r.hintDismissed !== 'boolean') return null;
	const lrclibId = r.lrclibId ?? null;
	if (lrclibId !== null && !(Number.isInteger(lrclibId) && (lrclibId as number) > 0)) return null;
	if (!Array.isArray(r.anchors) || r.anchors.length > MAX_ANCHORS) return null;
	const anchors: StoredAnchor[] = [];
	for (const a of r.anchors as unknown[]) {
		if (typeof a !== 'object' || a === null) return null;
		const x = a as Record<string, unknown>;
		if (!isNum(x.lyric, 0, MAX_SECONDS) || !isNum(x.video, 0, MAX_SECONDS)) return null;
		if (Math.abs(x.video - x.lyric) > OFFSET_LIMIT_S) return null;
		if (typeof x.hash !== 'string' || !HASH.test(x.hash)) return null;
		anchors.push({ lyric: x.lyric, video: x.video, hash: x.hash });
	}
	return {
		v: 1,
		rate: r.rate,
		anchors,
		hintDismissed: r.hintDismissed,
		lrclibId: lrclibId as number | null
	};
}

/** A sincronia da obra (refs.lyrics_sync); vazia quando a pessoa nunca mexeu. */
export function syncFromRefs(refs: unknown): StoredSync {
	const r = (typeof refs === 'object' && refs !== null ? refs : {}) as Record<string, unknown>;
	return parseStoredSync(r.lyrics_sync) ?? EMPTY_SYNC;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Corpo do POST /musica/sincronia: { workId, sync }. */
export function parseSyncUpdate(body: unknown): { workId: string; sync: StoredSync } | null {
	if (typeof body !== 'object' || body === null) return null;
	const b = body as Record<string, unknown>;
	if (typeof b.workId !== 'string' || !UUID.test(b.workId)) return null;
	const sync = parseStoredSync(b.sync);
	return sync ? { workId: b.workId, sync } : null;
}
