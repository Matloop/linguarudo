// Seleção de linhas compartilhada (hub de decks, página do deck, /palavras): clique marca,
// Shift+clique marca o intervalo, X marca a linha em foco, Esc limpa, Ctrl/⌘+A marca tudo.

import { SvelteSet } from 'svelte/reactivity';
import { selectionKey, selectRange } from '#lib/decks-ui.ts';
import { isTypingTarget } from '#lib/shortcuts.ts';

const DIALOG_OPEN =
	'dialog[open], details.lang-wrap[open], [data-drawer-open], [data-popover-open]';

export class Selection {
	readonly ids = new SvelteSet<string>();
	#anchor: string | null = null;
	/** Ids visíveis, na ordem da lista (para o intervalo e o "tudo"). */
	#order: () => readonly string[];

	constructor(order: () => readonly string[]) {
		this.#order = order;
	}

	get size() {
		return this.ids.size;
	}

	has(id: string) {
		return this.ids.has(id);
	}

	/** Marca ou desmarca; com Shift, o intervalo desde o último clique. */
	toggle(id: string, shift = false) {
		const next = shift
			? selectRange(this.#order(), this.ids, this.#anchor, id)
			: selectRange(this.#order(), this.ids, null, id);
		this.#set(next);
		this.#anchor = id;
	}

	all() {
		this.#set(new Set(this.#order())); // eslint-disable-line svelte/prefer-svelte-reactivity -- cópia local
	}

	clear() {
		this.ids.clear();
		this.#anchor = null;
	}

	/** Tira da seleção o que sumiu da lista (filtro, apagado). */
	prune() {
		const visible = new Set(this.#order()); // eslint-disable-line svelte/prefer-svelte-reactivity -- cópia local
		for (const id of [...this.ids]) if (!visible.has(id)) this.ids.delete(id);
	}

	#set(next: Set<string>) {
		for (const id of [...this.ids]) if (!next.has(id)) this.ids.delete(id);
		for (const id of next) this.ids.add(id);
	}

	/**
	 * Teclado da lista. A linha em foco diz o id pelo `data-sel-id` mais próximo. Devolve
	 * true se tratou a tecla.
	 */
	onkeydown = (e: KeyboardEvent): boolean => {
		const action = selectionKey(e, {
			typing: isTypingTarget(e.target),
			dialogOpen: !!document.querySelector(DIALOG_OPEN),
			any: this.ids.size > 0
		});
		if (!action) return false;
		if (action === 'all') this.all();
		else if (action === 'clear') this.clear();
		else {
			const row = (e.target as HTMLElement | null)?.closest?.<HTMLElement>('[data-sel-id]');
			const id = row?.dataset.selId;
			if (!id) return false;
			this.toggle(id, e.shiftKey);
		}
		e.preventDefault();
		return true;
	};
}
