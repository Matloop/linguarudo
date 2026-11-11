import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '#lib/database.types.ts';
import {
	DEFAULT_NATIVE_LANGUAGE,
	DEFAULT_STUDY_LANGUAGES,
	isLanguage,
	type Language
} from '#lib/languages.ts';

export interface Settings {
	nativeLanguage: Language;
	studyLanguages: Language[];
}

/** Preferências do usuário (a linha nasce com a conta; sem ela, valem os padrões). */
export async function loadSettings(
	supabase: SupabaseClient<Database>,
	userId: string
): Promise<Settings> {
	const { data } = await supabase
		.from('user_settings')
		.select('native_language, study_languages')
		.eq('user_id', userId)
		.maybeSingle();
	const native = isLanguage(data?.native_language) ? data.native_language : DEFAULT_NATIVE_LANGUAGE;
	const study = (data?.study_languages ?? []).filter(isLanguage);
	return {
		nativeLanguage: native,
		studyLanguages: study.length > 0 ? study : [...DEFAULT_STUDY_LANGUAGES]
	};
}
