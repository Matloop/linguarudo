// Dados falsos dos e2e do jogo de música. Os versos são inventados para os testes:
// nenhuma letra de música real entra no repositório.

export const VERSES = [
	'Lantern light on the quiet meadow',
	'Paper boats on the silver harbor',
	'Counting stars above the orchard',
	'Whispers travel through the tunnel',
	'Gentle thunder over the compass',
	'Pocket full of ribbon and feathers',
	'Blanket folded by the window',
	'Kettle singing in the morning'
] as const;

/** Um verso a cada 3 s, começando em 1 s, e uma marca vazia de fim em 25 s. */
export const LRC = [
	...VERSES.map((text, i) => `[00:${String(1 + i * 3).padStart(2, '0')}.00] ${text}`),
	'[00:25.00]'
].join('\n');

/** Outra versão da letra no LRCLIB (ao vivo): os mesmos versos 2 s depois. */
export const LRC_LIVE = [
	...VERSES.map((text, i) => `[00:${String(3 + i * 3).padStart(2, '0')}.00] ${text}`),
	'[00:27.00]'
].join('\n');

export const VIDEO_SECONDS = 28;
/** Duração da versão ao vivo: longe do vídeo, nunca é a escolhida sozinha. */
export const LIVE_SECONDS = 70;
export const CLIP_EXTRA_SECONDS = 12;

export const VIDEOS = {
	ok: { id: 'LANTERN0001', title: 'Slow Lantern', artist: 'Banda Inventada' },
	/** Clipe: a faixa no LRCLIB tem CLIP_EXTRA_SECONDS a menos que o vídeo. */
	clip: { id: 'CLIPELONGO1', title: 'Clipe Comprido', artist: 'Banda Inventada' },
	noLyrics: { id: 'SEMLETRA001', title: 'Sem Letra', artist: 'Banda Inventada' },
	down: { id: 'FORADOAR001', title: 'Fora do Ar', artist: 'Banda Inventada' }
} as const;

/** Playlist de álbum falsa: uma faixa com letra e uma sem. */
export const PLAYLIST = {
	id: 'OLAK5uy_inventada001',
	title: 'Disco Inventado',
	videos: [VIDEOS.ok, VIDEOS.noLyrics]
} as const;

/** Ids dos registros no LRCLIB falso. O clipe tem duas versões: a faixa e a ao vivo. */
export const LRCLIB_IDS = { ok: 1, clip: 2, clipLive: 3, noLyrics: 4 } as const;
