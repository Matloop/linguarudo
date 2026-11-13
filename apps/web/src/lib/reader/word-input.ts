// O que o leitor manda ao tocar ou salvar uma palavra do blend. Puro.
// Limites como os do `save` do sync (CONTRACT §4) e de items.ts.

import { LIMITS, charLength, normalizeLemma, normalizeText } from '#lib/items.ts';
import { MAX_SENTENCE } from './sentence.ts';

export type WordSave = {
	clientId: string;
	at: Date;
	lemma: string;
	translation: string;
	note: string;
	form: string;
	sentence: string;
	chapter: string;
	spine: number | null;
	percent: number | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Corta em code points (o aparelho e o servidor cortam igual). */
function clip(v: unknown, max: number, normalize = normalizeText): string {
	const chars = [...normalize(str(v))];
	return chars.length > max ? chars.slice(0, max).join('').trimEnd() : chars.join('');
}

/** O lema que identifica o item: obrigatório, até 80 code points. */
export function parseLemma(v: unknown): string | null {
	const lemma = normalizeLemma(str(v));
	return lemma && charLength(lemma) <= LIMITS.lemma ? lemma : null;
}

export function parseWordSave(raw: unknown, now: Date): WordSave | null {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;
	const lemma = parseLemma(r.lemma);
	const clientId = str(r.clientId);
	if (!lemma || !UUID.test(clientId)) return null;
	const at = new Date(str(r.at));
	const pos = (r.position ?? {}) as Record<string, unknown>;
	const spine = pos.spine;
	const percent = pos.percent;
	return {
		clientId: clientId.toLowerCase(),
		at: Number.isNaN(at.getTime()) || at > now ? now : at,
		lemma,
		translation: clip(r.translation, LIMITS.sense),
		note: clip(r.note, LIMITS.note),
		form: clip(r.form, LIMITS.form, normalizeLemma),
		sentence: clip(r.sentence, MAX_SENTENCE, (s) => normalizeText(s).replace(/\s+/g, ' ')),
		chapter: clip(pos.chapter, LIMITS.title, (s) => normalizeText(s).replace(/\s+/g, ' ')),
		spine: typeof spine === 'number' && Number.isInteger(spine) && spine >= 0 ? spine : null,
		percent:
			typeof percent === 'number' && Number.isFinite(percent)
				? Math.round(Math.min(100, Math.max(0, percent)) * 10) / 10
				: null
	};
}
