import { error, fail } from '@sveltejs/kit';
import { generateToken } from '#lib/server/tokens.ts';
import { formatWorkSource, normalizeLemma } from '#lib/items.ts';
import type { Actions, PageServerLoad } from './$types';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '#lib/database.types.ts';

const LABEL_MAX = 60;

async function requireUser(locals: App.Locals) {
	const user = await locals.getUser();
	if (!user) error(401, 'Entre para ver suas integrações.');
	return user;
}

/** O que chega pelo LingoBlend (Stremio) entra com uma destas origens. */
const STREMIO_ORIGINS = ['stremio', 'blend'];

type SourceKey = 'tv' | 'mu' | 'mao' | 'er';

/** Origem do encontro → fonte da barra. Anki (importação) conta como "à mão". */
const SOURCE_OF: Record<string, SourceKey> = {
	stremio: 'tv',
	blend: 'tv',
	musica: 'mu',
	manual: 'mao',
	anki: 'mao',
	ereader: 'er',
	leitor: 'er'
};

const PAGE = 1000;

/**
 * Quantas palavras vieram de cada fonte. Cada palavra conta uma vez, pela origem do
 * primeiro encontro (sem encontro: à mão). Pagina porque o PostgREST corta em 1000 linhas.
 */
async function wordSources(supabase: SupabaseClient<Database>, userId: string) {
	const counts: Record<SourceKey, number> = { tv: 0, mu: 0, mao: 0, er: 0 };
	for (let from = 0; ; from += PAGE) {
		const { data, error: dbError } = await supabase
			.from('items')
			.select('id, encounters(origin, seen_at)')
			.eq('user_id', userId)
			.is('deleted_at', null)
			.is('encounters.deleted_at', null)
			.order('id')
			.order('seen_at', { referencedTable: 'encounters', ascending: true })
			.limit(1, { referencedTable: 'encounters' })
			.range(from, from + PAGE - 1);
		if (dbError) return null;
		for (const row of data) {
			counts[SOURCE_OF[row.encounters[0]?.origin ?? 'manual'] ?? 'mao']++;
		}
		if (data.length < PAGE) return counts;
	}
}

export const load: PageServerLoad = async ({ locals }) => {
	const user = await requireUser(locals);
	const [tokens, words, last, sources] = await Promise.all([
		locals.supabase
			.from('api_tokens')
			.select('id, label, token_hint, created_at, last_used_at, kind, device_model')
			.eq('user_id', user.id)
			.order('created_at', { ascending: false }),
		locals.supabase
			.from('items')
			.select('id, encounters!inner(origin)', { count: 'exact', head: true })
			.eq('user_id', user.id)
			.is('deleted_at', null)
			.in('encounters.origin', STREMIO_ORIGINS),
		locals.supabase
			.from('encounters')
			.select('seen_at, position, items!inner(lemma, deleted_at), works(title, subtitle)')
			.eq('user_id', user.id)
			.is('deleted_at', null)
			.is('items.deleted_at', null)
			.in('origin', STREMIO_ORIGINS)
			.order('seen_at', { ascending: false })
			.limit(1)
			.maybeSingle(),
		wordSources(locals.supabase, user.id)
	]);
	if (tokens.error) error(500, 'Não deu para carregar suas integrações agora.');
	const lastRow = last.data as {
		seen_at: string;
		position: unknown;
		items: { lemma: string };
		works: { title: string; subtitle: string } | null;
	} | null;
	// Tokens do Stremio (gerados aqui) e aparelhos pareados (e-reader) aparecem à parte.
	const strip = ({ kind: _kind, device_model: _model, ...t }: (typeof tokens.data)[number]) => t;
	return {
		tokens: tokens.data.filter((t) => t.kind !== 'aparelho').map(strip),
		devices: tokens.data
			.filter((t) => t.kind === 'aparelho')
			.map((t) => ({ ...strip(t), model: t.device_model })),
		stremio: {
			words: words.count ?? 0,
			last: lastRow
				? {
						lemma: lastRow.items.lemma,
						source: formatWorkSource(lastRow.works, lastRow.position),
						at: lastRow.seen_at
					}
				: null
		},
		sources,
		now: new Date().toISOString()
	};
};

export const actions: Actions = {
	create: async ({ locals, request }) => {
		const user = await requireUser(locals);
		const raw = (await request.formData()).get('label');
		const label =
			[...normalizeLemma(typeof raw === 'string' ? raw : '')].slice(0, LABEL_MAX).join('') ||
			'Stremio';

		const { token, hash, hint } = generateToken();
		const { error: dbError } = await locals.supabase
			.from('api_tokens')
			.insert({ user_id: user.id, label, token_hash: hash, token_hint: hint });
		if (dbError) {
			return fail(500, { action: 'create' as const, message: 'Não deu para gerar agora.' });
		}
		// Só aqui o token aparece. O banco guarda o hash.
		return { action: 'create' as const, token, label };
	},

	revoke: async ({ locals, request }) => {
		const user = await requireUser(locals);
		const id = (await request.formData()).get('id');
		if (typeof id !== 'string' || id === '') {
			return fail(400, { action: 'revoke' as const, message: 'Token não encontrado.' });
		}
		const { data, error: dbError } = await locals.supabase
			.from('api_tokens')
			.delete()
			.eq('id', id)
			.eq('user_id', user.id)
			.select('id');
		if (dbError || data.length === 0) {
			return fail(dbError ? 500 : 404, {
				action: 'revoke' as const,
				message: 'Não deu para revogar agora.'
			});
		}
		return { action: 'revoke' as const, revoked: id };
	}
};
