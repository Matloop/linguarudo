<script lang="ts">
	import { resolve } from '$app/paths';
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { languageInline } from '#lib/languages.ts';
	import { toast } from '#lib/ui/app-state.svelte.ts';
	import Icon from '#lib/ui/Icon.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let q = $state('');
	const shown = $derived.by(() => {
		const needle = q.trim().toLocaleLowerCase('pt-BR');
		if (!needle) return data.fichas;
		return data.fichas.filter((f) =>
			`${f.front} ${f.back} ${f.tags.join(' ')}`.toLocaleLowerCase('pt-BR').includes(needle)
		);
	});
	const languageName = $derived(languageInline(data.language, data.uiLanguage));

	const tagQuery = (tag: string | null): `?${string}` | '' =>
		tag ? `?tag=${encodeURIComponent(tag)}` : '';

	onMount(() => {
		const params = page.url.searchParams;
		if (params.has('criada')) toast('Ficha criada');
		else if (params.has('salva')) toast('Ficha salva');
		else if (params.has('apagada')) toast('Ficha apagada');
		if (params.has('criada') || params.has('salva') || params.has('apagada')) {
			const url = new URL(page.url.href);
			for (const k of ['criada', 'salva', 'apagada']) url.searchParams.delete(k);
			replaceState(resolve(`/flashcards/fichas${url.search as `?${string}` | ''}`), page.state);
		}
	});
</script>

<svelte:head>
	<title>Fichas · Linguetta</title>
</svelte:head>

<div class="ph">
	<div>
		<h1>Fichas</h1>
		<p>Flashcards de frente e verso livres em {languageName}.</p>
	</div>
	<div class="acts">
		<a class="btn btn-ghost" href={resolve('/flashcards/estudar')}><Icon name="repeat" />Revisar</a>
		<a class="btn btn-ghost" href={resolve('/flashcards/importar')}
			><Icon name="upload" />Importar do Anki</a
		>
		<a class="btn btn-primary" href={resolve('/flashcards/fichas/nova')}
			><Icon name="plus" />Nova ficha</a
		>
	</div>
</div>

{#if data.tags.length > 0 || data.tag}
	<nav class="tags" aria-label="Filtrar por tag">
		<a
			class="chip"
			class:on={!data.tag}
			href={resolve(`/flashcards/fichas${tagQuery(null)}`)}
			aria-current={!data.tag}>Todas</a
		>
		{#each data.tags as tag (tag)}
			<a
				class="chip"
				class:on={data.tag === tag}
				href={resolve(`/flashcards/fichas${tagQuery(tag)}`)}
				aria-current={data.tag === tag}><Icon name="tag" size="sm" />{tag}</a
			>
		{/each}
	</nav>
{/if}

{#if data.fichas.length === 0}
	<div class="empty">
		<div>
			<h2>{data.tag ? `Nenhuma ficha com a tag “${data.tag}”` : 'Nenhuma ficha ainda'}</h2>
			<p>Fichas guardam o que não cabe numa palavra: conjugações, regras, frases inteiras.</p>
			<div class="acts">
				<a class="btn btn-primary btn-lg" href={resolve('/flashcards/fichas/nova')}
					><Icon name="plus" />Criar ficha</a
				>
			</div>
		</div>
	</div>
{:else}
	<label class="search">
		<Icon name="search" size="sm" />
		<input type="search" placeholder="Buscar nas fichas" bind:value={q} aria-label="Buscar" />
	</label>
	<ul class="list">
		{#each shown as f (f.id)}
			<li>
				<a href={resolve('/flashcards/fichas/[id]', { id: f.id })}>
					<span class="txt">
						<b>{f.front}</b>
						{#if f.back}<span class="back">{f.back}</span>{/if}
					</span>
					<span class="meta">
						{#each f.tags.slice(0, 3) as tag (tag)}<span class="tg">{tag}</span>{/each}
						<span>{f.kinds}</span>
						<span>Revisão {f.next}</span>
					</span>
				</a>
			</li>
		{:else}
			<li class="none">Nada encontrado para “{q}”.</li>
		{/each}
	</ul>
{/if}

<style>
	.acts {
		display: flex;
		gap: 8px;
	}
	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin: -12px 0 20px;
	}
	.search {
		display: flex;
		align-items: center;
		gap: 8px;
		max-width: 360px;
		padding: 0 12px;
		margin-bottom: 12px;
		border-radius: var(--r-m);
		background: var(--sunk);
		box-shadow: inset 0 0 0 1px var(--line);
		color: var(--ink-3);
	}
	.search input {
		flex: 1;
		height: 38px;
		border: 0;
		background: transparent;
		color: var(--ink);
		font-size: 14px;
		outline: none;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		border-top: 1px solid var(--line);
	}
	.list li {
		border-bottom: 1px solid var(--line);
	}
	.list a {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 20px;
		padding: 14px 6px;
		color: inherit;
		text-decoration: none;
	}
	.list a:hover {
		background: var(--tile);
	}
	.txt {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.txt b,
	.back {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.txt b {
		font-weight: 500;
	}
	.back {
		font-size: 13.5px;
		color: var(--ink-3);
	}
	.meta {
		display: flex;
		align-items: center;
		gap: 10px;
		flex: none;
		font-size: 12.5px;
		color: var(--ink-3);
	}
	.tg {
		padding: 2px 8px;
		border-radius: 99px;
		background: var(--tile);
		color: var(--ink-2);
	}
	.none {
		padding: 18px 6px;
		color: var(--ink-3);
	}
	@media (max-width: 768px) {
		.ph {
			flex-wrap: wrap;
		}
		.list a {
			flex-direction: column;
			align-items: flex-start;
			gap: 6px;
		}
		.meta {
			flex-wrap: wrap;
		}
	}
</style>
