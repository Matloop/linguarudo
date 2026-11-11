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
import { clockFrom, DEFAULT_RETENTION, type DayClock } from '#lib/review.ts';

export interface Settings {
	uiLanguage: UiLanguage;
	/** null só antes da primeira visita (a conta nasce sem língua nativa). */
	nativeLanguage: Language | null;
	/** Pode ser vazia: o início pede um idioma antes de tudo. */
	studyLanguages: Language[];
	/** Fuso e hora em que o dia de estudo vira. */
	clock: DayClock;
	/** false até a pessoa (ou o navegador, na primeira visita) gravar um fuso. */
	timeZoneSet: boolean;
	/** Retenção desejada do FSRS. */
	retention: number;
}

/** Só o relógio e a retenção, para quem não precisa dos idiomas. */
export async function loadReviewSettings(
	supabase: SupabaseClient<Database>,
	userId: string
): Promise<Pick<Settings, 'clock' | 'retention' | 'timeZoneSet'>> {
	const { data } = await supabase
		.from('user_settings')
		.select('time_zone, day_start_hour, desired_retention')
		.eq('user_id', userId)
		.maybeSingle();
	return reviewSettingsFrom(data);
}

function reviewSettingsFrom(
	data: { time_zone: string | null; day_start_hour: number; desired_retention: number } | null
) {
	return {
		clock: clockFrom(data?.time_zone, data?.day_start_hour),
		timeZoneSet: !!data?.time_zone,
		retention: data?.desired_retention ?? DEFAULT_RETENTION
	};
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
		.select(
			'ui_language, native_language, study_languages, time_zone, day_start_hour, desired_retention'
		)
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
		studyLanguages: studyLanguages.filter((l) => l !== nativeLanguage),
		...reviewSettingsFrom(data)
	};
}
