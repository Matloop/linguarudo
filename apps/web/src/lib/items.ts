// Regras puras do banco: itens, encontros e obras (glossário em CONTEXT.md).
// Os limites espelham os checks de supabase/migrations/*_banco.sql; se mudar um, mude o outro.

import { isLanguage, type Language } from './languages.ts';

export const LIMITS = {
	lemma: 80,
	sense: 200,
	note: 2000,
	ipa: 100,
	partOfSpeech: 80,
	form: 80,
	sentence: 500,
	highlight: 80,
	title: 200,
	subtitle: 200,
	path: 500,
	seconds: 1_000_000,
	/** Itens por chamada de save_items. */
	saveBatch: 200
} as const;

export type ItemStatus = 'ativo' | 'conhecido';

export type CardKind = 'reconhecer' | 'produzir';

export const WORK_KINDS = ['livro', 'episodio', 'filme', 'musica', 'video'] as const;
export type WorkKind = (typeof WORK_KINDS)[number];

export const ORIGINS = ['manual', 'stremio', 'musica', 'ereader', 'anki', 'blend'] as const;
export type Origin = (typeof ORIGINS)[number];

export const ORIGIN_LABELS: Record<Origin, string> = {
	manual: 'Adicionado à mão',
	stremio: 'Stremio',
	musica: 'Música',
	ereader: 'E-reader',
	anki: 'Anki',
	blend: 'Blend'
};

// ---------- Texto ----------

/** Conta caracteres como o char_length do Postgres (code points, não unidades UTF-16). */
export function charLength(s: string): number {
	return [...s].length;
}

/** Lema e forma: NFC, sem espaço nas pontas e com espaços internos colapsados. */
export function normalizeLemma(raw: string): string {
	return raw.normalize('NFC').trim().replace(/\s+/g, ' ');
}

/** Texto livre (sentido, frase, nota): NFC e sem espaço nas pontas. */
export function normalizeText(raw: string): string {
	return raw.normalize('NFC').trim();
}

function asString(v: unknown): string {
	return typeof v === 'string' ? v : '';
}

/** Normaliza e corta em code points, para textos que não valem recusar o salvamento. */
function clip(v: unknown, max: number, normalize = normalizeText): string {
	const chars = [...normalize(asString(v))];
	return chars.length > max ? chars.slice(0, max).join('').trimEnd() : chars.join('');
}

/** unique_violation (23505): já existe um item com esse lema no idioma. */
export function isDuplicateError(err: unknown): boolean {
	return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23505';
}

// ---------- Formulário de Minhas palavras ----------

export interface ItemInput {
	language: Language;
	lemma: string;
	sense: string;
	/** Frase onde a pessoa viu; vira um encontro manual. Vazia = item sem encontro. */
	sentence: string;
}

export type ItemField = keyof ItemInput;

export type FormResult<T, F extends string> =
	| { ok: true; value: T }
	| { ok: false; errors: Partial<Record<F, string>>; values: Record<F, string> };

function lemmaError(lemma: string): string | undefined {
	if (lemma === '') return 'Escreva a palavra ou expressão.';
	if (charLength(lemma) > LIMITS.lemma) return `Use no máximo ${LIMITS.lemma} caracteres.`;
}

function tooLong(text: string, max: number): string | undefined {
	return charLength(text) > max ? `Use no máximo ${max} caracteres.` : undefined;
}

function compact<F extends string>(errors: Partial<Record<F, string | undefined>>) {
	return Object.fromEntries(Object.entries(errors).filter(([, v]) => v)) as Partial<
		Record<F, string>
	>;
}

/** Guardar um item à mão. `languages` são os idiomas de estudo (o que o formulário oferece). */
export function parseItemInput(
	raw: Record<string, unknown>,
	languages: readonly Language[]
): FormResult<ItemInput, ItemField> {
	const values = {
		language: asString(raw.language),
		lemma: asString(raw.lemma),
		sense: asString(raw.sense),
		sentence: asString(raw.sentence)
	};
	const language = values.language.toLowerCase();
	const lemma = normalizeLemma(values.lemma);
	const sense = normalizeText(values.sense);
	const sentence = normalizeText(values.sentence);

	const errors = compact<ItemField>({
		language:
			isLanguage(language) && languages.includes(language) ? undefined : 'Escolha um idioma.',
		lemma: lemmaError(lemma),
		sense: tooLong(sense, LIMITS.sense),
		sentence: tooLong(sentence, LIMITS.sentence)
	});
	if (Object.keys(errors).length > 0 || !isLanguage(language)) return { ok: false, errors, values };
	return { ok: true, value: { language, lemma, sense, sentence } };
}

