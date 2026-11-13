<script lang="ts">
	import { resolve } from '$app/paths';
	import { goto, invalidateAll, preloadData, pushState } from '$app/navigation';
	import { page } from '$app/state';
	import { languageInline } from '#lib/languages.ts';
	import { openFicha } from '#lib/ui/app-state.svelte.ts';
	import FichaDialog from '#lib/ui/FichaDialog.svelte';
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

	const plainClick = (e: MouseEvent) =>
		!(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0);

	function onNew(e: MouseEvent) {
		if (!plainClick(e)) return;
		e.preventDefault();
		openFicha();
	}

	// Editar abre o diálogo por cima da lista (a URL vira a da ficha; Voltar fecha).
	async function onEdit(e: MouseEvent, href: string) {
		if (!plainClick(e)) return;
		e.preventDefault();
		const r = await preloadData(href);
		if (r.type === 'loaded' && r.status === 200) {
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- href já veio do resolve()
			pushState(href, { ficha: (r.data as { ficha: App.PageState['ficha'] }).ficha });
		} else {
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- href já veio do resolve()
			goto(href);
		}
	}

	/** Fechar volta à URL da lista (só se o diálogo ainda está no histórico). */
	// A URL da ficha só chega aqui pelo pushState (o link direto é outra página): volta.
	// Olha a barra de endereço: o invalidateAll do salvar refaz page.url e page.state com a
	// URL de antes do pushState, e o voltar do navegador já tirou a ficha da barra.
	function closeEdit() {
		if (location.pathname !== resolve('/flashcards/fichas')) history.back();
	}
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
		<a class="btn btn-primary" href={resolve('/flashcards/fichas?ficha')} onclick={onNew}
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
				<a class="btn btn-primary btn-lg" href={resolve('/flashcards/fichas?ficha')} onclick={onNew}
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
			{@const href = resolve('/flashcards/fichas/[id]', { id: f.id })}
			<li>
				<a {href} onclick={(e) => onEdit(e, href)}>
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

<FichaDialog
	mode="edit"
	open={!!page.state.ficha}
	edit={page.state.ficha ?? null}
	language={data.language}
	uiLanguage={data.uiLanguage}
	onsaved={() => invalidateAll()}
	ondeleted={() => invalidateAll()}
	onclose={closeEdit}
/>

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
