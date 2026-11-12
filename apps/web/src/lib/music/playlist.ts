// Playlist do YouTube (álbum): lê o list= do link e as faixas da página pública.
// Sem chave de API: o servidor baixa youtube.com/playlist e lê o JSON ytInitialData.
// ponytail: a página só traz as ~100 primeiras faixas e o formato muda sem aviso
// (playlistVideoRenderer virou lockupViewModel em 2026); se quebrar de novo, YouTube Data API.

import { guessTrack } from './track.ts';

/** Teto de faixas por álbum; espelha o check de open_album no banco. */
export const MAX_ALBUM_TRACKS = 50;

const LIST_ID = /^[A-Za-z0-9_-]{10,64}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function parsePlaylistId(input: string): string | null {
	let url: URL;
	try {
		const text = input.trim();
		url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
	} catch {
		return null;
	}
	const host = url.hostname.replace(/^(www|m|music)\./, '');
	if (host !== 'youtube.com' && host !== 'youtu.be') return null;
	const list = url.searchParams.get('list') ?? '';
	// RD… é o mix automático do YouTube: muda a cada visita, não é um álbum.
	if (!LIST_ID.test(list) || list.startsWith('RD')) return null;
	return list;
}

export interface PlaylistTrack {
	youtubeId: string;
	title: string;
	artist: string;
}

export interface Playlist {
	title: string;
	artist: string;
	tracks: PlaylistTrack[];
}

type Json = Record<string, unknown>;

function* walk(node: unknown): Generator<Json> {
	if (Array.isArray(node)) for (const v of node) yield* walk(v);
	else if (node && typeof node === 'object') {
		yield node as Json;
		for (const v of Object.values(node)) yield* walk(v);
	}
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const runs = (v: unknown) => str((v as { runs?: { text?: unknown }[] })?.runs?.[0]?.text);

/** Vídeo e canal de um item da playlist, nos dois formatos que o YouTube já usou. */
function rawTrack(node: Json): { id: string; title: string; channel: string } | null {
	const old = node.playlistVideoRenderer as Json | undefined;
	if (old)
		return { id: str(old.videoId), title: runs(old.title), channel: runs(old.shortBylineText) };
	const lockup = node.lockupViewModel as Json | undefined;
	if (!lockup || lockup.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO') return null;
	const meta = (lockup.metadata as Json | undefined)?.lockupMetadataViewModel as Json | undefined;
	const rows = (meta?.metadata as { contentMetadataViewModel?: { metadataRows?: unknown } })
		?.contentMetadataViewModel?.metadataRows as
		{ metadataParts?: { text?: { content?: unknown } }[] }[] | undefined;
	return {
		id: str(lockup.contentId),
		title: str((meta?.title as Json | undefined)?.content),
		channel: str(rows?.[0]?.metadataParts?.[0]?.text?.content)
	};
}

export function parsePlaylistPage(html: string): Playlist | null {
	const match = /var ytInitialData = (\{.*?\});<\/script>/s.exec(html);
	if (!match) return null;
	let data: unknown;
	try {
		data = JSON.parse(match[1]);
	} catch {
		return null;
	}

	let title = '';
	const seen = new Set<string>();
	const tracks: PlaylistTrack[] = [];
	for (const node of walk(data)) {
		const meta = node.playlistMetadataRenderer as Json | undefined;
		if (meta && title === '') title = str(meta.title);
		const raw = rawTrack(node);
		if (!raw || !VIDEO_ID.test(raw.id) || seen.has(raw.id)) continue;
		const guess = guessTrack(raw.title, raw.channel);
		if (guess.title === '') continue;
		seen.add(raw.id);
		tracks.push({ youtubeId: raw.id, ...guess });
	}
	if (tracks.length === 0) return null;
	return {
		// Playlists de álbum do YouTube Music vêm como "Album - Nome".
		title: title.replace(/^Album\s*-\s*/i, '').trim(),
		artist: tracks[0].artist,
		tracks: tracks.slice(0, MAX_ALBUM_TRACKS)
	};
}

export async function fetchPlaylist(
	endpoint: string,
	listId: string,
	fetcher: typeof fetch = fetch
): Promise<Playlist | null> {
	const url = new URL(endpoint);
	url.searchParams.set('list', listId);
	try {
		const res = await fetcher(url, {
			signal: AbortSignal.timeout(8_000),
			// Sem idioma fixo o YouTube responde na língua do IP (Vercel em gru1: português).
			headers: { 'Accept-Language': 'en', 'User-Agent': 'Mozilla/5.0' }
		});
		if (!res.ok) return null;
		return parsePlaylistPage(await res.text());
	} catch {
		return null;
	}
}
