// Regras puras do banco de palavras. Os limites espelham os checks de
// supabase/migrations/*_words.sql; se mudar um, mude o outro.

export const LANGS = ['en', 'it'] as const;
export type Lang = (typeof LANGS)[number];

export const LANG_LABELS: Record<Lang, string> = { en: 'Inglês', it: 'Italiano' };

export const LIMITS = { term: 80, translation: 200, context: 500 } as const;

export interface WordInput {
	term: string;
	translation: string;
	lang: Lang;
	context: string;
}

export type WordField = keyof WordInput;

export type ParseResult =
	| { ok: true; value: WordInput }
	| {
			ok: false;
			errors: Partial<Record<WordField, string>>;
			values: Record<WordField, string>;
	  };

/** Conta caracteres como o char_length do Postgres (code points, não unidades UTF-16). */
function charLength(s: string): number {
	return [...s].length;
}

/** Termo: NFC, sem espaço nas pontas e com espaços internos colapsados. */
export function normalizeTerm(raw: string): string {
	return raw.normalize('NFC').trim().replace(/\s+/g, ' ');
}

/** Texto livre (tradução, contexto): NFC e sem espaço nas pontas. */
export function normalizeText(raw: string): string {
	return raw.normalize('NFC').trim();
}

export function isLang(value: unknown): value is Lang {
	return typeof value === 'string' && (LANGS as readonly string[]).includes(value);
}

export function parseLangFilter(param: string | null | undefined): Lang | null {
	const v = param?.toLowerCase();
	return isLang(v) ? v : null;
}

function asString(v: unknown): string {
	return typeof v === 'string' ? v : '';
}

export function parseWordInput(raw: Record<string, unknown>): ParseResult {
	const values = {
		term: asString(raw.term),
		translation: asString(raw.translation),
		lang: asString(raw.lang),
		context: asString(raw.context)
	};

	const term = normalizeTerm(values.term);
	const translation = normalizeText(values.translation);
	const context = normalizeText(values.context);
	const lang = values.lang.toLowerCase();

	const errors: Partial<Record<WordField, string>> = {};

	if (term === '') errors.term = 'Escreva a palavra ou expressão.';
	else if (charLength(term) > LIMITS.term) errors.term = `Use no máximo ${LIMITS.term} caracteres.`;

	if (charLength(translation) > LIMITS.translation)
		errors.translation = `Use no máximo ${LIMITS.translation} caracteres.`;

	if (charLength(context) > LIMITS.context)
		errors.context = `Use no máximo ${LIMITS.context} caracteres.`;

	if (!isLang(lang)) errors.lang = 'Escolha inglês ou italiano.';

	if (Object.keys(errors).length > 0 || !isLang(lang)) return { ok: false, errors, values };

	return { ok: true, value: { term, translation, lang, context } };
}

/** unique_violation (23505): a palavra já está no banco do usuário. */
export function isDuplicateError(err: unknown): boolean {
	return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23505';
}
