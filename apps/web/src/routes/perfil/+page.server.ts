import { error, fail, redirect } from '@sveltejs/kit';
import { safeNext } from '#lib/auth.ts';
import { parseLanguage, parseStudyLanguages, parseUiLanguage } from '#lib/languages.ts';
import {
	LANGUAGE_COOKIE,
	PREF_COOKIE_OPTIONS,
	SIDEBAR_COOKIE,
	THEME_COOKIE,
	addStudyLanguage,
	parseTheme
} from '#lib/prefs.ts';
import {
	DEFAULT_NEW_PER_DAY,
	DEFAULT_RETENTION,
	isTimeZone,
	MAX_RETENTION,
	MIN_RETENTION
} from '#lib/review.ts';
import {
	DECK_LIMITS,
	DEFAULT_LEECH_LAPSES,
	parseLeechAction,
	parseNewOrder,
	type LeechAction,
	type NewOrder
} from '#lib/decks.ts';
import { updateStudySettings, type StudySettings } from '#lib/server/decks.ts';
import { loadSettings } from '#lib/server/settings.ts';
import type { Actions, PageServerLoad } from './$types';

/** Teto do "palavras novas por dia" (o banco aceita até 9999; ninguém precisa de tanto). */
const MAX_NEW_PER_DAY = 50;

async function requireUser(locals: App.Locals) {
	const user = await locals.getUser();
	if (!user) error(401, 'Entre para ver seu perfil.');
	return user;
}

async function saveStudy(locals: App.Locals, userId: string, form: FormData, s: StudySettings) {
	const res = await updateStudySettings(locals.supabase, userId, s);
	if (!res.ok) return fail(500, { message: 'Não deu para salvar agora.' });
	back(form);
}

/** Sem JS, cada preferência volta para a página de onde veio. */
function back(form: FormData): never {
	const to = form.get('voltar');
	redirect(303, safeNext(typeof to === 'string' ? to : '/perfil'));
}

export const load: PageServerLoad = async ({ locals }) => {
	const user = await requireUser(locals);
	const [{ data: settings }, { count: tokens }] = await Promise.all([
		locals.supabase
			.from('user_settings')
			.select(
				'new_flashcards_per_day, autoplay_audio, desired_retention, new_order, leech_lapses, leech_action'
			)
			.eq('user_id', user.id)
			.maybeSingle(),
		locals.supabase
			.from('api_tokens')
			.select('id', { count: 'exact', head: true })
			.eq('user_id', user.id)
	]);
	return {
		newPerDay: settings?.new_flashcards_per_day ?? DEFAULT_NEW_PER_DAY,
		maxNewPerDay: MAX_NEW_PER_DAY,
		newOrder: (parseNewOrder(settings?.new_order) ?? 'importance') as NewOrder,
		leechLapses: settings?.leech_lapses ?? DEFAULT_LEECH_LAPSES,
		leechAction: (parseLeechAction(settings?.leech_action) ?? 'wait') as LeechAction,
		minLeechLapses: DECK_LIMITS.leechLapsesMin,
		maxLeechLapses: DECK_LIMITS.leechLapsesMax,
		autoplayAudio: settings?.autoplay_audio ?? false,
		// Em pontos percentuais inteiros (90), como o stepper mostra.
		retention: Math.round((settings?.desired_retention ?? DEFAULT_RETENTION) * 100),
		minRetention: Math.round(MIN_RETENTION * 100),
		maxRetention: Math.round(MAX_RETENTION * 100),
		stremioConnected: (tokens ?? 0) > 0
	};
};

