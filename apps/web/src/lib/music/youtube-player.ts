// Player do YouTube pela IFrame API oficial (https://www.youtube.com/iframe_api).
// Só este arquivo conhece a API; o jogo fala com `PlayerAdapter`, o que deixa
// trocar o player por um fake nos testes (os e2e interceptam o script oficial).

import type { PlayerAdapter, PlayerEvents, PlayerFactory } from './youtube.ts';

interface YTPlayer {
	playVideo(): void;
	pauseVideo(): void;
	seekTo(seconds: number, allowSeekAhead: boolean): void;
	getCurrentTime(): number;
	getDuration(): number;
	setPlaybackRate(rate: number): void;
	destroy(): void;
}

interface YTNamespace {
	Player: new (
		target: HTMLElement,
		options: {
			videoId: string;
			width: string;
			height: string;
			playerVars: Record<string, string | number>;
			events: {
				onReady: () => void;
				onStateChange: (e: { data: number }) => void;
				onError: (e: { data: number }) => void;
			};
		}
	) => YTPlayer;
	PlayerState: { ENDED: number };
}

declare global {
	interface Window {
		YT?: YTNamespace;
		onYouTubeIframeAPIReady?: () => void;
	}
}

const API_URL = 'https://www.youtube.com/iframe_api';
const READY_TIMEOUT_MS = 15_000;
const ENDED = 0;

let apiPromise: Promise<YTNamespace> | undefined;

function loadApi(): Promise<YTNamespace> {
	apiPromise ??= new Promise<YTNamespace>((resolve, reject) => {
		if (window.YT?.Player) return resolve(window.YT);
		const previous = window.onYouTubeIframeAPIReady;
		window.onYouTubeIframeAPIReady = () => {
			previous?.();
			if (window.YT?.Player) resolve(window.YT);
			else reject(new Error('A API do YouTube não carregou.'));
		};
		const script = document.createElement('script');
		script.src = API_URL;
		script.async = true;
		script.onerror = () => {
			apiPromise = undefined;
			reject(new Error('Não deu para carregar o player do YouTube.'));
		};
		document.head.append(script);
	});
	return apiPromise;
}

function errorMessage(code: number): string {
	if (code === 101 || code === 150) {
		return 'O dono do vídeo não deixa tocar fora do YouTube. Escolha outro vídeo da música.';
	}
	if (code === 100) return 'Esse vídeo não existe ou é privado.';
	if (code === 2) return 'O link do vídeo parece inválido.';
	return 'O player do YouTube falhou. Tente de novo.';
}

export const createYoutubePlayer: PlayerFactory = async (host, videoId, events: PlayerEvents) => {
	const YT = await loadApi();
	const target = document.createElement('div');
	host.replaceChildren(target);

	return new Promise<PlayerAdapter>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error('O player do YouTube demorou demais para abrir.')),
			READY_TIMEOUT_MS
		);
		const player = new YT.Player(target, {
			videoId,
			width: '100%',
			height: '100%',
			playerVars: {
				controls: 0,
				disablekb: 1,
				fs: 0,
				rel: 0,
				playsinline: 1,
				modestbranding: 1,
				iv_load_policy: 3,
				origin: location.origin
			},
			events: {
				onReady: () => {
					clearTimeout(timer);
					resolve({
						play: () => player.playVideo(),
						pause: () => player.pauseVideo(),
						seekTo: (s) => player.seekTo(s, true),
						currentTime: () => player.getCurrentTime() || 0,
						duration: () => player.getDuration() || 0,
						setRate: (r) => player.setPlaybackRate(r),
						destroy: () => player.destroy()
					});
				},
				onStateChange: (e) => {
					if (e.data === ENDED) events.onEnded();
				},
				onError: (e) => {
					clearTimeout(timer);
					const message = errorMessage(e.data);
					events.onError(message);
					reject(new Error(message));
				}
			}
		});
	});
};
