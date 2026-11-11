// Respostas nas listas (deck e Minhas palavras): ver a tradução ao lado da palavra é cola,
// então ficam escondidas até a pessoa pedir. A escolha vale para as duas listas e fica salva
// no navegador.

const KEY = 'linguetta.respostas';

class Answers {
	shown = $state(false);

	/** Lê a escolha salva; chamar no onMount (localStorage não existe no SSR). */
	load() {
		this.shown = localStorage.getItem(KEY) === '1';
	}

	toggle() {
		this.shown = !this.shown;
		localStorage.setItem(KEY, this.shown ? '1' : '0');
	}

	/** Atalho H fora de campos de texto. Devolve true se tratou a tecla. */
	onkeydown(e: KeyboardEvent): boolean {
		if (e.metaKey || e.ctrlKey || e.altKey || e.key.toLowerCase() !== 'h') return false;
		const t = e.target as HTMLElement | null;
		if (t?.closest('input, textarea, select, [contenteditable]')) return false;
		e.preventDefault();
		this.toggle();
		return true;
	}
}

export const answers = new Answers();
