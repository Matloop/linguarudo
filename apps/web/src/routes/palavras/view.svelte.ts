// "Exibir" de Minhas palavras: o que cada linha mostra (tradução, frase, leitura, origem)
// e o modo estudo, que esconde a tradução até passar o mouse. Fica salvo no navegador.

import { isTypingTarget } from '#lib/shortcuts.ts';

const KEY = 'linguetta.palavras.exibir';

export interface ListView {
	traducao: boolean;
	frase: boolean;
	leitura: boolean;
	origem: boolean;
	estudo: boolean;
}

const DEFAULTS: ListView = {
	traducao: true,
	frase: true,
	leitura: false,
	origem: true,
	estudo: false
};

class View {
	on = $state<ListView>({ ...DEFAULTS });

	/** Lê a escolha salva; chamar no onMount (localStorage não existe no SSR). */
	load() {
		try {
			const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<ListView>;
			for (const k of Object.keys(DEFAULTS) as (keyof ListView)[]) {
				if (typeof saved[k] === 'boolean') this.on[k] = saved[k];
			}
		} catch {
			// Valor estragado: fica o padrão.
		}
	}

	toggle(k: keyof ListView) {
		this.on[k] = !this.on[k];
		localStorage.setItem(KEY, JSON.stringify(this.on));
	}

	/** Atalho H (modo estudo) fora de campos de texto. Devolve true se tratou a tecla. */
	onkeydown(e: KeyboardEvent): boolean {
		if (e.metaKey || e.ctrlKey || e.altKey || e.key.toLowerCase() !== 'h') return false;
		if (isTypingTarget(e.target)) return false;
		e.preventDefault();
		this.toggle('estudo');
		return true;
	}
}

export const view = new View();
