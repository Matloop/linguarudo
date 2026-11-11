import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '#lib/database.types.ts';
import {
	languageDefaults,
	parseLanguage,
	parseStudyLanguages,
	parseUiLanguage,
	type Language,
	type UiLanguage
} from '#lib/languages.ts';

export interface Settings {
	uiLanguage: UiLanguage;
	/** null só antes da primeira visita (a conta nasce sem língua nativa). */
	nativeLanguage: Language | null;
	/** Pode ser vazia: o início pede um idioma antes de tudo. */
	studyLanguages: Language[];
}

/**
 * Preferências do usuário. A linha nasce com a conta, sem língua nativa; na primeira
 * leitura com `acceptLanguage`, interface e língua nativa saem do navegador e ficam
 * gravadas (ADR 0004). Sem linha, nada é inventado além da interface.
 */
export async function loadSettings(
	supabase: SupabaseClient<Database>,
	userId: string,
	acceptLanguage?: string | null
): Promise<Settings> {
	const { data } = await supabase
		.from('user_settings')
		.select('ui_language, native_language, study_languages')
		.eq('user_id', userId)
		.maybeSingle();
	let uiLanguage = parseUiLanguage(data?.ui_language) ?? 'pt';
	let nativeLanguage = parseLanguage(data?.native_language);
	const studyLanguages = parseStudyLanguages(data?.study_languages ?? [], nativeLanguage) ?? [];

	if (data && !nativeLanguage && acceptLanguage !== undefined) {
		const defaults = languageDefaults(acceptLanguage);
		const { error } = await supabase
			.from('user_settings')
			.update({ ui_language: defaults.ui, native_language: defaults.native })
			.eq('user_id', userId)
			.is('native_language', null);
		if (!error) {
			uiLanguage = defaults.ui;
			nativeLanguage = defaults.native;
		}
	}
	return {
		uiLanguage,
		nativeLanguage,
		studyLanguages: studyLanguages.filter((l) => l !== nativeLanguage)
	};
}
