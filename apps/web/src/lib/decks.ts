// Decks e orçamento de novas (docs/agents/decks.md, ADR 0005): regras puras que a web,
// o servidor e os testes dividem. O banco fica em lib/server/decks.ts; a ordem da fila em
// lib/server/queue.ts.

import { normalizeText } from './items.ts';

export const NEW_ORDERS = ['importance', 'deck', 'random'] as const;
export type NewOrder = (typeof NEW_ORDERS)[number];

export const LEECH_ACTIONS = ['wait', 'tag', 'suspend'] as const;
export type LeechAction = (typeof LEECH_ACTIONS)[number];

export const DEFAULT_DECK_NAME = 'Minhas palavras';
export const DEFAULT_LEECH_LAPSES = 8;

export const DECK_LIMITS = {
	name: 80,
	newCap: 1000,
	leechLapsesMin: 1,
	leechLapsesMax: 99,
	/** "+5 hoje". */
	extraStep: 5,
	extraMax: 1000
} as const;

/** Deck como a web e o snapshot veem (camelCase). */
export interface Deck {
	id: string;
	language: string;
	name: string;
	parentId: string | null;
	isDefault: boolean;
	paused: boolean;
	newOrder: NewOrder;
	/** Teto de novas por dia do próprio deck; null = só o orçamento do idioma. */
	newCap: number | null;
	onReader: boolean;
	position: number;
	createdAt: string;
}

/** Contagens de um deck para hoje (deck_summaries), sem os subdecks. */
export interface DeckCounts {
	/** Novas disponíveis (sem orçamento nem teto). */
	newAvailable: number;
	/** Novas que entram hoje: min(disponíveis, teto restante, orçamento restante). */
	newToday: number;
	/** Aprendendo/reaprendendo já vencidas (o mesmo corte da sessão). */
	learning: number;
	/** Em revisão já vencidas (um por item). */
	review: number;
	newDoneToday: number;
	items: number;
	fichas: number;
	/** Teimosas em espera ou suspensas. */
	leeches: number;
}

export interface DeckSummary extends Deck {
	counts: DeckCounts;
	/** Próprias + dos subdecks (igual a counts num subdeck). */
	total: DeckCounts;
	depth: 0 | 1;
}

export interface DeckBudget {
	perDay: number;
	extraNew: number;
	newDoneToday: number;
	/** max(0, perDay + extraNew − newDoneToday). */
	newAllowance: number;
}

/** Novas que ainda cabem hoje no idioma. Revisão nunca passa por aqui. */
export function newAllowance(perDay: number, extraNew: number, newDoneToday: number): number {
	return Math.max(0, perDay + extraNew - newDoneToday);
}

export function budget(perDay: number, extraNew: number, newDoneToday: number): DeckBudget {
	return {
		perDay,
		extraNew,
		newDoneToday,
		newAllowance: newAllowance(perDay, extraNew, newDoneToday)
	};
}

/** Quantas novas o teto do deck ainda deixa hoje (Infinity sem teto). */
export function capRemaining(newCap: number | null, doneInDeck: number): number {
	return newCap === null ? Infinity : Math.max(0, newCap - doneInDeck);
}

// ---------- Validação ----------

/** Nome de deck: espaços colapsados, 1 a 80 code points. null se vazio ou longo. */
export function parseDeckName(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	const name = normalizeText(raw).replace(/\s+/g, ' ').trim();
	const n = [...name].length;
	return n >= 1 && n <= DECK_LIMITS.name ? name : null;
}

export function parseNewOrder(raw: unknown): NewOrder | null {
	return NEW_ORDERS.includes(raw as NewOrder) ? (raw as NewOrder) : null;
}

export function parseLeechAction(raw: unknown): LeechAction | null {
	return LEECH_ACTIONS.includes(raw as LeechAction) ? (raw as LeechAction) : null;
}

/** Teto do deck: '' ou null = sem teto; inteiro 0–1000. undefined se inválido. */
export function parseNewCap(raw: unknown): number | null | undefined {
	if (raw === null || raw === '' || raw === undefined) return null;
	const n = typeof raw === 'number' ? raw : Number(raw);
	return Number.isInteger(n) && n >= 0 && n <= DECK_LIMITS.newCap ? n : undefined;
}

