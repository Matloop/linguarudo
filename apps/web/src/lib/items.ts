// Regras puras do banco: itens, encontros e obras (glossário em CONTEXT.md).
// Os limites espelham os checks de supabase/migrations/*_banco.sql; se mudar um, mude o outro.

import { lemmaKey } from '@linguetta/language';
import { parseLanguage, type Language } from './languages.ts';
import { parseTags, tagsError } from './tags.ts';

export const LIMITS = {
	lemma: 80,
	sense: 200,
	note: 2000,
	ipa: 100,
	/** Leitura (furigana, pinyin): fica acima do lema na revisão. */
	reading: 100,
	partOfSpeech: 80,
	form: 80,
	sentence: 500,
	highlight: 80,
	translation: 1000,
	title: 200,
	subtitle: 200,
	path: 500,
	seconds: 1_000_000,
	/** Itens por chamada de save_items. */
	saveBatch: 200
} as const;

export type ItemStatus = 'ativo' | 'conhecido';

export type FlashcardKind = 'reconhecer' | 'produzir';

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
	reading: string;
	sense: string;
	/** Frase onde a pessoa viu; vira um encontro manual. Vazia = item sem encontro. */
	sentence: string;
	note: string;
	tags: string[];
	/** Deck escolhido em "Mais campos"; null = o padrão do idioma. */
	deck: string | null;
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

/**
 * Guardar um item à mão (diálogo Guardar). `languages` são os idiomas de estudo (o que o
 * formulário oferece). Nota, tags e deck vêm de "Mais campos" e são opcionais; a mídia
 * precisa do usuário e é lida na action (parseMediaField).
 */
export function parseItemInput(
	raw: Record<string, unknown>,
	languages: readonly Language[]
): FormResult<ItemInput, ItemField> {
	const values = {
		language: asString(raw.language),
		lemma: asString(raw.lemma),
		reading: asString(raw.reading),
		sense: asString(raw.sense),
		sentence: asString(raw.sentence),
		note: asString(raw.note),
		tags: asString(raw.tags),
		deck: asString(raw.deck)
	};
	const language = parseLanguage(values.language);
	const lemma = normalizeLemma(values.lemma);
	const reading = normalizeLemma(values.reading);
	const sense = normalizeText(values.sense);
	const sentence = normalizeText(values.sentence);
	const note = normalizeText(values.note);
	const tags = parseTags(values.tags);
	const deck = values.deck.trim();

	const errors = compact<ItemField>({
		language: language && languages.includes(language) ? undefined : 'Escolha um idioma.',
		lemma: lemmaError(lemma),
		reading: tooLong(reading, LIMITS.reading),
		sense: tooLong(sense, LIMITS.sense),
		sentence: tooLong(sentence, LIMITS.sentence),
		note: tooLong(note, LIMITS.note),
		tags: tagsError(tags),
		deck: deck === '' || UUID.test(deck) ? undefined : 'Escolha um deck da lista.'
	});
	if (Object.keys(errors).length > 0 || !language) return { ok: false, errors, values };
	return {
		ok: true,
		value: {
			language,
			lemma,
			reading,
			sense,
			sentence,
			note,
			tags,
			deck: deck ? deck.toLowerCase() : null
		}
	};
}

export interface ItemEdit {
	lemma: string;
	reading: string;
	sense: string;
	note: string;
	tags: string[];
}

export type ItemEditField = keyof ItemEdit;

/** Editar um item existente. Sem o campo tags no formulário, as tags ficam como estão. */
export function parseItemEdit(
	raw: Record<string, unknown>
): FormResult<Omit<ItemEdit, 'tags'> & { tags?: string[] }, ItemEditField> {
	const values = {
		lemma: asString(raw.lemma),
		reading: asString(raw.reading),
		sense: asString(raw.sense),
		note: asString(raw.note),
		tags: asString(raw.tags)
	};
	const lemma = normalizeLemma(values.lemma);
	const reading = normalizeLemma(values.reading);
	const sense = normalizeText(values.sense);
	const note = normalizeText(values.note);
	const tags = typeof raw.tags === 'string' ? parseTags(raw.tags) : undefined;
	const errors = compact<ItemEditField>({
		lemma: lemmaError(lemma),
		reading: tooLong(reading, LIMITS.reading),
		sense: tooLong(sense, LIMITS.sense),
		note: tooLong(note, LIMITS.note),
		tags: tags && tagsError(tags)
	});
	if (Object.keys(errors).length > 0) return { ok: false, errors, values };
	return { ok: true, value: { lemma, reading, sense, note, ...(tags ? { tags } : {}) } };
}

