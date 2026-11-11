// Lote de notas do Anki que o navegador manda ao servidor, já com a mídia trocada
// pelos caminhos no bucket. Aqui o lote é conferido campo a campo (vem do cliente).

import { clozeCount, FICHA_LIMITS, sanitizeFichaHtml } from '#lib/fichas.ts';
import { charLength, LIMITS } from '#lib/items.ts';
import { isMediaPath, sha256Hex, type MediaKind } from '#lib/media.ts';
import type { Grade } from '#lib/review.ts';
import type { ImportCard, ImportFichaNote, ImportItemNote, ImportNote } from './mapping.ts';

/** Notas por pedido: cabe folgado no tempo de uma função. */
export const IMPORT_BATCH_SIZE = 50;
const MAX_CARDS = 60;
const MAX_LOGS = 2000;
const MAX_TAGS = 50;

/** UUID fixo por GUID do Anki: client_id do encontro, para o reimport não duplicar. */
export async function ankiEncounterId(guid: string): Promise<string> {
	const h = await sha256Hex(new TextEncoder().encode(`anki:${guid}`));
	const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export type BatchResult = { ok: true; notes: ImportNote[] } | { ok: false; error: string };

class Invalid extends Error {}

function fail(what: string): never {
	throw new Invalid(what);
}

const isObj = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

function text(v: unknown, max: number, what: string, required = false): string {
	if (typeof v !== 'string') fail(what);
	const s = v.trim();
	if (charLength(s) > max || (required && !s)) fail(what);
	return s;
}

function media(v: unknown, userId: string, kind: MediaKind): string | null {
	if (v === null || v === undefined || v === '') return null;
	if (typeof v !== 'string' || !isMediaPath(userId, v, kind)) fail('mídia');
	return v;
}

function tags(v: unknown): string[] {
	if (!Array.isArray(v) || v.length > MAX_TAGS) fail('tags');
	const out = new Set<string>();
	for (const t of v) {
		const tag = text(t, 100, 'tags');
		if (tag) out.add(tag);
	}
	return [...out];
}

const ITEM_KINDS = new Set(['reconhecer', 'produzir']);
const FICHA_KINDS = new Set(['frente', 'inverso', 'lacuna']);

function cards(v: unknown, kinds: Set<string>, now: number): ImportCard[] {
	if (!Array.isArray(v) || v.length > MAX_CARDS) fail('flashcards');
	const seen = new Set<string>();
	return v.map((c) => {
		if (!isObj(c) || typeof c.kind !== 'string' || !kinds.has(c.kind)) fail('flashcards');
		const ord = c.ord;
		if (!Number.isInteger(ord) || (ord as number) < 0 || (ord as number) > 50) fail('flashcards');
		if ((c.kind === 'lacuna') !== (ord as number) >= 1) fail('flashcards');
		const key = `${c.kind}:${ord}`;
		if (seen.has(key)) fail('flashcards repetidos');
		seen.add(key);
		if (!Array.isArray(c.logs) || c.logs.length > MAX_LOGS) fail('revisões');
		const logs = c.logs.map((l) => {
			if (!isObj(l) || ![1, 2, 3, 4].includes(l.rating as number)) fail('revisões');
			const at = typeof l.at === 'string' ? Date.parse(l.at) : NaN;
			if (!Number.isFinite(at) || at > now + 60_000) fail('revisões');
			return { rating: l.rating as Grade, at: new Date(at).toISOString() };
		});
		return {
			kind: c.kind as ImportCard['kind'],
			ord: ord as number,
			suspended: c.suspended === true,
			logs
		};
	});
}

function itemNote(n: Record<string, unknown>, userId: string, now: number): ImportItemNote {
	return {
		type: 'item',
		guid: text(n.guid, 100, 'guid', true),
		tags: tags(n.tags),
		lemma: text(n.lemma, LIMITS.lemma, 'lema', true),
		reading: text(n.reading ?? '', LIMITS.reading, 'leitura'),
		sense: text(n.sense ?? '', LIMITS.sense, 'sentido'),
		sentence: text(n.sentence ?? '', LIMITS.sentence, 'frase'),
		image: media(n.image, userId, 'image'),
		audio: media(n.audio, userId, 'audio'),
		cards: cards(n.cards, ITEM_KINDS, now)
	};
}

function fichaNote(n: Record<string, unknown>, userId: string, now: number): ImportFichaNote {
	if (typeof n.front !== 'string' || typeof n.back !== 'string') fail('ficha');
	const front = sanitizeFichaHtml(n.front);
	const back = sanitizeFichaHtml(n.back);
	if (!front || front.length > FICHA_LIMITS.face || back.length > FICHA_LIMITS.face) fail('ficha');
	const cloze = clozeCount(front) > 0;
	const list = cards(n.cards, FICHA_KINDS, now);
	if (list.some((c) => (c.kind === 'lacuna') !== cloze)) fail('flashcards');
	return {
		type: 'ficha',
		guid: text(n.guid, 100, 'guid', true),
		tags: tags(n.tags),
		front,
		back,
		reverse: !cloze && n.reverse === true,
		front_image: media(n.front_image, userId, 'image'),
		front_audio: media(n.front_audio, userId, 'audio'),
		back_image: media(n.back_image, userId, 'image'),
		back_audio: media(n.back_audio, userId, 'audio'),
		cards: list
	};
}

export function parseImportBatch(raw: unknown, userId: string, now = Date.now()): BatchResult {
	try {
		if (!Array.isArray(raw) || raw.length === 0 || raw.length > IMPORT_BATCH_SIZE) fail('lote');
		const guids = new Set<string>();
		const notes = raw.map((n): ImportNote => {
			if (!isObj(n)) fail('nota');
			const note =
				n.type === 'item'
					? itemNote(n, userId, now)
					: n.type === 'ficha'
						? fichaNote(n, userId, now)
						: fail('tipo');
			if (guids.has(note.guid)) fail('guid repetido');
			guids.add(note.guid);
			return note;
		});
		return { ok: true, notes };
	} catch (e) {
		if (e instanceof Invalid) return { ok: false, error: `Lote inválido (${e.message}).` };
		throw e;
	}
}
