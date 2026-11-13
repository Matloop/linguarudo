// Textos e contas puras das telas de decks (hub, página do deck, sidebar, diálogo de fim
// de cota). As regras da fila ficam em lib/decks.ts e lib/server/queue.ts.

import {
	isPausedIn,
	type Deck,
	type DeckBudget,
	type DeckCounts,
	type DeckLimitsView,
	type DeckSummary,
	type LimitMode
} from './decks.ts';

/** "1 baralho", "3 baralhos". */
export function plural(n: number, one: string, many: string): string {
	return `${n} ${n === 1 ? one : many}`;
}

/** Nome para mostrar: o subdeck achatado do Anki "B::C" vira "B › C". */
export function deckDisplayName(name: string): string {
	return (
		name
			.split('::')
			.map((p) => p.trim())
			.filter(Boolean)
			.join(' › ') || name
	);
}

/** Nome visível na UI: no máximo 60 caracteres (o servidor aceita 80, para o Anki). */
export const DECK_NAME_UI_MAX = 60;

/** O que estudar o deck serviria hoje: novas que cabem + aprendendo + revisões. */
export function forToday(c: Pick<DeckCounts, 'newToday' | 'learning' | 'review'>): number {
	return c.newToday + c.learning + c.review;
}

/** Contagens da linha: o pai mostra o que a sessão dele serve (com os filhos). */
export function rowCounts(d: DeckSummary): DeckCounts {
	return d.depth === 0 ? d.total : d.counts;
}

export interface TodayTotals {
	/** "N para hoje": o mesmo número do badge da sidebar. */
	total: number;
	fresh: number;
	/** Aprendendo + revisões. */
	reviews: number;
	/** Novas que esperam porque o orçamento do dia acabou. */
	waiting: number;
	/** Orçamento esgotado com novas esperando. */
	budgetSpent: boolean;
}

/**
 * Totais de "Estudar tudo": decks ativos (sem os pausados nem os filhos de pausados). Novas
 * e revisões cabem nos limites de cada deck (o filho conta contra o pai) e no Geral do
 * idioma; aprendendo nunca tem limite.
 */
export function todayTotals(decks: readonly DeckSummary[], b: DeckBudget): TodayTotals {
	const active = decks.filter((d) => !isPausedIn(d, decks as readonly Deck[]));
	const ids = new Set(active.map((d) => d.id));
	const tops = active.filter((d) => !d.parentId || !ids.has(d.parentId));
	const pooled = (k: 'newToday' | 'review', left: (d: DeckSummary) => number) =>
		tops.reduce((s, t) => {
			const own = active
				.filter((d) => d.id === t.id || d.parentId === t.id)
				.reduce((n, d) => n + d.counts[k], 0);
			return s + Math.min(own, left(t));
		}, 0);
	const learning = active.reduce((s, d) => s + d.counts.learning, 0);
	const reviews =
		learning +
		Math.min(
			b.reviewAllowance,
			pooled('review', (d) => d.limits.reviewsLeft)
		);
	const fresh = Math.min(
		b.newAllowance,
		pooled('newToday', (d) => d.limits.newLeft)
	);
	const available = active.reduce((s, d) => s + d.counts.newAvailable, 0);
	const waiting = Math.max(0, available - fresh);
	return {
		total: reviews + fresh,
		fresh,
		reviews,
		waiting,
		budgetSpent: b.newAllowance === 0 && available > 0
	};
}

/** "3 baralhos · 1 sub-baralho · 63 cartas". */
export function hubSubtitle(decks: readonly Pick<Deck, 'parentId'>[], flashcards: number): string {
	const subs = decks.filter((d) => d.parentId).length;
	const parts = [plural(decks.length - subs, 'baralho', 'baralhos')];
	if (subs) parts.push(plural(subs, 'sub-baralho', 'sub-baralhos'));
	parts.push(plural(flashcards, 'carta', 'cartas'));
	return parts.join(' · ');
}

/** "4 novas · 10 revisões" (sem as partes zeradas). */
export function todayBreakdown(fresh: number, reviews: number): string {
	const parts: string[] = [];
	if (fresh) parts.push(plural(fresh, 'nova', 'novas'));
	if (reviews) parts.push(plural(reviews, 'revisão', 'revisões'));
	return parts.join(' · ');
}

/** "As 10 novas de hoje acabaram" / "As 10 novas + 5 extras de hoje acabaram". */
export function quotaDoneText(b: Pick<DeckBudget, 'perDay' | 'extraNew'>): string {
	const extra = b.extraNew ? ` + ${b.extraNew} ${b.extraNew === 1 ? 'extra' : 'extras'}` : '';
	if (b.perDay === 1 && !extra) return 'A nova de hoje acabou';
	return `As ${b.perDay} novas${extra} de hoje acabaram`;
}

/** "Amanhã: cerca de 23 revisões." */
export function tomorrowText(n: number): string {
	if (n === 0) return 'Amanhã: nada vence ainda.';
	return `Amanhã: cerca de ${plural(n, 'revisão', 'revisões')}.`;
}

