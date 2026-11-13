import { fail } from '@sveltejs/kit';
import { findHighlight, parseEncounterEdit, type EncounterEditField } from '#lib/sentence.ts';

export type EncounterEditErrors = Partial<Record<EncounterEditField, string>>;

/**
 * Editar a frase de um encontro e a tradução dela (painel de Minhas palavras e revisão).
 * O destaque é achado de novo na frase nova: o antigo, a forma vista ou o lema.
 */
export async function editEncounter(locals: App.Locals, userId: string, form: FormData) {
	const parsed = parseEncounterEdit(Object.fromEntries(form));
	if (!parsed.ok) {
		return fail(400, { action: 'editEncounter' as const, errors: parsed.errors });
	}
	const { id, sentence, translation } = parsed.value;

	const { data: current } = await locals.supabase
		.from('encounters')
		.select('form, highlight, items!inner(lemma, language)')
		.eq('id', id)
		.eq('user_id', userId)
		.is('deleted_at', null)
		.maybeSingle();
	if (!current) {
		const errors: EncounterEditErrors = { form: 'Frase não encontrada.' };
		return fail(404, { action: 'editEncounter' as const, errors });
	}
	const item = current.items as unknown as { lemma: string; language: string };
	const highlight = findHighlight(
		sentence,
		[current.highlight, current.form, item.lemma],
		item.language
	);

	const { data, error: dbError } = await locals.supabase
		.from('encounters')
		.update({ sentence, translation, highlight })
		.eq('id', id)
		.eq('user_id', userId)
		.is('deleted_at', null)
		.select('id');
	if (dbError || data.length === 0) {
		const errors: EncounterEditErrors = { form: 'Não deu para salvar agora. Tente de novo.' };
		return fail(dbError ? 500 : 404, { action: 'editEncounter' as const, errors });
	}
	return { action: 'editEncounter' as const, id, sentence, translation, highlight };
}
