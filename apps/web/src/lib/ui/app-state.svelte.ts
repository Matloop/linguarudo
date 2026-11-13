// Estado do shell que várias telas tocam: diálogos Guardar e Nova ficha e aviso (toast).

import { THEME_COOKIE, cookieString, type Theme } from '#lib/prefs.ts';

export const ui = $state({
	saveOpen: false,
	/** Diálogo Nova ficha (FichaDialog no layout). */
	fichaOpen: false,
	toast: '',
	/** Muda a cada aviso, para o mesmo texto aparecer de novo. */
	toastId: 0
});

let timer: ReturnType<typeof setTimeout> | undefined;

export function toast(message: string) {
	ui.toast = message;
	ui.toastId += 1;
	clearTimeout(timer);
	timer = setTimeout(() => (ui.toast = ''), 2600);
}

export function openSave() {
	ui.saveOpen = true;
}

export function openFicha() {
	ui.fichaOpen = true;
}

/** Aplica o tema na hora (classe na raiz) e guarda no cookie para o SSR. */
export function applyTheme(theme: Theme) {
	const root = document.documentElement;
	root.classList.remove('tema-claro', 'tema-escuro');
	root.classList.add(`tema-${theme}`);
	document.cookie = cookieString(THEME_COOKIE, theme);
}