// ---------- Entrada de save_items ----------

// type (não interface) para caber no tipo Json do RPC. Campos em snake_case, como o SQL lê.
export type WorkRefs = {
	youtube_id?: string;
	imdb_id?: string;
	season?: number;
	episode?: number;
	path?: string;
	/** Hash parcial do KOSync do arquivo do livro (32 hex), do e-reader. */
	ko_hash?: string;
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

export type Position = {
	seconds?: number;
	page?: number;
	/** Livro no e-reader: título do capítulo, índice no spine e progresso (0–100). */
	chapter?: string;
	spine?: number;
	percent?: number;
};

export type EncounterEntry = {
	form: string;
	sentence: string;
	highlight: string;
	sense: string;
	/** A frase traduzida para a língua nativa (ex.: a fala do filme em PT). */
	translation?: string;
	position: Position;
	origin: Origin;
	seen_at: string | null;
	client_id: string | null;
};

export type SaveEntry = {
	language: Language;
	/** Como a pessoa escreveu (NFC); a caixa é preservada. */
	lemma: string;
	/** Chave de identidade (language, lemma_key). Só o servidor calcula (ADR 0004). */
	lemma_key: string;
	reading: string;
	sense: string;
	note: string;
	ipa: string;
	part_of_speech: string;
	encounter?: EncounterEntry;
	work?: WorkEntry;
};

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
	const language = parseLanguage(w.language);
	const refs = parseWorkRefs(w.refs);
	if (kind === 'musica' && !(refs.youtube_id && language)) {
		return { error: 'música precisa de refs.youtubeId e language' };
	}
	return {
		kind: kind as WorkKind,
		title,
		subtitle: clip(w.subtitle, LIMITS.subtitle),
		refs,
		language
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
	const translation = clip(e.translation, LIMITS.translation);
	return {
		form: clip(e.form, LIMITS.form, normalizeLemma),
		sentence: clip(e.sentence, LIMITS.sentence),
		// Destaque cortado não destacaria nada: longo demais some.
		highlight: charLength(highlight) <= LIMITS.highlight ? highlight : '',
		sense: clip(e.sense, LIMITS.sense),
		...(translation ? { translation } : {}),
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
	const language = parseLanguage(r.language);
	if (!language) return { ok: false, error: 'language inválido' };
	const lemma = normalizeLemma(asString(r.lemma));
	const err = lemmaError(lemma);
	if (err) return { ok: false, error: lemma === '' ? 'lemma vazio' : 'lemma longo demais' };

	const entry: SaveEntry = {
		language,
		lemma,
		lemma_key: lemmaKey(lemma, language),
		reading: clip(r.reading, LIMITS.reading, normalizeLemma),
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

/**
 * De onde veio o encontro: "Kaguya · T1E2, 42:10", "Volare · Modugno" e, no livro do
 * e-reader, "O nome da rosa · Primeiro dia · 12%".
 */
export function formatWorkSource(
	work: { title: string; subtitle: string } | null,
	position: unknown
): string {
	const pos = record(position);
	const chapter = asString(pos?.chapter).trim();
	const percent =
		typeof pos?.percent === 'number' && Number.isFinite(pos.percent) && pos.percent >= 0
			? Math.min(100, Math.floor(pos.percent))
			: undefined;
	if (chapter || percent !== undefined) {
		const parts = [work?.title ?? '', chapter, percent === undefined ? '' : `${percent}%`];
		return parts.filter(Boolean).join(' · ');
	}
	const seconds = wholeNumber(pos?.seconds, LIMITS.seconds);
	const name = work ? [work.title, work.subtitle].filter(Boolean).join(' · ') : '';
	return [name, seconds === undefined ? '' : clock(seconds)].filter(Boolean).join(', ');
}
