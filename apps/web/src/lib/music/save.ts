// Validação do lote de palavras que o jogo manda salvar. Cada palavra vira um item
// (ou acha o que já existe) com um encontro de origem 'musica' ligado à obra.
// Frase longa é cortada; lema vazio ou longo e sentido enorme recusam o lote.

import { LIMITS, charLength, normalizeLemma, normalizeText, type SaveEntry } from '../items.ts';
import type { MusicLanguage } from './wordlists.ts';

export const MAX_WORDS_PER_SAVE = 50;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface MusicWord {
	lemma: string;
	sense: string;
	/** Verso onde a palavra apareceu. */
	sentence: string;
	/** A palavra como está no verso. */
	highlight: string;
	/** Momento do verso no vídeo. */
	seconds: number | null;
}

export type ParsedMusicSave = { ok: true; workId: string; words: MusicWord[] } | { ok: false };

function cut(s: string, max: number): string {
	return [...s].slice(0, max).join('');
}

function asString(v: unknown): string {
	return typeof v === 'string' ? v : '';
}

function seconds(v: unknown): number | null {
	if (typeof v !== 'number' || !Number.isFinite(v)) return null;
	const s = Math.floor(v);
	return s >= 0 && s <= LIMITS.seconds ? s : null;
}

export function parseMusicSave(body: unknown): ParsedMusicSave {
	const b = body as { workId?: unknown; words?: unknown } | null;
	const workId = asString(b?.workId);
	const raw = b?.words;
	if (!UUID.test(workId)) return { ok: false };
	if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_WORDS_PER_SAVE)
		return { ok: false };

	const words: MusicWord[] = [];
	for (const item of raw) {
		if (typeof item !== 'object' || item === null) return { ok: false };
		const r = item as Record<string, unknown>;

		const lemma = normalizeLemma(asString(r.lemma));
		const sense = normalizeText(asString(r.sense));
		if (lemma === '' || charLength(lemma) > LIMITS.lemma) return { ok: false };
		if (charLength(sense) > LIMITS.sense) return { ok: false };

		const highlight = normalizeLemma(asString(r.highlight));
		words.push({
			lemma,
			sense,
			sentence: cut(normalizeText(asString(r.sentence)), LIMITS.sentence),
			highlight: charLength(highlight) <= LIMITS.highlight ? highlight : '',
			seconds: seconds(r.seconds)
		});
	}
	return { ok: true, workId, words };
}

/** O que save_items recebe: o idioma vem da obra, não do navegador. */
export function musicEntries(
	words: readonly MusicWord[],
	work: { id: string; language: MusicLanguage }
): SaveEntry[] {
	return words.map((w) => ({
		language: work.language,
		lemma: w.lemma,
		sense: w.sense,
		note: '',
		ipa: '',
		part_of_speech: '',
		encounter: {
			form: w.highlight,
			sentence: w.sentence,
			highlight: w.highlight,
			sense: w.sense,
			position: w.seconds === null ? {} : { seconds: w.seconds },
			origin: 'musica',
			seen_at: null,
			client_id: null
		},
		work: { id: work.id }
	}));
}
