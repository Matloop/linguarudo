<script lang="ts">
	import { resolve } from '$app/paths';
	import '@fontsource-variable/manrope';
	import '@fontsource-variable/inter';
	import '#lib/styles/tokens.css';
	import '#lib/styles/ui.css';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { SIDEBAR_COOKIE, cookieString, nextTheme, type Theme } from '#lib/prefs.ts';
	import { isTypingTarget, shortcutFor, type Screen } from '#lib/shortcuts.ts';
	import Icon from '#lib/ui/Icon.svelte';
	import LangMenu from '#lib/ui/LangMenu.svelte';
	import Mark from '#lib/ui/Mark.svelte';
	import SaveDialog from '#lib/ui/SaveDialog.svelte';
	import Sprite from '#lib/ui/Sprite.svelte';
	import Toast from '#lib/ui/Toast.svelte';
	import { applyTheme, openSave } from '#lib/ui/app-state.svelte.ts';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();

	/** Telas com cara própria: landing, entrar e o jogo de música em tela cheia. */
	const BARE = new Set(['/', '/entrar', '/musica/[id]']);
	const bare = $derived(!data.shell || BARE.has(page.route.id ?? ''));

	// Estado local que nasce do cookie e muda na hora; o cookie vai junto.
	let theme = $derived<Theme | null>(data.theme);
	let collapsed = $derived(data.collapsed);

	const back = $derived(page.url.pathname + page.url.search);
	const shell = $derived(data.shell);
	const activeSummary = $derived(
		shell?.summary?.languages.find((l) => l.language === shell.active) ?? null
	);
	const toReview = $derived(activeSummary?.toReview ?? 0);
	const initial = $derived((data.user?.email ?? '?').charAt(0).toUpperCase());

	const SCREENS: Record<string, Screen> = {
		'/inicio': 'inicio',
		'/palavras': 'palavras',
		'/flashcards': 'flashcards'
	};

	function current(path: string) {
		const p = page.url.pathname;
		return p === path || p.startsWith(`${path}/`) ? 'page' : undefined;
	}

	function toggleCollapsed(e?: Event) {
		e?.preventDefault();
		collapsed = !collapsed;
		document.cookie = cookieString(SIDEBAR_COOKIE, collapsed ? 'recolhida' : 'aberta');
	}

	function toggleTheme(e: Event) {
		e.preventDefault();
		const systemDark = matchMedia('(prefers-color-scheme: dark)').matches;
		theme = nextTheme(theme, systemDark);
		applyTheme(theme);
	}

	function onSaveLink(e: MouseEvent) {
		if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
		e.preventDefault();
		openSave();
	}

	// Sem JS o link ?guardar abre o diálogo pelo servidor; com JS, limpa a URL.
	$effect(() => {
		if (!shell || !page.url.searchParams.has('guardar')) return;
		openSave();
		const url = new URL(page.url.href);
		url.searchParams.delete('guardar');
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- tira ?guardar da URL atual
		goto(url, { replace: true, reset: false });
	});

	function onKeydown(e: KeyboardEvent) {
		if (bare) return;
		const action = shortcutFor(e, {
			screen: SCREENS[page.route.id ?? ''] ?? 'outra',
			typing: isTypingTarget(e.target),
			dialogOpen: !!document.querySelector(
				'dialog[open], details.lang-wrap[open], [data-drawer-open]'
			)
		});
		if (!action) return;
		if (action.type === 'guardar') openSave();
		else if (action.type === 'barra') toggleCollapsed();
		else if (action.type === 'flashcards') goto(resolve('/flashcards'));
		else if (action.type === 'buscar') document.getElementById('busca')?.focus();
		else return; // o resto é da tela de revisão
		e.preventDefault();
	}
</script>

<svelte:head>
	<title>Linguetta</title>
</svelte:head>

<svelte:window onkeydown={onKeydown} />

<Sprite />