export interface ItemEdit {
	lemma: string;
	sense: string;
	note: string;
}

export type ItemEditField = keyof ItemEdit;

/** Editar um item existente. */
export function parseItemEdit(raw: Record<string, unknown>): FormResult<ItemEdit, ItemEditField> {
	const values = {
		lemma: asString(raw.lemma),
		sense: asString(raw.sense),
		note: asString(raw.note)
	};
	const lemma = normalizeLemma(values.lemma);
	const sense = normalizeText(values.sense);
	const note = normalizeText(values.note);
	const errors = compact<ItemEditField>({
		lemma: lemmaError(lemma),
		sense: tooLong(sense, LIMITS.sense),
		note: tooLong(note, LIMITS.note)
	});
	if (Object.keys(errors).length > 0) return { ok: false, errors, values };
	return { ok: true, value: { lemma, sense, note } };
}

// ---------- Entrada de save_items ----------

// type (não interface) para caber no tipo Json do RPC. Campos em snake_case, como o SQL lê.
export type WorkRefs = {
	youtube_id?: string;
	imdb_id?: string;
	season?: number;
	episode?: number;
	path?: string;
};

export type WorkEntry =
	| { id: string }
	| {
			kind: WorkKind;
			title: string;
			subtitle: string;
			refs: WorkRefs;
			language: Language | null;
	  };

export type Position = { seconds?: number; page?: number };

export type EncounterEntry = {
	form: string;
	sentence: string;
	highlight: string;
	sense: string;
	position: Position;
	origin: Origin;
	seen_at: string | null;
	client_id: string | null;
};

