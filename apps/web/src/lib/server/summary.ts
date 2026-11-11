// Contagens por idioma de estudo para o shell (seletor de idioma, "N para
// revisar"): review_counts por idioma (com irmãos ocultos, como a fila) e a
// contagem "head" de itens.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '#lib/database.types.ts';
import type { Language } from '#lib/languages.ts';
import {
	DEFAULT_CLOCK,
	DEFAULT_NEW_PER_DAY,
	dayStart,
	formatWhen,
	newRemaining,
	type DayClock
} from '#lib/review.ts';

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

async function count(query: PromiseLike<{ count: number | null; error: unknown }>) {
	const { count, error } = await query;
	if (error) throw new Error('contagem por idioma');
	return count ?? 0;
}

export async function loadShellSummary(
	supabase: Client,
	userId: string,
	study: readonly Language[],
	now: Date,
	clock: DayClock = DEFAULT_CLOCK
): Promise<ShellSummary> {
	const p_day_start = dayStart(now, clock).toISOString();
	const perLanguage = await Promise.all(
		study.map((language) =>
			Promise.all([
				count(
					supabase
						.from('items')
						.select('id', { count: 'exact', head: true })
						.eq('user_id', userId)
						.eq('language', language)
						.is('deleted_at', null)
				),
				supabase.rpc('review_counts', { p_day_start, p_language: language }).single()
			])
		)
	);
	let newLimit = DEFAULT_NEW_PER_DAY;
	let newDoneToday: number;
	if (perLanguage.length === 0) {
		const { data } = await supabase.rpc('review_counts', { p_day_start }).single();
		newLimit = data?.new_limit ?? newLimit;
		newDoneToday = data?.new_done_today ?? 0;
	} else {
		const first = perLanguage[0][1].data;
		newLimit = first?.new_limit ?? newLimit;
		newDoneToday = first?.new_done_today ?? 0;
	}
	const remaining = newRemaining(newLimit, newDoneToday);
	return {
		newLimit,
		newDoneToday,
		languages: study.map((language, i) => {
			const [items, counts] = perLanguage[i];
			if (counts.error) throw new Error('contagem por idioma');
			const dueNow = counts.data?.due_now ?? 0;
			const newAvailable = counts.data?.new_available ?? 0;
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
	now: Date,
	clock: DayClock = DEFAULT_CLOCK
): Promise<string | null> {
	const nowIso = now.toISOString();
	const [item, ficha] = await Promise.all([
		supabase
			.from('flashcards')
			.select('due_at, items!inner(language, status, deleted_at)')
			.eq('user_id', userId)
			.eq('items.language', language)
			.eq('items.status', 'ativo')
			.is('items.deleted_at', null)
			.gt('state', 0)
			.gt('due_at', nowIso)
			.order('due_at')
			.limit(1)
			.maybeSingle(),
		supabase
			.from('flashcards')
			.select('due_at, fichas!inner(language, status, deleted_at)')
			.eq('user_id', userId)
			.eq('fichas.language', language)
			.eq('fichas.status', 'ativo')
			.is('fichas.deleted_at', null)
			.gt('state', 0)
			.gt('due_at', nowIso)
			.order('due_at')
			.limit(1)
			.maybeSingle()
	]);
	const dues = [item.data?.due_at, ficha.data?.due_at].filter((d): d is string => !!d);
	if (dues.length === 0) return null;
	return formatWhen(new Date(Math.min(...dues.map((d) => Date.parse(d)))), now, clock.timeZone);
}

/** Tags usadas em itens e fichas do idioma, em ordem alfabética (para os filtros). */
export async function loadTags(
	supabase: Client,
	userId: string,
	language: Language
): Promise<string[]> {
	const [items, fichas] = await Promise.all([
		supabase
			.from('items')
			.select('tags')
			.eq('user_id', userId)
			.eq('language', language)
			.is('deleted_at', null)
			.filter('tags', 'neq', '{}')
			.limit(5000),
		supabase
			.from('fichas')
			.select('tags')
			.eq('user_id', userId)
			.eq('language', language)
			.is('deleted_at', null)
			.filter('tags', 'neq', '{}')
			.limit(5000)
	]);
	if (items.error || fichas.error) throw new Error('tags');
	const all = new Set([...items.data, ...fichas.data].flatMap((r) => r.tags));
	return [...all].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}