/** "Mover 3 para Minhas palavras" no diálogo de apagar. */
export function deleteMoveText(n: number, target: string): string {
	return n ? `Mover ${n} para ${target}` : `Mover para ${target}`;
}

/** Subtítulo da página do deck: "48 cartas · 20 novas/dia · 200 revisões/dia". */
export function deckSubtitle(
	flashcards: number,
	limits: Pick<DeckLimitsView, 'new' | 'reviews'>
): string {
	return [
		plural(flashcards, 'carta', 'cartas'),
		`${limits.new.value} ${limits.new.value === 1 ? 'nova' : 'novas'}/dia`,
		`${limits.reviews.value} ${limits.reviews.value === 1 ? 'revisão' : 'revisões'}/dia`
	].join(' · ');
}

/** De onde vem o limite, para a engrenagem: "Geral", "Este baralho", "Só hoje". */
export const LIMIT_MODE_LABEL: Record<LimitMode, string> = {
	geral: 'Geral',
	deck: 'Este baralho',
	hoje: 'Só hoje'
};

// ---------- Seleção ----------

/**
 * Shift+clique: marca (ou desmarca, conforme o novo estado do alvo) tudo entre a âncora e
 * o alvo, na ordem da lista. Sem âncora visível, só o alvo.
 */
export function selectRange(
	order: readonly string[],
	selected: ReadonlySet<string>,
	anchor: string | null,
	target: string
): Set<string> {
	const out = new Set(selected);
	const on = !selected.has(target);
	const a = anchor === null ? -1 : order.indexOf(anchor);
	const b = order.indexOf(target);
	if (b < 0) return out;
	const [from, to] = a < 0 ? [b, b] : a < b ? [a, b] : [b, a];
	for (const id of order.slice(from, to + 1)) {
		if (on) out.add(id);
		else out.delete(id);
	}
	return out;
}

export type SelectionKey = 'toggle' | 'clear' | 'all';

/** Teclas da seleção: X marca a linha em foco, Esc limpa, Ctrl/⌘+A marca tudo. */
export function selectionKey(
	e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean },
	ctx: { typing: boolean; dialogOpen: boolean; any: boolean }
): SelectionKey | null {
	if (ctx.typing || ctx.dialogOpen || e.altKey) return null;
	const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
	if ((e.ctrlKey || e.metaKey) && k === 'a') return 'all';
	if (e.ctrlKey || e.metaKey) return null;
	if (k === 'x') return 'toggle';
	if (k === 'Escape' && ctx.any) return 'clear';
	return null;
}

/** "1 selecionado", "3 selecionados". */
export function selectionLabel(n: number): string {
	return plural(n, 'selecionado', 'selecionados');
}

// ---------- Página do deck ----------

export type DeckTab = 'todas' | 'hoje' | 'novas' | 'aprendendo' | 'teimosas';

export interface EntryCard {
	id: string;
	state: number;
	dueAt: string;
}

export interface EntryFlags {
	/** Todos os flashcards ainda novos. */
	fresh: boolean;
	/** Algum em aprendizado (1) ou reaprendizado (3). */
	learning: boolean;
	/** Em espera ou suspensa por erros. */
	leech: boolean;
	/** Entra na sessão de hoje: vence até o fim do dia ou é nova planejada para hoje. */
	today: boolean;
}

/**
 * Em que abas um item ou ficha aparece. Conhecido (status ≠ ativo) e teimosa nunca estão
 * na fila; a nova só está "hoje" se o plano do dia a escolheu.
 */
export function entryFlags(
	e: { status: string; leechHold: string | null; cards: readonly EntryCard[] },
	ctx: { nextDayStart: Date; plannedIds: ReadonlySet<string> }
): EntryFlags {
	const leech = e.leechHold !== null;
	const active = e.status === 'ativo' && !leech;
	const fresh = e.cards.length > 0 && e.cards.every((c) => c.state === 0);
	const learning = e.cards.some((c) => c.state === 1 || c.state === 3);
	const due = e.cards.some(
		(c) => c.state > 0 && new Date(c.dueAt).getTime() < ctx.nextDayStart.getTime()
	);
	const planned = e.cards.some((c) => ctx.plannedIds.has(c.id));
	return { fresh, learning, leech, today: active && (due || planned) };
}

export function inTab(f: EntryFlags, tab: DeckTab): boolean {
	if (tab === 'todas') return true;
	if (tab === 'hoje') return f.today;
	if (tab === 'novas') return f.fresh && !f.leech;
	if (tab === 'aprendendo') return f.learning && !f.leech;
	return f.leech;
}

/**
 * Rótulo da coluna "próxima": conhecida = "Já sei"; toda nova = "nova" (ou "nova hoje" se o
 * plano do dia a escolheu); senão a data das já estudadas (`reviewed`, só chamada aí).
 */
export function entryNext(f: EntryFlags, known: boolean, reviewed: () => string): string {
	if (known) return 'Já sei';
	if (f.fresh) return f.today ? 'nova hoje' : 'nova';
	return reviewed();
}
