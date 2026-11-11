import { error, fail } from '@sveltejs/kit';
import {
	ORIGIN_LABELS,
	formatWorkSource,
	isDuplicateError,
	parseItemEdit,
	parseItemInput,
	type ItemEditField,
	type ItemField,
	type ItemStatus,
	type Origin,
	type SaveEntry
} from '#lib/items.ts';
import { parseLanguage, parseStudyLanguages, type Language } from '#lib/languages.ts';
import { isMastered } from '#lib/review.ts';
import { loadSettings } from '#lib/server/settings.ts';
import type { Actions, PageServerLoad } from './$types';

const PAGE_SIZE = 500;
/** Encontros mostrados por item; o mais recente primeiro. */
const ENCOUNTERS_SHOWN = 5;

type AddErrors = Partial<Record<ItemField | 'form', string>>;
type EditErrors = Partial<Record<ItemEditField | 'form', string>>;

async function requireUser(locals: App.Locals) {
	const user = await locals.getUser();
	if (!user) error(401, 'Entre para ver suas palavras.');
	return user;
}

function formId(form: FormData): string | null {
	const id = form.get('id');
	return typeof id === 'string' && id !== '' ? id : null;
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = await requireUser(locals);
	const language = parseLanguage(url.searchParams.get('lang'));
	const settings = await loadSettings(locals.supabase, user.id);

	let query = locals.supabase
		.from('items')
		.select(
			'id, language, lemma, sense, note, status, seen_count, created_at, cards(kind, state, stability), encounters(id, sentence, highlight, sense, origin, position, works(title, subtitle))'
		)
		.eq('user_id', user.id)
		.is('deleted_at', null)
		.is('encounters.deleted_at', null)
		.order('created_at', { ascending: false })
		.order('seen_at', { referencedTable: 'encounters', ascending: false })
		.limit(ENCOUNTERS_SHOWN, { referencedTable: 'encounters' })
		.limit(PAGE_SIZE);
	if (language) query = query.eq('language', language);

	const { data, error: dbError } = await query;
	if (dbError) error(500, 'Não deu para carregar suas palavras agora.');

	const items = data.map(({ cards, encounters, seen_count, ...item }) => ({
		...item,
		language: item.language as Language,
		status: item.status as ItemStatus,
		mastered: isMastered(cards),
		hasProduce: cards.some((c) => c.kind === 'produzir'),
		seenCount: seen_count,
		encounters: encounters.map((e) => ({
			id: e.id,
			sentence: e.sentence,
			highlight: e.highlight,
			sense: e.sense,
			origin: ORIGIN_LABELS[e.origin as Origin],
			source: formatWorkSource(e.works, e.position)
		}))
	}));
	return { items, language, studyLanguages: settings.studyLanguages };
};

