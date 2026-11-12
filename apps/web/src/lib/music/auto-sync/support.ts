// O "Sincronizar sozinho" só funciona no Chromium de computador: precisa capturar o
// áudio da própria aba (getDisplayMedia com preferCurrentTab). Firefox e Safari não
// entregam áudio de aba, e no celular não existe captura de tela. Onde não dá, o
// botão nem aparece.

/** O pedaço do `navigator` que a checagem usa; os testes passam um falso. */
export interface SupportNavigator {
	mediaDevices?: { getDisplayMedia?: unknown };
	userAgent?: string;
	userAgentData?: { mobile?: boolean; brands?: readonly { brand: string }[] };
	maxTouchPoints?: number;
}

const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile/i;
/** Navegadores que dizem "Chrome/" no user agent mas não são Chromium de verdade. */
const NOT_CHROMIUM_UA = /Firefox\/|FxiOS|CriOS|EdgiOS/;

export function autoSyncSupported(
	nav: SupportNavigator | undefined = globalThis.navigator as SupportNavigator | undefined
): boolean {
	if (!nav) return false;
	if (typeof nav.mediaDevices?.getDisplayMedia !== 'function') return false;

	const data = nav.userAgentData;
	if (data && Array.isArray(data.brands)) {
		// UA-CH só existe no Chromium (contexto seguro); é a fonte mais confiável.
		if (data.mobile) return false;
		return data.brands.some((b) => b.brand === 'Chromium');
	}

	const ua = nav.userAgent ?? '';
	if (MOBILE_UA.test(ua) || NOT_CHROMIUM_UA.test(ua)) return false;
	return /\b(?:Chrome|Chromium)\/\d+/.test(ua);
}