export function parseLeechLapses(raw: unknown): number | null {
	const n = typeof raw === 'number' ? raw : Number(raw);
	return Number.isInteger(n) && n >= DECK_LIMITS.leechLapsesMin && n <= DECK_LIMITS.leechLapsesMax
		? n
		: null;
}

/**
 * Caminho de deck do Anki → [pai, filho] como o banco cria (deck_for_path): um nível só,
 * o resto achatado no nome do filho ("A::B::C" → ["A", "B::C"]). Vazio = deck padrão.
 */
export function ankiDeckPath(path: string): string[] {
	const parts = path
		.split('::')
		.map((p) => [...p.trim()].slice(0, DECK_LIMITS.name).join(''))
		.filter(Boolean);
	if (parts.length <= 1) return parts;
	return [parts[0], [...parts.slice(1).join('::')].slice(0, DECK_LIMITS.name).join('')];
}

// ---------- Árvore ----------

/** Pais na ordem (posição, criação), cada um seguido dos filhos. */
export function deckTree<T extends Pick<Deck, 'id' | 'parentId' | 'position' | 'createdAt'>>(
	decks: readonly T[]
): T[] {
	const byOrder = (a: T, b: T) =>
		a.position - b.position || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
	const ids = new Set(decks.map((d) => d.id));
	const roots = decks.filter((d) => !d.parentId || !ids.has(d.parentId)).sort(byOrder);
	return roots.flatMap((root) => [
		root,
		...decks.filter((d) => d.parentId === root.id).sort(byOrder)
	]);
}

/** Pausado, ou filho de um pausado: fora de "Estudar tudo" e do leitor. */
export function isPausedIn(
	deck: Pick<Deck, 'paused' | 'parentId'>,
	decks: readonly Deck[]
): boolean {
	if (deck.paused) return true;
	return !!deck.parentId && !!decks.find((d) => d.id === deck.parentId)?.paused;
}

const ZERO: DeckCounts = {
	newAvailable: 0,
	newToday: 0,
	learning: 0,
	review: 0,
	newDoneToday: 0,
	items: 0,
	fichas: 0,
	leeches: 0
};

function add(a: DeckCounts, b: DeckCounts): DeckCounts {
	const out = { ...a };
	for (const k of Object.keys(ZERO) as (keyof DeckCounts)[]) out[k] = a[k] + b[k];
	return out;
}

/**
 * Linhas da tela de decks: árvore, contagens próprias e totais com os subdecks. newToday
 * respeita o teto de cada deck e o orçamento restante do idioma (o pai não passa dele).
 */
export function summarizeDecks(
	decks: readonly Deck[],
	raw: ReadonlyMap<string, Omit<DeckCounts, 'newToday'>>,
	allowance: number
): DeckSummary[] {
	const own = new Map<string, DeckCounts>();
	for (const d of decks) {
		const c = raw.get(d.id) ?? ZERO;
		const newToday = Math.min(c.newAvailable, capRemaining(d.newCap, c.newDoneToday), allowance);
		own.set(d.id, { ...ZERO, ...c, newToday });
	}
	return deckTree(decks).map((d) => {
		const counts = own.get(d.id)!;
		const children = decks.filter((c) => c.parentId === d.id);
		const total = children.reduce((t, c) => add(t, own.get(c.id)!), counts);
		return {
			...d,
			counts,
			total: { ...total, newToday: Math.min(total.newToday, allowance) },
			depth: d.parentId ? 1 : 0
		};
	});
}

/** Erros das funções de deck, em PT. */
export function deckErrorMessage(code: string | undefined): string {
	switch (code) {
		case 'deck_default':
			return 'O deck padrão não pode ser apagado. Escolha outro padrão antes.';
		case 'deck_parent':
			return 'Subdeck só fica dentro de um deck de topo do mesmo idioma.';
		case 'deck_language':
			return 'O deck é de outro idioma.';
		case 'deck_not_found':
			return 'Deck não encontrado.';
		case 'deck_name_taken':
			return 'Já existe um deck com esse nome.';
		case 'deck_name':
			return 'Dê um nome de 1 a 80 caracteres.';
		default:
			return 'Não deu para salvar o deck agora.';
	}
}
