<script lang="ts">
	import { goto, invalidate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { REVIEW_DEPENDENCY } from '#lib/review.ts';
	import FimDeJogo from '#lib/music/FimDeJogo.svelte';
	import Inicio from '#lib/music/Inicio.svelte';
	import Resumo from '#lib/music/Resumo.svelte';
	import WordCard from '#lib/music/WordCard.svelte';
	import { DIFFICULTIES, type Difficulty } from '#lib/music/gaps.ts';
	import { Game, type Command, type GameGapConfig, type GapResult } from '#lib/music/game.ts';
	import type { LyricLine } from '#lib/music/lrc.ts';
	import { mulberry32 } from '#lib/music/rng.ts';
	import { buildSession, type Session } from '#lib/music/session.ts';
	import type { PlayerAdapter } from '#lib/music/youtube.ts';
	import { createYoutubePlayer } from '#lib/music/youtube-player.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const song = $derived(data.song);
	const lang = $derived(song.language);

	// ---------- banco do usuário (cresce quando ele salva palavras) ----------
	interface BankEntry {
		sense: string;
		ipa: string;
		pos: string;
	}
	const bank = new SvelteMap<string, BankEntry>();
	const savedNow = new SvelteMap<string, string>();
	let bankTotal = $state(0);
	// Carrega o banco do servidor uma vez por música. Um `invalidate` (contagem do menu) recria
	// `data`, mas não pode apagar o que a pessoa salvou nesta partida.
	let loadedBank: unknown;
	$effect.pre(() => {
		if (data.bank === loadedBank) return;
		loadedBank = data.bank;
		bank.clear();
		for (const w of data.bank) {
			bank.set(w.key, { sense: w.sense, ipa: w.ipa, pos: w.pos });
		}
		bankTotal = data.bankTotal;
	});

	// ---------- carregamento: player e letra ----------
	type Status = 'loading' | 'ready' | 'no-lyrics' | 'unavailable' | 'player-error';
	let status = $state<Status>('loading');
	let statusMessage = $state('');
	let lyrics = $state.raw<LyricLine[]>([]);
	let player: PlayerAdapter | null = null;
	let host: HTMLDivElement | undefined = $state();
	let duration = $state(0);

	async function waitForDuration(p: PlayerAdapter): Promise<number> {
		for (let i = 0; i < 12; i++) {
			const d = p.duration();
			if (d > 0) return d;
			await new Promise((r) => setTimeout(r, 200));
		}
		return 0;
	}

	async function loadLyrics(seconds: number) {
		const query = [
			`title=${encodeURIComponent(song.title)}`,
			`artist=${encodeURIComponent(song.artist)}`
		];
		if (seconds > 0) query.push(`duration=${Math.round(seconds)}`);
		try {
			const res = await fetch(`/musica/letra?${query.join('&')}`);
			if (res.ok) {
				lyrics = ((await res.json()) as { lines: LyricLine[] }).lines;
				status = 'ready';
			} else if (res.status === 404) {
				status = 'no-lyrics';
				statusMessage =
					'Não achei letra sincronizada para essa música. Confira o título e o artista, ou escolha outra.';
			} else {
				throw new Error(String(res.status));
			}
		} catch {
			status = 'unavailable';
			statusMessage = 'O serviço de letras não respondeu. Tente de novo em instantes.';
		}
	}

	async function boot() {
		status = 'loading';
		if (!host) return;
		let playerFailed = false;
		try {
			player?.destroy();
			player = await createYoutubePlayer(host, song.youtubeId, {
				onEnded: () => {
					if (game) apply(game.finishNow());
					sync();
				},
				onError: (message) => {
					playerFailed = true;
					status = 'player-error';
					statusMessage = message;
				}
			});
		} catch (e) {
			if (!playerFailed) {
				status = 'player-error';
				statusMessage = e instanceof Error ? e.message : 'Não deu para abrir o player do YouTube.';
			}
			return;
		}
		duration = await waitForDuration(player);
		await loadLyrics(duration);
	}

	// ---------- sessão e jogo ----------
	let difficulty = $state<Difficulty>('medio');
	let session = $state.raw<Session | null>(null);
	let game = $state.raw<Game | null>(null);
	let started = $state(false);

	const bankKeys = $derived(new Map([...bank].map(([k, v]) => [k, v.sense])));

	// Só para mostrar na tela de início quantas lacunas cada dificuldade tem.
	const counts = $derived.by(() => {
		const out = {} as Record<Difficulty, { gaps: number; fromBank: number }>;
		for (const d of DIFFICULTIES) {
			const s = buildSession({ lyrics, lang, difficulty: d, bank: bankKeys, rng: mulberry32(1) });
			out[d] = { gaps: s.gaps.length, fromBank: s.fromBank };
		}
		return out;
	});

	// Espelho reativo do Game (que é uma classe comum).
	let phase = $state<Game['phase']>('ready');
	let activeLine = $state(-1);
	let score = $state(0);
	let combo = $state(1);
	let maxCombo = $state(1);
	let results = $state.raw<GapResult[]>([]);
	let answerable = $state.raw<GameGapConfig | null>(null);
	let waitMs = $state<number | null>(null);
	let revision = -1;

	function sync(now = performance.now()) {
		if (!game) return;
		phase = game.phase;
		activeLine = game.activeLine;
		score = game.score;
		combo = game.combo;
		maxCombo = game.maxCombo;
		waitMs = game.waitRemainingMs(now);
		if (game.revision !== revision) {
			revision = game.revision;
			results = [...game.results];
			answerable = game.answerable;
		}
	}

	/** Atraso da letra em relação ao vídeo (s). Positivo: a letra anda mais tarde. */
	let offset = $state(0);

	function apply(commands: Command[]) {
		for (const c of commands) {
			if (c.type === 'play') player?.play();
			else if (c.type === 'pause') player?.pause();
			else player?.seekTo(Math.max(0, c.to + offset));
		}
	}

	function startGame() {
		if (status !== 'ready' || !player) return;
		session = buildSession({ lyrics, lang, difficulty, bank: bankKeys, rng: Math.random });
		game = new Game(session.config);
		revision = -1;
		feedback = null;
		notice = '';
		started = true;
		apply(game.start());
		sync();
	}

	function backToStart() {
		player?.pause();
		player?.seekTo(0);
		started = false;
		game = null;
		session = null;
		results = [];
		answerable = null;
		activeLine = -1;
		phase = 'ready';
		score = 0;
		combo = 1;
		waitMs = null;
		savedNow.clear();
		summaryMessage = '';
	}

	// ---------- relógio ----------
	let clockSeconds = $state(0);
	let waveFill: SVGPathElement | undefined = $state();

	onMount(() => {
		void boot();
		let raf = requestAnimationFrame(frame);

		function frame() {
			raf = requestAnimationFrame(frame);
			if (!player) return;
			const t = player.currentTime();
			clockSeconds = Math.floor(t);
			if (duration === 0) duration = player.duration();
			if (waveFill && duration > 0) {
				waveFill.style.strokeDashoffset = String(100 - Math.min(1, t / duration) * 100);
			}
			if (!game) return;
			const now = performance.now();
			apply(game.tick(t - offset, now));
			sync(now);
		}

		const onHidden = () => {
			if (document.hidden && game?.phase === 'playing') pauseGame();
		};
		document.addEventListener('visibilitychange', onHidden);

		return () => {
			cancelAnimationFrame(raf);
			document.removeEventListener('visibilitychange', onHidden);
			player?.destroy();
			player = null;
		};
	});

	// ---------- ações do jogador ----------
	let feedback = $state<{ options: readonly string[]; chosen: string; answer: string } | null>(
		null
	);
	let notice = $state('');
	let noticeTimer: ReturnType<typeof setTimeout> | undefined;
	let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
	const PRAISE = ['Isso!', 'Na mosca!', 'Certinho!'];
	let streak = 0;

	function say(text: string, ms = 3200) {
		notice = text;
		clearTimeout(noticeTimer);
		noticeTimer = setTimeout(() => (notice = ''), ms);
	}

	function pick(option: string) {
		if (!game || !answerable) return;
		const gap = answerable;
		apply(game.answer(option));
		const result = game.results.find((r) => r.line === gap.line);
		if (!result) return;
		feedback = { options: gap.options, chosen: option, answer: gap.answer };
		clearTimeout(feedbackTimer);
		feedbackTimer = setTimeout(() => (feedback = null), 1400);
		if (result.ok) {
			say(`+${result.points} · ${PRAISE[streak++ % PRAISE.length]}`);
		} else {
			say(`Era “${gap.answer}”`);
		}
		sync();
	}

	function pauseGame() {
		if (!game) return;
		apply(game.pause(performance.now()));
		sync();
	}

	function resumeGame() {
		if (!game) return;
		apply(game.resume(performance.now()));
		sync();
	}

	function togglePause() {
		if (phase === 'paused') resumeGame();
		else if (phase === 'playing' || phase === 'waiting') pauseGame();
	}

	function repeatLine() {
		if (!game) return;
		apply(game.repeatLine(performance.now()));
		sync();
	}

	let slow = $state(false);
	function toggleSpeed() {
		slow = !slow;
		player?.setRate(slow ? 0.75 : 1);
	}

	let showPt = $state(true);

	function nudge(delta: number) {
		offset = Math.round((offset + delta) * 10) / 10;
	}

	function retry() {
		if (!game) return;
		apply(game.retry(performance.now()));
		feedback = null;
		savedNow.clear();
		sync();
	}

	function continueAfterOver() {
		if (!game) return;
		apply(game.continueAfterGameOver(performance.now()));
		sync();
	}

	// ---------- cartão de palavra ----------
	let card = $state<{
		line: number;
		token: number;
		anchor: { left: number; top: number; bottom: number; width: number };
	} | null>(null);
	let pausedByCard = false;
	let cardSaving = $state(false);

	function openCard(line: number, token: number, el: HTMLElement) {
		const r = el.getBoundingClientRect();
		card = { line, token, anchor: { left: r.left, top: r.top, bottom: r.bottom, width: r.width } };
		if (game && (phase === 'playing' || phase === 'waiting')) {
			pausedByCard = true;
			pauseGame();
		}
	}

	function closeCard() {
		if (!card) return;
		card = null;
		if (pausedByCard) {
			pausedByCard = false;
			if (phase === 'paused') resumeGame();
		}
	}

	const cardToken = $derived(card && session ? session.lines[card.line].tokens[card.token] : null);
	const cardKey = $derived(cardToken?.key ?? '');

	// ---------- salvar palavras ----------
	let saving = $state(false);
	let summaryMessage = $state('');

	interface SaveItem {
		key: string;
		text: string;
		line: number;
		sense: string;
	}

	async function saveWords(items: SaveItem[]): Promise<boolean> {
		if (!session || items.length === 0) return true;
		const lines = session.lines;
		const body = {
			workId: song.id,
			words: items.map((i) => ({
				lemma: i.key,
				sense: i.sense,
				sentence: lines[i.line].text,
				highlight: i.text,
				seconds: lines[i.line].start + offset
			}))
		};
		try {
			const res = await fetch('/musica/salvar', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!res.ok) return false;
			const out = (await res.json()) as { saved: string[]; existing: string[] };
			// O banco devolve o lema como está guardado; a chave do jogo é minúscula.
			const created = new Set(out.saved.map((l) => l.toLowerCase()));
			const done = new Set([...created, ...out.existing.map((l) => l.toLowerCase())]);
			let ok = true;
			for (const item of items) {
				const key = item.key.toLowerCase();
				if (!done.has(key)) {
					ok = false;
					continue;
				}
				bank.set(item.key, { sense: item.sense, ipa: '', pos: '' });
				if (created.has(key)) {
					savedNow.set(item.key, item.sense);
					bankTotal++;
				}
			}
			if (out.saved.length > 0) await invalidate(REVIEW_DEPENDENCY);
			return ok;
		} catch {
			return false;
		}
	}

	async function saveFromCard(sense: string) {
		if (!card || !cardToken || !cardToken.key || cardSaving) return;
		cardSaving = true;
		const ok = await saveWords([
			{ key: cardToken.key, text: cardToken.text, line: card.line, sense: sense.trim() }
		]);
		cardSaving = false;
		if (ok) closeCard();
		else say('Não deu para salvar agora. Tente de novo.');
	}

	const wrongGaps = $derived(
		session ? session.gaps.filter((g) => results.some((r) => r.line === g.line && !r.ok)) : []
	);

	async function saveAllWrong() {
		const missing = wrongGaps.filter((g) => !bank.has(g.key));
		if (missing.length === 0 || saving) return;
		saving = true;
		const ok = await saveWords(
			missing.map((g) => ({ key: g.key, text: g.answer, line: g.line, sense: '' }))
		);
		saving = false;
		summaryMessage = ok ? '' : 'Algumas palavras não foram salvas. Tente de novo.';
	}

	// ---------- teclado ----------
	function onKeydown(e: KeyboardEvent) {
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		if (e.key === 'Escape') {
			closeCard();
			return;
		}
		const target = e.target as HTMLElement | null;
		if (target?.matches('input, textarea')) return;
		if (!started || card || phase === 'gameover' || phase === 'finished') return;

		const k = e.key.toLowerCase();
		if (k >= '1' && k <= '4' && answerable) {
			const option = answerable.options[Number(k) - 1];
			if (option) pick(option);
		} else if (k === ' ') {
			e.preventDefault();
			togglePause();
		} else if (k === 'r') repeatLine();
		else if (k === 'v') toggleSpeed();
		else if (k === 't') showPt = !showPt;
	}

	function onKeyup(e: KeyboardEvent) {
		// Espaço num botão focado dispararia um clique extra na hora de soltar.
		if (
			e.key === ' ' &&
			started &&
			!card &&
			!(e.target as HTMLElement).matches('input, textarea')
		) {
			e.preventDefault();
		}
	}

	// ---------- visual ----------
	const gapByLine = $derived(new Map((session?.gaps ?? []).map((g) => [g.line, g])));
	const resultByLine = $derived(new Map(results.map((r) => [r.line, r])));
	const totalGaps = $derived(session?.gaps.length ?? 0);
	const gapNumber = $derived.by(() => {
		if (!session) return 0;
		const open = answerable ? session.gaps.findIndex((g) => g.line === answerable!.line) + 1 : 0;
		return open || results.length;
	});
	const waitSeconds = $derived(waitMs === null ? null : Math.ceil(waitMs / 1000));
	const estado = $derived(
		phase === 'waiting' && waitSeconds !== null
			? `A música espera você · ${waitSeconds}s`
			: phase === 'paused'
				? 'Pausado'
				: 'Tocando'
	);

	let lettersBox: HTMLDivElement | undefined = $state();
	let lineEls = $state<HTMLElement[]>([]);
	let rollY = $state(0);
	function center() {
		const el = lineEls[Math.max(0, activeLine)];
		if (!el || !lettersBox) return;
		rollY = Math.round(lettersBox.clientHeight * 0.46 - el.offsetTop - el.offsetHeight / 2);
	}
	$effect(() => {
		void activeLine;
		void session;
		void showPt;
		center();
	});

	// Marcas das lacunas sobre a onda de progresso.
	let waveBase: SVGPathElement | undefined = $state();
	let marks = $state<{ line: number; x: number; y: number }[]>([]);
	$effect(() => {
		if (!waveBase || !session || duration <= 0) {
			marks = [];
			return;
		}
		const len = waveBase.getTotalLength();
		marks = session.gaps.map((g) => {
			const p = waveBase!.getPointAtLength(
				Math.min(1, session!.lines[g.line].start / duration) * len
			);
			return { line: g.line, x: p.x, y: p.y };
		});
	});

	const clock = (s: number) =>
		`${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

	function optionState(option: string): 'ok' | 'err' | 'dim' | '' {
		if (!feedback || answerable) return '';
		if (option === feedback.answer) return 'ok';
		if (option === feedback.chosen) return 'err';
		return 'dim';
	}
	const shownOptions = $derived(answerable?.options ?? feedback?.options ?? []);
	const OPTION_COLORS = ['#7FA886', '#F07C7C', '#E0A458', '#6C8EBF'];

	const gameOverLine = $derived(
		phase === 'gameover' && game && session ? (session.lines[game.gameOverLine]?.text ?? '') : ''
	);
</script>

<svelte:head>
	<title>{song.title} · Música · Linguarudo</title>
</svelte:head>

<svelte:window onkeydown={onKeydown} onkeyup={onKeyup} onresize={center} />

<div class="app" data-fase={phase}>
	<header class="topo">
		<a class="x" href={resolve('/musica')} aria-label="Sair da música">
			<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
		</a>
		<div class="faixa">
			<img
				class="capa-mini"
				src={`https://i.ytimg.com/vi/${song.youtubeId}/default.jpg`}
				alt=""
				width="44"
				height="44"
			/>
			<div class="faixa-txt">
				<b>{song.title}</b>
				<small
					><span class="tg" class:it={lang === 'it'}>{lang.toUpperCase()}</span>{song.artist}</small
				>
			</div>
		</div>
		<div class="prog">
			<span class="tempo">{clock(clockSeconds)}</span>
			<svg
				class="onda"
				viewBox="0 0 300 24"
				preserveAspectRatio="none"
				role="img"
				aria-label="Progresso da música"
			>
				<path
					class="fundo"
					bind:this={waveBase}
					d="M6 14 Q 43 4 80 13 T 155 13 T 230 11 T 294 10"
					pathLength="100"
				/>
				<path
					class="cheia"
					bind:this={waveFill}
					d="M6 14 Q 43 4 80 13 T 155 13 T 230 11 T 294 10"
					pathLength="100"
				/>
				{#each marks as m (m.line)}
					{@const r = resultByLine.get(m.line)}
					<circle class="marca" class:ok={r?.ok} class:err={r && !r.ok} cx={m.x} cy={m.y} r="2.6" />
				{/each}
			</svg>
			<span class="tempo">{duration > 0 ? clock(duration) : '–:––'}</span>
		</div>
		<div class="pontos" aria-label="Pontos" data-testid="pontos">
			<span>{'0'.repeat(Math.max(0, 4 - String(score).length))}</span>{score}
		</div>
		<div class="combo" title="Combo: acerte de primeira para subir. Errar só zera o combo.">
			<svg viewBox="0 0 46 46" aria-hidden="true">
				<circle cx="23" cy="23" r="19" stroke="#ffffff1c" />
				<circle
					cx="23"
					cy="23"
					r="19"
					stroke="#B5DDAA"
					pathLength="100"
					stroke-dasharray="{((combo - 1) / 3) * 100} 100"
				/>
			</svg>
			<span data-testid="combo">×{combo}</span>
		</div>
		<div class="banco-ct" aria-live="polite">
			<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"
				><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" /><path
					d="M5 17a3 3 0 0 1 3-3h11"
				/></svg
			>
			<div><small>Seu banco</small><b data-testid="banco">{bankTotal}</b></div>
		</div>
	</header>

	<main class="palco">
		<section class="jogo">
			<div class="letra" bind:this={lettersBox}>
				{#if started}
					<div class="estado" class:espera={phase === 'waiting'} role="status" data-testid="estado">
						<span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>
						<span>{estado}</span>
					</div>
				{/if}
				{#if wrongGaps.length > 0}
					<span class="rev-pill">Para revisar · {wrongGaps.length}</span>
				{/if}
				<div class="letra-masc">
					<div class="rolo" style:transform="translateY({rollY}px)">
						{#if session}
							{#each session.lines as line, i (line.index)}
								{@const gap = gapByLine.get(i)}
								{@const result = resultByLine.get(i)}
								<div
									class="lin"
									data-line={i}
									class:atual={i === activeLine}
									class:passou={i < activeLine}
									bind:this={lineEls[i]}
								>
									<p class="txt" {lang}>
										{#each line.tokens as token, t (t)}
											{#if token.key === null}{token.text}{:else if gap && gap.token === t && !result}<span
													class="gap"
													class:alvo={answerable?.line === i}
													role="img"
													aria-label="lacuna"
												></span>{:else}<button
													type="button"
													class="w"
													class:nobanco={bank.has(token.key)}
													class:salva={savedNow.has(token.key)}
													class:ok={result?.ok && gap?.token === t}
													class:err={result && !result.ok && gap?.token === t}
													onclick={(e) => openCard(i, t, e.currentTarget)}>{token.text}</button
												>{/if}
										{/each}
									</p>
									{#if showPt && i === activeLine}
										{@const known = line.tokens.filter(
											(tk) => tk.key !== null && bank.get(tk.key)?.sense
										)}
										{#if known.length > 0}
											<p class="tr">
												{#each known as tk, n (n)}{n > 0 ? ' · ' : ''}{tk.text} = {bank.get(tk.key!)
														?.sense}{/each}
											</p>
										{/if}
									{/if}
								</div>
							{/each}
						{/if}
					</div>
				</div>
			</div>

			<div class="ctrl">
				<button class="cb" type="button" onclick={repeatLine} title="Repetir a linha (R)">
					<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"
						><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg
					>
					<span class="lbl-l">Repetir</span><kbd>R</kbd>
				</button>
				<button
					class="cb"
					class:on={slow}
					type="button"
					onclick={toggleSpeed}
					aria-pressed={slow}
					title="Velocidade (V)">{slow ? '0,75×' : '1×'}</button
				>
				<button
					class="cb"
					class:on={showPt}
					type="button"
					onclick={() => (showPt = !showPt)}
					aria-pressed={showPt}
					title="Tradução das palavras do seu banco (T)">PT</button
				>
				<button
					class="cb"
					type="button"
					onclick={togglePause}
					aria-label={phase === 'paused' ? 'Continuar' : 'Pausar'}
					title="Pausar (espaço)"
				>
					<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">
						{#if phase === 'paused'}<path d="M7 4l13 8-13 8z" />{:else}<path
								d="M8 5v14M16 5v14"
							/>{/if}
					</svg>
				</button>
				<span class="esp"></span>
				<div
					class="sync"
					role="group"
					aria-label="Sincronia da letra"
					title="Se a letra aparece cedo ou tarde demais"
				>
					<button class="cb" type="button" onclick={() => nudge(-0.5)} aria-label="Letra mais cedo"
						>−</button
					>
					<span class="sync-v">{offset > 0 ? '+' : ''}{offset.toFixed(1).replace('.', ',')}s</span>
					<button class="cb" type="button" onclick={() => nudge(0.5)} aria-label="Letra mais tarde"
						>+</button
					>
				</div>
			</div>

			<div class="resp">
				<div class="resp-cab">
					<span class="info">
						{#if totalGaps > 0}Lacuna {Math.max(1, gapNumber)} de {totalGaps}{:else}Sem lacunas{/if}
					</span>
					{#if phase === 'waiting' && waitMs !== null}
						<div class="espera-bar" data-testid="contador">
							<div class="trilho"><i style:transform="scaleX({waitMs / 10000})"></i></div>
							<span>{waitSeconds}s</span>
						</div>
					{/if}
					<span class="aviso" class:err={notice.startsWith('Era')} aria-live="polite">{notice}</span
					>
				</div>
				<div class="ops" role="group" aria-label="Escolha a palavra que falta">
					{#each shownOptions.length > 0 ? shownOptions : ['', '', '', ''] as option, i (i)}
						{@const state = option ? optionState(option) : ''}
						<button
							type="button"
							class="op"
							class:vazia={!option}
							class:certa={state === 'ok'}
							class:errou={state === 'err'}
							class:apaga={state === 'dim'}
							style:--c={OPTION_COLORS[i]}
							disabled={!option || !answerable}
							aria-keyshortcuts={String(i + 1)}
							onclick={() => pick(option)}
						>
							{#if option}<span class="k">{i + 1}</span>{option}{:else}·{/if}
						</button>
					{/each}
				</div>
			</div>
		</section>

		<aside class="lado">
			<div class="video">
				<div class="video-host" bind:this={host}></div>
			</div>
			<div class="rev">
				<h3>Para revisar <span data-testid="rev-n">{wrongGaps.length}</span></h3>
				<p class="sub">Errou? A palavra fica aqui. Sem pontos perdidos.</p>
				<ul>
					{#each [...wrongGaps].reverse() as gap (gap.line)}
						<li>
							<b>{gap.key}</b>
							<em>{bank.get(gap.key)?.sense ?? ''}</em>
							<span class="tag">errou</span>
						</li>
					{/each}
				</ul>
				{#if wrongGaps.length === 0}<p class="vazio">Nada por aqui ainda.</p>{/if}
			</div>
			<div class="atalhos">
				<kbd>1</kbd>–<kbd>4</kbd> responde · <kbd>R</kbd> repete a linha · <kbd>V</kbd>
				velocidade<br />
				<kbd>T</kbd> tradução · <kbd>espaço</kbd> pausa · toque numa palavra
			</div>
		</aside>
	</main>
</div>

{#if card && cardToken && session}
	<WordCard
		{lang}
		text={cardToken.text}
		tokens={session.lines[card.line].tokens}
		highlightIndex={card.token}
		anchor={card.anchor}
		inBank={bank.get(cardKey) ?? null}
		saving={cardSaving}
		onsave={saveFromCard}
		onclose={closeCard}
	/>
{/if}

{#if !started}
	<Inicio
		title={song.title}
		artist={song.artist}
		{lang}
		bind:difficulty
		{counts}
		{status}
		message={statusMessage}
		onstart={startGame}
		onretry={boot}
	/>
{/if}

{#if phase === 'gameover' && game}
	<FimDeJogo
		line={gameOverLine}
		correct={results.filter((r) => r.ok).length}
		total={totalGaps}
		answered={results.length}
		wrong={results.filter((r) => !r.ok).length}
		onretry={retry}
		oncontinue={continueAfterOver}
		onleave={() => goto(resolve('/musica'))}
	/>
{/if}

{#if phase === 'finished' && game}
	<Resumo
		correct={results.filter((r) => r.ok).length}
		total={totalGaps}
		{score}
		{maxCombo}
		wrong={wrongGaps}
		isInBank={(key) => bank.has(key)}
		saved={[...savedNow].map(([key, sense]) => ({ key, sense }))}
		senseOf={(key) => bank.get(key)?.sense ?? ''}
		{bankTotal}
		{saving}
		message={summaryMessage}
		onsaveall={saveAllWrong}
		onagain={backToStart}
	/>
{/if}

<style>
	.app {
		--salvia-cl: #b5ddaa;
		--coral-esc: var(--coral-escuro);
		position: fixed;
		inset: 0;
		display: grid;
		grid-template-rows: auto 1fr;
		background: var(--verde-escuro);
		color: var(--creme);
		overflow: hidden;
	}

	.ic {
		width: 20px;
		height: 20px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2.2;
		stroke-linecap: round;
		stroke-linejoin: round;
		flex: none;
	}

	/* ===== topo ===== */
	.topo {
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 12px 22px;
		background: var(--verde);
		position: relative;
		z-index: 5;
	}

	.x {
		width: 40px;
		height: 40px;
		border-radius: 12px;
		display: grid;
		place-items: center;
		color: var(--verde-texto);
		flex: none;
	}

	.x:hover {
		background: #ffffff12;
		color: var(--creme);
	}

	.faixa {
		display: flex;
		align-items: center;
		gap: 12px;
		min-width: 0;
		flex: 0 1 auto;
	}

	.capa-mini {
		width: 44px;
		height: 44px;
		border-radius: 11px;
		flex: none;
		object-fit: cover;
		background: var(--verde-medio);
	}

	.faixa-txt {
		min-width: 0;
	}

	.faixa-txt b {
		display: block;
		font-size: 16px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 26ch;
	}

	.faixa-txt small {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--verde-texto);
		font-size: 13px;
		font-weight: 650;
		white-space: nowrap;
	}

	.tg {
		font-size: 11px;
		font-weight: 850;
		letter-spacing: 0.05em;
		border-radius: 6px;
		padding: 1px 6px;
		background: var(--salvia-claro);
		color: var(--verde);
	}

	.tg.it {
		background: #f6e2c2;
		color: #7a4b12;
	}

	.prog {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 120px;
	}

	.tempo {
		font:
			700 13px/1 ui-monospace,
			SFMono-Regular,
			Menlo,
			monospace;
		color: var(--verde-texto);
		white-space: nowrap;
	}

	.onda {
		flex: 1;
		height: 24px;
		min-width: 60px;
		overflow: visible;
	}

	.onda path {
		fill: none;
		stroke-linecap: round;
		stroke-width: 7;
	}

	.onda .fundo {
		stroke: #ffffff1c;
	}

	.onda .cheia {
		stroke: var(--salvia);
		stroke-dasharray: 100 200;
		stroke-dashoffset: 100;
	}

	.onda .marca {
		fill: #ffffff40;
	}

	.onda .marca.ok {
		fill: var(--salvia-cl);
	}

	.onda .marca.err {
		fill: var(--coral);
	}

	.pontos {
		font:
			800 20px/1 ui-monospace,
			SFMono-Regular,
			Menlo,
			monospace;
		letter-spacing: 0.03em;
	}

	.pontos span {
		color: #ffffff40;
	}

	.combo {
		position: relative;
		width: 46px;
		height: 46px;
		display: grid;
		place-items: center;
		font-weight: 900;
		font-size: 15px;
		flex: none;
	}

	.combo svg {
		position: absolute;
		inset: 0;
		transform: rotate(-90deg);
	}

	.combo circle {
		fill: none;
		stroke-width: 4;
		stroke-linecap: round;
	}

	.combo circle:last-child {
		transition: stroke-dasharray 0.4s;
	}

	.banco-ct {
		display: flex;
		align-items: center;
		gap: 10px;
		background: var(--verde-escuro);
		border-radius: 14px;
		padding: 6px 14px 6px 12px;
		flex: none;
	}

	.banco-ct .ic {
		color: var(--salvia);
	}

	.banco-ct small {
		display: block;
		font-size: 11px;
		font-weight: 800;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #9db8a6;
		line-height: 1.1;
	}

	.banco-ct b {
		display: block;
		font-size: 19px;
		line-height: 1.1;
	}

	/* ===== palco ===== */
	.palco {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 320px;
		gap: 20px;
		padding: 18px 22px 20px;
		min-height: 0;
		max-width: 1440px;
		width: 100%;
		margin: 0 auto;
	}

	.jogo {
		display: flex;
		flex-direction: column;
		gap: 14px;
		min-height: 0;
		min-width: 0;
	}

	.letra {
		position: relative;
		flex: 1;
		min-height: 0;
		overflow: hidden;
		border-radius: 24px;
		background: var(--verde);
	}

	.letra-masc {
		position: absolute;
		inset: 0;
		-webkit-mask: linear-gradient(transparent, #000 24%, #000 82%, transparent);
		mask: linear-gradient(transparent, #000 24%, #000 82%, transparent);
	}

	.rolo {
		position: absolute;
		left: 0;
		right: 0;
		top: 0;
		padding: 0 28px;
		transition: transform 0.55s cubic-bezier(0.3, 1, 0.4, 1);
	}

	.lin {
		text-align: center;
		padding: 10px 0;
	}

	.txt {
		margin: 0;
		font-size: 22px;
		font-weight: 780;
		color: #ffffff4d;
		transition:
			color 0.3s,
			font-size 0.3s;
		line-height: 1.35;
	}

	.lin.passou .txt {
		color: #ffffff8c;
	}

	.lin.atual .txt {
		color: var(--creme);
		font-size: 31px;
	}

	.tr {
		margin: 2px 0 0;
		font-size: 14px;
		font-weight: 600;
		color: var(--verde-texto);
	}

	.w {
		border: 0;
		background: none;
		padding: 0 1px;
		margin: 0;
		font: inherit;
		color: inherit;
		border-radius: 6px;
		transition:
			color 0.15s,
			background 0.15s;
	}

	.w:hover {
		background: #ffffff14;
	}

	.w.nobanco {
		text-decoration: underline dotted 2px var(--ouro);
		text-underline-offset: 5px;
	}

	.w.salva {
		text-decoration: underline solid 2.5px var(--ouro);
		text-underline-offset: 5px;
	}

	.gap {
		display: inline-block;
		min-width: 3.6em;
		border-bottom: 3px dashed currentColor;
		line-height: 1.05;
		opacity: 0.75;
		vertical-align: baseline;
	}

	.gap::before {
		content: '\00a0';
	}

	.gap.alvo {
		opacity: 1;
		color: var(--coral);
		border-bottom-style: solid;
		background: #f07c7c24;
		border-radius: 8px 8px 2px 2px;
		animation: pisca 1.2s ease-in-out infinite;
	}

	@keyframes pisca {
		50% {
			background: #f07c7c0d;
			border-color: #f07c7c80;
		}
	}

	.w.ok,
	.w.err {
		border-radius: 8px;
		padding: 0 6px;
		animation: pega 0.4s;
	}

	.lin .txt .w.ok {
		background: #b5ddaa2e;
		color: var(--salvia-cl);
	}

	.lin .txt .w.err {
		background: #f07c7c33;
		color: #f7b0ae;
	}

	@keyframes pega {
		0% {
			transform: scale(0.5);
		}
		60% {
			transform: scale(1.12);
		}
	}

	.estado {
		position: absolute;
		left: 50%;
		top: 14px;
		translate: -50% 0;
		z-index: 2;
		display: flex;
		align-items: center;
		gap: 8px;
		background: var(--verde-escuro);
		border-radius: 99px;
		padding: 7px 14px 7px 10px;
		font-size: 14px;
		font-weight: 800;
		color: var(--verde-texto);
		white-space: nowrap;
	}

	.estado.espera {
		color: var(--creme);
		background: #0f4a3b;
		box-shadow: 0 0 0 1.5px #ffffff22;
	}

	.eq {
		display: flex;
		gap: 3px;
		align-items: flex-end;
		height: 14px;
	}

	.eq i {
		width: 3px;
		height: 4px;
		background: var(--salvia);
		border-radius: 2px;
	}

	.app[data-fase='playing'] .eq i {
		animation: eq 0.9s ease-in-out infinite alternate;
	}

	.eq i:nth-child(2) {
		animation-delay: -0.3s;
	}

	.eq i:nth-child(3) {
		animation-delay: -0.6s;
	}

	@keyframes eq {
		from {
			height: 4px;
		}
		to {
			height: 14px;
		}
	}

	.rev-pill {
		display: none;
	}

	/* controles */
	.ctrl {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.cb {
		border: 0;
		background: var(--verde);
		color: inherit;
		border-radius: 12px;
		height: 42px;
		min-width: 42px;
		padding: 0 12px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 7px;
		font-weight: 800;
		font-size: 14px;
		white-space: nowrap;
	}

	.cb:hover {
		background: var(--verde-medio);
	}

	.cb.on {
		background: var(--creme);
		color: var(--verde);
	}

	.cb kbd {
		font: 700 11px/1 var(--fonte);
		border: 1px solid #ffffff38;
		border-radius: 5px;
		padding: 2px 5px;
		color: #9db8a6;
	}

	.esp {
		flex: 1;
	}

	.sync {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.sync .cb {
		min-width: 36px;
		padding: 0;
		font-size: 18px;
	}

	.sync-v {
		min-width: 3.6em;
		text-align: center;
		font:
			700 12px/1 ui-monospace,
			monospace;
		color: var(--verde-texto);
	}

	/* opções */
	.resp {
		background: var(--verde);
		border-radius: 24px;
		padding: 14px 16px 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.resp-cab {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 26px;
		font-size: 14px;
		font-weight: 700;
		color: var(--verde-texto);
	}

	.info {
		white-space: nowrap;
	}

	.espera-bar {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
		max-width: 220px;
	}

	.trilho {
		flex: 1;
		height: 6px;
		border-radius: 99px;
		background: #ffffff1a;
		overflow: hidden;
	}

	.trilho i {
		display: block;
		height: 100%;
		width: 100%;
		background: var(--ouro);
		border-radius: inherit;
		transform-origin: 0 50%;
	}

	.espera-bar span {
		font:
			800 12px/1 ui-monospace,
			monospace;
		color: var(--ouro);
		min-width: 2.4em;
	}

	.aviso {
		flex: 1;
		min-width: 0;
		text-align: right;
		font-weight: 800;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--salvia-cl);
	}

	.aviso.err {
		color: #f7b0ae;
	}

	.ops {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}

	.op {
		position: relative;
		border: 0;
		background: var(--creme);
		color: var(--verde-escuro);
		border-radius: 16px;
		padding: 15px 14px 15px 54px;
		min-height: 60px;
		font-weight: 850;
		font-size: 20px;
		text-align: left;
		box-shadow: 0 5px 0 var(--c);
		transition:
			transform 0.08s,
			background 0.2s,
			opacity 0.2s;
	}

	.op .k {
		position: absolute;
		left: 14px;
		top: 50%;
		translate: 0 -50%;
		width: 28px;
		height: 28px;
		border-radius: 8px;
		background: var(--c);
		color: var(--verde-escuro);
		display: grid;
		place-items: center;
		font-size: 14px;
	}

	.op:active:not(:disabled) {
		transform: translateY(4px);
		box-shadow: 0 1px 0 var(--c);
	}

	.op:disabled {
		cursor: default;
	}

	.op.vazia {
		background: #ffffff08;
		box-shadow: none;
		color: transparent;
		border: 2px dashed #ffffff1c;
	}

	.op.apaga {
		opacity: 0.35;
	}

	.op.errou {
		background: var(--coral-claro);
		animation: nao 0.35s;
		opacity: 1;
	}

	.op.certa {
		background: var(--salvia-cl);
		opacity: 1;
		box-shadow: 0 5px 0 #5f8f6b;
	}

	.op.certa .k,
	.op.errou .k {
		font-size: 0;
		color: #fff;
	}

	.op.certa .k {
		background: #4e7f5b;
	}

	.op.errou .k {
		background: var(--coral-esc);
	}

	.op.certa .k::after {
		content: '✓';
		font-size: 16px;
	}

	.op.errou .k::after {
		content: '✕';
		font-size: 15px;
	}

	@keyframes nao {
		25%,
		75% {
			transform: translateX(-5px);
		}
		50% {
			transform: translateX(5px);
		}
	}

	/* lado */
	.lado {
		display: flex;
		flex-direction: column;
		gap: 14px;
		min-height: 0;
	}

	.video {
		background: var(--verde);
		border-radius: 24px;
		padding: 12px;
	}

	.video-host {
		position: relative;
		aspect-ratio: 16 / 9;
		border-radius: 14px;
		overflow: hidden;
		background: #000;
	}

	/* A pessoa não mexe no vídeo: quem manda é o jogo. */
	.video-host :global(iframe) {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		border: 0;
		pointer-events: none;
	}

	.rev {
		background: var(--verde);
		border-radius: 24px;
		padding: 16px;
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	.rev h3 {
		margin: 0;
		font-size: 16px;
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.rev h3 span {
		margin-left: auto;
		font-size: 13px;
		color: #9db8a6;
	}

	.rev .sub {
		font-size: 13px;
		color: var(--verde-texto);
		margin: 4px 0 12px;
	}

	.rev ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
		overflow: auto;
		min-height: 0;
	}

	.rev li {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 0 10px;
		background: #ffffff0d;
		border-radius: 12px;
		padding: 8px 12px;
		align-items: center;
		animation: chega 0.55s;
	}

	@keyframes chega {
		0% {
			background: #f07c7c55;
			transform: scale(0.94);
		}
	}

	.rev li b {
		font-size: 16px;
	}

	.rev li em {
		font-style: normal;
		font-size: 13px;
		color: var(--verde-texto);
	}

	.rev li .tag {
		grid-row: 1 / 3;
		grid-column: 2;
		font-size: 11px;
		font-weight: 800;
		border-radius: 6px;
		padding: 2px 7px;
		background: #f07c7c2e;
		color: #f7b0ae;
	}

	.rev .vazio {
		border: 1.5px dashed #ffffff26;
		border-radius: 14px;
		padding: 14px;
		font-size: 14px;
		color: var(--verde-texto);
		font-weight: 600;
		text-align: center;
		margin: 0;
	}

	.atalhos {
		font-size: 12px;
		color: #9db8a6;
		line-height: 1.9;
	}

	.atalhos kbd {
		font: inherit;
		font-weight: 700;
		border: 1px solid #ffffff30;
		border-radius: 5px;
		padding: 0 5px;
		color: var(--verde-texto);
	}

	/* ===== responsivo ===== */
	@media (max-width: 1100px) {
		.palco {
			grid-template-columns: minmax(0, 1fr) 270px;
		}
	}

	@media (max-width: 860px) {
		.topo {
			flex-wrap: wrap;
			gap: 8px 10px;
			padding: 8px 12px 10px;
		}

		.x {
			width: 36px;
			height: 36px;
			margin-left: -6px;
		}

		.faixa {
			flex: 1;
		}

		.capa-mini {
			width: 36px;
			height: 36px;
			border-radius: 9px;
		}

		.faixa-txt b {
			font-size: 15px;
		}

		.faixa-txt small {
			font-size: 12px;
		}

		.pontos {
			display: none;
		}

		.combo {
			width: 40px;
			height: 40px;
			font-size: 13px;
		}

		.banco-ct {
			padding: 5px 10px;
		}

		.banco-ct .ic {
			display: none;
		}

		.banco-ct b {
			font-size: 16px;
		}

		.prog {
			order: 9;
			flex-basis: 100%;
			gap: 8px;
		}

		.onda {
			height: 18px;
		}

		.onda path {
			stroke-width: 6;
		}

		.palco {
			grid-template-columns: 1fr;
			grid-template-rows: auto minmax(0, 1fr);
			padding: 10px 12px 0;
			gap: 10px;
		}

		.lado {
			order: -1;
		}

		.rev,
		.atalhos {
			display: none;
		}

		.video {
			padding: 0;
			background: none;
			border-radius: 14px;
		}

		.video-host {
			width: min(100%, 320px);
			margin: 0 auto;
		}

		.jogo {
			gap: 10px;
		}

		.letra {
			border-radius: 20px;
		}

		.rolo {
			padding: 0 14px;
		}

		.lin {
			padding: 7px 0;
		}

		.txt {
			font-size: 17px;
		}

		.lin.atual .txt {
			font-size: 22px;
		}

		.tr {
			font-size: 12.5px;
		}

		.estado {
			top: 10px;
			font-size: 12.5px;
			padding: 5px 12px 5px 9px;
		}

		.rev-pill {
			display: inline-flex;
			position: absolute;
			right: 10px;
			bottom: 10px;
			z-index: 2;
			background: var(--verde-escuro);
			border-radius: 99px;
			padding: 4px 10px;
			font-size: 12px;
			font-weight: 800;
			color: #f7b0ae;
		}

		.ctrl {
			gap: 6px;
		}

		.cb {
			height: 40px;
			min-width: 40px;
			padding: 0 10px;
			font-size: 13px;
		}

		.cb kbd,
		.lbl-l {
			display: none;
		}

		.sync-v {
			display: none;
		}

		.resp {
			margin: 0 -12px;
			border-radius: 22px 22px 0 0;
			padding: 12px 12px calc(14px + env(safe-area-inset-bottom));
		}

		.resp-cab {
			font-size: 13px;
		}

		.ops {
			gap: 10px;
		}

		.op {
			min-height: 62px;
			font-size: 19px;
			padding: 12px 10px 12px 46px;
			border-radius: 15px;
		}

		.op .k {
			left: 11px;
			width: 26px;
			height: 26px;
			font-size: 13px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.rolo {
			transition: none;
		}
	}
</style>
