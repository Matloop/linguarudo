<!--
	Leitor web do livro com blend (foliate-js). Paginado; vira com toque nas bordas, swipe,
	setas ou os botões laterais. Tocar num link do blend abre o cartão da palavra (lema,
	tradução, nota e Salvar); a posição vai para o book_progress (quem leu por último vence).
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import Popover from '#lib/ui/Popover.svelte';
	import { applyTheme } from '#lib/ui/app-state.svelte.ts';
	import { bookCss, openBook, type Engine, type Relocation, type TocEntry } from '#lib/reader/engine.ts';
	import { linkSentence } from '#lib/reader/sentence.ts';
	import { ProgressSaver, positionFrom, type ReadingPosition } from '#lib/reader/progress.ts';
	import type { BlendLink } from '#lib/reader/blend-link.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const FONT_KEY = 'linguetta.leitor.fonte';
	const FONT_STEPS = [0.85, 0.92, 1, 1.1, 1.2, 1.32, 1.46];

	let stage: HTMLDivElement | undefined = $state();
	let engine: Engine | null = $state(null);
	let status = $state<'abrindo' | 'pronto' | 'erro'>('abrindo');
	let toc = $state<TocEntry[]>([]);
	let tocOpen = $state(false);
	let here = $state<Relocation | null>(null);
	let fontStep = $state(2);
	let dark = $state(false);

	const percent = $derived(here ? Math.floor(here.bookFraction * 100) : 0);
	const currentHref = $derived.by(() => {
		if (!here?.chapter) return null;
		return toc.find((t) => t.label === here?.chapter)?.href ?? null;
	});

	// ---------- Cartão da palavra ----------

	type CardState = 'vendo' | 'novo' | 'banco' | 'salvando' | 'salvo' | 'erro';
	type Card = {
		link: BlendLink;
		form: string;
		sentence: string;
		position: { chapter: string; spine: number; percent: number };
		top: boolean;
		state: CardState;
		bank: string;
		created: boolean;
		clientId: string;
		message: string;
		anchor: HTMLAnchorElement;
	};
	let card = $state<Card | null>(null);

	function closeCard() {
		card?.anchor.removeAttribute('data-lb-open');
		card = null;
	}

	async function post(path: string, body: unknown) {
		const res = await fetch(`/livros/${data.book.id}/ler/${path}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		const json = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(json?.message ?? 'Não deu agora.');
		return json;
	}

	async function onBlendTap(tap: import('#lib/reader/engine.ts').BlendTap) {
		card?.anchor.removeAttribute('data-lb-open');
		tap.anchor.setAttribute('data-lb-open', '');
		const pos = here;
		const next: Card = {
			link: tap.link,
			form: tap.form,
			sentence: linkSentence(tap.anchor, data.book.bookLanguage),
			position: {
				chapter: pos?.chapter ?? '',
				spine: pos?.spine ?? 0,
				percent: Math.round((pos?.bookFraction ?? 0) * 1000) / 10
			},
			// A palavra na parte de baixo da tela: o cartão vai para cima.
			top: tap.rect.bottom > window.innerHeight * 0.58,
			state: 'vendo',
			bank: '',
			created: false,
			clientId: '',
			message: '',
			anchor: tap.anchor
		};
		card = next;
		try {
			const { bank } = await post('palavra', { action: 'tocar', lemma: tap.link.lemma });
			if (card?.anchor !== tap.anchor) return;
			if (bank) {
				card.state = 'banco';
				card.bank = bank.label;
			} else card.state = 'novo';
		} catch {
			if (card?.anchor === tap.anchor) card.state = 'novo';
		}
	}

	async function save() {
		const c = card;
		if (!c) return;
		c.clientId ||= crypto.randomUUID();
		c.state = 'salvando';
		try {
			const res = await post('palavra', {
				action: 'salvar',
				clientId: c.clientId,
				at: new Date().toISOString(),
				lemma: c.link.lemma,
				translation: c.link.translation,
				note: c.link.note,
				form: c.form,
				sentence: c.sentence,
				position: c.position
			});
			c.created = res.created;
			c.bank = res.bank?.label ?? '';
			c.state = 'salvo';
		} catch (e) {
			c.state = 'erro';
			c.message = e instanceof Error ? e.message : 'Não deu para salvar agora.';
		}
	}

	async function undo() {
		const c = card;
		if (!c) return;
		try {
			await post('palavra', { action: 'desfazer', clientId: c.clientId });
			c.state = 'novo';
			c.clientId = '';
			c.message = 'Removida do banco.';
		} catch (e) {
			c.message = e instanceof Error ? e.message : 'Não deu para desfazer.';
		}
	}

	// ---------- Posição ----------

	let saver: ProgressSaver | null = null;

	function sendPosition(pos: ReadingPosition, at: Date, keepalive = false) {
		fetch(`/livros/${data.book.id}/ler/posicao`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ ...pos, at: at.toISOString() }),
			keepalive
		}).catch(() => {});
	}

	let leaving = false;
	function flushPosition() {
		leaving = true;
		saver?.flush();
		leaving = false;
	}

	function onRelocate(r: Relocation) {
		const moved = !here || here.spine !== r.spine || here.chapterFraction !== r.chapterFraction;
		here = r;
		// Virou a página: o cartão da página anterior sai. (Relocate sem mudar de lugar
		// acontece, por exemplo, quando o toque rola o link para a vista.)
		if (moved && card) closeCard();
		const pos = positionFrom(r.spine, r.chapterFraction, r.bookFraction);
		if (!pos) return;
		// A primeira posição é a de abertura: abrir o livro não conta como ler.
		if (!saver) {
			saver = new ProgressSaver({
				initial: pos,
				save: (p, at) => sendPosition(p, at, leaving)
			});
			return;
		}
		saver.update(pos);
	}

	// ---------- Tema e letra ----------

	function applyBookStyles() {
		if (!engine) return;
		const css = getComputedStyle(document.documentElement);
		engine.setStyles(
			bookCss({
				ink: css.getPropertyValue('--ink').trim() || '#16231b',
				accent: css.getPropertyValue('--terra-ink').trim() || '#9a5536',
				hl: css.getPropertyValue('--hl').trim() || '#e3e8dd',
				fontScale: FONT_STEPS[fontStep],
				dark: document.documentElement.classList.contains('tema-escuro')
			})
		);
	}

	function setFont(step: number) {
		fontStep = Math.max(0, Math.min(FONT_STEPS.length - 1, step));
		localStorage.setItem(FONT_KEY, String(fontStep));
		applyBookStyles();
	}

	function toggleTheme() {
		applyTheme(dark ? 'claro' : 'escuro');
	}

	// ---------- Teclado ----------

	function onKey(e: KeyboardEvent) {
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		const t = e.target as HTMLElement | null;
		if (t?.closest?.('input, textarea, [contenteditable], [data-popover-open]')) return;
		if (e.key === 'Escape' && card) {
			closeCard();
			e.preventDefault();
			return;
		}
		const go =
			e.key === 'ArrowLeft' || e.key === 'PageUp'
				? 'left'
				: e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' '
					? 'right'
					: null;
		if (!go || !engine) return;
		e.preventDefault();
		if (e.key === 'PageUp') engine.prev();
		else if (e.key === 'PageDown' || e.key === ' ') engine.next();
		else if (go === 'left') engine.goLeft();
		else engine.goRight();
	}

	onMount(() => {
		const saved = Number(localStorage.getItem(FONT_KEY) ?? NaN);
		if (Number.isInteger(saved) && saved >= 0 && saved < FONT_STEPS.length) fontStep = saved;
		dark = document.documentElement.classList.contains('tema-escuro');
		const themeWatch = new MutationObserver(() => {
			dark = document.documentElement.classList.contains('tema-escuro');
			applyBookStyles();
		});
		themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

		let closed = false;
		let opened: Engine | null = null;
		(async () => {
			try {
				const res = await fetch(data.fileUrl);
				if (!res.ok) throw new Error(String(res.status));
				const blob = await res.blob();
				if (closed || !stage) return;
				opened = await openBook(stage, new File([blob], 'livro.epub'), {
					onRelocate,
					onBlendTap,
					onTap: (zone) => {
						if (card) closeCard();
						else if (zone === 'left') opened?.goLeft();
						else if (zone === 'right') opened?.goRight();
					},
					onKey
				});
				if (closed) return opened.destroy();
				engine = opened;
				toc = opened.toc;
				applyBookStyles();
				if (data.progress) {
					await opened.goToPosition(data.progress.spine, data.progress.chapterPercent / 100);
				} else await opened.start();
				status = 'pronto';
			} catch (e) {
				console.error(e);
				status = 'erro';
			}
		})();

		const tick = setInterval(() => saver?.tick(), 5_000);
		const onHide = () => {
			if (document.visibilityState === 'hidden') flushPosition();
		};
		document.addEventListener('visibilitychange', onHide);
		window.addEventListener('pagehide', flushPosition);
		return () => {
			closed = true;
			clearInterval(tick);
			document.removeEventListener('visibilitychange', onHide);
			window.removeEventListener('pagehide', flushPosition);
			themeWatch.disconnect();
			flushPosition();
			opened?.destroy();
		};
	});
</script>

<svelte:head>
	<title>{data.book.title} · Linguetta</title>
</svelte:head>

<svelte:window onkeydown={onKey} />

<div class="reader" data-testid="leitor">
	<header class="top">
		<a class="icon-btn" href="/livros" aria-label="Voltar para Livros" title="Voltar para Livros">
			<span class="flip"><Icon name="arrow" /></span>
		</a>
		<div class="title">
			<h1>{data.book.title}</h1>
			{#if here?.chapter}<p>{here.chapter}</p>{:else if data.book.author}<p>{data.book.author}</p>{/if}
		</div>
		<div class="tools">
			<div class="font" role="group" aria-label="Tamanho da letra">
				<button
					class="icon-btn"
					type="button"
					aria-label="Diminuir letra"
					disabled={fontStep === 0}
					onclick={() => setFont(fontStep - 1)}><span class="a-sm">A</span></button
				>
				<button
					class="icon-btn"
					type="button"
					aria-label="Aumentar letra"
					disabled={fontStep === FONT_STEPS.length - 1}
					onclick={() => setFont(fontStep + 1)}><span class="a-lg">A</span></button
				>
			</div>
			<button
				class="icon-btn"
				type="button"
				aria-label={dark ? 'Tema claro' : 'Tema escuro'}
				title={dark ? 'Tema claro' : 'Tema escuro'}
				onclick={toggleTheme}
			>
				<Icon name={dark ? 'sun' : 'moon'} />
			</button>
			<Popover bind:open={tocOpen} label="Sumário" width={320}>
				{#snippet trigger({ toggle, expanded, id })}
					<button
						class="icon-btn"
						type="button"
						aria-label="Sumário"
						title="Sumário"
						aria-expanded={expanded}
						aria-controls={id}
						disabled={toc.length === 0}
						onclick={toggle}
					>
						<Icon name="note" />
					</button>
				{/snippet}
				{#snippet children({ close })}
					<p class="toc-head">Sumário</p>
					<ul class="toc">
						{#each toc as entry (entry.href)}
							<li>
								<button
									type="button"
									style:padding-left="{10 + entry.depth * 14}px"
									aria-current={entry.href === currentHref ? 'true' : undefined}
									onclick={() => {
										close();
										engine?.goToHref(entry.href);
									}}>{entry.label}</button
								>
							</li>
						{/each}
					</ul>
				{/snippet}
			</Popover>
		</div>
	</header>

	<main class="page">
		<button
			class="side prev"
			type="button"
			aria-label="Página anterior"
			tabindex="-1"
			onclick={() => engine?.goLeft()}><span class="flip"><Icon name="right" /></span></button
		>
		<div class="stage" bind:this={stage}></div>
		<button
			class="side next"
			type="button"
			aria-label="Próxima página"
			tabindex="-1"
			onclick={() => engine?.goRight()}><Icon name="right" /></button
		>
		{#if status === 'abrindo'}
			<p class="state">Abrindo o livro…</p>
		{:else if status === 'erro'}
			<div class="state">
				<p>Não deu para abrir este livro.</p>
				<a class="btn btn-soft" href="/livros">Voltar para Livros</a>
			</div>
		{/if}
	</main>

	<footer class="foot">
		<span class="bar" role="progressbar" aria-label="Progresso no livro" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}
			><i style:width="{percent}%"></i></span
		>
		<span class="pct" data-testid="progresso">{percent}%</span>
	</footer>

	{#if card}
		<div
			class="card"
			class:at-top={card.top}
			role="dialog"
			aria-label="Palavra do blend"
			data-testid="cartao-palavra"
		>
			<button class="icon-btn close" type="button" aria-label="Fechar" onclick={closeCard}>
				<Icon name="x" size="sm" />
			</button>
			<p class="lemma" lang={data.book.language}>{card.link.lemma}</p>
			<p class="tr">{card.link.translation}</p>
			{#if card.link.note}<p class="note">{card.link.note}</p>{/if}
			<div class="acts">
				{#if card.state === 'vendo'}
					<span class="muted">…</span>
				{:else if card.state === 'banco'}
					<span class="in-bank"><Icon name="check" size="sm" /> No banco</span>
					{#if card.bank}<span class="muted">{card.bank}</span>{/if}
				{:else if card.state === 'salvo'}
					<span class="in-bank"><Icon name="check" size="sm" /> Salvo</span>
					{#if card.created}
						<button class="btn btn-ghost" type="button" onclick={undo}>
							<Icon name="undo" size="sm" /> Desfazer
						</button>
					{:else}
						<span class="muted">Já estava no banco; a frase entrou.</span>
					{/if}
				{:else}
					<button
						class="btn btn-primary"
						type="button"
						disabled={card.state === 'salvando'}
						onclick={save}
					>
						{card.state === 'salvando' ? 'Salvando…' : 'Salvar'}
					</button>
				{/if}
			</div>
			{#if card.message}<p class="msg" role="status">{card.message}</p>{/if}
		</div>
	{/if}
</div>

<style>
	.reader {
		position: fixed;
		inset: 0;
		z-index: 40;
		display: grid;
		grid-template-rows: auto 1fr auto;
		background: var(--page);
		color: var(--ink);
	}
	.top {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: calc(8px + var(--safe-t)) 12px 8px;
		border-bottom: 1px solid var(--line);
		background: var(--page);
	}
	.flip {
		display: inline-flex;
		transform: rotate(180deg);
	}
	.title {
		flex: 1;
		min-width: 0;
	}
	.title h1 {
		margin: 0;
		font: 600 15px/1.25 var(--f-head);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.title p {
		margin: 1px 0 0;
		font-size: 12.5px;
		color: var(--ink-3);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.tools {
		display: flex;
		align-items: center;
		gap: 2px;
	}
	.font {
		display: flex;
		margin-right: 4px;
	}
	.icon-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.a-sm,
	.a-lg {
		font: 600 13px/1 var(--f-head);
	}
	.a-lg {
		font-size: 18px;
	}
	.toc-head {
		margin: 0 0 6px;
		font: 600 12px/1 var(--f-body);
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--ink-3);
	}
	.toc {
		list-style: none;
		margin: 0 -6px;
		padding: 0;
		max-height: min(60vh, 460px);
		overflow-y: auto;
	}
	.toc button {
		display: block;
		width: 100%;
		padding: 8px 10px;
		border: 0;
		border-radius: var(--r-s);
		background: none;
		text-align: left;
		font-size: 14.5px;
		line-height: 1.35;
		color: var(--ink-2);
	}
	.toc button:hover {
		background: var(--hover);
		color: var(--ink);
	}
	.toc button[aria-current='true'] {
		background: var(--sel);
		color: var(--ink);
		font-weight: 600;
	}
	.page {
		position: relative;
		min-height: 0;
		display: grid;
		grid-template-columns: 56px 1fr 56px;
	}
	.stage {
		grid-column: 2;
		grid-row: 1;
		min-width: 0;
		min-height: 0;
	}
	.side {
		align-self: center;
		justify-self: center;
		display: grid;
		place-items: center;
		width: 40px;
		height: 40px;
		border: 0;
		border-radius: 50%;
		background: none;
		color: var(--ink-3);
		transition:
			background-color 0.15s,
			color 0.15s;
	}
	.side.prev {
		grid-area: 1 / 1;
	}
	.side.next {
		grid-area: 1 / 3;
	}
	.side:hover {
		background: var(--hover);
		color: var(--ink);
	}
	.state {
		position: absolute;
		inset: 0;
		display: grid;
		place-content: center;
		justify-items: center;
		gap: 14px;
		margin: 0;
		color: var(--ink-3);
		background: var(--page);
	}
	.state p {
		margin: 0;
	}
	.foot {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 8px 18px calc(10px + var(--safe-b));
	}
	.pct {
		min-width: 3ch;
		font: 500 12.5px/1 var(--f-body);
		font-variant-numeric: tabular-nums;
		color: var(--ink-3);
		text-align: right;
	}
	.card {
		position: fixed;
		left: 50%;
		bottom: calc(52px + var(--safe-b));
		z-index: 45;
		width: min(440px, calc(100vw - 24px));
		transform: translateX(-50%);
		padding: 18px 20px 16px;
		border-radius: var(--r-l);
		background: var(--raise);
		box-shadow: var(--sh-pop);
		animation: cardIn 0.16s var(--ease) both;
	}
	.card.at-top {
		bottom: auto;
		top: calc(64px + var(--safe-t));
	}
	:global(.tema-escuro) .card {
		background: var(--raise-2);
	}
	@keyframes cardIn {
		from {
			opacity: 0;
			transform: translate(-50%, 6px);
		}
	}
	.close {
		position: absolute;
		top: 10px;
		right: 10px;
	}
	.lemma {
		margin: 0 32px 2px 0;
		font: 700 22px/1.2 var(--f-head);
		letter-spacing: -0.01em;
	}
	.tr {
		margin: 0;
		font-size: 17px;
		color: var(--ink-2);
	}
	.note {
		margin: 4px 0 0;
		font-size: 13.5px;
		color: var(--ink-3);
	}
	.acts {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
		margin-top: 14px;
		min-height: 38px;
	}
	.in-bank {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 5px 10px;
		border-radius: 999px;
		background: var(--ok-soft);
		color: var(--ok-ink);
		font-size: 14px;
		font-weight: 600;
	}
	.muted {
		color: var(--ink-3);
		font-size: 14px;
	}
	.msg {
		margin: 10px 0 0;
		font-size: 13.5px;
		color: var(--ink-3);
	}
	@media (max-width: 700px) {
		.page {
			grid-template-columns: 0 1fr 0;
		}
		.side {
			display: none;
		}
		.font {
			margin-right: 0;
		}
		.card {
			left: 0;
			right: 0;
			bottom: 0;
			width: auto;
			transform: none;
			padding-bottom: calc(18px + var(--safe-b));
			border-radius: var(--r-l) var(--r-l) 0 0;
			animation-name: sheetIn;
		}
		.card.at-top {
			top: 0;
			bottom: auto;
			padding-top: calc(18px + var(--safe-t));
			border-radius: 0 0 var(--r-l) var(--r-l);
		}
		@keyframes sheetIn {
			from {
				opacity: 0;
				transform: translateY(12px);
			}
		}
	}
</style>
