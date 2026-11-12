// Álbum: uma playlist do YouTube jogada faixa a faixa. Cada faixa é uma obra
// 'musica' comum; a obra 'album' guarda a ordem e a faixa aberta por último.

import { LIMITS, normalizeText } from '../items.ts';
import { MAX_ALBUM_TRACKS, parsePlaylistId } from './playlist.ts';
import { isMusicLanguage, type MusicLanguage } from './wordlists.ts';

export type AlbumField = 'url' | 'title' | 'artist' | 'language' | 'tracks';

// type, não interface: o AlbumInput precisa caber em Json no rpc.
type AlbumTrack = {
	youtube_id: string;
	title: string;
	subtitle: string;
	language: MusicLanguage;
};

/** O que open_album recebe. */
export type AlbumInput = {
	playlist_id: string;
	title: string;
	subtitle: string;
	language: MusicLanguage;
	tracks: AlbumTrack[];
};

export type ParsedAlbum =
	{ ok: true; value: AlbumInput } | { ok: false; errors: Partial<Record<AlbumField, string>> };

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const fits = (s: string, max: number) => s !== '' && [...s].length <= max;

function parseTracks(json: string): AlbumTrack[] | null {
	let list: unknown;
	try {
		list = JSON.parse(json);
	} catch {
		return null;
	}
	if (!Array.isArray(list) || list.length > MAX_ALBUM_TRACKS) return null;
	const tracks: AlbumTrack[] = [];
	for (const t of list as Record<string, unknown>[]) {
		const youtube_id = str(t?.youtubeId);
		const title = normalizeText(str(t?.title));
		const subtitle = normalizeText(str(t?.artist));
		const language = str(t?.language);
		if (!VIDEO_ID.test(youtube_id) || !isMusicLanguage(language)) return null;
		if (!fits(title, LIMITS.title) || !fits(subtitle, LIMITS.subtitle)) return null;
		tracks.push({ youtube_id, title, subtitle, language });
	}
	return tracks;
}

export function parseAlbumInput(raw: Record<string, unknown>): ParsedAlbum {
	const playlistId = parsePlaylistId(str(raw.url));
	const title = normalizeText(str(raw.title));
	const artist = normalizeText(str(raw.artist));
	const language = str(raw.language).toLowerCase();
	const tracks = parseTracks(str(raw.tracks));

	const errors: Partial<Record<AlbumField, string>> = {};
	if (playlistId === null) errors.url = 'Cole o link de uma playlist do YouTube.';
	if (title === '') errors.title = 'Escreva o nome do álbum.';
	else if (!fits(title, LIMITS.title)) errors.title = `Use no máximo ${LIMITS.title} caracteres.`;
	if (!fits(artist, LIMITS.subtitle)) errors.artist = 'Escreva o artista.';
	if (!isMusicLanguage(language)) errors.language = 'Escolha inglês ou italiano.';
	if (tracks === null) errors.tracks = 'Não deu para ler as faixas. Cole o link de novo.';
	else if (tracks.length === 0) errors.tracks = 'Escolha pelo menos uma faixa.';

	if (
		playlistId === null ||
		tracks === null ||
		!isMusicLanguage(language) ||
		Object.keys(errors).length > 0
	) {
		return { ok: false, errors };
	}
	return {
		ok: true,
		value: { playlist_id: playlistId, title, subtitle: artist, language, tracks }
	};
}

export interface Album {
	id: string;
	title: string;
	artist: string;
	language: MusicLanguage;
	playedAt: string | null;
	/** Vídeo da 1ª faixa: a miniatura dele é a capa. */
	cover: string;
	/** Obras 'musica' das faixas, na ordem. */
	tracks: string[];
	/** Faixa aberta por último (0 = primeira). */
	position: number;
}

export function albumFromWork(row: {
	id: string;
	title: string;
	subtitle: string;
	refs: unknown;
	language: string | null;
	played_at: string | null;
}): Album | null {
	const refs = row.refs as { cover?: unknown; tracks?: unknown; position?: unknown } | null;
	const tracks = Array.isArray(refs?.tracks)
		? refs.tracks.filter((t) => typeof t === 'string')
		: [];
	if (tracks.length === 0 || !isMusicLanguage(row.language)) return null;
	const position = typeof refs?.position === 'number' ? refs.position : 0;
	return {
		id: row.id,
		title: row.title,
		artist: row.subtitle,
		language: row.language,
		playedAt: row.played_at,
		cover: typeof refs?.cover === 'string' ? refs.cover : '',
		tracks,
		position: Math.min(Math.max(position, 0), tracks.length - 1)
	};
}
