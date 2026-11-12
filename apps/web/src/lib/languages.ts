// Idiomas são tags BCP 47 canônicas (ADR 0004): qualquer idioma que o
// Intl.getCanonicalLocales aceite. A boa formação espelha o domínio
// language_code do banco (LANGUAGE_TAG_RE); a canonização fica no pacote.

import {
	canonicalLanguage,
	languageEndonym,
	languageName,
	languageProfile
} from '@linguetta/language';

/** Tag BCP 47 canônica ('it', 'pt-BR', 'zh-Hant'). Valide com parseLanguage. */
export type Language = string;

/** Idiomas da própria interface. */
export const UI_LANGUAGES = ['pt', 'en'] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];

/** Teto de idiomas de estudo (o banco aceita de 0 a 20). */
export const MAX_STUDY_LANGUAGES = 20;

/** Tag canônica, ou null se não é uma tag BCP 47 válida. */
export function parseLanguage(value: unknown): Language | null {
	return canonicalLanguage(typeof value === 'string' ? value.trim() : value);
}

export function parseUiLanguage(value: unknown): UiLanguage | null {
	return value === 'pt' || value === 'en' ? value : null;
}

/** Nome do idioma na língua da interface, com inicial maiúscula ('Italiano', 'Italian'). */
export function languageLabel(tag: Language, ui: UiLanguage): string {
	return capitalize(languageName(tag, ui), ui);
}

/**
 * Nome do idioma no meio de uma frase: minúsculo em português ("ao italiano"),
 * maiúsculo em inglês ("Italian").
 */
export function languageInline(tag: Language, ui: UiLanguage): string {
	const name = languageLabel(tag, ui);
	return ui === 'pt' ? name.toLocaleLowerCase('pt') : name;
}

/** Nome do idioma nele mesmo, com inicial maiúscula ('Deutsch'). */
export function languageSelfLabel(tag: Language): string {
	return capitalize(languageEndonym(tag), tag);
}

/** Atributos lang/dir para texto escrito no idioma. */
export function langAttrs(tag: Language): { lang: string; dir: 'ltr' | 'rtl' } {
	return { lang: tag, dir: languageProfile(tag).dir };
}

function capitalize(s: string, locale: string): string {
	if (!s) return s;
	const first = String.fromCodePoint(s.codePointAt(0) as number);
	let upper: string;
	try {
		upper = first.toLocaleUpperCase(locale);
	} catch {
		upper = first.toUpperCase();
	}
	return upper + s.slice(first.length);
}

/**
 * Idiomas de estudo vindos de um formulário: canônicos, sem repetir, na ordem
 * recebida e sem a língua nativa. Vazio vale (o início pede um idioma); null se
 * algum valor é inválido ou passa do teto.
 */
export function parseStudyLanguages(
	values: readonly unknown[],
	native?: Language | null
): Language[] | null {
	const list: Language[] = [];
	for (const v of values) {
		const tag = parseLanguage(v);
		if (!tag) return null;
		if (tag !== native && !list.includes(tag)) list.push(tag);
	}
	return list.length <= MAX_STUDY_LANGUAGES ? list : null;
}

/** Tags de um Accept-Language, da mais para a menos preferida. */
export function acceptedLanguages(header: string | null | undefined): Language[] {
	if (!header) return [];
	const ranked: { tag: Language; q: number; i: number }[] = [];
	header.split(',').forEach((part, i) => {
		const [range, ...params] = part.trim().split(';');
		const qParam = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
		const q = qParam ? Number(qParam.slice(2)) : 1;
		const tag = parseLanguage(range);
		if (tag && Number.isFinite(q) && q > 0) ranked.push({ tag, q, i });
	});
	ranked.sort((a, b) => b.q - a.q || a.i - b.i);
	return ranked.map((r) => r.tag);
}

/**
 * Padrões de uma conta nova a partir do Accept-Language: interface em português
 * se o navegador prefere algum pt*, senão inglês; língua nativa = base da
 * primeira tag (ou a da interface, sem cabeçalho).
 */
export function languageDefaults(header: string | null | undefined): {
	ui: UiLanguage;
	native: Language;
} {
	const tags = acceptedLanguages(header);
	const bases = tags.map((t) => languageProfile(t).base);
	const firstUi = bases.find((b) => b === 'pt' || b === 'en');
	const ui: UiLanguage = firstUi === 'pt' ? 'pt' : 'en';
	return { ui, native: bases[0] ? (parseLanguage(bases[0]) ?? ui) : ui };
}
