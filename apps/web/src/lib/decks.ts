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
/** Padrões do Geral (user_settings), como no Anki. */
export const DEFAULT_NEW_PER_DAY = 20;
export const DEFAULT_REVIEWS_PER_DAY = 200;

export const DECK_LIMITS = {
	name: 80,
	newPerDay: 1000,
	reviewsPerDay: 9999,
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
	/** "Este baralho": novas por dia do próprio deck; null = segue o Geral. */
	newPerDay: number | null;
	/** "Este baralho": revisões máximas por dia; null = segue o Geral. */
	reviewsPerDay: number | null;
	/** "Só hoje" (já filtrado para o dia de estudo corrente); null = não há. */
	newPerDayToday: number | null;
	reviewsPerDayToday: number | null;
	onReader: boolean;
	position: number;
	createdAt: string;
}

/** Contagens de um deck para hoje (deck_summaries), sem os subdecks. */
export interface DeckCounts {
	/** Novas disponíveis (sem limite). */
	newAvailable: number;
	/** Novas que entram hoje: min(disponíveis, o que o deck e o pai ainda deixam). */
	newToday: number;
	/** Aprendendo/reaprendendo já vencidas, no instante (o mesmo corte da sessão, isDue). */
	learning: number;
	/** Revisões que vencem até o fim do dia de estudo (isDue; um por item), sem limite. */
	reviewAvailable: number;
	/** Revisões servidas hoje: reviewAvailable cortado pelo limite de revisões. */
	review: number;
	newDoneToday: number;
	reviewDoneToday: number;
	items: number;
	fichas: number;
	/** Flashcards do deck (todos os estados, sem os apagados). */
	flashcards: number;
	/** Teimosas em espera ou suspensas. */
	leeches: number;
}

/** Contagens cruas do banco (deck_summaries); newToday e review saem dos limites. */
export type RawDeckCounts = Omit<DeckCounts, 'newToday' | 'review'>;

// ---------- Limites diários ----------

/** De onde vem o limite: o Geral da conta, o do baralho ou o "Só hoje" do baralho. */
export const LIMIT_MODES = ['geral', 'deck', 'hoje'] as const;
export type LimitMode = (typeof LIMIT_MODES)[number];
export type LimitKind = 'new' | 'reviews';

/** Limites do Geral (user_settings). */
export interface GeneralLimits {
	newPerDay: number;
	reviewsPerDay: number;
}

export interface Limit {
	value: number;
	mode: LimitMode;
}

/** Limite que vale hoje para o deck: Só hoje > Este baralho > Geral. */
export function deckLimit(
	deck: Pick<Deck, 'newPerDay' | 'reviewsPerDay' | 'newPerDayToday' | 'reviewsPerDayToday'>,
	kind: LimitKind,
	general: GeneralLimits
): Limit {
	const today = kind === 'new' ? deck.newPerDayToday : deck.reviewsPerDayToday;
	if (today !== null) return { value: today, mode: 'hoje' };
	const own = kind === 'new' ? deck.newPerDay : deck.reviewsPerDay;
	if (own !== null) return { value: own, mode: 'deck' };
	return { value: kind === 'new' ? general.newPerDay : general.reviewsPerDay, mode: 'geral' };
}

/**
 * Vagas de hoje por deck, para cortar uma fila: cada deck deixa limite (+ extra do dia, nas
 * novas) − o que já foi feito nele e nos subdecks (o filho conta contra o pai, como no Anki).
 * Um flashcard só entra se o deck dele e o pai ainda têm vaga, e se o total cabe em `max`.
 */
export interface DeckQuota {
	left: ReadonlyMap<string, number>;
	parentOf: ReadonlyMap<string, string>;
	/** Teto da sessão inteira ("Estudar tudo": o Geral do idioma); Infinity num deck só. */
	max: number;
}

