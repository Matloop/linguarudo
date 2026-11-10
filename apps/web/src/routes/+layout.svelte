<script lang="ts">
	import { resolve } from '$app/paths';
	import '#lib/styles/tokens.css';
	import icone from '#lib/assets/icone.png';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" type="image/png" href={icone} />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
	<meta name="theme-color" content="#0C4033" />
</svelte:head>

<header>
	<a class="marca" href={data.user ? resolve('/palavras') : resolve('/')}>
		<img src={icone} alt="" width="36" height="36" />
		<span>Linguarudo</span>
	</a>

	{#if data.user}
		<nav aria-label="Principal">
			<a href={resolve('/palavras')}>Minhas palavras</a>
		</nav>
		<form method="POST" action="/sair">
			<button class="sair" type="submit" title={data.user.email ?? undefined}>Sair</button>
		</form>
	{/if}
</header>

<main>
	{@render children()}
</main>

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
	}

	nav a {
		white-space: nowrap;
		color: var(--salvia-claro);
		text-decoration: none;
		font-weight: 700;
		padding: 8px 10px;
		border-radius: var(--raio-p);
	}

	nav a:hover {
		background: #ffffff14;
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

	@media (max-width: 359px) {
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
