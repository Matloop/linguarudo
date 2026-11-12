<script lang="ts">
	import { resolve } from '$app/paths';
	import { untrack } from 'svelte';
	import { languageLabel } from '#lib/languages.ts';
	import CriarMusica from '#lib/music/CriarMusica.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const uiLanguage = $derived(data.shell?.uiLanguage ?? 'pt');
	const errors = $derived<Record<string, string>>(form && 'errors' in form ? form.errors : {});

	// Erro do servidor reabre o painel para a pessoa corrigir.
	let creating = $state(untrack(() => Object.keys(errors).length > 0));
	let filter = $state<'tudo' | 'album' | 'musica'>('tudo');

	const hasBoth = $derived(
		data.shelf.some((w) => w.kind === 'album') && data.shelf.some((w) => w.kind === 'musica')
	);
	const shown = $derived(
		filter === 'tudo' || !hasBoth ? data.shelf : data.shelf.filter((w) => w.kind === filter)
	);
	const FILTERS = [
		['tudo', 'Tudo'],
		['album', 'Álbuns'],
		['musica', 'Músicas']
	] as const;
</script>

<svelte:head>
	<title>Música · Linguetta</title>
</svelte:head>

<div class="ph">
	<div>
		<h1>Música</h1>
		<p>Complete a letra de uma música ou de um álbum inteiro, escolhendo a palavra certa.</p>
	</div>
	<button class="btn btn-primary" type="button" onclick={() => (creating = true)}>
		<Icon name="plus" size="sm" />Criar
	</button>
</div>

<section class="estante" aria-labelledby="recentes-titulo">
	<div class="topo">
		<h2 class="eyebrow" id="recentes-titulo">Tocadas recentemente</h2>
		{#if hasBoth}
			<div class="filtro" role="group" aria-label="Mostrar">
				{#each FILTERS as [value, label] (value)}
					<button type="button" aria-pressed={filter === value} onclick={() => (filter = value)}
						>{label}</button
					>
				{/each}
			</div>
		{/if}
	</div>

	{#if data.shelf.length === 0}
		<div class="vazio tile">
			<Icon name="music" />
			<p>Nenhuma música ainda.</p>
			<span>Cole o link de um vídeo ou de uma playlist de álbum do YouTube.</span>
			<button class="btn btn-soft" type="button" onclick={() => (creating = true)}>
				<Icon name="plus" size="sm" />Criar a primeira
			</button>
		</div>
	{:else}
		<ul class="capas">
			{#each shown as w (w.id)}
				<li>
					{#if w.kind === 'album'}
						<a class="card album" href={resolve('/musica/album/[id]', { id: w.id })}>
							<span class="capa" aria-hidden="true">
								<img
									src={`https://i.ytimg.com/vi/${w.cover}/mqdefault.jpg`}
									alt=""
									loading="lazy"
								/>
								<span class="tag">{w.position + 1}/{w.tracks.length}</span>
								<span class="barra"
									><i style:width={`${((w.position + 1) / w.tracks.length) * 100}%`}></i></span
								>
							</span>
							<b>{w.title}</b>
							<span class="sub">Álbum · {w.artist}</span>
						</a>
					{:else}
						<a class="card" href={resolve('/musica/[id]', { id: w.id })}>
							<span class="capa" aria-hidden="true">
								<img
									src={`https://i.ytimg.com/vi/${w.youtubeId}/mqdefault.jpg`}
									alt=""
									loading="lazy"
								/>
								<span class="tag" title={languageLabel(w.language, uiLanguage)}
									>{w.language.toUpperCase()}</span
								>
							</span>
							<b>{w.title}</b>
							<span class="sub">{w.artist}</span>
						</a>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>

<CriarMusica bind:open={creating} {errors} {uiLanguage} />

<style>
	.topo {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 14px;
		min-height: 36px;
	}
	.topo .eyebrow {
		margin: 0;
	}
	.filtro {
		display: inline-flex;
		padding: 3px;
		gap: 2px;
		border-radius: var(--r-m);
		background: var(--sunk);
		box-shadow: inset 0 0 0 1px var(--line);
	}
	.filtro button {
		height: 28px;
		padding: 0 12px;
		border: 0;
		border-radius: var(--r-s);
		background: none;
		font-size: 14.5px;
		font-weight: 500;
		color: var(--ink-2);
	}
	.filtro button[aria-pressed='true'] {
		background: var(--raise);
		color: var(--ink);
		box-shadow: var(--sh-card);
	}
	.vazio {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		padding: 40px 20px;
		text-align: center;
		color: var(--ink-3);
	}
	.vazio p {
		margin: 6px 0 0;
		font: 600 17px var(--f-head);
		color: var(--ink);
	}
	.vazio .btn {
		margin-top: 12px;
	}
	.capas {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
		gap: 28px 20px;
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: 2px;
		color: inherit;
		text-decoration: none;
	}
	.capa {
		position: relative;
		aspect-ratio: 1;
		margin-bottom: 10px;
		border-radius: var(--r-m);
		background: var(--tile);
		box-shadow: var(--sh-card);
		transition: transform 0.2s var(--ease);
	}
	.capa img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
		border-radius: inherit;
	}
	/* Álbum: duas capas atrás, como uma pilha de discos. */
	.album .capa::before,
	.album .capa::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		background: var(--ink-3);
		z-index: -1;
	}
	.album .capa::before {
		transform: translateY(-13px) scale(0.92);
		opacity: 0.45;
	}
	.album .capa::after {
		transform: translateY(-24px) scale(0.84);
		opacity: 0.22;
	}
	.capas li {
		padding-top: 12px;
	}
	.album {
		isolation: isolate;
	}
	.card:hover .capa {
		transform: translateY(-3px);
	}
	.tag {
		position: absolute;
		top: 8px;
		left: 8px;
		padding: 2px 7px;
		border-radius: var(--r-s);
		font: 600 12px/1.4 var(--f-head);
		letter-spacing: 0.03em;
		color: #fff;
		background: rgba(20, 16, 12, 0.66);
		font-variant-numeric: tabular-nums;
	}
	.barra {
		position: absolute;
		left: 8px;
		right: 8px;
		bottom: 8px;
		height: 4px;
		border-radius: 2px;
		background: rgba(255, 255, 255, 0.35);
		overflow: hidden;
	}
	.barra i {
		display: block;
		height: 100%;
		background: #fff;
	}
	.card b {
		font: 600 16px/1.3 var(--f-head);
		letter-spacing: -0.01em;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sub {
		font-size: 14px;
		color: var(--ink-3);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	@media (max-width: 520px) {
		.capas {
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 22px 14px;
		}
		.topo {
			flex-wrap: wrap;
		}
	}
</style>
