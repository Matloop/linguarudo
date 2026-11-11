import {
	LANGUAGE_COOKIE,
	SIDEBAR_COOKIE,
	THEME_COOKIE,
	parseCollapsed,
	parseTheme,
	resolveActiveLanguage
} from '#lib/prefs.ts';
import { REVIEW_DEPENDENCY } from '#lib/review.ts';
import { loadSettings } from '#lib/server/settings.ts';
import { loadShellSummary } from '#lib/server/summary.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, depends, cookies, request }) => {
	depends(REVIEW_DEPENDENCY);
	const theme = parseTheme(cookies.get(THEME_COOKIE));
	const collapsed = parseCollapsed(cookies.get(SIDEBAR_COOKIE));
	const user = await locals.getUser();
	if (!user) return { user, theme, collapsed, shell: null };

	const settings = await loadSettings(
		locals.supabase,
		user.id,
		request.headers.get('accept-language')
	);
	const active = resolveActiveLanguage(cookies.get(LANGUAGE_COOKIE), settings.studyLanguages);
	// O shell não pode derrubar a página: sem contagem, só somem os números.
	const summary = await loadShellSummary(
		locals.supabase,
		user.id,
		settings.studyLanguages,
		new Date()
	).catch(() => null);

	return {
		user,
		theme,
		collapsed,
		shell: {
			uiLanguage: settings.uiLanguage,
			nativeLanguage: settings.nativeLanguage,
			studyLanguages: settings.studyLanguages,
			active,
			summary
		}
	};
};
