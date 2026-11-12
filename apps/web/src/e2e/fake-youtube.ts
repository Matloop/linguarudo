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
	// Manias do YouTube de verdade, que já quebraram o jogo: o seek chega depois (e o tempo
	// antigo segue aparecendo), cai no keyframe antes do alvo, seek fora da pausa toca, e
	// os eventos de estado chegam atrasados (postMessage).
	const Q = { seekLagMs: 250, keyframeS: 0.5, stateLagMs: 40 };
	const state = { time: 0, status: 'unstarted', rate: 1, last: performance.now(), duration: ${VIDEO_SECONDS} };
	const log = [];
	let current = null;
	let pending = null;
	const CODES = { unstarted: -1, ended: 0, playing: 1, paused: 2 };

	function emit(status) {
		state.status = status;
		const data = CODES[status];
		setTimeout(() => current && current.events.onStateChange({ data }), Q.stateLagMs);
	}

	function sync() {
		const now = performance.now();
		if (state.status === 'playing') {
			state.time = Math.min(state.duration, state.time + ((now - state.last) / 1000) * state.rate * SPEED);
		}
		if (pending && now >= pending.at) {
			state.time = pending.to;
			pending = null;
		}
		if (state.status === 'playing' && state.time >= state.duration) {
			log.push('ended');
			emit('ended');
		}
		state.last = now;
	}

	window.__fakeYT = {
		log,
		/** O que se ouve (sem o atraso do seek). */
		get time() { sync(); return state.time; },
		get playing() { return state.status === 'playing'; },
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
		playVideo() {
			sync();
			if (state.status === 'ended') state.time = 0;
			log.push('play');
			emit('playing');
		}
		pauseVideo() { sync(); log.push('pause'); emit('paused'); }
		seekTo(seconds) {
			sync();
			log.push('seek:' + seconds);
			const kf = Q.keyframeS;
			pending = { to: Math.max(0, Math.min(state.duration, Math.floor(seconds / kf) * kf)), at: performance.now() + Q.seekLagMs };
			if (state.status !== 'paused' && state.status !== 'playing') emit('playing');
		}
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
