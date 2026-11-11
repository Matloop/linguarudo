// Contagens por idioma de estudo para o shell (seletor de idioma, badge "N para hoje" e
// subitens de deck na sidebar). Usa o mesmo cálculo do hub /flashcards (deck_summaries +
// orçamento do idioma, ADR 0005), para os números baterem.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '#lib/database.types.ts';
import { isPausedIn } from '#lib/decks.ts';
import { forToday, rowCounts, todayTotals } from '#lib/decks-ui.ts';
import type { Language } from '#lib/languages.ts';
import { DEFAULT_CLOCK, formatWhen, type DayClock } from '#lib/review.ts';
import { loadDeckSummaries } from './decks.ts';

type Client = SupabaseClient<Database>;

export interface LanguageSummary {
	language: Language;
	/** Itens no banco (ativos e conhecidos), sem os apagados. */
	items: number;
	/** "N para hoje" de Estudar tudo: novas que cabem + aprendendo + revisões até o fim do dia. */
	toReview: number;
	/** Novas dentro de toReview. */
	fresh: number;
}

/** Deck de topo com algo para hoje, para os subitens da sidebar. */
export interface ShellDeck {
	id: string;
	name: string;
	forToday: number;
}

export interface ShellSummary {
	languages: LanguageSummary[];
	/** Decks do idioma ativo com algo para hoje (vazio se o idioma tem um deck só). */
	decks: ShellDeck[];
}

async function count(query: PromiseLike<{ count: number | null; error: unknown }>) {
	const { count, error } = await query;
	if (error) throw new Error('contagem por idioma');
	return count ?? 0;
}

/** Contagens por idioma de estudo; o orçamento de novas é de cada idioma (ADR 0005). */
export async function loadShellSummary(
	supabase: Client,
	userId: string,
	study: readonly Language[],
	active: Language | null,
	now: Date,
	clock: DayClock = DEFAULT_CLOCK
): Promise<ShellSummary> {
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
				loadDeckSummaries(supabase, language, now, clock)
			])
		)
	);
	let decks: ShellDeck[] = [];
	const languages = study.map((language, i) => {
		const [items, overview] = perLanguage[i];
		const totals = todayTotals(overview.decks, overview.budget);
		if (language === active && overview.decks.length > 1) {
			decks = overview.decks
				.filter((d) => d.depth === 0 && !isPausedIn(d, overview.decks))
				.map((d) => ({ id: d.id, name: d.name, forToday: forToday(rowCounts(d)) }))
				.filter((d) => d.forToday > 0);
		}
		return { language, items, toReview: totals.total, fresh: totals.fresh };
	});
	return { languages, decks };
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
