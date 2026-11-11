// Decks no banco (docs/agents/decks.md): o que a UI chama. Tudo com o cliente do usuário
// (RLS); apagar, trocar o padrão, extras e teimosas passam por funções do banco.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '#lib/database.types.ts';
import {
	budget,
	DECK_LIMITS,
	deckErrorMessage,
	parseDeckName,
	parseLeechAction,
	parseLeechLapses,
	parseNewCap,
	parseNewOrder,
	summarizeDecks,
	type Deck,
	type DeckBudget,
	type DeckSummary,
	type LeechAction,
	type NewOrder
} from '#lib/decks.ts';
import type { Language } from '#lib/languages.ts';
import { dayStart, nextDayStart, DEFAULT_CLOCK, type DayClock } from '#lib/review.ts';
import { parseQueueState, type QueueState } from './queue.ts';

type Client = SupabaseClient<Database>;
type DeckRow = Database['public']['Tables']['decks']['Row'];

/** Resultado das ações: ok, ou o erro em PT para mostrar. */
export type DeckResult<T = void> =
	{ ok: true; value: T } | { ok: false; code: string; message: string };

function ok<T>(value: T): DeckResult<T> {
	return { ok: true, value };
}

function failure<T>(raw: { message?: string; code?: string } | null | undefined): DeckResult<T> {
	// Nome repetido no mesmo nível (decks_name_key).
	const code = raw?.code === '23505' ? 'deck_name_taken' : (raw?.message ?? 'unknown');
	return { ok: false, code, message: deckErrorMessage(code) };
}

export function toDeck(r: DeckRow): Deck {
	return {
		id: r.id,
		language: r.language,
		name: r.name,
		parentId: r.parent_id,
		isDefault: r.is_default,
		paused: r.paused,
		newOrder: parseNewOrder(r.new_order) ?? 'importance',
		newCap: r.new_cap,
		onReader: r.on_reader,
		position: r.position,
		createdAt: r.created_at
	};
}

/** Decks do idioma, em ordem (posição, criação). */
export async function listDecks(supabase: Client, language: Language): Promise<Deck[]> {
	const { data, error } = await supabase
		.from('decks')
		.select('*')
		.eq('language', language)
		.order('position')
		.order('created_at');
	if (error) throw new Error(`decks: ${error.message}`);
	return data.map(toDeck);
}

/** Deck padrão do idioma ("Minhas palavras"); o banco cria se faltar. */
export async function defaultDeckId(supabase: Client, language: Language): Promise<string> {
	const { data, error } = await supabase.rpc('default_deck', { p_language: language });
	if (error || !data) throw new Error(`default_deck: ${error?.message ?? 'vazio'}`);
	return data;
}

export interface DeckOverview {
	decks: DeckSummary[];
	budget: DeckBudget;
}

/**
 * Tela de decks: cada deck com novas/aprendendo/revisar de hoje (pais somam os filhos em
 * total) e o orçamento do idioma (newAllowance, newDoneToday).
 */
export async function loadDeckSummaries(
	supabase: Client,
	language: Language,
	now: Date,
	clock: DayClock = DEFAULT_CLOCK
): Promise<DeckOverview> {
	const start = dayStart(now, clock);
	const [decks, sums, counts] = await Promise.all([
		listDecks(supabase, language),
		supabase.rpc('deck_summaries', {
			p_day_start: start.toISOString(),
			p_next_day_start: nextDayStart(now, clock).toISOString(),
			p_language: language
		}),
		supabase
			.rpc('review_counts', { p_day_start: start.toISOString(), p_language: language })
			.single()
	]);
	if (sums.error || counts.error || !counts.data) throw new Error('deck_summaries');
	const raw = new Map(
		sums.data.map((s) => [
			s.deck_id,
			{
				newAvailable: s.new_available,
				learning: s.learning_due,
				review: s.review_due,
				newDoneToday: s.new_done_today,
				items: s.items,
				fichas: s.fichas,
				leeches: s.leeches
			}
		])
	);
	const b = budget(counts.data.new_limit, counts.data.extra_new, counts.data.new_done_today);
	return { decks: summarizeDecks(decks, raw, b.newAllowance), budget: b };
}

