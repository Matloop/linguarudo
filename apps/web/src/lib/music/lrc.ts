// Parser de letra sincronizada no formato LRC ("[mm:ss.xx] texto").
// Só lógica pura: a letra vem do LRCLIB na hora de jogar e nunca é guardada.

export interface LrcEntry {
	time: number;
	text: string;
}

export interface LyricLine {
	index: number;
	start: number;
	end: number;
	text: string;
}

/** Uma linha cantada dura no máximo isto, mesmo que a próxima só venha depois de um trecho instrumental. */
export const MAX_LINE_SECONDS = 8;
/** A última linha não tem "próxima": assume esta duração. */
export const LAST_LINE_SECONDS = 5;

const STAMP = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const LEADING_STAMPS = /^(?:\s*\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\])+/;
const OFFSET_TAG = /^\s*\[offset:\s*([+-]?\d+)\s*\]\s*$/i;
const WORD_STAMP = /<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g;

function stampSeconds(min: string, sec: string, frac: string | undefined): number {
	const fraction = frac ? Number(`0.${frac}`) : 0;
	return Number(min) * 60 + Number(sec) + fraction;
}

function cleanText(raw: string): string {
	const text = raw.replace(WORD_STAMP, '').replace(/\s+/g, ' ').trim();
	// "♪" e "..." marcam pausa instrumental, não verso.
	return /\p{L}/u.test(text) ? text : '';
}

export function parseLrc(src: string): LrcEntry[] {
	const rows = src.split(/\r?\n/);
	let offsetSeconds = 0;
	const entries: LrcEntry[] = [];

	for (const row of rows) {
		const offset = row.match(OFFSET_TAG);
		if (offset) {
			// Segundo a convenção do LRC, offset positivo faz a letra aparecer mais cedo.
			offsetSeconds = Number(offset[1]) / 1000;
			continue;
		}
		const lead = row.match(LEADING_STAMPS);
		if (!lead) continue;
		const text = cleanText(row.slice(lead[0].length));
		for (const m of lead[0].matchAll(STAMP)) {
			entries.push({ time: stampSeconds(m[1], m[2], m[3]), text });
		}
	}

	return entries
		.map((e) => ({ ...e, time: Math.max(0, e.time - offsetSeconds) }))
		.sort((a, b) => a.time - b.time);
}

export function toLyricLines(entries: readonly LrcEntry[]): LyricLine[] {
	const lines: LyricLine[] = [];
	entries.forEach((entry, i) => {
		if (entry.text === '') return;
		const next = entries[i + 1];
		const end = next
			? Math.min(next.time, entry.time + MAX_LINE_SECONDS)
			: entry.time + LAST_LINE_SECONDS;
		lines.push({ index: lines.length, start: entry.time, end, text: entry.text });
	});
	return lines;
}

export function parseSyncedLyrics(src: string): LyricLine[] {
	return toLyricLines(parseLrc(src));
}
