export function audioUrl(text: string, lang: string): string {
	return `/audio?${new URLSearchParams({ lang, text })}`;
}

let element: HTMLAudioElement | undefined;
let lastPlay = 0;

/** Toca a palavra pelo servidor. Resolve quando o áudio começa; rejeita se não toca. */
export async function playWord(text: string, lang: string): Promise<void> {
	element ??= new Audio();
	const id = ++lastPlay;
	element.pause();
	element.src = audioUrl(text, lang);
	try {
		await element.play();
	} catch (e) {
		// Uma chamada nova troca o src e aborta a anterior: isso não é erro.
		if (id !== lastPlay) return;
		throw e;
	}
}
