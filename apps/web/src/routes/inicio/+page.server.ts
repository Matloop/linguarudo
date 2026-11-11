import { error } from '@sveltejs/kit';
import { formatWorkSource, type Origin } from '#lib/items.ts';
import { nextDueText } from '#lib/server/summary.ts';
import type { PageServerLoad } from './$types';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** O flashcard do leque: o primeiro que a revisão vai mostrar (vencido, senão novo). */
const CARD_ITEM =
	'id, due_at, state, items!inner(lemma, ipa, language, status, deleted_at, encounters(origin, position, seen_at, deleted_at, works(title, subtitle)))';

type FanRow = {
	items: {
		lemma: string;
		ipa: string;
		encounters: {
			origin: string;
			position: unknown;
			works: { title: string; subtitle: string } | null;
		}[];
	};
};

export const load: PageServerLoad = async ({ locals, parent }) => {
	const user = await locals.getUser();
	if (!user) error(401, 'Entre para ver o início.');
	const { shell } = await parent();
	if (!shell) error(401, 'Entre para ver o início.');
	const language = shell.active;
	const now = new Date();
	const nowIso = now.toISOString();
	// Sem idioma de estudo ainda: o início só pede para escolher um (ADR 0004).
	if (!language) {
		return {
			needsLanguage: true as const,
			next: null,
			lastItem: null,
			savedThisWeek: 0,
			song: null,
			stremioConnected: false,
			nextDue: null,
			now: nowIso
		};
	}

	const flashcards = () =>
		locals.supabase
			.from('flashcards')
			.select(CARD_ITEM)
			.eq('user_id', user.id)
			.eq('items.language', language)
			.eq('items.status', 'ativo')
			.is('items.deleted_at', null)
			.is('items.encounters.deleted_at', null)
			.order('seen_at', { referencedTable: 'items.encounters', ascending: false })
			.limit(1, { referencedTable: 'items.encounters' });

	const [due, fresh, last, week, song, tokens, nextDue] = await Promise.all([
		flashcards().gt('state', 0).lte('due_at', nowIso).order('due_at').limit(1).maybeSingle(),
		flashcards().eq('state', 0).order('created_at').limit(1).maybeSingle(),
		locals.supabase
			.from('items')
			.select('lemma, created_at')
			.eq('user_id', user.id)
			.eq('language', language)
			.is('deleted_at', null)
			.order('created_at', { ascending: false })
			.limit(1)
			.maybeSingle(),
		locals.supabase
			.from('items')
			.select('id', { count: 'exact', head: true })
			.eq('user_id', user.id)
			.eq('language', language)
			.is('deleted_at', null)
			.gte('created_at', new Date(now.getTime() - WEEK_MS).toISOString()),
		locals.supabase
			.from('works')
			.select('id, title, subtitle')
			.eq('user_id', user.id)
			.eq('kind', 'musica')
			.is('deleted_at', null)
			.not('played_at', 'is', null)
			.order('played_at', { ascending: false })
			.limit(1)
			.maybeSingle(),
		locals.supabase
			.from('api_tokens')
			.select('id', { count: 'exact', head: true })
			.eq('user_id', user.id),
		nextDueText(locals.supabase, user.id, language, now).catch(() => null)
	]);

	const fanRow = (due.data ?? fresh.data) as FanRow | null;
	const encounter = fanRow?.items.encounters[0] ?? null;

	return {
		needsLanguage: false as const,
		next: fanRow
			? {
					lemma: fanRow.items.lemma,
					ipa: fanRow.items.ipa,
					origin: (encounter?.origin ?? 'manual') as Origin,
					source: encounter ? formatWorkSource(encounter.works, encounter.position) : ''
				}
			: null,
		lastItem: last.data ? { lemma: last.data.lemma, at: last.data.created_at } : null,
		savedThisWeek: week.count ?? 0,
		song: song.data,
		stremioConnected: (tokens.count ?? 0) > 0,
		nextDue,
		now: nowIso
	};
};