export const actions: Actions = {
	add: async ({ locals, request }) => {
		const user = await requireUser(locals);
		const settings = await loadSettings(locals.supabase, user.id);
		const parsed = parseItemInput(
			Object.fromEntries(await request.formData()),
			settings.studyLanguages
		);
		if (!parsed.ok) {
			const errors: AddErrors = parsed.errors;
			return fail(400, { action: 'add' as const, errors, values: parsed.values });
		}

		const { language, lemma, sense, sentence } = parsed.value;
		const entry: SaveEntry = { language, lemma, sense, note: '', ipa: '', part_of_speech: '' };
		if (sentence) {
			entry.encounter = {
				form: '',
				sentence,
				highlight: '',
				sense,
				position: {},
				origin: 'manual',
				seen_at: null,
				client_id: null
			};
		}
		const { data, error: dbError } = await locals.supabase.rpc('save_items', { p_items: [entry] });
		const saved = data?.[0];
		if (dbError || !saved) {
			const errors: AddErrors = { form: 'Não deu para salvar agora. Tente de novo.' };
			return fail(500, { action: 'add' as const, errors, values: { ...parsed.value } });
		}
		if (!saved.created && !saved.encounter_id) {
			const errors: AddErrors = { lemma: `“${saved.lemma}” já está no seu banco.` };
			return fail(409, { action: 'add' as const, errors, values: { ...parsed.value } });
		}
		return {
			action: 'add' as const,
			added: saved.lemma,
			message: saved.created
				? `“${saved.lemma}” guardada.`
				: `“${saved.lemma}” já estava no banco. A frase entrou como novo encontro.`
		};
	},

	edit: async ({ locals, request }) => {
		const user = await requireUser(locals);
		const form = await request.formData();
		const id = formId(form);
		const parsed = parseItemEdit(Object.fromEntries(form));
		if (!id)
			return fail(400, {
				action: 'edit' as const,
				id,
				errors: { form: 'Palavra não encontrada.' } as EditErrors
			});
		if (!parsed.ok) {
			const errors: EditErrors = parsed.errors;
			return fail(400, { action: 'edit' as const, id, errors });
		}

		const { data, error: dbError } = await locals.supabase
			.from('items')
			.update(parsed.value)
			.eq('id', id)
			.eq('user_id', user.id)
			.is('deleted_at', null)
			.select('id');
		if (dbError || data.length === 0) {
			const errors: EditErrors = isDuplicateError(dbError)
				? { lemma: `“${parsed.value.lemma}” já está no seu banco.` }
				: { form: 'Não deu para salvar agora. Tente de novo.' };
			return fail(isDuplicateError(dbError) ? 409 : dbError ? 500 : 404, {
				action: 'edit' as const,
				id,
				errors
			});
		}
		return { action: 'edit' as const, id, edited: parsed.value.lemma };
	},

	known: async ({ locals, request }) => {
		const user = await requireUser(locals);
		const form = await request.formData();
		const id = formId(form);
		const status: ItemStatus = form.get('known') === 'true' ? 'conhecido' : 'ativo';
		if (!id) return fail(400, { action: 'known' as const, message: 'Palavra não encontrada.' });

		const { data, error: dbError } = await locals.supabase
			.from('items')
			.update({ status })
			.eq('id', id)
			.eq('user_id', user.id)
			.is('deleted_at', null)
			.select('id');
		if (dbError || data.length === 0) {
			return fail(dbError ? 500 : 404, {
				action: 'known' as const,
				message: 'Não deu para mudar agora. Tente de novo.'
			});
		}
		return { action: 'known' as const, id, status };
	},

	delete: async ({ locals, request }) => {
		const user = await requireUser(locals);
		const id = formId(await request.formData());
		if (!id) return fail(400, { action: 'delete' as const, message: 'Palavra não encontrada.' });

		// Apagar marca deleted_at: a exclusão precisa chegar aos outros aparelhos (sync).
		const { error: dbError } = await locals.supabase
			.from('items')
			.update({ deleted_at: new Date().toISOString() })
			.eq('id', id)
			.eq('user_id', user.id)
			.is('deleted_at', null);
		if (dbError) {
			return fail(500, { action: 'delete' as const, message: 'Não deu para apagar agora.' });
		}
		return { action: 'delete' as const, deleted: id };
	},

	languages: async ({ locals, request }) => {
		const user = await requireUser(locals);
		const settings = await loadSettings(locals.supabase, user.id);
		const study = parseStudyLanguages(
			(await request.formData()).getAll('languages'),
			settings.nativeLanguage
		);
		if (!study) {
			return fail(400, { action: 'languages' as const, message: 'Escolha pelo menos um idioma.' });
		}
		const { error: dbError } = await locals.supabase
			.from('user_settings')
			.update({ study_languages: study })
			.eq('user_id', user.id);
		if (dbError) {
			return fail(500, { action: 'languages' as const, message: 'Não deu para salvar agora.' });
		}
		return { action: 'languages' as const, saved: study };
	}
};
