// Idiomas que o banco aceita (ISO 639-1). Espelha o domínio language_code da
// migration do banco; se mudar um, mude o outro. A interface fica em português.

export const LANGUAGES = [
	'en',
	'it',
	'es',
	'fr',
	'de',
	'pt',
	'ja',
	'ko',
	'zh',
	'nl',
	'ru'
] as const;
export type Language = (typeof LANGUAGES)[number];

export const LANGUAGE_LABELS: Record<Language, string> = {
	en: 'Inglês',
	it: 'Italiano',
	es: 'Espanhol',
	fr: 'Francês',
	de: 'Alemão',
	pt: 'Português',
	ja: 'Japonês',
	ko: 'Coreano',
	zh: 'Chinês',
	nl: 'Holandês',
	ru: 'Russo'
};

/** Padrões de user_settings, para quando a linha ainda não chegou. */
export const DEFAULT_NATIVE_LANGUAGE: Language = 'pt';
export const DEFAULT_STUDY_LANGUAGES: readonly Language[] = ['en', 'it'];

export function isLanguage(value: unknown): value is Language {
	return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

/** Filtro vindo da URL: código conhecido (sem diferenciar caixa) ou null. */
export function parseLanguage(param: string | null | undefined): Language | null {
	const v = param?.trim().toLowerCase();
	return isLanguage(v) ? v : null;
}

/**
 * Idiomas de estudo escolhidos num formulário: só os conhecidos, sem repetir e
 * na ordem da lista. Vazio é inválido (null): sempre se estuda alguma coisa.
 */
export function parseStudyLanguages(
	values: readonly unknown[],
	native?: Language
): Language[] | null {
	const picked = new Set(values.map((v) => (typeof v === 'string' ? v.toLowerCase() : v)));
	const list = LANGUAGES.filter((l) => picked.has(l) && l !== native);
	return list.length > 0 ? list : null;
}
