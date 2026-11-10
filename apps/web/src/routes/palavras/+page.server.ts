import { error, fail } from '@sveltejs/kit';
import { isDuplicateError, parseLangFilter, parseWordInput, type WordField } from '#lib/words.ts';
import type { Actions, PageServerLoad } from './$types';

const PAGE_SIZE = 500;

type AddErrors = Partial<Record<WordField | 'form', string>>;

async function requireUser(locals: App.Locals) {
	const user = await locals.getUser();
	if (!user) error(401, 'Entre para ver suas palavras.');
	return user;
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = await requireUser(locals);
	const lang = parseLangFilter(url.searchParams.get('lang'));

	let query = locals.supabase
		.from('words')
		.select('id, term, translation, lang, context, created_at, cards(paused)')
		.eq('user_id', user.id)
		.order('created_at', { ascending: false })
		.limit(PAGE_SIZE);
	if (lang) query = query.eq('lang', lang);

	const { data, error: dbError } = await query;
	if (dbError) error(500, 'Não deu para carregar suas palavras agora.');

	const words = data.map(({ cards, ...word }) => ({ ...word, paused: cards?.paused ?? false }));
	return { words, lang };
};

export const actions: Actions = {
	add: async ({ locals, request }) => {
		const user = await requireUser(locals);
		const parsed = parseWordInput(Object.fromEntries(await request.formData()));
		if (!parsed.ok) {
			const errors: AddErrors = parsed.errors;
			return fail(400, { action: 'add' as const, errors, values: parsed.values });
		}

		const { error: dbError } = await locals.supabase
			.from('words')
			.insert({ ...parsed.value, user_id: user.id, source: 'manual' });

		if (dbError) {
			const errors: AddErrors = isDuplicateError(dbError)
				? { term: `“${parsed.value.term}” já está no seu banco.` }
				: { form: 'Não deu para salvar agora. Tente de novo.' };
			return fail(isDuplicateError(dbError) ? 409 : 500, {
				action: 'add' as const,
				errors,
				values: { ...parsed.value }
			});
		}

		return { action: 'add' as const, added: parsed.value.term };
	},

	delete: async ({ locals, request }) => {
		const user = await requireUser(locals);
		const id = (await request.formData()).get('id');
		if (typeof id !== 'string' || id === '') {
			return fail(400, { action: 'delete' as const, message: 'Palavra não encontrada.' });
		}

		const { error: dbError } = await locals.supabase
			.from('words')
			.delete()
			.eq('id', id)
			.eq('user_id', user.id);
		if (dbError) {
			return fail(500, { action: 'delete' as const, message: 'Não deu para apagar agora.' });
		}
		return { action: 'delete' as const, deleted: id };
	},

	pause: async ({ locals, request }) => {
		const user = await requireUser(locals);
		const form = await request.formData();
		const id = form.get('id');
		const paused = form.get('paused') === 'true';
		if (typeof id !== 'string' || id === '') {
			return fail(400, { action: 'pause' as const, message: 'Palavra não encontrada.' });
		}

		const { data, error: dbError } = await locals.supabase
			.from('cards')
			.update({ paused })
			.eq('word_id', id)
			.eq('user_id', user.id)
			.select('id');
		if (dbError || data.length === 0) {
			return fail(dbError ? 500 : 404, {
				action: 'pause' as const,
				message: paused ? 'Não deu para pausar agora.' : 'Não deu para retomar agora.'
			});
		}
		return { action: 'pause' as const, id, paused };
	}
};