export const actions: Actions = {
	idioma: async ({ locals, request, cookies }) => {
		const user = await requireUser(locals);
		const form = await request.formData();
		const lang = parseLanguage(form.get('idioma'));
		const { studyLanguages } = await loadSettings(locals.supabase, user.id);
		if (!lang || !studyLanguages.includes(lang)) {
			return fail(400, { message: 'Esse idioma não está nos seus idiomas.' });
		}
		cookies.set(LANGUAGE_COOKIE, lang, PREF_COOKIE_OPTIONS);
		back(form);
	},

	adicionarIdioma: async ({ locals, request, cookies }) => {
		const user = await requireUser(locals);
		const form = await request.formData();
		const settings = await loadSettings(locals.supabase, user.id);
		const study = addStudyLanguage(
			settings.studyLanguages,
			form.get('idioma')?.toString(),
			settings.nativeLanguage
		);
		if (!study) return fail(400, { message: 'Não dá para adicionar esse idioma.' });
		const { error: dbError } = await locals.supabase
			.from('user_settings')
			.update({ study_languages: study })
			.eq('user_id', user.id);
		if (dbError) return fail(500, { message: 'Não deu para salvar agora.' });
		// O idioma novo já fica ativo: é nele que a pessoa quer guardar.
		cookies.set(LANGUAGE_COOKIE, study[study.length - 1], PREF_COOKIE_OPTIONS);
		back(form);
	},

	/** Lista inteira de idiomas de estudo (no perfil dá para tirar um idioma). */
	idiomas: async ({ locals, request }) => {
		const user = await requireUser(locals);
		const form = await request.formData();
		const settings = await loadSettings(locals.supabase, user.id);
		const study = parseStudyLanguages(form.getAll('idiomas'), settings.nativeLanguage);
		if (!study) return fail(400, { message: 'Não dá para salvar esses idiomas.' });
		const { error: dbError } = await locals.supabase
			.from('user_settings')
			.update({ study_languages: study })
			.eq('user_id', user.id);
		if (dbError) return fail(500, { message: 'Não deu para salvar agora.' });
		back(form);
	},

	/** Idioma da interface (por ora só português e inglês). */
	interface: async ({ locals, request }) => {
		const user = await requireUser(locals);
		const form = await request.formData();
		const ui = parseUiLanguage(form.get('interface'));
		if (!ui) return fail(400, { message: 'Escolha português ou inglês.' });
		const { error: dbError } = await locals.supabase
			.from('user_settings')
			.update({ ui_language: ui })
			.eq('user_id', user.id);
		if (dbError) return fail(500, { message: 'Não deu para salvar agora.' });
		back(form);
	},

	/** Língua nativa: qualquer tag BCP 47; sai da lista de estudo se estava lá. */
	nativa: async ({ locals, request }) => {
		const user = await requireUser(locals);
		const form = await request.formData();
		const native = parseLanguage(form.get('nativa'));
		if (!native) return fail(400, { message: 'Esse código de idioma não existe.' });
		const settings = await loadSettings(locals.supabase, user.id);
		const { error: dbError } = await locals.supabase
			.from('user_settings')
			.update({
				native_language: native,
				study_languages: settings.studyLanguages.filter((l) => l !== native)
			})
			.eq('user_id', user.id);
		if (dbError) return fail(500, { message: 'Não deu para salvar agora.' });
		back(form);
	},

	tema: async ({ request, cookies }) => {
		const form = await request.formData();
		const theme = parseTheme(form.get('tema')?.toString());
		if (!theme) return fail(400, { message: 'Tema inválido.' });
		cookies.set(THEME_COOKIE, theme, PREF_COOKIE_OPTIONS);
		back(form);
	},

	barra: async ({ request, cookies }) => {
		const form = await request.formData();
		const collapsed = form.get('barra') === 'recolhida';
		cookies.set(SIDEBAR_COOKIE, collapsed ? 'recolhida' : 'aberta', PREF_COOKIE_OPTIONS);
		back(form);
	},

	/** Gravação do flashcard toca sozinha na revisão. */
	autoplay: async ({ locals, request }) => {
		const user = await requireUser(locals);
		const form = await request.formData();
		const { error: dbError } = await locals.supabase
			.from('user_settings')
			.update({ autoplay_audio: form.get('autoplay') === 'on' })
			.eq('user_id', user.id);
		if (dbError) return fail(500, { message: 'Não deu para salvar agora.' });
		back(form);
	},

	novasPorDia: async ({ locals, request }) => {
		const user = await requireUser(locals);
		const form = await request.formData();
		const n = Number(form.get('novasPorDia'));
		if (!Number.isInteger(n) || n < 0 || n > MAX_NEW_PER_DAY) {
			return fail(400, { message: `Escolha um número de 0 a ${MAX_NEW_PER_DAY}.` });
		}
		return saveStudy(locals, user.id, form, { newFlashcardsPerDay: n });
	},

	/** Como "Estudar tudo" intercala as novas dos decks. */
	ordem: async ({ locals, request }) => {
		const user = await requireUser(locals);
		const form = await request.formData();
		const order = parseNewOrder(form.get('ordem'));
		if (!order) return fail(400, { message: 'Ordem desconhecida.' });
		return saveStudy(locals, user.id, form, { newOrder: order });
	},

	/** Teimosas: quantos erros e o que fazer depois. */
	teimosas: async ({ locals, request }) => {
		const user = await requireUser(locals);
		const form = await request.formData();
		const patch: StudySettings = {};
		if (form.has('erros')) {
			const n = Number(form.get('erros'));
			const { leechLapsesMin: min, leechLapsesMax: max } = DECK_LIMITS;
			if (!Number.isInteger(n) || n < min || n > max) {
				return fail(400, { message: `Escolha de ${min} a ${max} erros.` });
			}
			patch.leechLapses = n;
		}
		if (form.has('acao')) {
			const action = parseLeechAction(form.get('acao'));
			if (!action) return fail(400, { message: 'Escolha o que fazer com as teimosas.' });
			patch.leechAction = action;
		}
		return saveStudy(locals, user.id, form, patch);
	},

	retencao: async ({ locals, request }) => {
		const user = await requireUser(locals);
		const form = await request.formData();
		const pct = Number(form.get('retencao'));
		const min = Math.round(MIN_RETENTION * 100);
		const max = Math.round(MAX_RETENTION * 100);
		if (!Number.isInteger(pct) || pct < min || pct > max) {
			return fail(400, { message: `Escolha uma retenção de ${min}% a ${max}%.` });
		}
		const { error: dbError } = await locals.supabase
			.from('user_settings')
			.update({ desired_retention: pct / 100 })
			.eq('user_id', user.id);
		if (dbError) return fail(500, { message: 'Não deu para salvar agora.' });
		back(form);
	},

	virada: async ({ locals, request }) => {
		const user = await requireUser(locals);
		const form = await request.formData();
		const hour = Number(form.get('virada'));
		if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
			return fail(400, { message: 'Escolha uma hora de 0 a 23.' });
		}
		const { error: dbError } = await locals.supabase
			.from('user_settings')
			.update({ day_start_hour: hour })
			.eq('user_id', user.id);
		if (dbError) return fail(500, { message: 'Não deu para salvar agora.' });
		back(form);
	},

	/** Fuso escolhido no perfil ou detectado pelo navegador na primeira visita (so_se_vazio). */
	fuso: async ({ locals, request }) => {
		const user = await requireUser(locals);
		const form = await request.formData();
		const zone = form.get('fuso')?.toString() ?? '';
		if (!isTimeZone(zone)) {
			return fail(400, { message: 'Fuso horário desconhecido.' });
		}
		let query = locals.supabase
			.from('user_settings')
			.update({ time_zone: zone })
			.eq('user_id', user.id);
		if (form.get('so_se_vazio')) query = query.is('time_zone', null);
		const { error: dbError } = await query;
		if (dbError) return fail(400, { message: 'Não deu para salvar esse fuso.' });
		back(form);
	}
};