/** Estado da fila do idioma no dia de estudo (decks, orçamento, candidatas a nova). */
export async function loadQueueState(
	supabase: Client,
	language: Language,
	now: Date,
	clock: DayClock = DEFAULT_CLOCK
): Promise<QueueState> {
	const { data, error } = await supabase.rpc('queue_state', {
		p_language: language,
		p_day_start: dayStart(now, clock).toISOString()
	});
	if (error) throw new Error(`queue_state: ${error.message}`);
	return parseQueueState(data, language);
}

/** Itens do usuário com algum encontro na obra ("Desta obra"). */
export async function itemsOfWork(supabase: Client, workId: string): Promise<Set<string>> {
	const { data, error } = await supabase
		.from('encounters')
		.select('item_id')
		.eq('work_id', workId)
		.is('deleted_at', null)
		.limit(5000);
	if (error) throw new Error(`encounters: ${error.message}`);
	return new Set(data.map((e) => e.item_id));
}

export async function createDeck(
	supabase: Client,
	userId: string,
	input: { language: Language; name: string; parentId?: string | null; newOrder?: NewOrder }
): Promise<DeckResult<Deck>> {
	const name = parseDeckName(input.name);
	if (!name) return failure({ message: 'deck_name' });
	const { data: last } = await supabase
		.from('decks')
		.select('position')
		.eq('language', input.language)
		.order('position', { ascending: false })
		.limit(1)
		.maybeSingle();
	const { data, error } = await supabase
		.from('decks')
		.insert({
			user_id: userId,
			language: input.language,
			name,
			parent_id: input.parentId ?? null,
			new_order: input.newOrder ?? 'importance',
			position: (last?.position ?? 0) + 1
		})
		.select('*')
		.single();
	return error ? failure(error) : ok(toDeck(data));
}

export async function renameDeck(
	supabase: Client,
	deckId: string,
	rawName: string
): Promise<DeckResult> {
	const name = parseDeckName(rawName);
	if (!name) return failure({ message: 'deck_name' });
	return update(supabase, deckId, { name });
}

export async function setDeckPaused(
	supabase: Client,
	deckIds: readonly string[],
	paused: boolean
): Promise<DeckResult<number>> {
	const { data, error } = await supabase
		.from('decks')
		.update({ paused })
		.in('id', [...deckIds])
		.select('id');
	return error ? failure(error) : ok(data.length);
}

export interface DeckOptions {
	newOrder?: NewOrder;
	/** null = sem teto. */
	newCap?: number | null;
	onReader?: boolean;
	/** null = deck de topo. */
	parentId?: string | null;
	position?: number;
}

/** Opções do deck; campos ausentes ficam como estão. Valores inválidos recusam tudo. */
export async function setDeckOptions(
	supabase: Client,
	deckId: string,
	options: DeckOptions
): Promise<DeckResult> {
	const patch: Database['public']['Tables']['decks']['Update'] = {};
	if (options.newOrder !== undefined) {
		const order = parseNewOrder(options.newOrder);
		if (!order) return failure({ message: 'bad_request' });
		patch.new_order = order;
	}
	if (options.newCap !== undefined) {
		const cap = parseNewCap(options.newCap);
		if (cap === undefined) return failure({ message: 'bad_request' });
		patch.new_cap = cap;
	}
	if (options.onReader !== undefined) patch.on_reader = options.onReader;
	if (options.parentId !== undefined) patch.parent_id = options.parentId;
	if (options.position !== undefined) patch.position = Math.trunc(options.position);
	return update(supabase, deckId, patch);
}

async function update(
	supabase: Client,
	deckId: string,
	patch: Database['public']['Tables']['decks']['Update']
): Promise<DeckResult> {
	const { data, error } = await supabase.from('decks').update(patch).eq('id', deckId).select('id');
	if (error) return failure(error);
	return data.length ? ok(undefined) : failure({ message: 'deck_not_found' });
}

export async function setDefaultDeck(supabase: Client, deckId: string): Promise<DeckResult> {
	const { error } = await supabase.rpc('set_default_deck', { p_deck: deckId });
	return error ? failure(error) : ok(undefined);
}

