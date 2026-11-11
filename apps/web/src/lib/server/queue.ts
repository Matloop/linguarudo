// Fila do dia (ADR 0005): o servidor decide quais novas entram e em que ordem. Puro: recebe
// o estado de queue_state / api_sync_snapshot e devolve a ordem. Vencidas e irmãos de
// aprendizado continuam em buildQueue (review.ts).

import {
	capRemaining,
	deckTree,
	isPausedIn,
	newAllowance,
	parseLeechAction,
	parseNewOrder,
	DEFAULT_LEECH_LAPSES,
	type Deck,
	type LeechAction,
	type NewOrder
} from '#lib/decks.ts';

/** Bônus de importância quando o encontro mais recente é da obra ativa. */
export const ACTIVE_WORK_BONUS = 3;
/** Novas por sessão "Desta obra" (contam como extra). */
export const OBRA_SESSION_NEW = 10;

export interface QueueCandidate {
	id: string;
	itemId: string | null;
	fichaId: string | null;
	kind: string;
	ord: number;
	deckId: string;
	createdAt: string;
	encounters: number;
	works: number;
	lastWorkId: string | null;
	/** Irmão revisado hoje: fica para amanhã. */
	buried: boolean;
}

export interface QueueSettings {
	perDay: number;
	newOrder: NewOrder;
	leechLapses: number;
	leechAction: LeechAction;
}

export interface QueueState {
	settings: QueueSettings;
	/** Data local do dia de estudo (YYYY-MM-DD): semente do "random". */
	dayKey: string;
	extraNew: number;
	newDoneByDeck: Record<string, number>;
	activeWorkId: string | null;
	decks: Deck[];
	candidates: QueueCandidate[];
}

export type QueueScope =
	| { kind: 'all' }
	| { kind: 'deck'; deckId: string }
	/** Novas dos itens com encontro na obra; fora do orçamento (contam como extra). */
	| { kind: 'obra'; workId: string; itemIds: ReadonlySet<string> };

// ---------- Estado vindo do banco ----------

type Raw = Record<string, unknown>;

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const strOrNull = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null);

function toDeck(r: Raw, language: string): Deck {
	return {
		id: String(r.id),
		language,
		name: String(r.name ?? ''),
		parentId: strOrNull(r.parentId),
		isDefault: r.default === true,
		paused: r.paused === true,
		newOrder: parseNewOrder(r.newOrder) ?? 'importance',
		newCap: typeof r.newCap === 'number' ? r.newCap : null,
		onReader: r.onReader !== false,
		position: num(r.position),
		createdAt: String(r.createdAt ?? '')
	};
}

/** jsonb de queue_state_for → QueueState (campos ausentes viram padrão). */
export function parseQueueState(raw: unknown, language: string): QueueState {
	const r = (raw ?? {}) as Raw;
	const s = (r.settings ?? {}) as Raw;
	const done = (r.newDoneByDeck ?? {}) as Record<string, unknown>;
	return {
		settings: {
			perDay: num(s.perDay, 10),
			newOrder: parseNewOrder(s.newOrder) ?? 'importance',
			leechLapses: num(s.leechLapses, DEFAULT_LEECH_LAPSES),
			leechAction: parseLeechAction(s.leechAction) ?? 'wait'
		},
		dayKey: String(r.dayKey ?? ''),
		extraNew: num(r.extraNew),
		newDoneByDeck: Object.fromEntries(Object.entries(done).map(([k, v]) => [k, num(v)])),
		activeWorkId: strOrNull(r.activeWorkId),
		decks: ((r.decks ?? []) as Raw[]).map((d) => toDeck(d, language)),
		candidates: ((r.candidates ?? []) as Raw[]).map((c) => ({
			id: String(c.id),
			itemId: strOrNull(c.itemId),
			fichaId: strOrNull(c.fichaId),
			kind: String(c.kind ?? ''),
			ord: num(c.ord),
			deckId: String(c.deckId),
			createdAt: String(c.createdAt ?? ''),
			encounters: num(c.encounters),
			works: num(c.works),
			lastWorkId: strOrNull(c.lastWorkId),
			buried: c.buried === true
		}))
	};
}

// ---------- Orçamento ----------

export function newDoneToday(state: Pick<QueueState, 'newDoneByDeck'>): number {
	return Object.values(state.newDoneByDeck).reduce((a, b) => a + b, 0);
}

export function stateAllowance(state: QueueState): number {
	return newAllowance(state.settings.perDay, state.extraNew, newDoneToday(state));
}

// ---------- Ordem ----------

/** encontros + 2 × obras distintas + bônus se o último encontro é da obra ativa. */
export function importance(c: QueueCandidate, activeWorkId: string | null): number {
	const bonus = activeWorkId && c.lastWorkId === activeWorkId ? ACTIVE_WORK_BONUS : 0;
	return c.encounters + 2 * c.works + bonus;
}

/** FNV-1a de 32 bits: a ordem "random" é estável no mesmo dia e muda no outro. */
export function stableHash(s: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h >>> 0;
}

const byCreated = (a: QueueCandidate, b: QueueCandidate) =>
	Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.ord - b.ord || a.id.localeCompare(b.id);

function comparator(order: NewOrder, state: QueueState) {
	const score = new Map(state.candidates.map((c) => [c.id, importance(c, state.activeWorkId)]));
	const hash = (c: QueueCandidate) => stableHash(`${c.id}:${state.dayKey}`);
	switch (order) {
		case 'importance':
			return (a: QueueCandidate, b: QueueCandidate) =>
				score.get(b.id)! - score.get(a.id)! || byCreated(a, b);
		case 'random':
			return (a: QueueCandidate, b: QueueCandidate) => hash(a) - hash(b) || byCreated(a, b);
		default:
			return byCreated;
	}
}

