// Validação do formulário "colar um link" de /musica. Os limites espelham os checks de
// supabase/migrations/*_songs.sql.

import { isLang, normalizeText, type Lang } from '../words.ts';
import { parseYoutubeId } from './youtube.ts';

export const SONG_LIMIT = 200;

export interface SongInput {
	youtubeId: string;
	title: string;
	artist: string;
	lang: Lang;
}

export type SongField = 'url' | 'title' | 'artist' | 'lang';

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
		lang: asString(raw.lang)
	};
	const youtubeId = parseYoutubeId(values.url);
	const title = normalizeText(values.title);
	const artist = normalizeText(values.artist);
	const lang = values.lang.toLowerCase();

	const errors: Partial<Record<SongField, string>> = {};
	if (youtubeId === null) errors.url = 'Cole um link de vídeo do YouTube.';
	if (title === '') errors.title = 'Escreva o título da música.';
	else if ([...title].length > SONG_LIMIT) errors.title = `Use no máximo ${SONG_LIMIT} caracteres.`;
	if (artist === '') errors.artist = 'Escreva o artista.';
	else if ([...artist].length > SONG_LIMIT)
		errors.artist = `Use no máximo ${SONG_LIMIT} caracteres.`;
	if (!isLang(lang)) errors.lang = 'Escolha inglês ou italiano.';

	if (Object.keys(errors).length > 0 || youtubeId === null || !isLang(lang)) {
		return { ok: false, errors, values };
	}
	return { ok: true, value: { youtubeId, title, artist, lang } };
}
