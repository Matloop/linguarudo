// Palpite de título e artista a partir do que o oEmbed do YouTube devolve
// (título do vídeo e nome do canal). O usuário sempre pode corrigir.

export interface TrackGuess {
	artist: string;
	title: string;
}

const NOISE =
	/\s*[([][^)\]]*(official|video|vídeo|lyric|letra|audio|áudio|hd|4k|remaster|clip|visuali[sz]er|legendado|tradu)[^)\]]*[)\]]/giu;

function clean(s: string): string {
	return s.replace(NOISE, '').replace(/\s+/g, ' ').trim();
}

function channelArtist(channel: string): string {
	return channel
		.replace(/\s*-\s*Topic$/i, '')
		.replace(/\s*VEVO$/i, '')
		.replace(/\s+/g, ' ')
		.trim();
}

export function guessTrack(videoTitle: string, channel: string): TrackGuess {
	const title = clean(videoTitle);
	if (title === '') return { artist: '', title: '' };

	// Só separa em " - " (ou travessão) com espaços: "Spider-Man" fica inteiro.
	const parts = title.split(/\s+[-–—]\s+/);
	if (parts.length >= 2) {
		return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
	}
	return { artist: channelArtist(channel), title };
}