/** Sem irmão revisado hoje e um flashcard novo por item (o primeiro da ordem). */
function oncePerItem(list: QueueCandidate[]): QueueCandidate[] {
	const taken = new Set<string>();
	return list.filter((c) => {
		if (c.buried) return false;
		if (!c.itemId) return true;
		if (taken.has(c.itemId)) return false;
		taken.add(c.itemId);
		return true;
	});
}

/** Decks do escopo: tudo = não pausados; um deck = ele e os subdecks (mesmo pausados). */
export function scopeDeckIds(decks: readonly Deck[], scope: QueueScope): Set<string> {
	if (scope.kind === 'deck') {
		return new Set(
			decks.filter((d) => d.id === scope.deckId || d.parentId === scope.deckId).map((d) => d.id)
		);
	}
	return new Set(decks.filter((d) => !isPausedIn(d, decks)).map((d) => d.id));
}

/**
 * Todas as novas dos decks dados, em ordem: cada deck ordenado pela própria regra e cortado
 * pelo teto restante, depois os decks intercalados pela ordem da conta (importância: a
 * cabeça de maior pontuação; deck: um deck depois do outro; random: hash do dia).
 */
export function orderNew(state: QueueState, deckIds: ReadonlySet<string>): QueueCandidate[] {
	const decks = deckTree(state.decks).filter((d) => deckIds.has(d.id));
	const lists = decks
		.map((d) => {
			const own = state.candidates
				.filter((c) => c.deckId === d.id)
				.sort(comparator(d.newOrder, state));
			const cap = capRemaining(d.newCap, state.newDoneByDeck[d.id] ?? 0);
			return oncePerItem(own).slice(0, cap === Infinity ? undefined : cap);
		})
		.filter((l) => l.length > 0);

	if (state.settings.newOrder === 'deck') return lists.flat();
	const pick = comparator(state.settings.newOrder, state);
	const out: QueueCandidate[] = [];
	const heads = lists.map(() => 0);
	for (;;) {
		let best = -1;
		for (let i = 0; i < lists.length; i++) {
			if (heads[i] >= lists[i].length) continue;
			if (best < 0 || pick(lists[i][heads[i]], lists[best][heads[best]]) < 0) best = i;
		}
		if (best < 0) return out;
		out.push(lists[best][heads[best]++]);
	}
}

export interface NewPlan {
	/** Flashcards novos da sessão, na ordem. */
	ids: string[];
	/** Orçamento restante do idioma antes da sessão. */
	newAllowance: number;
	newDoneToday: number;
	/** Novas que existem no escopo além das que entram (para "+5 hoje"). */
	more: number;
	/** Decks do escopo (as vencidas também se limitam a eles). */
	deckIds: Set<string>;
}

/** As novas da sessão no escopo. "Desta obra" ignora orçamento e tetos. */
export function planNew(state: QueueState, scope: QueueScope): NewPlan {
	const allowance = stateAllowance(state);
	const done = newDoneToday(state);
	if (scope.kind === 'obra') {
		const all = new Set(state.decks.map((d) => d.id));
		const list = oncePerItem(
			state.candidates
				.filter((c) => c.itemId && scope.itemIds.has(c.itemId) && all.has(c.deckId))
				.sort(comparator('importance', state))
		);
		return {
			ids: list.slice(0, OBRA_SESSION_NEW).map((c) => c.id),
			newAllowance: allowance,
			newDoneToday: done,
			more: Math.max(0, list.length - OBRA_SESSION_NEW),
			deckIds: all
		};
	}
	const deckIds = scopeDeckIds(state.decks, scope);
	const list = orderNew(state, deckIds);
	return {
		ids: list.slice(0, allowance).map((c) => c.id),
		newAllowance: allowance,
		newDoneToday: done,
		more: Math.max(0, list.length - allowance),
		deckIds
	};
}

/** Flashcards que o leitor revisa: Reconhecer, frente e lacuna (a primeira, na linha). */
const READER_KINDS = new Set(['reconhecer', 'frente', 'lacuna']);

/**
 * queueRank do snapshot: 1 = primeira nova, só decks do leitor (on_reader e não pausados),
 * tetos aplicados, sem cortar no orçamento (o leitor corta com today.newAllowance).
 * Flashcard fora do mapa: não é nova ou não entra hoje (rank null).
 */
export function readerRanks(state: QueueState): Map<string, number> {
	const ids = new Set(
		state.decks.filter((d) => d.onReader && !isPausedIn(d, state.decks)).map((d) => d.id)
	);
	const firstLacuna = new Map<string, number>();
	for (const c of state.candidates) {
		if (c.kind === 'lacuna' && c.fichaId) {
			firstLacuna.set(c.fichaId, Math.min(firstLacuna.get(c.fichaId) ?? Infinity, c.ord));
		}
	}
	const visible = orderNew(state, ids).filter(
		(c) =>
			READER_KINDS.has(c.kind) && (c.kind !== 'lacuna' || firstLacuna.get(c.fichaId!) === c.ord)
	);
	return new Map(visible.map((c, i) => [c.id, i + 1]));
}

/** Decks no cabeçalho do snapshot: on_reader e não pausados (nem filhos de pausado). */
export function readerDecks(state: QueueState): Deck[] {
	return deckTree(state.decks).filter((d) => d.onReader && !isPausedIn(d, state.decks));
}