export type SaveEntry = {
	language: Language;
	lemma: string;
	sense: string;
	note: string;
	ipa: string;
	part_of_speech: string;
	encounter?: EncounterEntry;
	work?: WorkEntry;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function wholeNumber(v: unknown, max: number): number | undefined {
	if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
	const n = Math.floor(v);
	return n >= 0 && n <= max ? n : undefined;
}

function isoDate(v: unknown): string | null {
	if (typeof v !== 'string') return null;
	const d = new Date(v);
	return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function record(v: unknown): Record<string, unknown> | null {
	return typeof v === 'object' && v !== null && !Array.isArray(v)
		? (v as Record<string, unknown>)
		: null;
}

/** Mesmas regras dos checks da tabela works. Campos que não batem são ignorados. */
export function parseWorkRefs(raw: unknown): WorkRefs {
	const r = record(raw) ?? {};
	const refs: WorkRefs = {};
	const youtube = asString(r.youtubeId);
	if (/^[A-Za-z0-9_-]{11}$/.test(youtube)) refs.youtube_id = youtube;
	const imdb = asString(r.imdbId);
	if (/^tt[0-9]{1,10}$/.test(imdb)) {
		refs.imdb_id = imdb;
		const season = wholeNumber(r.season, 10_000);
		const episode = wholeNumber(r.episode, 100_000);
		if (season !== undefined && episode !== undefined) Object.assign(refs, { season, episode });
	}
	const path = clip(r.path, LIMITS.path);
	if (path) refs.path = path;
	return refs;
}

function parseWork(raw: unknown): WorkEntry | { error: string } {
	const w = record(raw);
	if (!w) return { error: 'work inválida' };
	if (typeof w.id === 'string')
		return UUID.test(w.id) ? { id: w.id } : { error: 'work.id inválido' };
	const kind = asString(w.kind);
	if (!(WORK_KINDS as readonly string[]).includes(kind)) {
		return { error: `work.kind deve ser ${WORK_KINDS.join(', ')}` };
	}
	const title = clip(w.title, LIMITS.title, normalizeLemma);
	if (!title) return { error: 'work.title vazio' };
	const language = asString(w.language).toLowerCase();
	const refs = parseWorkRefs(w.refs);
	if (kind === 'musica' && !(refs.youtube_id && isLanguage(language))) {
		return { error: 'música precisa de refs.youtubeId e language' };
	}
	return {
		kind: kind as WorkKind,
		title,
		subtitle: clip(w.subtitle, LIMITS.subtitle),
		refs,
		language: isLanguage(language) ? language : null
	};
}

function parsePosition(raw: unknown): Position {
	const r = record(raw) ?? {};
	const position: Position = {};
	const seconds = wholeNumber(r.seconds, LIMITS.seconds);
	if (seconds !== undefined) position.seconds = seconds;
	const page = wholeNumber(r.page, 1_000_000);
	if (page !== undefined) position.page = page;
	return position;
}

function parseEncounter(raw: unknown, defaultOrigin: Origin): EncounterEntry | { error: string } {
	const e = record(raw);
	if (!e) return { error: 'encounter inválido' };
	const origin = e.origin === undefined ? defaultOrigin : asString(e.origin);
	if (!(ORIGINS as readonly string[]).includes(origin)) {
		return { error: `encounter.origin deve ser ${ORIGINS.join(', ')}` };
	}
	const clientId = asString(e.clientId);
	if (clientId && !UUID.test(clientId)) return { error: 'encounter.clientId deve ser um UUID' };
	const highlight = normalizeLemma(asString(e.highlight));
	return {
		form: clip(e.form, LIMITS.form, normalizeLemma),
		sentence: clip(e.sentence, LIMITS.sentence),
		// Destaque cortado não destacaria nada: longo demais some.
		highlight: charLength(highlight) <= LIMITS.highlight ? highlight : '',
		sense: clip(e.sense, LIMITS.sense),
		position: parsePosition(e.position),
		origin: origin as Origin,
		seen_at: isoDate(e.seenAt),
		client_id: clientId ? clientId.toLowerCase() : null
	};
}

export type ParsedEntry = { ok: true; entry: SaveEntry } | { ok: false; error: string };

/**
 * Um item vindo de uma integração (JSON em camelCase). Só language e lemma são
 * obrigatórios; textos longos são cortados, e o lema longo demais recusa o item.
 */
export function parseSaveEntry(raw: unknown, defaultOrigin: Origin): ParsedEntry {
	const r = record(raw);
	if (!r) return { ok: false, error: 'item inválido' };
	const language = asString(r.language).toLowerCase();
	if (!isLanguage(language)) return { ok: false, error: 'language inválido' };
	const lemma = normalizeLemma(asString(r.lemma));
	const err = lemmaError(lemma);
	if (err) return { ok: false, error: lemma === '' ? 'lemma vazio' : 'lemma longo demais' };

	const entry: SaveEntry = {
		language,
		lemma,
		sense: clip(r.sense, LIMITS.sense),
		note: clip(r.note, LIMITS.note),
		ipa: clip(r.ipa, LIMITS.ipa),
		part_of_speech: clip(r.partOfSpeech, LIMITS.partOfSpeech)
	};
	if (r.encounter !== undefined) {
		const encounter = parseEncounter(r.encounter, defaultOrigin);
		if ('error' in encounter) return { ok: false, error: encounter.error };
		entry.encounter = encounter;
	}
	if (r.work !== undefined) {
		if (!entry.encounter) return { ok: false, error: 'work só vale junto de um encounter' };
		const work = parseWork(r.work);
		if ('error' in work) return { ok: false, error: work.error };
		entry.work = work;
	}
	return { ok: true, entry };
}

// ---------- Exibição ----------

function clock(totalSeconds: number): string {
	const s = Math.floor(totalSeconds);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const ss = String(s % 60).padStart(2, '0');
	return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** De onde veio o encontro: "Kaguya · T1E2, 42:10", "Volare · Modugno". */
export function formatWorkSource(
	work: { title: string; subtitle: string } | null,
	position: unknown
): string {
	const seconds = wholeNumber(record(position)?.seconds, LIMITS.seconds);
	const name = work ? [work.title, work.subtitle].filter(Boolean).join(' · ') : '';
	return [name, seconds === undefined ? '' : clock(seconds)].filter(Boolean).join(', ');
}
