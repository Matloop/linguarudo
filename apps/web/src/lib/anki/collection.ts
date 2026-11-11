// Lê a coleção do Anki (SQLite) para um modelo simples. Aceita o esquema antigo
// (col.models e col.decks em JSON) e o novo (tabelas notetypes, fields, templates,
// decks, com config em protobuf).

import type { Database, SqlValue } from 'sql.js';
import { protoNumber, protoString, readMessage } from './protobuf.ts';

export interface AnkiTemplate {
	name: string;
	ord: number;
	qfmt: string;
	afmt: string;
}

export interface AnkiNotetype {
	id: string;
	name: string;
	cloze: boolean;
	/** Nomes dos campos, na ordem de notes.flds. */
	fields: string[];
	templates: AnkiTemplate[];
}

export interface AnkiNote {
	id: string;
	guid: string;
	notetypeId: string;
	tags: string[];
	fields: string[];
}

export interface AnkiCard {
	id: string;
	noteId: string;
	deckId: string;
	ord: number;
	/** -1 suspenso, -2/-3 enterrado, 0 novo, 1/3 aprendendo, 2 revisão. */
	queue: number;
}

export interface AnkiReview {
	cardId: string;
	/** Momento da revisão (ms). */
	at: number;
	/** 1 a 4 (Again, Hard, Good, Easy); 0 em reagendamento manual. */
	ease: number;
	/** 0 aprender, 1 revisão, 2 reaprender, 3 filtrado, 4 manual. */
	type: number;
}

export interface AnkiCollection {
	notetypes: Map<string, AnkiNotetype>;
	/** Nome do deck por id, com "::" entre os níveis. */
	decks: Map<string, string>;
	notes: AnkiNote[];
	cards: AnkiCard[];
	reviews: AnkiReview[];
}

function rows(db: Database, sql: string): SqlValue[][] {
	return db.exec(sql)[0]?.values ?? [];
}

const str = (v: SqlValue) => (v == null ? '' : v instanceof Uint8Array ? '' : String(v));
const num = (v: SqlValue) => (typeof v === 'number' ? v : Number(v ?? 0));
const bytes = (v: SqlValue) => (v instanceof Uint8Array ? v : new Uint8Array());

function hasTable(db: Database, name: string): boolean {
	return (
		rows(db, `select 1 from sqlite_master where type = 'table' and name = '${name}'`).length > 0
	);
}

interface LegacyModel {
	id?: number | string;
	name?: string;
	type?: number;
	flds?: { name: string; ord: number }[];
	tmpls?: { name: string; ord: number; qfmt: string; afmt: string }[];
}

function legacyNotetypes(db: Database): Map<string, AnkiNotetype> {
	const [[raw] = ['']] = rows(db, 'select models from col');
	const models = JSON.parse(str(raw) || '{}') as Record<string, LegacyModel>;
	const out = new Map<string, AnkiNotetype>();
	for (const [id, m] of Object.entries(models)) {
		out.set(id, {
			id,
			name: m.name ?? id,
			cloze: m.type === 1,
			fields: [...(m.flds ?? [])].sort((a, b) => a.ord - b.ord).map((f) => f.name),
			templates: [...(m.tmpls ?? [])]
				.sort((a, b) => a.ord - b.ord)
				.map((t) => ({ name: t.name, ord: t.ord, qfmt: t.qfmt ?? '', afmt: t.afmt ?? '' }))
		});
	}
	return out;
}

function legacyDecks(db: Database): Map<string, string> {
	const [[raw] = ['']] = rows(db, 'select decks from col');
	const decks = JSON.parse(str(raw) || '{}') as Record<string, { name?: string }>;
	return new Map(Object.entries(decks).map(([id, d]) => [id, d.name ?? '']));
}

function modernNotetypes(db: Database): Map<string, AnkiNotetype> {
	const out = new Map<string, AnkiNotetype>();
	for (const [id, name, config] of rows(
		db,
		'select cast(id as text), name, config from notetypes'
	)) {
		// NotetypeConfig: kind = 1 (0 normal, 1 lacunas).
		const kind = protoNumber(readMessage(bytes(config)), 1);
		out.set(str(id), {
			id: str(id),
			name: str(name),
			cloze: kind === 1,
			fields: [],
			templates: []
		});
	}
	for (const [ntid, , name] of rows(
		db,
		'select cast(ntid as text), ord, name from fields order by ntid, ord'
	)) {
		out.get(str(ntid))?.fields.push(str(name));
	}
	for (const [ntid, ord, name, config] of rows(
		db,
		'select cast(ntid as text), ord, name, config from templates order by ntid, ord'
	)) {
		// CardTemplateConfig: q_format = 1, a_format = 2.
		const msg = readMessage(bytes(config));
		out.get(str(ntid))?.templates.push({
			name: str(name),
			ord: num(ord),
			qfmt: protoString(msg, 1),
			afmt: protoString(msg, 2)
		});
	}
	return out;
}

function modernDecks(db: Database): Map<string, string> {
	return new Map(
		rows(db, 'select cast(id as text), name from decks').map(([id, name]) => [
			str(id),
			str(name).replaceAll('\x1f', '::')
		])
	);
}

export function readCollection(db: Database): AnkiCollection {
	const modern = hasTable(db, 'notetypes');
	const notes = rows(
		db,
		'select cast(id as text), guid, cast(mid as text), tags, flds from notes'
	).map(([id, guid, mid, tags, flds]): AnkiNote => ({
		id: str(id),
		guid: str(guid),
		notetypeId: str(mid),
		tags: str(tags).split(/\s+/).filter(Boolean),
		fields: str(flds).split('\x1f')
	}));
	const cards = rows(
		db,
		'select cast(id as text), cast(nid as text), cast(did as text), ord, queue from cards'
	).map(([id, nid, did, ord, queue]): AnkiCard => ({
		id: str(id),
		noteId: str(nid),
		deckId: str(did),
		ord: num(ord),
		queue: num(queue)
	}));
	const reviews = rows(db, 'select id, cast(cid as text), ease, type from revlog order by id').map(
		([id, cid, ease, type]): AnkiReview => ({
			cardId: str(cid),
			at: num(id),
			ease: num(ease),
			type: num(type)
		})
	);
	return {
		notetypes: modern ? modernNotetypes(db) : legacyNotetypes(db),
		decks: modern ? modernDecks(db) : legacyDecks(db),
		notes,
		cards,
		reviews
	};
}
