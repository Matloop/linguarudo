<script lang="ts">
	import { resolve } from '$app/paths';
	import '#lib/styles/tokens.css';
	import icone from '#lib/assets/icone.png';
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();

	function isCurrent(path: string) {
		return page.url.pathname === path ? 'page' : undefined;
	}
</script>

<svelte:head>
	<link rel="icon" type="image/png" href={icone} />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
	<meta name="theme-color" content="#0C4033" />
</svelte:head>

<!-- A landing (/) tem header e footer próprios; o jogo de música ocupa a tela toda. -->
{#if page.route.id === '/' || page.route.id === '/musica/[id]'}
	{@render children()}
{:else}
	<header>
		<a class="marca" href={data.user ? resolve('/palavras') : resolve('/')}>
			<img src={icone} alt="" width="36" height="36" />
			<span>Linguarudo</span>
		</a>

		{#if data.user}
			<nav aria-label="Principal">
				<a href={resolve('/palavras')} aria-current={isCurrent('/palavras')}>
					<span class="longo">Minhas palavras</span><span class="curto">Palavras</span>
				</a>
				<a href={resolve('/revisar')} aria-current={isCurrent('/revisar')}>
					Revisar
					{#if data.review && data.review.count > 0}
						<span class="qtd"
							>{data.review.count}<span class="visually-hidden"> para revisar</span></span
						>
					{/if}
				</a>
				<a href={resolve('/musica')} aria-current={isCurrent('/musica')}>Música</a>
				<a href={resolve('/integracoes')} aria-current={isCurrent('/integracoes')}> Integrações </a>
			</nav>
			<form method="POST" action="/sair">
				<button class="sair" type="submit" title={data.user.email ?? undefined}>Sair</button>
			</form>
		{/if}
	</header>

	<main>
		{@render children()}
	</main>
{/if}

<style>
	header {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 16px;
		background: var(--verde);
		color: var(--creme);
	}

	.marca {
		display: flex;
		align-items: center;
		gap: 10px;
		color: var(--creme);
		text-decoration: none;
		font-weight: 800;
		font-size: 19px;
		letter-spacing: -0.01em;
	}

	.marca img {
		border-radius: 10px;
	}

	nav {
		margin-left: auto;
		display: flex;
		gap: 2px;
	}

	nav a {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		white-space: nowrap;
		color: var(--salvia-claro);
		text-decoration: none;
		font-weight: 700;
		padding: 8px 10px;
		border-radius: var(--raio-p);
	}

	nav a:hover,
	nav a[aria-current='page'] {
		background: #ffffff14;
	}

	nav a[aria-current='page'] {
		color: var(--creme);
	}

	.qtd {
		min-width: 22px;
		padding: 1px 7px;
		border-radius: 99px;
		background: var(--coral);
		color: #fff;
		font-size: 13px;
		font-weight: 800;
		text-align: center;
	}

	.curto {
		display: none;
	}

	@media (max-width: 479px) {
		.longo {
			display: none;
		}

		.curto {
			display: inline;
		}

		nav a {
			padding: 8px 8px;
		}
	}

	.sair {
		border: 1.5px solid #ffffff33;
		background: none;
		color: var(--creme);
		border-radius: var(--raio-p);
		padding: 6px 12px;
		font-weight: 700;
		font-size: 14px;
	}

	.sair:hover {
		background: #ffffff14;
	}

	@media (max-width: 479px) {
		.marca span {
			display: none;
		}
	}

	main {
		width: 100%;
		max-width: 760px;
		margin: 0 auto;
		padding: 20px 16px 48px;
	}

	@media (min-width: 640px) {
		header {
			padding: 14px 28px;
		}

		main {
			padding: 32px 28px 64px;
		}
	}
</style>
