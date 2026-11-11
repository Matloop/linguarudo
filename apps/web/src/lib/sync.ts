// Sync com o e-reader (docs/sync/CONTRACT.md, protocolo 1): regras puras.
// Validação das operações do push, formato das linhas do snapshot (JSONL), cursor,
// token de página e código de pareamento. O que fala com o banco fica em lib/server/sync.ts.

import {
	charLength,
	LIMITS,
	normalizeLemma,
	normalizeText,
	type Position,
	type SaveEntry
} from './items.ts';
import { lemmaKey } from '@linguetta/language';
import {
	languageLabel,
	languageSelfLabel,
	parseLanguage,
	type Language,
	type UiLanguage
} from './languages.ts';
import { isGrade, type Grade } from './review.ts';

export const SYNC_PROTOCOL = 1;

export const SYNC_LIMITS = {
	ops: 200,
	bodyBytes: 512 * 1024,
	pageDefault: 500,
	pageMin: 100,
	pageMax: 1000,
	lineBytes: 16_384,
	encounters: 2,
	forms: 10,
	note: 200,
	pageTtlMs: 15 * 60_000,
	deviceName: 60,
	deviceModel: 40,
	firmware: 60,
	chapter: 200,
	author: 200,
	durationMs: 3_600_000,
	pairExpiresIn: 600,
	pairInterval: 5
} as const;

/** Os parâmetros do agendador do servidor (lib/server/scheduler.ts), para o cabeçalho. */
export const FSRS_HEADER = {
	tsFsrs: '6.0.0',
	version: 'FSRS-7',
	desiredRetention: 0.9,
	enableFuzz: true,
	learningSteps: ['1m', '10m'],
	relearningSteps: ['10m'],
	maximumInterval: 36500
} as const;

// ---------- Código de pareamento ----------

/** Sem 0, 1, I e O. */
export const USER_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** Seis caracteres do alfabeto, a partir de seis números aleatórios (0–31). */
export function userCodeFrom(random: (max: number) => number): string {
	let code = '';
	for (let i = 0; i < 6; i++) code += USER_CODE_ALPHABET[random(USER_CODE_ALPHABET.length)];
	return code;
}

/** "K7Q4MP" -> "K7Q-4MP". */
export function formatUserCode(code: string): string {
	return `${code.slice(0, 3)}-${code.slice(3)}`;
}

/** O que a pessoa digitou, sem caixa, espaço e hífen. null se não for um código possível. */
export function normalizeUserCode(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	const code = raw.toUpperCase().replace(/[\s-]+/g, '');
	if (code.length !== 6) return null;
	for (const ch of code) if (!USER_CODE_ALPHABET.includes(ch)) return null;
	return code;
}

/** Nome do aparelho: 1 a 60 code points (cortado). null se vazio. */
export function parseDeviceText(raw: unknown, max: number): string {
	if (typeof raw !== 'string') return '';
	const chars = [...normalizeText(raw).replace(/\s+/g, ' ')];
	return chars.slice(0, max).join('').trimEnd();
}

// ---------- Operações do push ----------

export type OpResult =
	| ({ clientId: string; status: 'applied' | 'duplicate' } & Record<string, unknown>)
	| { clientId: string; status: 'dropped'; reason: 'item_deleted' | 'not_found' | 'unknown_target' }
	| {
			clientId: string;
			status: 'rejected';
			reason: 'invalid' | 'unknown_type' | 'client_id_conflict';
			errors?: Record<string, string>;
	  };

export type OpType = 'save' | 'review' | 'seen';

export type SaveOp = {
	type: 'save';
	clientId: string;
	at: string;
	language: Language;
	entry: SaveEntry;
};
export type ReviewOp = {
	type: 'review';
	clientId: string;
	at: string;
	language: Language;
	cardId: string | null;
	saveClientId: string | null;
	rating: Grade;
	durationMs: number | null;
};
export type SeenOp = {
	type: 'seen';
	clientId: string;
	at: string;
	language: Language;
	lemma: string;
	/** Calculada aqui a partir de lemma e language; o cliente não manda. */
	lemmaKey: string;
};
export type SyncOp = SaveOp | ReviewOp | SeenOp;

/**
 * Resultado da validação de uma operação. Inválida: o resultado já pronto e, se der
 * para guardar (clientId e tipo conhecidos), o tipo, para o reenvio dar o mesmo.
 */
