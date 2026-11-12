import { playWord } from '#lib/audio.ts';
import type { MusicLanguage } from './wordlists.ts';

/** Toca a palavra. Falha de áudio é ignorada: o botão só tenta de novo no próximo toque. */
export function speak(text: string, lang: MusicLanguage) {
	if (text) playWord(text, lang).catch(() => {});
}
