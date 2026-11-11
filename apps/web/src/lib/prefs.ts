// Preferências da interface guardadas em cookie: tema, barra lateral e idioma
// ativo. O servidor lê os cookies e já renderiza a página certa (sem piscar).

import { isLanguage, parseLanguage, type Language } from './languages.ts';

export type Theme = 'claro' | 'escuro';

export const THEME_COOKIE = 'tema';
export const SIDEBAR_COOKIE = 'barra';
export const LANGUAGE_COOKIE = 'idioma';

const YEAR_SECONDS = 365 * 24 * 60 * 60;

export function parseTheme(value: string | null | undefined): Theme | null {
	return value === 'claro' || value === 'escuro' ? value : null;
}

/** Classe da raiz. Vazia = sem escolha: o CSS segue prefers-color-scheme. */
export function themeClass(theme: Theme | null): string {
	return theme ? `tema-${theme}` : '';
}

/** O tema oposto ao que está na tela (o salvo ou, sem ele, o do sistema). */
export function nextTheme(saved: Theme | null, systemDark: boolean): Theme {
	const shown = saved ?? (systemDark ? 'escuro' : 'claro');
	return shown === 'escuro' ? 'claro' : 'escuro';
}

export function parseCollapsed(value: string | null | undefined): boolean {
	return value === 'recolhida';
}

/** Idioma do cookie se ainda é de estudo; senão o primeiro da lista. */
export function resolveActiveLanguage(
	cookie: string | null | undefined,
	study: readonly Language[]
): Language {
	const lang = parseLanguage(cookie);
	return lang && study.includes(lang) ? lang : study[0];
}

/** Lista nova com o idioma no fim, ou null se ele não pode entrar. */
export function addStudyLanguage(
	study: readonly Language[],
	value: string | null | undefined,
	native: Language
): Language[] | null {
	const lang = value?.trim().toLowerCase();
	if (!isLanguage(lang) || lang === native || study.includes(lang)) return null;
	return [...study, lang];
}

/** Cookie de preferência gravado pelo navegador: site todo, um ano. */
export function cookieString(name: string, value: string): string {
	return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${YEAR_SECONDS}; SameSite=Lax`;
}

/** Opções equivalentes para cookies.set no servidor. */
export const PREF_COOKIE_OPTIONS = {
	path: '/',
	maxAge: YEAR_SECONDS,
	sameSite: 'lax',
	httpOnly: false
} as const;