export type ParsedOp =
	{ ok: true; op: SyncOp } | { ok: false; result: OpResult; store: OpType | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KO_HASH = /^[0-9a-f]{32}$/;

function record(v: unknown): Record<string, unknown> | null {
	return typeof v === 'object' && v !== null && !Array.isArray(v)
		? (v as Record<string, unknown>)
		: null;
}

function str(v: unknown): string {
	return typeof v === 'string' ? v : '';
}

/** Normaliza e corta em code points (texto longo é cortado, não recusado). */
function clip(v: unknown, max: number): string {
	const chars = [...normalizeText(str(v))];
	return chars.length > max ? chars.slice(0, max).join('').trimEnd() : chars.join('');
}

function uuid(v: unknown): string | null {
	return typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : null;
}

function isoDate(v: unknown): string | null {
	if (typeof v !== 'string' || v === '') return null;
	const d = new Date(v);
	return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function lemmaError(lemma: string): string | null {
	if (lemma === '') return 'lema vazio';
	if (charLength(lemma) > LIMITS.lemma) return 'lema longo demais';
	return null;
}

function bookPosition(raw: unknown): Position {
	const r = record(raw) ?? {};
	const position: Position = {};
	const chapter = clip(r.chapter, SYNC_LIMITS.chapter);
	if (chapter) position.chapter = chapter;
	if (
		typeof r.spine === 'number' &&
		Number.isInteger(r.spine) &&
		r.spine >= 0 &&
		r.spine <= 1_000_000
	) {
		position.spine = r.spine;
	}
	if (typeof r.percent === 'number' && Number.isFinite(r.percent)) {
		position.percent = Math.round(Math.min(100, Math.max(0, r.percent)) * 10) / 10;
	}
	return position;
}

/**
 * Valida uma operação do push. Texto longo é cortado; lema vazio ou longo, data, alvo
 * e nota inválidos recusam a operação (rejected, invalid, com errors por campo).
 */
export function parseOp(raw: unknown): ParsedOp {
	const r = record(raw);
	const rawId = r ? str(r.clientId) : '';
	const clientId = uuid(rawId);
	const type = r?.type;
	const invalid = (errors: Record<string, string>, store: OpType | null): ParsedOp => ({
		ok: false,
		result: { clientId: clientId ?? rawId, status: 'rejected', reason: 'invalid', errors },
		store
	});
	if (!r) return invalid({ op: 'operação inválida' }, null);
	if (!clientId) return invalid({ clientId: 'clientId precisa ser um uuid' }, null);
	if (type !== 'save' && type !== 'review' && type !== 'seen') {
		return {
			ok: false,
			result: { clientId, status: 'rejected', reason: 'unknown_type' },
			store: null
		};
	}

	const errors: Record<string, string> = {};
	const at = isoDate(r.at);
	if (!at) errors.at = 'data inválida';
	const language = parseLanguage(r.language) ?? '';
	if (!language) errors.language = 'idioma inválido';

	if (type === 'seen') {
		const lemma = normalizeLemma(str(r.lemma));
		const err = lemmaError(lemma);
		if (err) errors.lemma = err;
		if (Object.keys(errors).length) return invalid(errors, type);
		return {
			ok: true,
			op: { type, clientId, at: at!, language, lemma, lemmaKey: lemmaKey(lemma, language) }
		};
	}

	if (type === 'review') {
		const cardId = r.cardId == null || r.cardId === '' ? null : uuid(r.cardId);
		const saveClientId =
			r.saveClientId == null || r.saveClientId === '' ? null : uuid(r.saveClientId);
		const hasCard = !(r.cardId == null || r.cardId === '');
		const hasSave = !(r.saveClientId == null || r.saveClientId === '');
		if (hasCard && hasSave) errors.cardId = 'mande cardId ou saveClientId, não os dois';
		else if (!hasCard && !hasSave) errors.cardId = 'falta cardId ou saveClientId';
		else if (hasCard && !cardId) errors.cardId = 'cardId precisa ser um uuid';
		else if (hasSave && !saveClientId) errors.saveClientId = 'saveClientId precisa ser um uuid';
		if (!isGrade(r.rating)) errors.rating = 'nota de 1 a 4';
		// Duração é opcional e só informativa: valor fora da faixa vira ausente.
		const d = r.durationMs;
		const durationMs =
			typeof d === 'number' && Number.isFinite(d) && d >= 0 && d <= SYNC_LIMITS.durationMs
				? Math.round(d)
				: null;
		if (Object.keys(errors).length) return invalid(errors, type);
		return {
			ok: true,
			op: {
				type,
				clientId,
				at: at!,
				language: language as Language,
				cardId,
				saveClientId,
				rating: r.rating as Grade,
				durationMs
			}
		};
	}

	// save
	const lemma = normalizeLemma(str(r.lemma));
	const lemmaErr = lemmaError(lemma);
	if (lemmaErr) errors.lemma = lemmaErr;
	const enc = record(r.encounter);
	if (!enc) errors.encounter = 'falta o encontro';
	const work = record(r.work);
	if (!work) errors.work = 'falta a obra';
	else {
		if (work.kind !== 'livro') errors['work.kind'] = 'só livro';
		const koHash = str(work.koHash).toLowerCase();
		if (!KO_HASH.test(koHash)) errors['work.koHash'] = 'hash de 32 hex';
		if (clip(work.title, LIMITS.title) === '') errors['work.title'] = 'título vazio';
	}
	if (Object.keys(errors).length) return invalid(errors, type);

	const form = clip(enc!.form, LIMITS.form);
	const entry: SaveEntry = {
		language,
		lemma,
		lemma_key: lemmaKey(lemma, language),
		reading: clip(normalizeLemma(str(r.reading)), LIMITS.reading),
		sense: clip(r.sense, LIMITS.sense),
		note: clip(r.note, LIMITS.note),
		ipa: clip(r.ipa, LIMITS.ipa),
		part_of_speech: clip(r.pos, LIMITS.partOfSpeech),
		encounter: {
			form,
			sentence: clip(enc!.sentence, LIMITS.sentence),
			highlight: [...form].slice(0, LIMITS.highlight).join(''),
			sense: clip(enc!.sense, LIMITS.sense),
			position: bookPosition(enc!.position),
			origin: 'ereader',
			seen_at: at,
			client_id: clientId
		},
		work: {
			kind: 'livro',
			title: clip(work!.title, LIMITS.title),
			subtitle: clip(work!.author, SYNC_LIMITS.author),
			refs: { ko_hash: str(work!.koHash).toLowerCase() },
			language: parseLanguage(work!.language)
		}
	};
	return { ok: true, op: { type, clientId, at: at!, language: language as Language, entry } };
}

/** Envelope do push. null: corpo inválido (400). */
export function parsePushBody(body: unknown): { ops: unknown[] } | null {
	const r = record(body);
	if (!r || !Array.isArray(r.ops)) return null;
	if (r.ops.length < 1 || r.ops.length > SYNC_LIMITS.ops) return null;
	return { ops: r.ops };
}

/**
 * Resultado guardado no banco ({ prior, result }) -> resultado do push. Um applied que
 * já existia vira duplicate com os mesmos campos; dropped e rejected se repetem.
 */
export function toOpResult(
	clientId: string,
	stored: { prior?: boolean; result?: unknown }
): OpResult {
	const { clientId: _stored, ...result } = record(stored.result) ?? {};
	const status =
		stored.prior && (result.status === 'applied' || !result.status) ? 'duplicate' : result.status;
	return { clientId, ...result, status } as OpResult;
}

// ---------- Estado do cartão ----------

/** Linha de cards (snake_case, como sai do banco). */
export interface CardRowJson {
	id: string;
	created_at: string;
	due_at: string;
	stability: number;
	stability_fast: number;
	difficulty: number;
	state: number;
	schedule_status: string;
	last_review_at: string | null;
	reps: number;
	lapses: number;
	scheduled_days: number;
	learning_step: number;
}

export interface CardState {
	id: string;
	createdAt: string;
	dueAt: string;
	stability: number;
	stabilityFast: number;
	difficulty: number;
	state: number;
	scheduleStatus: string;
	lastReviewAt: string | null;
	reps: number;
	lapses: number;
	scheduledDays: number;
	learningStep: number;
}

/** Data do Postgres ("2026-11-03 10:00:00+00") em ISO com milissegundos. */
export function iso(v: string): string {
	return new Date(v).toISOString();
}

/** O Reconhecer em camelCase, todos os campos sempre presentes. */
export function cardState(c: CardRowJson): CardState {
	return {
		id: c.id,
		createdAt: iso(c.created_at),
		dueAt: iso(c.due_at),
		stability: c.stability,
		stabilityFast: c.stability_fast,
		difficulty: c.difficulty,
		state: c.state,
		scheduleStatus: c.schedule_status,
		lastReviewAt: c.last_review_at ? iso(c.last_review_at) : null,
		reps: c.reps,
		lapses: c.lapses,
		scheduledDays: c.scheduled_days,
		learningStep: c.learning_step
	};
}

// ---------- Snapshot (JSONL) ----------

/** Um item como api_sync_snapshot devolve. */
export interface SnapshotItemRow {
	id: string;
	lemma: string;
	lemma_key: string;
	reading: string | null;
	language: string;
	sense: string | null;
	note: string | null;
	ipa: string | null;
	pos: string | null;
	status: string;
	seen_count: number;
	last_seen_at: string | null;
	created_at: string;
	updated_at: string;
	forms: string[] | null;
	encounters: {
		form: string | null;
		sentence: string | null;
		sense: string | null;
		work: string | null;
		at: string;
	}[];
	card: CardRowJson;
}

function lineBytes(line: string): number {
	return new TextEncoder().encode(line).length;
}

/** Copia só os campos com valor (texto vazio, null e lista vazia saem). */
function compact<T extends Record<string, unknown>>(o: T): Partial<T> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(o)) {
		if (v === null || v === undefined || v === '') continue;
		if (Array.isArray(v) && v.length === 0) continue;
		out[k] = v;
	}
	return out as Partial<T>;
}

