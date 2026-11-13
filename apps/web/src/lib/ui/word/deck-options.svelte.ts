// Baralhos de um idioma para o campo Baralho dos diálogos (Guardar palavra, Nova ficha),
// buscados em /palavras/decks quando o campo aparece. Criar dentro do componente (usa $effect):
//	const decks = new DeckOptions(() => (more && isOpen ? chosen : null));
//	<WordDeckField decks={decks.list} loading={decks.loading} … />

import { untrack } from 'svelte';
import type { Language } from '#lib/languages.ts';
import type { DeckOption } from '#lib/word-fields.ts';

export class DeckOptions {
	list = $state<DeckOption[]>([]);
	loading = $state(false);
	#for = $state<Language | null>(null);

	/** `language`: o idioma cujos baralhos buscar agora; null = ainda não precisa. */
	constructor(language: () => Language | null) {
		$effect(() => {
			const lang = language();
			if (!lang || untrack(() => this.#for) === lang) return;
			this.#for = lang;
			this.list = [];
			this.loading = true;
			fetch(`/palavras/decks?idioma=${encodeURIComponent(lang)}`)
				.then((r) => (r.ok ? (r.json() as Promise<DeckOption[]>) : []))
				.catch(() => [])
				.then((list) => {
					if (this.#for !== lang) return;
					this.list = list;
					this.loading = false;
				});
		});
	}
}
