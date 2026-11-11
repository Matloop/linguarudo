<script lang="ts">
	import { goto, invalidate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { languageLabel } from '#lib/languages.ts';
	import { REVIEW_DEPENDENCY } from '#lib/review.ts';
	import FimDeJogo from '#lib/music/FimDeJogo.svelte';
	import Inicio from '#lib/music/Inicio.svelte';
	import Resumo from '#lib/music/Resumo.svelte';
	import Sincronia from '#lib/music/Sincronia.svelte';
	import WordCard from '#lib/music/WordCard.svelte';
	import { DIFFICULTIES, type Difficulty } from '#lib/music/gaps.ts';
	import { Game, type Command, type GameGapConfig, type GapResult } from '#lib/music/game.ts';
	import type { LyricLine } from '#lib/music/lrc.ts';
	import { clampOffset, durationHint, formatOffset, offsetFromMark } from '#lib/music/offset.ts';
	import { mulberry32 } from '#lib/music/rng.ts';
	import { buildSession, type Session } from '#lib/music/session.ts';
	import type { PlayerAdapter } from '#lib/music/youtube.ts';
	import { createYoutubePlayer } from '#lib/music/youtube-player.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const song = $derived(data.song);
	const lang = $derived(song.language);
	const langName = $derived(languageLabel(lang, data.shell?.uiLanguage ?? 'pt'));

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
	/** Duração da faixa no LRCLIB (s), para o palpite de sincronia. */
	let trackDuration = $state<number | null>(null);

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
				const body = (await res.json()) as { lines: LyricLine[]; duration?: number | null };
				lyrics = body.lines;
				trackDuration = typeof body.duration === 'number' ? body.duration : null;
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
					if (syncing) {
						syncPlaying = false;
						return;
					}
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
	/** O que está salvo na obra; null = a pessoa nunca sincronizou esta música. */
	let savedOffset = $state<number | null>(null);
	let hintDismissed = $state(false);
	let loadedSong = '';
	$effect.pre(() => {
		if (data.song.id === loadedSong) return;
		loadedSong = data.song.id;
		offset = data.song.sync.offset ?? 0;
		savedOffset = data.song.sync.offset;
		hintDismissed = data.song.sync.hintDismissed;
	});
	const hint = $derived(
		savedOffset === null && !hintDismissed ? durationHint(duration, trackDuration) : null
	);

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
	let progFill: HTMLDivElement | undefined = $state();

	onMount(() => {
		void boot();
		let raf = requestAnimationFrame(frame);

		function frame() {
			raf = requestAnimationFrame(frame);
			if (!player) return;
			const t = player.currentTime();
			clockSeconds = Math.floor(t);
			if (syncing) syncTime = t;
			if (duration === 0) duration = player.duration();
			if (progFill && duration > 0) {
				progFill.style.width = `${Math.min(1, t / duration) * 100}%`;
			}
			if (!game) return;
			const now = performance.now();
			apply(game.tick(t - offset, now));
			sync(now);
		}

		const onHidden = () => {
			if (!document.hidden) return;
			if (syncing) {
				player?.pause();
				syncPlaying = false;
			} else if (game?.phase === 'playing') pauseGame();
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
	let noticeTone = $state<'ok' | 'err' | ''>('');
	let noticeTimer: ReturnType<typeof setTimeout> | undefined;
	let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
	const PRAISE = ['Isso!', 'Na mosca!', 'Certinho!'];
	let streak = 0;

	function say(text: string, ms = 3200, tone: 'ok' | 'err' | '' = '') {
		notice = text;
		noticeTone = tone;
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
			say(`${PRAISE[streak++ % PRAISE.length]} +${result.points}`, 3200, 'ok');
		} else {
			say(`Era “${gap.answer}”. Foi para revisar.`, 3200, 'err');
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

	// ---------- sincronia da letra ----------
	async function persistSync(patch: { offset?: number; hintDismissed?: boolean }) {
		try {
			const res = await fetch('/musica/sincronia', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ workId: song.id, ...patch })
			});
			return res.ok;
		} catch {
			return false;
		}
	}

	async function saveOffset(message = '') {
		const value = offset;
		if (await persistSync({ offset: value })) {
			savedOffset = value;
			if (message) say(message, 4200);
		} else {
			say('Não deu para salvar a sincronia agora.');
		}
	}

	let nudgeTimer: ReturnType<typeof setTimeout> | undefined;
	/** −/+ da barra: ajusta na hora e salva quando a pessoa para de mexer. */
	function nudge(delta: number) {
		offset = clampOffset(offset + delta);
		if (syncing) return;
		clearTimeout(nudgeTimer);
		nudgeTimer = setTimeout(() => void saveOffset(), 900);
	}

	function applyHint() {
		if (hint === null) return;
		offset = hint;
		void saveOffset();
	}

	function dismissHint() {
		hintDismissed = true;
		void persistSync({ hintDismissed: true });
	}

	function syncFromHint() {
		startGame();
		openSync();
	}

	let syncing = $state(false);
	let syncTarget = $state(0);
	let syncTime = $state(0);
	let syncPlaying = $state(false);
	let syncFeedback = $state('');
	let syncBefore = { offset: 0, time: 0 };

	function lineAt(lyricTime: number) {
		const lines = session?.lines ?? [];
		let found = -1;
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].start <= lyricTime) found = i;
			else break;
		}
		return found;
	}

	function syncSeek(to: number) {
		player?.seekTo(Math.max(0, to));
		syncTime = Math.max(0, to);
	}

	function syncPlay(on: boolean) {
		if (on) player?.play();
		else player?.pause();
		syncPlaying = on;
	}

	function openSync() {
		if (!game || !player || !session || syncing) return;
		if (phase === 'gameover' || phase === 'finished') return;
		closeCard();
		clearTimeout(nudgeTimer);
		if (phase === 'playing' || phase === 'waiting') pauseGame();
		const now = player.currentTime();
		syncBefore = { offset, time: now };
		syncing = true;
		syncFeedback = '';
		if (savedOffset === null) {
			// Nunca ajustada: o que costuma estar errado é a intro, então começa do zero.
			syncSeek(0);
			syncTarget = 0;
		} else {
			const from = Math.max(0, now - 5);
			syncSeek(from);
			const next = session.lines.findIndex((l) => l.start + offset > from);
			syncTarget = next < 0 ? session.lines.length - 1 : next;
		}
		syncPlay(true);
	}

	function markLine() {
		if (!player || !session) return;
		const line = session.lines[syncTarget];
		if (!line) return;
		offset = offsetFromMark(player.currentTime(), line.start);
		syncFeedback = `Pela linha ${syncTarget + 1}: ${formatOffset(offset)}. Confira na próxima e marque de novo se precisar.`;
		syncTarget = Math.min(syncTarget + 1, session.lines.length);
	}

	function moveTarget(delta: number) {
		if (!session) return;
		syncTarget = Math.max(0, Math.min(session.lines.length - 1, syncTarget + delta));
	}

	function closeSync(conclude: boolean) {
		if (!syncing || !game) return;
		if (!conclude) offset = syncBefore.offset;
		syncPlay(false);
		syncing = false;
		// Volta ao começo da linha em que o jogo estava, já com o deslocamento final, e espera o play.
		const commands = game.rewindToLine(performance.now());
		if (commands.length > 0) apply(commands);
		else player?.seekTo(syncBefore.time);
		sync();
		if (conclude)
			void saveOffset(`Sincronia salva: ${formatOffset(offset)}. Toque play para continuar.`);
		else say('Ajuste cancelado.');
	}

	function onSyncKey(e: KeyboardEvent) {
		const step = e.shiftKey ? 1 : 0.1;
		const k = e.key;
		if (k === ' ') {
			e.preventDefault();
			markLine();
		} else if (k === 'p' || k === 'P') syncPlay(!syncPlaying);
		else if (k === 'ArrowLeft') {
			e.preventDefault();
			nudge(-step);
		} else if (k === 'ArrowRight') {
			e.preventDefault();
			nudge(step);
		} else if (k === 'ArrowUp') {
			e.preventDefault();
			moveTarget(-1);
		} else if (k === 'ArrowDown') {
			e.preventDefault();
			moveTarget(1);
		} else if (k === 'Enter') {
			e.preventDefault();
			closeSync(true);
		} else if (k === 'Escape') closeSync(false);
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
		if (syncing) {
			onSyncKey(e);
			return;
		}
		if (e.key === 'Escape') {
			revOpen = false;
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
		else if (k === 's') openSync();
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
		syncing
			? 'Ajustando a sincronia'
			: phase === 'waiting'
				? 'A música espera você'
				: phase === 'paused'
					? 'Pausado'
					: answerable
						? 'Escolha a palavra que falta'
						: 'Tocando'
	);
	/** Tocando, o resultado da resposta toma o lugar da dica; nos outros estados ficam os dois. */
	const estadoOculto = $derived(!syncing && phase === 'playing' && notice !== '');

	// ---------- popover "para revisar" ----------
	let revOpen = $state(false);
	let revChip: HTMLButtonElement | undefined = $state();
	let revPop: HTMLDivElement | undefined = $state();
	$effect(() => {
		if (wrongGaps.length === 0) revOpen = false;
	});
	function onPointerdown(e: PointerEvent) {
		if (!revOpen) return;
		const t = e.target as Node;
		if (revChip?.contains(t) || revPop?.contains(t)) return;
		revOpen = false;
	}

	let lettersBox: HTMLDivElement | undefined = $state();
	let lineEls = $state<HTMLElement[]>([]);
	let rollY = $state(0);
	/** Na sincronia o jogo está parado: a linha acesa segue o vídeo com o deslocamento. */
	const shownLine = $derived(syncing ? lineAt(syncTime - offset) : activeLine);
	function center() {
		const el = lineEls[Math.max(0, shownLine)];
		if (!el || !lettersBox) return;
		rollY = Math.round(lettersBox.clientHeight * 0.46 - el.offsetTop - el.offsetHeight / 2);
	}
	$effect(() => {
		void shownLine;
		void session;
		void showPt;
		center();
	});

	// Marcas das lacunas sobre a trilha de progresso (em % da duração do vídeo).
	const marks = $derived.by(() => {
		if (!session || duration <= 0) return [];
		const lines = session.lines;
		return session.gaps.map((g) => ({
			line: g.line,
			pct: Math.max(0, Math.min(1, (lines[g.line].start + offset) / duration)) * 100
		}));
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

	const gameOverLine = $derived(
		phase === 'gameover' && game && session ? (session.lines[game.gameOverLine]?.text ?? '') : ''
	);
</script>

<svelte:head>
	<title>{song.title} · Música · Linguetta</title>
</svelte:head>

<svelte:window
	onkeydown={onKeydown}
	onkeyup={onKeyup}
	onresize={center}
	onpointerdown={onPointerdown}
/>

<div class="app" data-fase={phase}>
	<header class="topo">
		<div class="t-esq">
			<a class="x" href={resolve('/musica')} aria-label="Sair da música">
				<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
			</a>
			<div class="faixa">
				<b>{song.title}</b>
				<span>{song.artist} · {langName}</span>
			</div>
		</div>

		<div class="prog">
			<div class="trilha" role="img" aria-label="Progresso da música">
				<div class="fill" bind:this={progFill}></div>
				{#each marks as m (m.line)}
					{@const r = resultByLine.get(m.line)}
					<span
						class="gp"
						class:ok={r?.ok}
						class:err={r && !r.ok}
						class:cur={!r && answerable?.line === m.line}
						style:left="{m.pct}%"
					></span>
				{/each}
			</div>
			<div class="tempos">
				<span>{clock(clockSeconds)}</span><span>{duration > 0 ? clock(duration) : '–:––'}</span>
			</div>
		</div>

		<div class="t-dir">
			<button
				type="button"
				class="chip-rev"
				bind:this={revChip}
				hidden={wrongGaps.length === 0}
				aria-expanded={revOpen}
				aria-controls="pop-rev"
				onclick={() => (revOpen = !revOpen)}
			>
				<svg class="ic sm" viewBox="0 0 24 24" aria-hidden="true"
					><path d="M4 12a8 8 0 0 1 14-5l2 2M20 12a8 8 0 0 1-14 5l-2-2" /></svg
				>
				<span data-testid="rev-n">{wrongGaps.length}</span><span class="lbl-l">para revisar</span>
			</button>
			<div class="placar" title="Combo: acerte de primeira para subir. Errar só zera o combo.">
				<b aria-label="Pontos" data-testid="pontos">{score.toLocaleString('pt-BR')}</b>
				<span class="combo" class:ativo={combo > 1} data-testid="combo">×{combo}</span>
			</div>
		</div>

		<div class="pop" id="pop-rev" bind:this={revPop} hidden={!revOpen}>
			<h3>Para revisar</h3>
			<p>Errou? A palavra fica aqui. Você salva no banco no fim da música.</p>
			<ul>
				{#each [...wrongGaps].reverse() as gap (gap.line)}
					<li><b {lang}>{gap.key}</b><span>{bank.get(gap.key)?.sense ?? ''}</span></li>
				{/each}
			</ul>
			<p class="banco-ct" aria-live="polite">
				Seu banco: <b data-testid="banco">{bankTotal}</b>
				{bankTotal === 1 ? 'palavra' : 'palavras'}
			</p>
		</div>
	</header>

	<main class="palco">
		<div class="video">
			<div class="video-host" bind:this={host}></div>
		</div>
		<div class="letra" bind:this={lettersBox}>
			<div class="letra-masc">
				<div class="rolo" style:transform="translateY({rollY}px)">
					{#if session}
						{#each session.lines as line, i (line.index)}
							{@const gap = gapByLine.get(i)}
							{@const result = resultByLine.get(i)}
							<div
								class="lin"
								data-line={i}
								class:atual={i === shownLine}
								class:passou={i < shownLine}
								class:alvo-sinc={syncing && i === syncTarget}
								bind:this={lineEls[i]}
							>
								{#if syncing}
									<p class="txt" {lang}>
										<button
											type="button"
											class="lin-alvo"
											title="Marcar esta linha"
											onclick={() => (syncTarget = i)}>{line.text}</button
										>
									</p>
								{:else}
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
								{/if}
								{#if showPt && !syncing && i === activeLine}
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
	</main>

	<section class="resp" class:sinc-on={syncing}>
		<div class="status">
			{#if started}
				<span
					class="estado"
					class:espera={phase === 'waiting' && !syncing}
					class:oculto={estadoOculto}
					role="status"
					data-testid="estado"
				>
					{#if phase === 'playing' && !syncing}<span class="eq" aria-hidden="true"
							><i></i><i></i><i></i></span
						>{/if}{estado}
				</span>
			{/if}
			{#if phase === 'waiting' && waitMs !== null && !syncing}
				<span class="cd" data-testid="contador">
					<span class="bar"><i style:transform="scaleX({waitMs / 10000})"></i></span>
					{waitSeconds} s
				</span>
			{/if}
			<span class="aviso {noticeTone}" class:so={estadoOculto} aria-live="polite">{notice}</span>
		</div>

		{#if syncing && session}
			<div class="sinc-box">
				<Sincronia
					lines={session.lines}
					{offset}
					target={syncTarget}
					time={syncTime}
					{duration}
					playing={syncPlaying}
					feedback={syncFeedback}
					onmark={markLine}
					onnudge={nudge}
					onzero={() => {
						offset = 0;
						syncFeedback = '';
					}}
					onrestart={() => {
						syncSeek(0);
						syncTarget = 0;
						syncPlay(true);
					}}
					onback={() => syncSeek((player?.currentTime() ?? 0) - 5)}
					ontoggle={() => syncPlay(!syncPlaying)}
					oncancel={() => closeSync(false)}
					onconclude={() => closeSync(true)}
				/>
			</div>
		{:else}
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
						disabled={!option || !answerable}
						aria-keyshortcuts={String(i + 1)}
						onclick={() => pick(option)}
					>
						{#if option}<kbd class="k">{i + 1}</kbd><span {lang}>{option}</span>{/if}
					</button>
				{/each}
			</div>
		{/if}
	</section>

	<footer class="baixo">
		<div class="tools">
			{#if !syncing}
				<button
					class="tool"
					type="button"
					onclick={togglePause}
					aria-label={phase === 'paused' ? 'Continuar' : 'Pausar'}
					title={phase === 'paused' ? 'Continuar (espaço)' : 'Pausar (espaço)'}
				>
					<svg class="ic sm" viewBox="0 0 24 24" aria-hidden="true">
						{#if phase === 'paused'}<path d="M8 5v14l11-7z" />{:else}<path
								d="M8 5v14M16 5v14"
							/>{/if}
					</svg>
					<span class="lbl">{phase === 'paused' ? 'Continuar' : 'Pausar'}</span>
					<kbd aria-hidden="true">␣</kbd>
				</button>
				<button class="tool" type="button" onclick={repeatLine} title="Repetir a linha (R)">
					<svg class="ic sm" viewBox="0 0 24 24" aria-hidden="true"
						><path d="M4 12a8 8 0 1 0 3-6.2" /><path d="M4 4v4h4" /></svg
					>
					<span class="lbl">Repetir</span><kbd aria-hidden="true">R</kbd>
				</button>
				<button
					class="tool"
					class:on={showPt}
					type="button"
					onclick={() => (showPt = !showPt)}
					aria-pressed={showPt}
					title="Tradução das palavras do seu banco (T)"
				>
					<svg class="ic sm" viewBox="0 0 24 24" aria-hidden="true"
						><path
							d="M4 6h10M9 4v2M6 6c1 4 4 7 7 8M12 6c-1 4-4 7-7 8M14 20l4-9 4 9M15.5 17h5"
						/></svg
					>
					<span class="lbl">Tradução</span><kbd aria-hidden="true">T</kbd>
				</button>
			{/if}
		</div>

		<div class="lacunas">
			{#if totalGaps > 0}Lacuna <b>{Math.max(1, gapNumber)}</b> de {totalGaps}{:else}Sem lacunas{/if}
		</div>

		<div class="tools dir">
			{#if !syncing}
				<button
					class="tool"
					class:on={slow}
					type="button"
					onclick={toggleSpeed}
					aria-pressed={slow}
					title="Velocidade (V)"
				>
					{slow ? '0,75×' : '1×'}<kbd aria-hidden="true">V</kbd>
				</button>
				<div
					class="sync"
					role="group"
					aria-label="Sincronia da letra"
					title="Se a letra aparece cedo ou tarde demais"
				>
					<button
						class="tool nudge"
						type="button"
						onclick={() => nudge(-0.1)}
						aria-label="Letra mais cedo">−</button
					>
					<button
						class="tool"
						type="button"
						onclick={openSync}
						title="Ajustar a sincronia (S)"
						data-testid="sincronia"
					>
						<svg class="ic sm" viewBox="0 0 24 24" aria-hidden="true"
							><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg
						>
						<span class="lbl">Sincronia</span>
						<b>{formatOffset(offset)}</b>
					</button>
					<button
						class="tool nudge"
						type="button"
						onclick={() => nudge(0.1)}
						aria-label="Letra mais tarde">+</button
					>
				</div>
			{/if}
		</div>
	</footer>
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
		{hint}
		onapplyhint={applyHint}
		onsynchint={syncFromHint}
		ondismisshint={dismissHint}
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
	/* Mesmos tokens do app (tokens.css): segue o tema claro/escuro. */
	.app {
		position: fixed;
		inset: 0;
		display: grid;
		grid-template-rows: auto minmax(0, 1fr) auto auto;
		background: var(--page);
		color: var(--ink);
		overflow: hidden;
	}

	.ic {
		width: 19px;
		height: 19px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.6;
		stroke-linecap: round;
		stroke-linejoin: round;
		flex: none;
	}

	.ic.sm {
		width: 16px;
		height: 16px;
	}

	/* ===== topo ===== */
	.topo {
		position: relative;
		z-index: 5;
		display: grid;
		grid-template-columns: 1fr minmax(0, 560px) 1fr;
		align-items: center;
		gap: 24px;
		padding: 14px 22px;
	}

	.t-esq {
		display: flex;
		align-items: center;
		gap: 12px;
		min-width: 0;
	}

	.x {
		width: 38px;
		height: 38px;
		border-radius: var(--r-m);
		display: grid;
		place-items: center;
		color: var(--ink-2);
		flex: none;
		transition:
			background-color 0.15s,
			color 0.15s;
	}

	.x:hover {
		background: var(--hover);
		color: var(--ink);
	}

	.faixa {
		min-width: 0;
	}

	.faixa b {
		display: block;
		font: 600 16.5px/1.3 var(--f-head);
		letter-spacing: -0.01em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.faixa span {
		display: block;
		font-size: 14px;
		color: var(--ink-3);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.trilha {
		position: relative;
		height: 4px;
		border-radius: 99px;
		background: var(--prog-track);
	}

	.trilha .fill {
		position: absolute;
		inset: 0 auto 0 0;
		width: 0;
		border-radius: inherit;
		background: var(--prog);
	}

	.gp {
		position: absolute;
		top: 50%;
		width: 8px;
		height: 8px;
		margin: -4px 0 0 -4px;
		border-radius: 50%;
		background: var(--page);
		box-shadow: inset 0 0 0 2px var(--line-2);
		transition:
			background-color 0.2s,
			box-shadow 0.2s;
	}

	.gp.ok {
		background: var(--ok-ink);
		box-shadow: none;
	}

	.gp.err {
		background: var(--terra-ink);
		box-shadow: none;
	}

	.gp.cur {
		box-shadow: inset 0 0 0 2px var(--terra-ink);
	}

	.tempos {
		display: flex;
		justify-content: space-between;
		margin-top: 7px;
		font-size: 12.5px;
		color: var(--ink-3);
		font-variant-numeric: tabular-nums;
	}

	.t-dir {
		display: flex;
		justify-content: flex-end;
		align-items: center;
		gap: 8px;
	}

	.chip-rev {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		height: 38px;
		padding: 0 13px;
		border: 0;
		border-radius: 99px;
		background: var(--terra-soft);
		color: var(--terra-ink);
		font-size: 14.5px;
		font-weight: 500;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}

	.chip-rev[hidden],
	.pop[hidden] {
		display: none;
	}

	.placar {
		display: flex;
		align-items: center;
		gap: 12px;
		height: 38px;
		padding: 0 6px 0 14px;
		border-radius: 99px;
		background: var(--panel);
		box-shadow: var(--sh-card);
		white-space: nowrap;
	}

	.placar b {
		font: 600 17px/1 var(--f-head);
		font-variant-numeric: tabular-nums;
	}

	.combo {
		font: 600 13.5px/1 var(--f-head);
		padding: 6px 9px;
		border-radius: 99px;
		background: var(--tile);
		color: var(--ink-3);
		transition:
			background-color 0.2s,
			color 0.2s;
	}

	.combo.ativo {
		background: var(--ok-soft);
		color: var(--ok-ink);
	}

	.pop {
		position: absolute;
		z-index: 10;
		top: 64px;
		right: 22px;
		width: 300px;
		background: var(--raise-2);
		border-radius: var(--r-l);
		box-shadow: var(--sh-pop);
		padding: 16px;
		animation: abre 0.2s var(--ease);
	}

	@keyframes abre {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
	}

	.pop h3 {
		margin: 0 0 2px;
		font: 600 16px var(--f-head);
	}

	.pop p {
		margin: 0 0 12px;
		font-size: 14px;
		color: var(--ink-3);
	}

	.pop ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
		max-height: 260px;
		overflow: auto;
	}

	.pop li {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 10px;
		padding: 9px 12px;
		border-radius: var(--r-m);
		background: var(--tile);
		box-shadow: inset 0 0 0 1px var(--line);
	}

	.pop li b {
		font: 600 16px var(--f-head);
	}

	.pop li span {
		font-size: 14px;
		color: var(--ink-3);
	}

	.pop .banco-ct {
		margin: 12px 0 0;
	}

	.pop .banco-ct b {
		color: var(--ink);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	/* ===== palco ===== */
	.palco {
		position: relative;
		min-height: 0;
		overflow: hidden;
	}

	.video {
		position: absolute;
		z-index: 3;
		top: 8px;
		right: 22px;
		width: 248px;
	}

	.video-host {
		position: relative;
		aspect-ratio: 16 / 9;
		border-radius: 10px;
		overflow: hidden;
		background: #000;
		box-shadow: var(--sh-lift);
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

	.letra {
		position: absolute;
		inset: 0;
	}

	.letra-masc {
		position: absolute;
		inset: 0;
		-webkit-mask: linear-gradient(transparent, #000 22%, #000 80%, transparent);
		mask: linear-gradient(transparent, #000 22%, #000 80%, transparent);
	}

	.rolo {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		width: min(860px, 100% - 48px);
		margin: 0 auto;
		transition: transform 0.55s var(--ease);
	}

	.lin {
		text-align: center;
		padding: 6px 0;
	}

	.lin.atual {
		padding: 14px 0 4px;
	}

	.txt {
		margin: 0;
		font: 600 22px/1.4 var(--f-head);
		letter-spacing: -0.01em;
		color: var(--ink-3);
		opacity: 0.45;
		transition:
			color 0.3s,
			opacity 0.3s,
			font-size 0.3s;
	}

	.lin.passou .txt {
		color: var(--ink-2);
		opacity: 0.7;
	}

	.lin.atual .txt {
		color: var(--ink);
		opacity: 1;
		font-size: 40px;
		letter-spacing: -0.025em;
	}

	.tr {
		margin: 2px 0 10px;
		font-size: 17px;
		color: var(--ink-3);
	}

	.w {
		border: 0;
		background: none;
		padding: 0 1px;
		margin: 0;
		font: inherit;
		color: inherit;
		border-radius: var(--r-s);
		transition:
			color 0.15s,
			background-color 0.15s;
	}

	.w:hover {
		background: var(--hover);
	}

	.w.nobanco {
		text-decoration: underline dotted 2px var(--gold-ink);
		text-underline-offset: 7px;
	}

	.w.salva {
		text-decoration: underline solid 2px var(--gold-ink);
		text-underline-offset: 7px;
	}

	/* lacuna que ainda vai chegar */
	.gap {
		display: inline-block;
		min-width: 3em;
		border-bottom: 2px dashed currentColor;
		line-height: 1.05;
		vertical-align: baseline;
	}

	.gap::before {
		content: '\00a0';
	}

	/* lacuna aberta agora */
	.gap.alvo {
		min-width: 3.4em;
		color: var(--terra-ink);
		border-bottom: 2.5px solid var(--terra-ink);
		border-radius: var(--r-s) var(--r-s) 0 0;
		animation: pisca 1.6s ease-in-out infinite;
	}

	@keyframes pisca {
		50% {
			background: var(--terra-soft);
		}
	}

	.w.ok,
	.w.err {
		padding: 0 8px;
		animation: pega 0.35s var(--ease);
	}

	.lin .txt .w.ok {
		background: var(--ok-soft);
		color: var(--ok-ink);
	}

	.lin .txt .w.err {
		background: var(--sel);
		color: var(--ink);
		box-shadow: inset 0 -2px 0 var(--terra-ink);
	}

	@keyframes pega {
		0% {
			transform: scale(0.8);
		}
		60% {
			transform: scale(1.05);
		}
	}

	.lin-alvo {
		border: 0;
		background: none;
		padding: 0 6px;
		margin: 0;
		font: inherit;
		color: inherit;
		border-radius: var(--r-m);
	}

	.lin-alvo:hover {
		background: var(--hover);
	}

	.lin.alvo-sinc .txt {
		color: var(--gold-ink);
		opacity: 1;
	}

	/* ===== respostas ===== */
	.resp {
		padding: 0 22px 18px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 14px;
	}

	.status {
		min-height: 28px;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-wrap: wrap;
		gap: 4px 10px;
		font-size: 15px;
		color: var(--ink-3);
		text-align: center;
	}

	.estado {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}

	.estado.oculto {
		display: none;
	}

	.estado.espera {
		color: var(--gold-ink);
		font-weight: 500;
	}

	.eq {
		display: flex;
		gap: 2px;
		align-items: flex-end;
		height: 12px;
	}

	.eq i {
		width: 3px;
		height: 3px;
		background: var(--ok-ink);
		border-radius: 1px;
		animation: eq 0.9s ease-in-out infinite alternate;
	}

	.eq i:nth-child(2) {
		animation-delay: -0.3s;
	}

	.eq i:nth-child(3) {
		animation-delay: -0.6s;
	}

	@keyframes eq {
		to {
			height: 12px;
		}
	}

	.cd {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		color: var(--gold-ink);
		font-weight: 500;
		font-variant-numeric: tabular-nums;
	}

	.cd .bar {
		width: 140px;
		height: 4px;
		border-radius: 99px;
		background: var(--prog-track);
		overflow: hidden;
	}

	.cd .bar i {
		display: block;
		height: 100%;
		width: 100%;
		background: var(--gold-ink);
		transform-origin: 0 50%;
	}

	.aviso {
		font-weight: 500;
		color: var(--ink-2);
	}

	.aviso:empty {
		display: none;
	}

	/* ao lado do estado, separado por um ponto */
	.aviso:not(.so)::before {
		content: '·';
		margin-right: 10px;
		color: var(--ink-3);
	}

	.aviso.ok {
		color: var(--ok-ink);
	}

	.aviso.err {
		color: var(--terra-ink);
	}

	.sinc-box {
		width: min(860px, 100%);
	}

	.ops {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 10px;
		width: min(860px, 100%);
	}

	.op {
		position: relative;
		min-height: 64px;
		padding: 12px 34px;
		border: 0;
		border-radius: var(--r-l);
		background: var(--raise);
		box-shadow: var(--sh-card);
		font: 600 20px/1.2 var(--f-head);
		letter-spacing: -0.01em;
		color: var(--ink);
		overflow-wrap: anywhere;
		transition:
			box-shadow 0.15s,
			transform 0.08s,
			background-color 0.2s,
			opacity 0.2s;
	}

	:global(.tema-escuro) .op {
		background: var(--raise-2);
	}

	.op:hover:not(:disabled) {
		box-shadow: var(--sh-lift);
	}

	.op:active:not(:disabled) {
		transform: scale(0.985);
	}

	.op:disabled {
		cursor: default;
	}

	.op .k {
		position: absolute;
		left: 10px;
		top: 10px;
		min-width: 20px;
		height: 20px;
		font-size: 11.5px;
	}

	.op.vazia {
		background: none;
		box-shadow: inset 0 0 0 1.5px var(--line);
	}

	:global(.tema-escuro) .op.vazia {
		background: none;
	}

	.op.apaga {
		opacity: 0.35;
	}

	.op.certa {
		background: var(--ok-soft);
		color: var(--ok-ink);
		box-shadow: inset 0 0 0 1.5px var(--ok-ink);
	}

	.op.errou {
		background: var(--terra-soft);
		color: var(--terra-ink);
		box-shadow: inset 0 0 0 1.5px var(--terra-ink);
		animation: nao 0.35s;
	}

	/* ✓ / ✕ no lugar do número */
	.op.certa .k,
	.op.errou .k {
		font-size: 0;
		box-shadow: none;
		color: var(--page);
	}

	.op.certa .k {
		background: var(--ok-ink);
	}

	.op.errou .k {
		background: var(--terra-ink);
	}

	.op.certa .k::after,
	.op.errou .k::after {
		content: '';
		width: 13px;
		height: 13px;
		background: currentColor;
		-webkit-mask: var(--glifo) center / contain no-repeat;
		mask: var(--glifo) center / contain no-repeat;
	}

	.op.certa .k::after {
		--glifo: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 12.5l4.5 4.5L19 7.5'/%3E%3C/svg%3E");
	}

	.op.errou .k::after {
		--glifo: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='3' stroke-linecap='round'%3E%3Cpath d='M6.5 6.5l11 11M17.5 6.5l-11 11'/%3E%3C/svg%3E");
	}

	@keyframes nao {
		25%,
		75% {
			transform: translateX(-4px);
		}
		50% {
			transform: translateX(4px);
		}
	}

	/* ===== barra de baixo ===== */
	.baixo {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		gap: 12px;
		min-height: 62px;
		padding: 10px 22px 16px;
		border-top: 1px solid var(--line);
	}

	.tools {
		display: flex;
		align-items: center;
		gap: 2px;
		min-width: 0;
	}

	.tools.dir {
		justify-content: flex-end;
	}

	.tool {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		height: 36px;
		min-width: 36px;
		padding: 0 11px;
		border: 0;
		border-radius: var(--r-m);
		background: none;
		color: var(--ink-2);
		font-size: 14.5px;
		font-weight: 500;
		white-space: nowrap;
		transition:
			background-color 0.15s,
			color 0.15s;
	}

	.tool:hover {
		background: var(--hover);
		color: var(--ink);
	}

	.tool.on {
		background: var(--sel);
		color: var(--ink);
		box-shadow: inset 0 0 0 1px var(--line-2);
	}

	.tool kbd {
		min-width: 20px;
		height: 20px;
		font-size: 11.5px;
	}

	.tool b {
		font: 600 14px/1 var(--f-body);
		font-variant-numeric: tabular-nums;
		color: var(--ink);
	}

	.sync {
		display: flex;
		align-items: center;
		gap: 2px;
		margin-left: 4px;
	}

	.tool.nudge {
		min-width: 32px;
		padding: 0;
		font-size: 18px;
	}

	.lacunas {
		font-size: 14.5px;
		color: var(--ink-3);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.lacunas b {
		color: var(--ink);
		font-weight: 600;
	}

	/* ===== responsivo ===== */
	@media (max-width: 1100px) {
		.topo {
			grid-template-columns: 1fr minmax(0, 360px) 1fr;
			gap: 16px;
		}

		.lbl-l {
			display: none;
		}

		.video {
			width: 200px;
		}
	}

	@media (max-width: 860px) {
		.topo {
			grid-template-columns: minmax(0, 1fr) auto;
			gap: 8px 10px;
			padding: 8px 12px 10px;
		}

		.prog {
			grid-column: 1 / -1;
			order: 3;
		}

		.x {
			width: 36px;
			height: 36px;
			margin-left: -6px;
		}

		.faixa b {
			font-size: 15.5px;
		}

		.faixa span {
			font-size: 13px;
		}

		.chip-rev,
		.placar {
			height: 34px;
		}

		.chip-rev {
			padding: 0 11px;
		}

		.placar {
			gap: 8px;
			padding: 0 5px 0 11px;
		}

		.placar b {
			font-size: 15.5px;
		}

		.pop {
			top: 54px;
			right: 12px;
			width: min(300px, 100vw - 24px);
		}

		.palco {
			display: flex;
			flex-direction: column;
			gap: 6px;
			padding: 4px 12px 0;
		}

		.video {
			position: static;
			width: 100%;
			max-width: 480px;
			margin: 0 auto;
			flex: none;
		}

		.letra {
			position: relative;
			inset: auto;
			flex: 1;
			min-height: 0;
		}

		.rolo {
			width: 100%;
		}

		.lin {
			padding: 5px 0;
		}

		.lin.atual {
			padding: 8px 0 2px;
		}

		.txt {
			font-size: 18px;
		}

		.lin.atual .txt {
			font-size: 26px;
		}

		.tr {
			font-size: 14.5px;
		}

		.resp {
			padding: 0 12px 10px;
			gap: 8px;
		}

		.status {
			font-size: 14px;
			min-height: 24px;
		}

		.cd .bar {
			width: 90px;
		}

		.ops {
			grid-template-columns: 1fr 1fr;
			gap: 8px;
		}

		.op {
			min-height: 54px;
			font-size: 18px;
			padding: 10px 30px;
		}

		.op .k {
			left: 8px;
			top: 8px;
		}

		.baixo {
			gap: 6px;
			min-height: 0;
			padding: 6px 8px calc(8px + env(safe-area-inset-bottom));
		}

		.tools {
			gap: 0;
		}

		.tool {
			padding: 0 9px;
		}

		.tool .lbl,
		.tool kbd {
			display: none;
		}

		.lacunas {
			font-size: 13.5px;
		}
	}

	@media (max-width: 520px) {
		.tool.nudge {
			display: none;
		}

		.sync {
			margin-left: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.rolo {
			transition: none;
		}

		.gap.alvo,
		.eq i {
			animation: none;
		}
	}
</style>
