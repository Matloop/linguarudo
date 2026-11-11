// Regras puras da API v1 das integrações (/api/v1, token Bearer): CORS, corpo dos
// pedidos e o que entra primeiro na legenda. O contrato está em
// packages/stremio-server/docs/CONTRACT.md.

import {
	LIMITS,
	charLength,
	normalizeLemma,
	parseSaveEntry,
	type FlashcardKind,
	type ItemStatus,
	type ParsedEntry
} from './items.ts';
import { lemmaKey } from '@linguetta/language';
import { parseLanguage, type Language } from './languages.ts';
import { isMastered } from './review.ts';

export const API_LIMITS = { saveBatch: LIMITS.saveBatch, seenBatch: 500 } as const;

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

// ---------- Preferência na legenda ----------

export interface FlashcardBrief {
	state: number;
	due_at: string;
}

/**
 * Entra na legenda primeiro: item ativo com algum flashcard aprendendo/reaprendendo
 * ou em revisão já vencida. Conhecido nunca entra.
 */
export function isPreferred(
	item: { status: ItemStatus; flashcards: readonly FlashcardBrief[] },
	now: Date
) {
	if (item.status !== 'ativo') return false;
	return item.flashcards.some(
		(c) =>
			c.state === 1 || c.state === 3 || (c.state === 2 && Date.parse(c.due_at) <= now.getTime())
	);
}

// ---------- Corpo de POST /api/v1/items ----------

export function parseSaveBody(
	body: unknown
): { ok: true; items: ParsedEntry[] } | { ok: false; error: string } {
	const items = (body as { items?: unknown } | null)?.items;
	if (!Array.isArray(items) || items.length === 0) {
		return { ok: false, error: 'mande { items: [...] } com pelo menos um item' };
	}
	if (items.length > API_LIMITS.saveBatch) {
		return { ok: false, error: `no máximo ${API_LIMITS.saveBatch} itens por vez` };
	}
	return { ok: true, items: items.map((raw) => parseSaveEntry(raw, 'stremio')) };
}

// ---------- Corpo de POST /api/v1/items/seen ----------

/** Os lemas viram chaves (lemmaKey) aqui: o cliente nunca manda a chave. */
export function parseSeenBody(body: unknown): { language: Language; lemmaKeys: string[] } | null {
	const b = body as { language?: unknown; lemmas?: unknown } | null;
	const language = parseLanguage(b?.language);
	if (!language || !Array.isArray(b?.lemmas) || b.lemmas.length > API_LIMITS.seenBatch) return null;
	const keys = new Set<string>();
	for (const t of b.lemmas) {
		if (typeof t !== 'string') continue;
		const lemma = normalizeLemma(t);
		if (lemma && charLength(lemma) <= LIMITS.lemma) keys.add(lemmaKey(lemma, language));
	}
	return { language, lemmaKeys: [...keys] };
}

// ---------- Respostas ----------

export interface ApiFlashcard {
	kind: FlashcardKind;
	state: number;
	dueAt: string;
	stability: number;
}

export interface ApiItem {
	id: string;
	/** Como a pessoa escreveu (a caixa é preservada). */
	lemma: string;
	/** Identidade do item no idioma: (language, lemmaKey). Só o servidor calcula. */
	lemmaKey: string;
	/** Leitura (furigana, pinyin); vazia se não há. */
	reading: string;
	sense: string;
	status: ItemStatus;
	/** Dominado (derivado da estabilidade); a legenda pode trocar sem destaque. */
	mastered: boolean;
	/** Entra primeiro na legenda (ver isPreferred). */
	prefer: boolean;
	flashcards: ApiFlashcard[];
	/** Grafias já vistas nos encontros, como escritas, além do lema (destaque na legenda do modo só-alvo). */
	forms: string[];
}

function flashcardBriefs(
	raw: unknown
): (FlashcardBrief & { kind: FlashcardKind; stability: number })[] {
	if (!Array.isArray(raw)) return [];
	return raw.filter(
		(c): c is FlashcardBrief & { kind: FlashcardKind; stability: number } =>
			typeof c === 'object' &&
			c !== null &&
			(c.kind === 'reconhecer' || c.kind === 'produzir') &&
			typeof c.state === 'number' &&
			typeof c.due_at === 'string' &&
			typeof c.stability === 'number'
	);
}

/**
 * Grafias como escritas, sem repetir pela chave do idioma e sem a do próprio lema
 * ('Haus' e 'haus' contam uma vez só; fica a primeira que chegou).
 */
export function distinctForms(raw: unknown, itemKey: string, language: Language): string[] {
	if (!Array.isArray(raw)) return [];
	const seen = new Set([itemKey]);
	const forms: string[] = [];
	for (const f of raw) {
		if (typeof f !== 'string' || !f) continue;
		const key = lemmaKey(f, language);
		if (seen.has(key)) continue;
		seen.add(key);
		forms.push(f);
	}
	return forms;
}

/** Uma linha de api_items como sai em GET /api/v1/items. */
export function apiItem(
	row: {
		id: string;
		lemma: string;
		lemma_key: string;
		reading?: string | null;
		sense: string;
		status: string;
		flashcards: unknown;
		forms?: unknown;
	},
	language: Language,
	now: Date
): ApiItem {
	const flashcards = flashcardBriefs(row.flashcards);
	const status: ItemStatus = row.status === 'conhecido' ? 'conhecido' : 'ativo';
	return {
		id: row.id,
		lemma: row.lemma,
		lemmaKey: row.lemma_key,
		reading: row.reading ?? '',
		sense: row.sense,
		status,
		mastered: isMastered(flashcards),
		prefer: isPreferred({ status, flashcards }, now),
		flashcards: flashcards.map((c) => ({
			kind: c.kind,
			state: c.state,
			dueAt: c.due_at,
			stability: c.stability
		})),
		forms: distinctForms(row.forms, row.lemma_key, language)
	};
}

export type ApiSaveResult =
	| {
			ok: true;
			item: {
				id: string;
				language: string;
				lemma: string;
				lemmaKey: string;
				/** false: o item já existia (o encontro entrou nele). */
				created: boolean;
				encounterId: string | null;
				flashcard: { state: number; dueAt: string };
			};
	  }
	| { ok: false; error: string };

export interface SavedRow {
	item_id: string;
	language: string;
	lemma: string;
	created: boolean;
	encounter_id: string | null;
	flashcard_state: number;
	flashcard_due_at: string;
}

/**
 * Junta o que foi validado com o que save_items devolveu (uma linha por entrada
 * válida, na mesma ordem). A resposta tem uma posição por entrada do pedido.
 */
export function apiSaveResults(
	entries: readonly ParsedEntry[],
	rows: readonly SavedRow[]
): ApiSaveResult[] {
	let next = 0;
	return entries.map((entry) => {
		if (!entry.ok) return { ok: false, error: entry.error };
		const r = rows[next++];
		if (!r) return { ok: false, error: 'não deu para salvar' };
		return {
			ok: true,
			item: {
				id: r.item_id,
				language: r.language,
				lemma: r.lemma,
				lemmaKey: entry.entry.lemma_key,
				created: r.created,
				encounterId: r.encounter_id,
				flashcard: { state: r.flashcard_state, dueAt: r.flashcard_due_at }
			}
		};
	});
}
