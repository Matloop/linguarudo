// Validação do lote de palavras que o jogo manda salvar no banco (source = 'music').
// Os limites vêm de words.ts e do banco; contexto e título longos são cortados, não recusados.

import { API_LIMITS } from '../stremio.ts';
import { LIMITS, isLang, normalizeTerm, normalizeText, type Lang } from '../words.ts';

export const MAX_WORDS_PER_SAVE = 50;

export interface MusicWord {
	term: string;
	translation: string;
	lang: Lang;
	context: string;
	context_highlight: string;
	source_title: string;
	source_time_s: number | null;
}

export type ParsedMusicWords = { ok: true; words: MusicWord[] } | { ok: false };

function cut(s: string, max: number): string {
	return [...s].slice(0, max).join('');
}

function asString(v: unknown): string {
	return typeof v === 'string' ? v : '';
}

function seconds(v: unknown): number | null {
	if (typeof v !== 'number' || !Number.isFinite(v)) return null;
	const s = Math.floor(v);
	return s >= 0 && s <= API_LIMITS.sourceTimeS ? s : null;
}

export function parseMusicWords(body: unknown): ParsedMusicWords {
	const raw = (body as { words?: unknown } | null)?.words;
	if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_WORDS_PER_SAVE)
		return { ok: false };

	const words: MusicWord[] = [];
	for (const item of raw) {
		if (typeof item !== 'object' || item === null) return { ok: false };
		const r = item as Record<string, unknown>;

		const term = normalizeTerm(asString(r.term));
		const translation = normalizeText(asString(r.translation));
		const lang = asString(r.lang).toLowerCase();
		if (term === '' || [...term].length > LIMITS.term) return { ok: false };
		if ([...translation].length > LIMITS.translation) return { ok: false };
		if (!isLang(lang)) return { ok: false };

		const highlight = normalizeText(asString(r.highlight));
		words.push({
			term,
			translation,
			lang,
			context: cut(normalizeText(asString(r.context)), LIMITS.context),
			context_highlight: [...highlight].length <= API_LIMITS.contextHighlight ? highlight : '',
			source_title: cut(normalizeText(asString(r.sourceTitle)), API_LIMITS.sourceTitle),
			source_time_s: seconds(r.sourceTime)
		});
	}
	return { ok: true, words };
}