{#if bare || !shell}
	{@render children()}
{:else}
	<div class="app" class:mini={collapsed}>
		<aside class="side" aria-label="Navegação">
			<div class="side-top">
				{#if !collapsed}
					<a class="brand" href={resolve('/inicio')} aria-label="Linguetta, início">
						<Mark />
						<span class="wordmark">Linguetta</span>
					</a>
				{/if}
				<!-- Aberta: botão ao lado do nome. Recolhida: o logo vira o botão e mostra o
				     ícone no hover. -->
				<form method="POST" action="/perfil?/barra" onsubmit={toggleCollapsed}>
					<input type="hidden" name="voltar" value={back} />
					<input type="hidden" name="barra" value={collapsed ? 'aberta' : 'recolhida'} />
					<button
						class="toggle"
						class:over={collapsed}
						aria-label={collapsed ? 'Abrir barra lateral' : 'Recolher barra lateral'}
						aria-expanded={!collapsed}
						title="{collapsed ? 'Abrir' : 'Recolher'} barra lateral ( [ )"
						data-testid="logo-barra"
					>
						{#if collapsed}<span class="tg-mark"><Mark /></span>{/if}
						<span class="tg-ic"><Icon name="sidebar" /></span>
					</button>
				</form>
			</div>

			<LangMenu
				id="idiomas-menu"
				active={shell.active}
				study={shell.studyLanguages}
				native={shell.nativeLanguage}
				ui={shell.uiLanguage}
				summaries={shell.summary?.languages ?? null}
			/>

			<a
				class="btn btn-primary save-btn"
				href={resolve('/palavras?guardar')}
				onclick={onSaveLink}
				title="Guardar palavra (N)"
				data-testid="guardar"
			>
				<Icon name="plus" /><span class="lb">Guardar palavra</span><kbd>N</kbd>
			</a>

			<nav class="nav" aria-label="Principal">
				<a
					class="nav-item"
					href={resolve('/inicio')}
					aria-current={current('/inicio')}
					title="Início"><Icon name="home" /><span class="lb">Início</span></a
				>
				<a
					class="nav-item"
					href={resolve('/palavras')}
					aria-current={current('/palavras')}
					title="Minhas palavras"><Icon name="book" /><span class="lb">Minhas palavras</span></a
				>
				<a
					class="nav-item"
					href={resolve('/flashcards')}
					aria-current={current('/flashcards')}
					title="Flashcards"
					><Icon name="repeat" /><span class="lb">Flashcards</span>
					{#if toReview > 0}<span class="count"
							>{toReview}<span class="visually-hidden">&nbsp;para revisar</span></span
						>{/if}</a
				>
				<a
					class="nav-item"
					href={resolve('/musica')}
					aria-current={current('/musica')}
					title="Música"><Icon name="music" /><span class="lb">Música</span></a
				>
				<div class="nav-label">Conexões</div>
				<a
					class="nav-item"
					href={resolve('/integracoes')}
					aria-current={current('/integracoes')}
					title="Integrações"><Icon name="plug" /><span class="lb">Integrações</span></a
				>
			</nav>

			<div class="side-foot">
				<div class="me">
					<a
						class="nav-item"
						href={resolve('/perfil')}
						aria-current={current('/perfil')}
						title={data.user?.email ?? 'Perfil'}
						><span class="avatar">{initial}</span><span class="lb">Perfil</span></a
					>
					<form method="POST" action="/perfil?/tema" onsubmit={toggleTheme}>
						<input type="hidden" name="voltar" value={back} />
						<input type="hidden" name="tema" value={theme === 'escuro' ? 'claro' : 'escuro'} />
						<button class="icon-btn theme-btn" aria-label="Trocar tema" title="Trocar tema">
							<span class="i-moon"><Icon name="moon" /></span><span class="i-sun"
								><Icon name="sun" /></span
							>
						</button>
					</form>
				</div>
			</div>
		</aside>

		<header class="mtop">
			<div class="l">
				<a class="brand" href={resolve('/inicio')} aria-label="Linguetta, início"><Mark /></a>
				<LangMenu
					id="idiomas-menu-m"
					compact
					active={shell.active}
					study={shell.studyLanguages}
					native={shell.nativeLanguage}
					ui={shell.uiLanguage}
					summaries={shell.summary?.languages ?? null}
				/>
			</div>
			<div class="r">
				<a
					class="plus"
					href={resolve('/palavras?guardar')}
					onclick={onSaveLink}
					aria-label="Guardar palavra"><Icon name="plus" /></a
				>
				<a class="me-btn" href={resolve('/perfil')} aria-label="Perfil"
					><span class="avatar">{initial}</span></a
				>
			</div>
		</header>

		<main class="panel">
			<div class="scroll" id="scroll">
				{#key page.url.pathname}
					<div class="view enter">
						{@render children()}
					</div>
				{/key}
			</div>
		</main>

		<nav class="tabbar" aria-label="Abas">
			<a class="tab" href={resolve('/inicio')} aria-current={current('/inicio')}
				><Icon name="home" />Início</a
			>
			<a class="tab" href={resolve('/palavras')} aria-current={current('/palavras')}
				><Icon name="book" />Palavras</a
			>
			<a class="tab" href={resolve('/flashcards')} aria-current={current('/flashcards')}
				><Icon name="repeat" />Flashcards{#if toReview > 0}<span class="count"
						>{toReview}<span class="visually-hidden">&nbsp;para revisar</span></span
					>{/if}</a
			>
			<a class="tab" href={resolve('/musica')} aria-current={current('/musica')}
				><Icon name="music" />Música</a
			>
		</nav>
	</div>

	{#if shell.active}
		<SaveDialog
			language={shell.active}
			uiLanguage={shell.uiLanguage}
			ssrOpen={page.url.searchParams.has('guardar')}
		/>
	{/if}
	<Toast />
{/if}

<style>
	.app {
		display: grid;
		grid-template-columns: 236px minmax(0, 1fr);
		height: 100vh;
		height: 100dvh;
		transition: grid-template-columns 0.3s var(--ease);
	}
	.app.mini {
		grid-template-columns: 64px minmax(0, 1fr);
	}

	/* Barra lateral: mesma cor da página, sem borda. */
	.side {
		display: flex;
		flex-direction: column;
		padding: 14px 10px 14px 14px;
		min-height: 0;
		min-width: 0;
	}
	.side-top {
		display: flex;
		align-items: center;
		height: 36px;
		margin: 0 0 14px;
	}
	.brand {
		display: inline-flex;
		align-items: center;
		gap: 9px;
		height: 36px;
		padding: 0 10px 0 8px;
		border: 0;
		border-radius: var(--r-m);
		background: none;
		color: var(--ink);
		cursor: pointer;
		text-decoration: none;
		transition: background-color 0.15s;
	}
	.side-top .brand:hover {
		background: var(--hover);
	}
	.side-top form {
		margin-left: auto;
	}
	.toggle {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border: 0;
		border-radius: var(--r-m);
		background: none;
		color: var(--ink-3);
		cursor: pointer;
		transition:
			background-color 0.15s,
			color 0.15s;
	}
	.toggle:hover,
	.toggle:focus-visible {
		background: var(--hover);
		color: var(--ink);
	}
	.toggle > span {
		grid-area: 1 / 1;
		display: grid;
		place-items: center;
	}
	/* Recolhida: o logo ocupa o lugar e o ícone aparece por cima no hover. */
	.toggle.over {
		width: 36px;
		height: 36px;
		color: var(--ink);
	}
	.toggle.over .tg-ic,
	.toggle.over:hover .tg-mark,
	.toggle.over:focus-visible .tg-mark {
		opacity: 0;
	}
	/* Seta para fora: abre. */
	.toggle.over .tg-ic {
		scale: -1 1;
	}
	.toggle.over:hover .tg-ic,
	.toggle.over:focus-visible .tg-ic {
		opacity: 1;
	}
	.wordmark {
		font: 600 17px/1 var(--f-head);
		letter-spacing: -0.012em;
		translate: 0 -1px;
		white-space: nowrap;
	}

	.save-btn {
		margin: 12px 0 18px;
		width: 100%;
		justify-content: flex-start;
		padding: 0 8px 0 11px;
		height: 36px;
	}
	.save-btn kbd {
		margin-left: auto;
	}

	.nav {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.nav-item {
		position: relative;
		display: flex;
		align-items: center;
		gap: 11px;
		height: 34px;
		padding: 0 10px;
		border-radius: var(--r-m);
		color: var(--ink-2);
		font-weight: 500;
		white-space: nowrap;
		text-decoration: none;
		transition:
			background-color 0.15s,
			color 0.15s;
	}
	.nav-item:hover {
		background: var(--hover);
		color: var(--ink);
	}
	.nav-item[aria-current='page'] {
		background: var(--nav-active);
		color: var(--accent-ink);
		box-shadow: var(--sh-card);
	}
	.count {
		margin-left: auto;
		min-width: 20px;
		height: 18px;
		padding: 0 6px;
		border-radius: 4px;
		display: grid;
		place-items: center;
		font: 600 11.5px/1 var(--f-body);
		font-variant-numeric: tabular-nums;
		color: var(--terra-ink);
		background: var(--terra-soft);
	}
	.nav-label {
		font-size: 11.5px;
		font-weight: 500;
		color: var(--ink-3);
		padding: 18px 10px 6px;
		white-space: nowrap;
	}
	.side-foot {
		margin-top: auto;
	}
	.me {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.me .nav-item {
		flex: 1;
		min-width: 0;
	}
	.me form {
		margin: 0;
	}
	.i-sun,
	.i-moon {
		display: contents;
	}
	.i-sun {
		display: none;
	}
	:global(.tema-escuro) .i-sun {
		display: contents;
	}
	:global(.tema-escuro) .i-moon {
		display: none;
	}
	@media (prefers-color-scheme: dark) {
		:global(:root:not(.tema-claro)) .i-sun {
			display: contents;
		}
		:global(:root:not(.tema-claro)) .i-moon {
			display: none;
		}
	}

	/* Recolhida: só ícones; o logo continua no topo e abre de novo. */
	.mini .side {
		padding: 14px 8px 14px 10px;
	}
	.mini .side-top {
		justify-content: center;
	}
	.mini .side-top form {
		margin-left: 0;
	}
	.mini .wordmark,
	.mini .lb,
	.mini .save-btn kbd {
		display: none;
	}
	.mini .save-btn {
		padding: 0;
		justify-content: center;
	}
	.mini .nav-item {
		justify-content: center;
		padding: 0;
	}
	.mini .count {
		position: absolute;
		top: -2px;
		right: -1px;
		box-shadow: 0 0 0 2px var(--page);
		background: linear-gradient(var(--terra-soft), var(--terra-soft)), var(--page);
		min-width: 16px;
		height: 15px;
		padding: 0 4px;
		font-size: 10px;
	}
	.mini .nav-label {
		font-size: 0;
		padding: 0;
		height: 1px;
		background: var(--line);
		margin: 14px 8px;
	}
	.mini .me {
		flex-direction: column;
	}
	.mini .me .nav-item {
		width: 100%;
		flex: none;
	}

	.panel {
		position: relative;
		margin: 10px 10px 10px 0;
		background: var(--panel);
		border-radius: var(--r-l);
		box-shadow: var(--sh-panel);
		overflow: hidden;
		min-width: 0;
		transition: background-color 0.35s var(--ease);
	}
	.scroll {
		position: absolute;
		inset: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		scrollbar-gutter: stable;
	}
	.scroll::-webkit-scrollbar {
		width: 10px;
	}
	.scroll::-webkit-scrollbar-thumb {
		background: var(--line-2);
		border-radius: 10px;
		border: 3px solid var(--panel);
	}
	.view {
		padding: 36px 48px 64px;
		max-width: 1120px;
		margin: 0 auto;
		min-height: 100%;
	}
	/* Só opacidade: transform aqui viraria o bloco de contenção do painel fixo. */
	.view.enter {
		animation: viewFade 0.36s var(--ease) backwards;
	}
	@keyframes viewFade {
		from {
			opacity: 0;
		}
	}

	.mtop,
	.tabbar {
		display: none;
	}

	@media (max-width: 1180px) {
		.view {
			padding: 32px 36px 56px;
		}
	}

	@media (max-width: 768px) {
		.app,
		.app.mini {
			display: block;
			height: auto;
			min-height: 100dvh;
		}
		.side {
			display: none;
		}
		.mtop {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 8px;
			position: sticky;
			top: 0;
			z-index: 30;
			padding: calc(8px + var(--safe-t)) 12px 8px 14px;
			background: color-mix(in srgb, var(--page) 88%, transparent);
			backdrop-filter: blur(14px);
			-webkit-backdrop-filter: blur(14px);
		}
		.mtop .l {
			display: flex;
			align-items: center;
			gap: 8px;
			min-width: 0;
		}
		.mtop .brand {
			padding: 0 4px;
			height: 34px;
		}
		.mtop .brand :global(.mark) {
			height: 21px;
		}
		.mtop .r {
			display: flex;
			align-items: center;
			gap: 4px;
		}
		.plus {
			width: 34px;
			height: 34px;
			border-radius: var(--r-m);
			display: grid;
			place-items: center;
			background: var(--primary);
			color: var(--on-primary);
		}
		.plus :global(.ic) {
			stroke-width: 2;
		}
		.me-btn {
			width: 34px;
			height: 34px;
			display: grid;
			place-items: center;
			border-radius: var(--r-m);
			text-decoration: none;
		}
		.me-btn .avatar {
			width: 28px;
			height: 28px;
			font-size: 12px;
		}
		.panel {
			margin: 0;
			border-radius: var(--r-l) var(--r-l) 0 0;
			min-height: calc(100dvh - 50px - var(--safe-t));
			box-shadow: 0 -1px 0 var(--line);
			overflow: visible;
		}
		.scroll {
			position: static;
			overflow: visible;
		}
		.view {
			padding: 24px 18px calc(var(--tab-h) + var(--safe-b) + 72px);
		}
		.tabbar {
			display: grid;
			grid-template-columns: repeat(4, 1fr);
			position: fixed;
			z-index: 30;
			left: 0;
			right: 0;
			bottom: 0;
			height: calc(var(--tab-h) + var(--safe-b));
			padding: 6px 8px var(--safe-b);
			background: color-mix(in srgb, var(--panel) 90%, transparent);
			backdrop-filter: blur(16px);
			-webkit-backdrop-filter: blur(16px);
			box-shadow: 0 -1px 0 var(--line);
		}
		.tab {
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: 3px;
			color: var(--ink-3);
			font-size: 11px;
			font-weight: 500;
			border-radius: var(--r-m);
			position: relative;
			text-decoration: none;
		}
		.tab :global(.ic) {
			width: 22px;
			height: 22px;
		}
		.tab[aria-current='page'] {
			color: var(--accent-ink);
		}
		.tab[aria-current='page'] :global(.ic) {
			stroke-width: 1.9;
		}
		.tab .count {
			position: absolute;
			top: 4px;
			left: calc(50% + 7px);
			margin: 0;
			min-width: 16px;
			height: 15px;
			padding: 0 4px;
			font-size: 10px;
		}
	}
</style>
