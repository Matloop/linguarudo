import type { Lang } from '../words.ts';

const VOICE_LANG: Record<Lang, string> = { en: 'en-US', it: 'it-IT' };

/** Lê a palavra em voz alta com a voz do navegador. Sem suporte, não faz nada. */
export function speak(text: string, lang: Lang, rate = 0.85) {
	if (typeof speechSynthesis === 'undefined' || !text) return;
	speechSynthesis.cancel();
	const utterance = new SpeechSynthesisUtterance(text);
	utterance.lang = VOICE_LANG[lang];
	utterance.rate = rate;
	const voice = speechSynthesis
		.getVoices()
		.find((v) => v.lang.replace('_', '-').toLowerCase().startsWith(lang));
	if (voice) utterance.voice = voice;
	speechSynthesis.speak(utterance);
}
