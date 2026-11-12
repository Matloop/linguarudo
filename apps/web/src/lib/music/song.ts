// Validação do formulário "colar um link" de /musica. A música vira uma obra do
// tipo 'musica'; os limites espelham os checks da tabela works.

import { LIMITS, normalizeText } from '../items.ts';
import { syncFromRefs, type StoredSync } from './timeline.ts';
import { isMusicLanguage, type MusicLanguage } from './wordlists.ts';
import { parseYoutubeId } from './youtube.ts';

export interface SongInput {
	youtubeId: string;
	title: string;
	artist: string;
	language: MusicLanguage;
}

export type SongField = 'url' | 'title' | 'artist' | 'language';

export type ParsedSong =
	| { ok: true; value: SongInput }
	| { ok: false; errors: Partial<Record<SongField, string>>; values: Record<SongField, string> };

function asString(v: unknown): string {
	return typeof v === 'string' ? v : '';
}

export function parseSongInput(raw: Record<string, unknown>): ParsedSong {
	const values = {
		url: asString(raw.url),
		title: asString(raw.title),
		artist: asString(raw.artist),
		language: asString(raw.language)
	};
	const youtubeId = parseYoutubeId(values.url);
	const title = normalizeText(values.title);
	const artist = normalizeText(values.artist);
	const language = values.language.toLowerCase();

	const errors: Partial<Record<SongField, string>> = {};
	if (youtubeId === null) errors.url = 'Cole um link de vídeo do YouTube.';
	if (title === '') errors.title = 'Escreva o título da música.';
	else if ([...title].length > LIMITS.title)
		errors.title = `Use no máximo ${LIMITS.title} caracteres.`;
	if (artist === '') errors.artist = 'Escreva o artista.';
	else if ([...artist].length > LIMITS.subtitle)
		errors.artist = `Use no máximo ${LIMITS.subtitle} caracteres.`;
	if (!isMusicLanguage(language)) errors.language = 'Escolha inglês ou italiano.';

	if (Object.keys(errors).length > 0 || youtubeId === null || !isMusicLanguage(language)) {
		return { ok: false, errors, values };
	}
	return { ok: true, value: { youtubeId, title, artist, language } };
}

/** A obra que open_work recebe: a música é identificada pelo vídeo. */
export function songWork(song: SongInput) {
	return {
		kind: 'musica' as const,
		title: song.title,
		subtitle: song.artist,
		refs: { youtube_id: song.youtubeId },
		language: song.language
	};
}

export interface Song {
	id: string;
	youtubeId: string;
	title: string;
	artist: string;
	language: MusicLanguage;
	playedAt: string | null;
	/** Linha do tempo da letra que a pessoa acertou para este vídeo. */
	sync: StoredSync;
}

/** Uma obra do tipo 'musica' como o jogo usa; null se não dá para jogar. */
export function songFromWork(row: {
	id: string;
	title: string;
	subtitle: string;
	refs: unknown;
	language: string | null;
	played_at: string | null;
}): Song | null {
	const refs = row.refs as { youtube_id?: unknown } | null;
	const youtubeId = typeof refs?.youtube_id === 'string' ? refs.youtube_id : '';
	if (youtubeId === '' || !isMusicLanguage(row.language)) return null;
	return {
		id: row.id,
		youtubeId,
		title: row.title,
		artist: row.subtitle,
		language: row.language,
		playedAt: row.played_at,
		sync: syncFromRefs(row.refs)
	};
}
