// Regras puras da integração com o fork LingoBlend do Stremio (rotas /api).
// Os limites espelham os checks de supabase/migrations/*_stremio.sql.

import { LIMITS, isLang, normalizeTerm, normalizeText, type Lang } from './words.ts';

export const API_LIMITS = {
	saveBatch: 200,
	seenBatch: 500,
	contextHighlight: 80,
	ipa: 100,
	pos: 80,
	meaning: 200,
	example: 300,
	sourceTitle: 200,
	sourceTimeS: 1_000_000
} as const;

// ---------- CORS e token ----------

/**
 * O fork roda local: `localhost`, `127.0.0.1` ou um `*.localhost` (o build web
 * serve em http://lingoblend.peario.xyz.localhost:8080). `extra` são origens exatas.
 */
export function isAllowedOrigin(origin: string | null, extra: readonly string[] = []): boolean {
	if (!origin) return false;
	if (extra.includes(origin)) return true;
	let url: URL;
	try {
		url = new URL(origin);
	} catch {
		return false;
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
	if (url.origin !== origin) return false;
	const host = url.hostname;
	return host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost');
}

export function parseBearer(header: string | null): string | null {
	const m = header?.trim().match(/^Bearer\s+(\S+)$/i);
	return m ? m[1] : null;
}

// ---------- Origem e preferências ----------

function clock(totalSeconds: number): string {
	const s = Math.floor(totalSeconds);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const ss = String(s % 60).padStart(2, '0');
	return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** "Kaguya, 42:10". */
export function formatSource(title: string, seconds: number | null): string {
	const parts = [title.trim(), seconds == null ? '' : clock(seconds)].filter(Boolean);
	return parts.join(', ');
}

export interface CardBrief {
	state: number;
	due_at: string;
	paused: boolean;
}

/** Entra na legenda primeiro: aprendendo/reaprendendo, ou em revisão já vencida. */
export function isPreferred(card: CardBrief, now: Date): boolean {
	if (card.paused) return false;
	if (card.state === 1 || card.state === 3) return true;
	return card.state === 2 && new Date(card.due_at).getTime() <= now.getTime();
}

// ---------- Corpo de POST /api/words ----------

// type (não interface) para caber no tipo Json do RPC.
export type StremioWordRow = {
	term: string;
	lang: Lang;
	translation: string;
	context: string;
	context_highlight: string;
	ipa: string;
	pos: string;
	meaning: string;
	example: string;
	source_title: string;
	source_time_s: number | null;
	saved_at: string | null;
};

export type StremioItem = { ok: true; row: StremioWordRow } | { ok: false; error: string };

/** Corta em code points (como o char_length do Postgres). */
function clip(v: unknown, max: number, normalize = normalizeText): string {
	if (typeof v !== 'string') return '';
	const chars = [...normalize(v)];
	return chars.length > max ? chars.slice(0, max).join('').trimEnd() : chars.join('');
}

function parseItem(raw: unknown): StremioItem {
	if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'item inválido' };
	const w = raw as Record<string, unknown>;

	const term = typeof w.term === 'string' ? normalizeTerm(w.term) : '';
	if (term === '') return { ok: false, error: 'term vazio' };
	if ([...term].length > LIMITS.term) return { ok: false, error: 'term longo demais' };
	const lang = typeof w.lang === 'string' ? w.lang.toLowerCase() : '';
	if (!isLang(lang)) return { ok: false, error: 'lang deve ser en ou it' };

	const highlight = typeof w.contextHighlight === 'string' ? normalizeTerm(w.contextHighlight) : '';
	const time = w.sourceTimeS;
	const savedAt = typeof w.savedAt === 'string' ? new Date(w.savedAt) : null;

	return {
		ok: true,
		row: {
			term,
			lang,
			translation: clip(w.translation, LIMITS.translation),
			context: clip(w.context, LIMITS.context),
			context_highlight: [...highlight].length <= API_LIMITS.contextHighlight ? highlight : '',
			ipa: clip(w.ipa, API_LIMITS.ipa),
			pos: clip(w.pos, API_LIMITS.pos),
			meaning: clip(w.meaning, API_LIMITS.meaning),
			example: clip(w.example, API_LIMITS.example),
			source_title: clip(w.sourceTitle, API_LIMITS.sourceTitle),
			source_time_s:
				typeof time === 'number' &&
				Number.isFinite(time) &&
				time >= 0 &&
				time <= API_LIMITS.sourceTimeS
					? Math.floor(time)
					: null,
			saved_at: savedAt && !Number.isNaN(savedAt.getTime()) ? savedAt.toISOString() : null
		}
	};
}

export function parseStremioWords(
	body: unknown
): { ok: true; items: StremioItem[] } | { ok: false; error: string } {
	const words = (body as { words?: unknown } | null)?.words;
	if (!Array.isArray(words) || words.length === 0) {
		return { ok: false, error: 'mande { words: [...] } com pelo menos uma palavra' };
	}
	if (words.length > API_LIMITS.saveBatch) {
		return { ok: false, error: `no máximo ${API_LIMITS.saveBatch} palavras por vez` };
	}
	return { ok: true, items: words.map(parseItem) };
}

// ---------- Corpo de POST /api/words/seen ----------

export function parseSeenBody(body: unknown): { lang: Lang; terms: string[] } | null {
	const b = body as { lang?: unknown; terms?: unknown } | null;
	const lang = typeof b?.lang === 'string' ? b.lang.toLowerCase() : '';
	if (!isLang(lang) || !Array.isArray(b?.terms) || b.terms.length > API_LIMITS.seenBatch)
		return null;
	const terms = new Set<string>();
	for (const t of b.terms) {
		if (typeof t !== 'string') continue;
		const term = normalizeTerm(t).toLowerCase();
		if (term && [...term].length <= LIMITS.term) terms.add(term);
	}
	return { lang, terms: [...terms] };
}
