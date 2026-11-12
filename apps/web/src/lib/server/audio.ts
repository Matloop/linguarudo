// Áudio da palavra (ADR 0005): pedido validado e chave do cache no bucket "audio".

import { createHash } from 'node:crypto';
import { languageProfile } from '@linguetta/language';
import { parseLanguage, type Language } from '#lib/languages.ts';

const MAX_TEXT = 80;

export type AudioQuery = { lang: Language; base: string; text: string };

/** Mesma forma para a chave, o Commons e o TTS: "Perché " e "perché" são um áudio só. */
function normalizeText(text: string): string {
	return text.normalize('NFC').trim().toLowerCase();
}

/** lang e text do GET /audio; null se faltam, o texto passa de 80 ou a tag é inválida. */
export function parseAudioQuery(params: URLSearchParams): AudioQuery | null {
	const lang = parseLanguage(params.get('lang'));
	const text = normalizeText(params.get('text') ?? '');
	if (!lang || !text || text.length > MAX_TEXT) return null;
	return { lang, base: languageProfile(lang).base, text };
}

/** Caminho no bucket, sem extensão: <base>/<sha256 hex do texto normalizado>. */
export function audioKey(base: string, text: string): string {
	const hash = createHash('sha256').update(normalizeText(text), 'utf8').digest('hex');
	return `${base}/${hash}`;
}

// Bases que o Supertonic 3 fala, com o código ISO 639-3 que o Lingua Libre põe no título
// do arquivo no Commons (letão é "lvs", não "lav").
const ISO_639_3: Record<string, string> = {
	en: 'eng',
	ko: 'kor',
	ja: 'jpn',
	ar: 'ara',
	bg: 'bul',
	cs: 'ces',
	da: 'dan',
	de: 'deu',
	el: 'ell',
	es: 'spa',
	et: 'est',
	fi: 'fin',
	fr: 'fra',
	hi: 'hin',
	hr: 'hrv',
	hu: 'hun',
	id: 'ind',
	it: 'ita',
	lt: 'lit',
	lv: 'lvs',
	nl: 'nld',
	pl: 'pol',
	pt: 'por',
	ro: 'ron',
	ru: 'rus',
	sk: 'slk',
	sl: 'slv',
	sv: 'swe',
	tr: 'tur',
	uk: 'ukr',
	vi: 'vie'
};

/** ISO 639-3 da base, ou null se o Supertonic não fala o idioma. */
export function supertonicIso(base: string): string | null {
	return Object.hasOwn(ISO_639_3, base) ? ISO_639_3[base] : null;
}

/** WAV PCM 16 bits mono, montado em memória. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
	const dataSize = samples.length * 2;
	const view = new DataView(new ArrayBuffer(44 + dataSize));
	const ascii = (at: number, s: string) =>
		[...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
	ascii(0, 'RIFF');
	view.setUint32(4, 36 + dataSize, true);
	ascii(8, 'WAVE');
	ascii(12, 'fmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true); // PCM
	view.setUint16(22, 1, true); // mono
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	ascii(36, 'data');
	view.setUint32(40, dataSize, true);
	samples.forEach((s, i) =>
		view.setInt16(44 + i * 2, Math.floor(Math.max(-1, Math.min(1, s)) * 32767), true)
	);
	return new Uint8Array(view.buffer);
}