function cut(v: string | null, max: number): string {
	if (!v) return '';
	const chars = [...v];
	return chars.length > max ? chars.slice(0, max).join('') : v;
}

/** Linha item. Se passar de 16384 bytes, perde encontros e formas até caber. */
export function itemLine(row: SnapshotItemRow): string {
	// Formas como escritas, uma por chave do idioma e sem a do próprio lema.
	const seen = new Set([row.lemma_key]);
	const forms = (row.forms ?? [])
		.filter((f) => {
			if (!f) return false;
			const key = lemmaKey(f, row.language);
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		})
		.sort()
		.slice(0, SYNC_LIMITS.forms);
	const encounters = [...row.encounters]
		.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
		.slice(0, SYNC_LIMITS.encounters)
		.map((e) =>
			compact({ form: e.form, sentence: e.sentence, sense: e.sense, work: e.work, at: iso(e.at) })
		);
	const build = (enc: typeof encounters, fs: string[]) =>
		JSON.stringify({
			t: 'item',
			...compact({
				id: row.id,
				lemma: row.lemma,
				lemmaKey: row.lemma_key,
				reading: row.reading,
				language: row.language,
				sense: row.sense,
				note: cut(row.note, SYNC_LIMITS.note),
				ipa: row.ipa,
				pos: row.pos,
				status: row.status
			}),
			seenCount: row.seen_count,
			...compact({
				lastSeenAt: row.last_seen_at ? iso(row.last_seen_at) : null,
				createdAt: iso(row.created_at),
				updatedAt: iso(row.updated_at),
				forms: fs,
				encounters: enc
			}),
			card: cardState(row.card)
		});
	let line = build(encounters, forms);
	for (let n = encounters.length - 1; n >= 0 && lineBytes(line) > SYNC_LIMITS.lineBytes; n--) {
		line = build(encounters.slice(0, n), forms);
	}
	if (lineBytes(line) > SYNC_LIMITS.lineBytes) line = build([], []);
	return line;
}