/**
 * Apaga um deck não padrão (e os subdecks). 'move' leva itens e fichas ao padrão; 'delete'
 * apaga junto. Devolve quantos itens + fichas foram afetados.
 */
export async function deleteDeck(
	supabase: Client,
	deckId: string,
	mode: 'move' | 'delete'
): Promise<DeckResult<number>> {
	const { data, error } = await supabase.rpc('delete_deck', { p_deck: deckId, p_mode: mode });
	return error ? failure(error) : ok(data ?? 0);
}

/** Move itens e fichas para um deck do mesmo idioma (o Reconhecer e o Produzir vão juntos). */
export async function moveToDeck(
	supabase: Client,
	deckId: string,
	ids: { itemIds?: readonly string[]; fichaIds?: readonly string[] }
): Promise<DeckResult<number>> {
	let moved = 0;
	if (ids.itemIds?.length) {
		const { data, error } = await supabase
			.from('items')
			.update({ deck_id: deckId })
			.in('id', [...ids.itemIds])
			.select('id');
		if (error) return failure(error);
		moved += data.length;
	}
	if (ids.fichaIds?.length) {
		const { data, error } = await supabase
			.from('fichas')
			.update({ deck_id: deckId })
			.in('id', [...ids.fichaIds])
			.select('id');
		if (error) return failure(error);
		moved += data.length;
	}
	return ok(moved);
}

/** "+5 hoje": soma ao extra do dia de estudo no idioma. Devolve o extra do dia. */
export async function addExtraNew(
	supabase: Client,
	language: Language,
	now: Date,
	clock: DayClock = DEFAULT_CLOCK,
	n: number = DECK_LIMITS.extraStep
): Promise<DeckResult<number>> {
	if (!Number.isInteger(n) || n < 1 || n > DECK_LIMITS.extraMax)
		return failure({ message: 'bad_request' });
	const { data, error } = await supabase.rpc('add_extra_new', {
		p_language: language,
		p_n: n,
		p_day_start: dayStart(now, clock).toISOString()
	});
	return error ? failure(error) : ok(data ?? 0);
}

export interface StudySettings {
	newFlashcardsPerDay?: number;
	/** Como "Estudar tudo" intercala os decks. */
	newOrder?: NewOrder;
	leechLapses?: number;
	leechAction?: LeechAction;
}

/** Configurações da fila em user_settings. Valores inválidos recusam tudo. */
export async function updateStudySettings(
	supabase: Client,
	userId: string,
	s: StudySettings
): Promise<DeckResult> {
	const patch: Database['public']['Tables']['user_settings']['Update'] = {};
	if (s.newFlashcardsPerDay !== undefined) {
		const n = s.newFlashcardsPerDay;
		if (!Number.isInteger(n) || n < 0 || n > 1000) return failure({ message: 'bad_request' });
		patch.new_flashcards_per_day = n;
	}
	if (s.newOrder !== undefined) {
		const order = parseNewOrder(s.newOrder);
		if (!order) return failure({ message: 'bad_request' });
		patch.new_order = order;
	}
	if (s.leechLapses !== undefined) {
		const lapses = parseLeechLapses(s.leechLapses);
		if (lapses === null) return failure({ message: 'bad_request' });
		patch.leech_lapses = lapses;
	}
	if (s.leechAction !== undefined) {
		const action = parseLeechAction(s.leechAction);
		if (!action) return failure({ message: 'bad_request' });
		patch.leech_action = action;
	}
	const { error } = await supabase.from('user_settings').update(patch).eq('user_id', userId);
	return error ? failure(error) : ok(undefined);
}

/** "Voltar para a fila": tira teimosas da espera (ou da suspensão). */
export async function releaseLeeches(
	supabase: Client,
	ids: { itemIds?: readonly string[]; fichaIds?: readonly string[] }
): Promise<DeckResult<number>> {
	const { data, error } = await supabase.rpc('release_leeches', {
		p_item_ids: [...(ids.itemIds ?? [])],
		p_ficha_ids: [...(ids.fichaIds ?? [])]
	});
	return error ? failure(error) : ok(data ?? 0);
}