export function deckQuota(
	decks: readonly Deck[],
	kind: LimitKind,
	general: GeneralLimits,
	doneByDeck: Readonly<Record<string, number>>,
	opts: { extra?: number; max?: number } = {}
): DeckQuota {
	const ids = new Set(decks.map((d) => d.id));
	const parentOf = new Map<string, string>();
	for (const d of decks) if (d.parentId && ids.has(d.parentId)) parentOf.set(d.id, d.parentId);
	const done = new Map<string, number>();
	for (const d of decks) {
		const n = doneByDeck[d.id] ?? 0;
		done.set(d.id, (done.get(d.id) ?? 0) + n);
		const p = parentOf.get(d.id);
		if (p) done.set(p, (done.get(p) ?? 0) + n);
	}
	const left = new Map(
		decks.map((d) => [
			d.id,
			Math.max(0, deckLimit(d, kind, general).value + (opts.extra ?? 0) - (done.get(d.id) ?? 0))
		])
	);
	return { left, parentOf, max: Math.max(0, opts.max ?? Infinity) };
}

/** Quantas ainda cabem hoje estudando este deck: o deck, o pai e o teto da sessão. */
export function quotaLeft(q: DeckQuota, deckId: string): number {
	const p = q.parentOf.get(deckId);
	return Math.min(q.left.get(deckId) ?? 0, p ? (q.left.get(p) ?? 0) : Infinity, q.max);
}

/** Corta a lista (já em ordem) nas vagas: entra se o deck, o pai e o total ainda deixam. */
export function takeWithin<T>(list: readonly T[], deckOf: (t: T) => string, q: DeckQuota): T[] {
	const left = new Map(q.left);
	const out: T[] = [];
	for (const t of list) {
		if (out.length >= q.max) break;
		const d = deckOf(t);
		const p = q.parentOf.get(d);
		if ((left.get(d) ?? 0) <= 0 || (p && (left.get(p) ?? 0) <= 0)) continue;
		left.set(d, left.get(d)! - 1);
		if (p) left.set(p, left.get(p)! - 1);
		out.push(t);
	}
	return out;
}

export interface DeckLimitsView {
	new: Limit;
	reviews: Limit;
	/** Vagas do próprio deck hoje (com os subdecks). */
	newLeft: number;
	reviewsLeft: number;
}

export interface DeckSummary extends Deck {
	counts: DeckCounts;
	/** Próprias + dos subdecks (igual a counts num subdeck). */
	total: DeckCounts;
	depth: 0 | 1;
	limits: DeckLimitsView;
}

/** Orçamento do idioma ("Estudar tudo"): o Geral menos o feito hoje em todos os decks. */
export interface DeckBudget {
	perDay: number;
	extraNew: number;
	newDoneToday: number;
	/** max(0, perDay + extraNew − newDoneToday). */
	newAllowance: number;
	reviewsPerDay: number;
	reviewDoneToday: number;
	/** max(0, reviewsPerDay − reviewDoneToday). */
	reviewAllowance: number;
}

/** Novas que ainda cabem hoje no idioma. Revisão nunca é recusada; só deixa de ser servida. */
export function newAllowance(perDay: number, extraNew: number, newDoneToday: number): number {
	return Math.max(0, perDay + extraNew - newDoneToday);
}

export function budget(b: {
	perDay: number;
	extraNew: number;
	newDoneToday: number;
	reviewsPerDay: number;
	reviewDoneToday: number;
}): DeckBudget {
	return {
		...b,
		newAllowance: newAllowance(b.perDay, b.extraNew, b.newDoneToday),
		reviewAllowance: Math.max(0, b.reviewsPerDay - b.reviewDoneToday)
	};
}

