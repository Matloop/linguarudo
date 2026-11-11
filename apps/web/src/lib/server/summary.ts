// Contagens por idioma de estudo para o shell (seletor de idioma, "N para
// revisar") sem mudar o schema: contagens "head" do PostgREST por idioma, mais
// o review_counts para o que é global (novas feitas hoje e o limite diário).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '#lib/database.types.ts';
import type { Language } from '#lib/languages.ts';
import { DEFAULT_NEW_PER_DAY, dayStart, formatWhen, newRemaining } from '#lib/review.ts';

type Client = SupabaseClient<Database>;

export interface LanguageSummary {
	language: Language;
	/** Itens no banco (ativos e conhecidos), sem os apagados. */
	items: number;
	/** Flashcards que entram na revisão agora: vencidos + novos até o limite do dia. */
	toReview: number;
	dueNow: number;
	newAvailable: number;
}

export interface ShellSummary {
	languages: LanguageSummary[];
	newLimit: number;
	newDoneToday: number;
}

function activeFlashcards(supabase: Client, userId: string, language: Language) {
	return supabase
		.from('flashcards')
		.select('id, items!inner(language, status, deleted_at)', { count: 'exact', head: true })
		.eq('user_id', userId)
		.eq('items.language', language)
		.eq('items.status', 'ativo')
		.is('items.deleted_at', null);
}

async function count(query: PromiseLike<{ count: number | null; error: unknown }>) {
	const { count, error } = await query;
	if (error) throw new Error('contagem por idioma');
	return count ?? 0;
}

export async function loadShellSummary(
	supabase: Client,
	userId: string,
	study: readonly Language[],
	now: Date
): Promise<ShellSummary> {
	const nowIso = now.toISOString();
	const [global, ...perLanguage] = await Promise.all([
		supabase.rpc('review_counts', { p_day_start: dayStart(now).toISOString() }).single(),
		...study.map((language) =>
			Promise.all([
				count(
					supabase
						.from('items')
						.select('id', { count: 'exact', head: true })
						.eq('user_id', userId)
						.eq('language', language)
						.is('deleted_at', null)
				),
				count(activeFlashcards(supabase, userId, language).gt('state', 0).lte('due_at', nowIso)),
				count(activeFlashcards(supabase, userId, language).eq('state', 0))
			])
		)
	]);
	const newLimit = global.data?.new_limit ?? DEFAULT_NEW_PER_DAY;
	const newDoneToday = global.data?.new_done_today ?? 0;
	const remaining = newRemaining(newLimit, newDoneToday);
	return {
		newLimit,
		newDoneToday,
		languages: study.map((language, i) => {
			const [items, dueNow, newAvailable] = perLanguage[i];
			return {
				language,
				items,
				dueNow,
				newAvailable,
				toReview: dueNow + Math.min(newAvailable, remaining)
			};
		})
	};
}

/** Quando o próximo flashcard do idioma vence, para o "volta amanhã às 09:00". */
export async function nextDueText(
	supabase: Client,
	userId: string,
	language: Language,
	now: Date
): Promise<string | null> {
	const { data } = await supabase
		.from('flashcards')
		.select('due_at, items!inner(language, status, deleted_at)')
		.eq('user_id', userId)
		.eq('items.language', language)
		.eq('items.status', 'ativo')
		.is('items.deleted_at', null)
		.gt('state', 0)
		.gt('due_at', now.toISOString())
		.order('due_at')
		.limit(1)
		.maybeSingle();
	return data ? formatWhen(new Date(data.due_at), now) : null;
}
