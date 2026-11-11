// YouTube: leitura de link (pura) e o contrato do player, que o jogo usa sem
// saber se por trás está a IFrame API ou um fake dos testes.

const ID = /^[A-Za-z0-9_-]{11}$/;

/** Extrai o id de um vídeo a partir de um link do YouTube (ou do próprio id). */
export function parseYoutubeId(input: string): string | null {
	const text = input.trim();
	if (ID.test(text)) return text;
	if (text === '' || /\s/.test(text)) return null;

	let url: URL;
	try {
		url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
	} catch {
		return null;
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

	const host = url.hostname.replace(/^(www|m|music)\./, '');
	let candidate: string | null = null;
	if (host === 'youtu.be') {
		candidate = url.pathname.split('/')[1] ?? null;
	} else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
		const [, kind, id] = url.pathname.split('/');
		if (kind === 'watch') candidate = url.searchParams.get('v');
		else if (kind === 'embed' || kind === 'shorts' || kind === 'live' || kind === 'v')
			candidate = id ?? null;
	}
	return candidate !== null && ID.test(candidate) ? candidate : null;
}

// ---------- Contrato do player ----------

export interface PlayerAdapter {
	play(): void;
	pause(): void;
	seekTo(seconds: number): void;
	currentTime(): number;
	/** 0 enquanto não se sabe. */
	duration(): number;
	setRate(rate: number): void;
	destroy(): void;
}

export interface PlayerEvents {
	onEnded(): void;
	onError(message: string): void;
}

export type PlayerFactory = (
	host: HTMLElement,
	videoId: string,
	events: PlayerEvents
) => Promise<PlayerAdapter>;