/** Data local (YYYY-MM-DD) do dia de estudo que começa em `dayStart` (= review_day_key). */
export function studyDayKey(dayStart: Date, timeZone: string): string {
	return new Intl.DateTimeFormat('en-CA', { timeZone }).format(dayStart);
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

/** Limite diário digitado: inteiro de 0 ao máximo do tipo. null se inválido. */
export function parseLimit(raw: unknown, kind: LimitKind): number | null {
	if (raw === null || raw === undefined || raw === '') return null;
	const n = typeof raw === 'number' ? raw : Number(raw);
	const max = kind === 'new' ? DECK_LIMITS.newPerDay : DECK_LIMITS.reviewsPerDay;
	return Number.isInteger(n) && n >= 0 && n <= max ? n : null;
}

export function parseLimitMode(raw: unknown): LimitMode | null {
	return LIMIT_MODES.includes(raw as LimitMode) ? (raw as LimitMode) : null;
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
	reviewAvailable: 0,
	review: 0,
	newDoneToday: 0,
	reviewDoneToday: 0,
	items: 0,
	fichas: 0,
	flashcards: 0,
	leeches: 0
};

function add(a: DeckCounts, b: DeckCounts): DeckCounts {
	const out = { ...a };
	for (const k of Object.keys(ZERO) as (keyof DeckCounts)[]) out[k] = a[k] + b[k];
	return out;
}

/**
 * Linhas da tela de decks: árvore, contagens próprias e totais com os subdecks. Novas e
 * revisões de hoje seguem os limites diários de cada deck; o subdeck também cabe no do pai,
 * e o pai não passa do próprio limite somando os filhos (a sessão do deck serve isso).
 */
export function summarizeDecks(
	decks: readonly Deck[],
	raw: ReadonlyMap<string, RawDeckCounts>,
	b: Pick<DeckBudget, 'perDay' | 'reviewsPerDay' | 'extraNew'>
): DeckSummary[] {
	const general = { newPerDay: b.perDay, reviewsPerDay: b.reviewsPerDay };
	const doneOf = (k: 'newDoneToday' | 'reviewDoneToday') =>
		Object.fromEntries(decks.map((d) => [d.id, raw.get(d.id)?.[k] ?? 0]));
	const newQ = deckQuota(decks, 'new', general, doneOf('newDoneToday'), { extra: b.extraNew });
	const revQ = deckQuota(decks, 'reviews', general, doneOf('reviewDoneToday'));

	const own = new Map<string, DeckCounts>();
	for (const d of decks) {
		const c = { ...ZERO, ...raw.get(d.id) };
		own.set(d.id, {
			...c,
			newToday: Math.min(c.newAvailable, quotaLeft(newQ, d.id)),
			review: Math.min(c.reviewAvailable, quotaLeft(revQ, d.id))
		});
	}
	return deckTree(decks).map((d) => {
		const counts = own.get(d.id)!;
		const children = decks.filter((c) => c.parentId === d.id);
		const sum = children.reduce((t, c) => add(t, own.get(c.id)!), counts);
		const limits: DeckLimitsView = {
			new: deckLimit(d, 'new', general),
			reviews: deckLimit(d, 'reviews', general),
			newLeft: newQ.left.get(d.id) ?? 0,
			reviewsLeft: revQ.left.get(d.id) ?? 0
		};
		const total = children.length
			? {
					...sum,
					newToday: Math.min(sum.newToday, limits.newLeft),
					review: Math.min(sum.review, limits.reviewsLeft)
				}
			: counts;
		return { ...d, counts, total, depth: d.parentId ? 1 : 0, limits };
	});
}

/** Erros das funções de deck, em PT. */
export function deckErrorMessage(code: string | undefined): string {
	switch (code) {
		case 'deck_default':
			return 'O baralho padrão não pode ser apagado. Escolha outro padrão antes.';
		case 'deck_parent':
			return 'Sub-baralho só fica dentro de um baralho de topo do mesmo idioma.';
		case 'deck_language':
			return 'O baralho é de outro idioma.';
		case 'deck_not_found':
			return 'Baralho não encontrado.';
		case 'deck_name_taken':
			return 'Já existe um baralho com esse nome.';
		case 'deck_name':
			return 'Dê um nome de 1 a 80 caracteres.';
		case 'bad_request':
			return 'Valor inválido.';
		default:
			return 'Não deu para salvar o baralho agora.';
	}
}