export interface HeaderInput {
	language: Language;
	cursor: string;
	serverNow: Date;
	total: number;
	uiLanguage: UiLanguage | null;
	nativeLanguage: Language | null;
	studyLanguages: Language[];
	newCardsPerDay: number;
	timeZone: string;
	dayStart: Date;
	nextDayStart: Date;
	newDoneToday: number;
}

/**
 * Nome do baralho no e-reader, na língua da interface ("Linguetta · Italiano"). Sem
 * interface conhecida, o nome do idioma nele mesmo.
 */
export function deckName(language: Language, ui: UiLanguage | null): string {
	return `Linguetta · ${ui ? languageLabel(language, ui) : languageSelfLabel(language)}`;
}

/** Diferença do fuso para o UTC no instante dado, em minutos (São Paulo: -180). */
export function utcOffsetMinutes(timeZone: string, at: Date): number {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hourCycle: 'h23',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	}).formatToParts(at);
	const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
	const local = Date.UTC(
		get('year'),
		get('month') - 1,
		get('day'),
		get('hour'),
		get('minute'),
		get('second')
	);
	return Math.round((local - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

export function headerLine(h: HeaderInput): string {
	return JSON.stringify({
		t: 'header',
		protocol: SYNC_PROTOCOL,
		language: h.language,
		mode: 'full',
		cursor: h.cursor,
		serverNow: h.serverNow.toISOString(),
		deckName: deckName(h.language, h.uiLanguage),
		total: h.total,
		settings: {
			uiLanguage: h.uiLanguage,
			nativeLanguage: h.nativeLanguage,
			studyLanguages: h.studyLanguages,
			newCardsPerDay: h.newCardsPerDay,
			timeZone: h.timeZone,
			utcOffsetMinutes: utcOffsetMinutes(h.timeZone, h.serverNow)
		},
		today: {
			dayStart: h.dayStart.toISOString(),
			nextDayStart: h.nextDayStart.toISOString(),
			newDoneToday: h.newDoneToday
		},
		fsrs: FSRS_HEADER
	});
}

export function endLine(count: number, next: string | null): string {
	return JSON.stringify({ t: 'end', count, next });
}

// ---------- Cursor e token de página ----------

function b64(s: string): string {
	return Buffer.from(s, 'utf8').toString('base64url');
}

function unb64(s: string): string | null {
	if (!/^[A-Za-z0-9_-]*={0,2}$/.test(s)) return null;
	return Buffer.from(s, 'base64url').toString('utf8');
}

/** Cursor do snapshot: o instante da primeira página. Sem sequência por enquanto (":0"). */
export function encodeCursor(at: Date): string {
	return `v1.${b64(`${at.toISOString()}:0`)}`;
}

export function decodeCursor(cursor: unknown): Date | null {
	if (typeof cursor !== 'string' || !cursor.startsWith('v1.') || cursor.length > 200) return null;
	const raw = unb64(cursor.slice(3));
	const m = raw?.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z):\d+$/);
	if (!m) return null;
	const d = new Date(m[1]);
	return Number.isNaN(d.getTime()) ? null : d;
}

