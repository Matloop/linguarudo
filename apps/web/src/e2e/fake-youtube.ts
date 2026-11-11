import type { Page } from '@playwright/test';
import { VIDEO_SECONDS } from './fixtures.ts';

/**
 * Troca o script oficial da IFrame API por um player de mentira. O app carrega o script pela
 * rede de verdade, então o wrapper de produção é o que roda; só o YouTube é falso.
 * `window.__fakeYT` mostra ao teste o que o jogo mandou o player fazer.
 */
const FAKE_IFRAME_API = `
(() => {
	const SPEED = window.__fakeYTSpeed || 1;
	const state = { time: 0, playing: false, rate: 1, last: performance.now(), duration: ${VIDEO_SECONDS} };
	const log = [];
	let current = null;

	function sync() {
		const now = performance.now();
		if (state.playing) {
			state.time = Math.min(state.duration, state.time + ((now - state.last) / 1000) * state.rate * SPEED);
			if (state.time >= state.duration) {
				state.playing = false;
				log.push('ended');
				current && current.events.onStateChange({ data: 0 });
			}
		}
		state.last = now;
	}

	window.__fakeYT = {
		log,
		get time() { sync(); return state.time; },
		get playing() { return state.playing; },
		get rate() { return state.rate; },
		/** Quantas vezes cada comando foi chamado. */
		count(name) { return log.filter((entry) => entry === name || entry.startsWith(name + ':')).length; }
	};

	class Player {
		constructor(target, options) {
			current = options;
			const frame = document.createElement('iframe');
			frame.title = 'video falso';
			frame.srcdoc = '<body style="margin:0;background:#123;color:#fff;font:14px sans-serif">video falso</body>';
			target.replaceWith(frame);
			setTimeout(() => options.events.onReady({ target: this }), 20);
		}
		playVideo() { sync(); state.playing = true; log.push('play'); current.events.onStateChange({ data: 1 }); }
		pauseVideo() { sync(); state.playing = false; log.push('pause'); current.events.onStateChange({ data: 2 }); }
		seekTo(seconds) { sync(); state.time = seconds; log.push('seek:' + seconds); }
		getCurrentTime() { sync(); return state.time; }
		getDuration() { return state.duration; }
		setPlaybackRate(rate) { state.rate = rate; log.push('rate:' + rate); }
		destroy() {}
	}

	window.YT = { Player, PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2 } };
	if (window.onYouTubeIframeAPIReady) window.onYouTubeIframeAPIReady();
})();
`;

const PIXEL = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
	'base64'
);

/** `speed`: quantos segundos de vídeo passam por segundo real (acelera os testes). */
export async function installFakeYoutube(page: Page, speed = 1) {
	await page.addInitScript((s) => {
		(window as unknown as { __fakeYTSpeed: number }).__fakeYTSpeed = s;
	}, speed);
	await page.route('https://www.youtube.com/iframe_api', (route) =>
		route.fulfill({ contentType: 'application/javascript', body: FAKE_IFRAME_API })
	);
	// Miniaturas: sem rede nos testes.
	await page.route('https://i.ytimg.com/**', (route) =>
		route.fulfill({ contentType: 'image/png', body: PIXEL })
	);
}