export interface PageToken {
	/** Idioma. */
	l: Language;
	/** Último id da página anterior. */
	a: string;
	/** Cursor da primeira página. */
	c: string;
	/** limit da primeira página. */
	n: number;
}

export function encodePageToken(t: PageToken): string {
	return `p1.${b64(JSON.stringify(t))}`;
}

/**
 * Token de página válido para este pedido (mesmo idioma e limit, dentro de 15 min da
 * primeira página), ou null (410 page_expired).
 */
export function decodePageToken(
	raw: string,
	expect: { language: Language; limit: number },
	now: Date
): (PageToken & { cursorAt: Date }) | null {
	if (!raw.startsWith('p1.') || raw.length > 1000) return null;
	let t: unknown;
	try {
		t = JSON.parse(unb64(raw.slice(3)) ?? '');
	} catch {
		return null;
	}
	const r = record(t);
	if (!r || r.l !== expect.language || r.n !== expect.limit) return null;
	const after = uuid(r.a);
	const cursorAt = decodeCursor(r.c);
	if (!after || !cursorAt) return null;
	const age = now.getTime() - cursorAt.getTime();
	if (age < -60_000 || age > SYNC_LIMITS.pageTtlMs) return null;
	return { l: expect.language, a: after, c: r.c as string, n: expect.limit, cursorAt };
}

/** limit da query: 100–1000, padrão 500. */
export function parseLimit(raw: string | null): number {
	if (raw === null || raw === '') return SYNC_LIMITS.pageDefault;
	const n = Number(raw);
	if (!Number.isFinite(n)) return SYNC_LIMITS.pageDefault;
	return Math.min(SYNC_LIMITS.pageMax, Math.max(SYNC_LIMITS.pageMin, Math.floor(n)));
}
