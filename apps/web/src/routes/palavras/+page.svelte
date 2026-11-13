<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { goto, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { langAttrs } from '#lib/languages.ts';
	import { highlightParts, type ItemReviewState } from '#lib/review.ts';
	import { deckDisplayName, plural } from '#lib/decks-ui.ts';
	import BulkBar from '#lib/ui/BulkBar.svelte';
	import DeckPicker from '#lib/ui/DeckPicker.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import Popover from '#lib/ui/Popover.svelte';
	import Select from '#lib/ui/Select.svelte';
	import { postAction } from '#lib/ui/post-action.ts';
	import { Selection } from '#lib/ui/selection.svelte.ts';
	import Mark from '#lib/ui/Mark.svelte';
	import WordSheet from '#lib/ui/WordSheet.svelte';
	import { openSave, toast } from '#lib/ui/app-state.svelte.ts';
	import { ORIGIN_ICONS } from '#lib/ui/origins.ts';
	import { view, type ListView } from './view.svelte.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	type Filter = 'todas' | 'hoje' | 'novas' | 'dominadas' | 'teimosas';
	const FILTERS: [Filter, string][] = [
		['todas', 'Todas'],
		['hoje', 'Para revisar'],
		['novas', 'Novas'],
		['dominadas', 'Dominadas'],
		['teimosas', 'Teimosas']
	];
	type Order = 'recentes' | 'az' | 'revisao' | 'forca';
	const ORDERS: [Order, string][] = [
		['recentes', 'Mais recentes'],
		['az', 'A–Z'],
		['revisao', 'Próxima revisão'],
		['forca', 'Força da memória']
	];
	const SWITCHES: [keyof ListView, string][] = [
		['traducao', 'Tradução'],
		['frase', 'Frase de exemplo'],
		['leitura', 'Leitura / IPA'],
		['origem', 'Origem']
	];
	/** Pontinho de cada linha: estado da revisão, ou teimosa por cima de tudo. */
	type Dot = 'late' | 'today' | 'learn' | 'new' | 'done' | 'leech';
	const DOTS: Record<ItemReviewState, Dot> = {
		atrasada: 'late',
		hoje: 'today',
		aprendendo: 'learn',
		nova: 'new',
		dominada: 'done',
		depois: 'done',
		conhecida: 'done'
	};
	const DOT_LABELS: Record<ItemReviewState, string> = {
		atrasada: 'Atrasada',
		hoje: 'Para revisar hoje',
		aprendendo: 'Aprendendo',
		nova: 'Nova',
		dominada: 'Dominada',
		depois: 'Em dia',
		conhecida: 'Já sei'
	};
	const parseFilter = (v: string | null): Filter =>
		FILTERS.some(([k]) => k === v) ? (v as Filter) : 'todas';

	// Filtro e busca são locais (sem ir ao servidor); a URL guarda os dois.
	let filter = $derived(parseFilter(page.url.searchParams.get('f')));
	let q = $derived(page.url.searchParams.get('q') ?? '');
	// O servidor manda as mais recentes primeiro; as outras ordens são locais.
	let order = $derived(
		ORDERS.find(([k]) => k === page.url.searchParams.get('o'))?.[0] ?? 'recentes'
	);
	// Deck da URL (?deck=); o de topo inclui os subdecks. Deck que sumiu = todos.
	let deckFilter = $derived(
		data.decks.some((d) => d.id === page.url.searchParams.get('deck'))
			? page.url.searchParams.get('deck')
			: null
	);
	const deckScope = $derived(
		deckFilter
			? new Set(
					data.decks
						.filter((d) => d.id === deckFilter || d.parentId === deckFilter)
						.map((d) => d.id)
				)
			: null
	);
	const inDeck = $derived(data.items.filter((i) => !deckScope || deckScope.has(i.deckId)));

	const now = $derived(new Date(data.now));
	const study = $derived(langAttrs(data.language));
	type Row = (typeof data.items)[number];
	// "Para revisar" = atrasadas + as de hoje; a nova espera o orçamento e conta em Novas.
	const due = (i: Row) => i.review === 'atrasada' || i.review === 'hoje';
	const isNew = (i: Row) => i.review === 'nova';
	const counts = $derived({
		todas: inDeck.length,
		hoje: inDeck.filter(due).length,
		novas: inDeck.filter(isNew).length,
		dominadas: inDeck.filter((i) => i.strength === 4).length,
		teimosas: inDeck.filter((i) => i.leech).length
	});
	const late = $derived(inDeck.filter((i) => i.review === 'atrasada').length);
	/** "Revisar N": o mesmo número da sidebar (flashcards da sessão de hoje). */
	const toReview = $derived(
		data.shell?.summary?.languages.find((l) => l.language === data.language)?.toReview ?? 0
	);
	const rows = $derived.by(() => {
		const needle = q.trim().toLocaleLowerCase();
		const found = inDeck.filter((i) => {
			if (filter === 'hoje' && !due(i)) return false;
			if (filter === 'novas' && !isNew(i)) return false;
			if (filter === 'dominadas' && i.strength !== 4) return false;
			if (filter === 'teimosas' && !i.leech) return false;
			return (
				!needle ||
				i.lemma.toLocaleLowerCase().includes(needle) ||
				i.sense.toLocaleLowerCase().includes(needle)
			);
		});
		// Estudadas pela data da próxima revisão; depois as novas; "já sei" no fim.
		const dueAt = (i: Row) =>
			i.dueAt ?? (i.review === 'nova' ? Number.MAX_SAFE_INTEGER - 1 : Number.MAX_SAFE_INTEGER);
		if (order === 'az') found.sort((a, b) => a.lemma.localeCompare(b.lemma, data.language));
		if (order === 'revisao') found.sort((a, b) => dueAt(a) - dueAt(b));
		if (order === 'forca') found.sort((a, b) => a.strength - b.strength);
		return found;
	});

	// Colunas da linha conforme o "Exibir": a frase, quando aparece, fica com a sobra.
	const cols = $derived.by(() => {
		const { traducao, frase, leitura, origem } = view.on;
		const flex = 'minmax(0, 1fr)';
		const word = leitura ? 'minmax(140px, 230px)' : 'minmax(110px, 170px)';
		return [
			'16px',
			!traducao && !frase ? flex : word,
			...(traducao ? [frase ? 'minmax(110px, 190px)' : flex] : []),
			...(frase ? [flex] : []),
			...(origem ? ['20px'] : []),
			'84px'
		].join(' ');
	});

	let adding = $state(false);
	async function addNew() {
		adding = true;
		const r = await postAction('extra', {});
		adding = false;
		toast(r.ok ? 'Mais 5 novas para revisar hoje' : r.message);
	}

	function pickOrder(o: Order) {
		order = o;
		replaceState(
			resolve(`/palavras${searchWith({ o: order === 'recentes' ? null : order })}`),
			page.state
		);
	}
	const sel = new Selection(() => rows.map((i) => i.id));
	$effect(() => {
		void rows;
		sel.prune();
	});
	const pickerDecks = $derived(data.decks.map((d) => ({ id: d.id, name: d.name, depth: d.depth })));
	let moveOpen = $state(false);
	let moving = $state(false);
	let showOpen = $state(false);

	async function moveTo(choice: { deckId: string } | { newName: string }) {
		moving = true;
		const r = await postAction('move', {
			item: [...sel.ids],
			...('deckId' in choice ? { deck: choice.deckId } : { newName: choice.newName })
		});
		moving = false;
		moveOpen = false;
		if (!r.ok) return toast(r.message);
		toast(
			`${plural(Number(r.data.n), 'palavra movida', 'palavras movidas')} para ${deckDisplayName(String(r.data.target))}`
		);
		sel.clear();
	}

	function pickDeck(v: string) {
		sel.clear();
		deckFilter = v || null;
		replaceState(resolve(`/palavras${searchWith({ deck: v || null })}`), page.state);
	}
	const deckLabel = (name: string) => deckDisplayName(name).split(' › ').at(-1);

	const selected = $derived(data.items.find((i) => i.id === data.selectedId) ?? null);
	/** Posição do painel na lista como ela está (filtro, busca, ordem). */
	const selectedIndex = $derived(selected ? rows.findIndex((i) => i.id === selected.id) : -1);

	onMount(() => view.load());

	/** Busca da URL atual com as mudanças aplicadas (`?…` ou vazia). */
	function searchWith(changes: Record<string, string | null>): `?${string}` | '' {
		const url = new URL(page.url.href);
		for (const [k, v] of Object.entries(changes)) {
			if (v === null || v === '' || (k === 'f' && v === 'todas')) url.searchParams.delete(k);
			else url.searchParams.set(k, v);
		}
		return url.search as `?${string}` | '';
	}

	function syncUrl() {
		replaceState(resolve(`/palavras${searchWith({ f: filter, q: q.trim() || null })}`), page.state);
	}

	function pickFilter(e: MouseEvent, f: Filter) {
		if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
		e.preventDefault();
		filter = f;
		syncUrl();
	}

	function closeDrawer() {
		goto(resolve(`/palavras${searchWith({ item: null })}`), { reset: false, replace: true });
	}

	/** ↑/↓ e J/K do painel: abre a vizinha na lista e a deixa à vista. */
	function step(delta: number) {
		const next = rows[selectedIndex + delta];
		if (!next) return;
		goto(resolve(`/palavras${searchWith({ item: next.id })}`), { reset: false, replace: true });
		document
			.querySelector(`[data-sel-id="${next.id}"]`)
			?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
	}

	async function afterDelete() {
		await goto(resolve(`/palavras${searchWith({ item: null })}`), {
			reset: false,
			replace: true,
			invalidateAll: true
		});
	}

	function onKeydown(e: KeyboardEvent) {
		if (selected) return; // o painel cuida do Esc
		if (sel.onkeydown(e)) return;
		view.onkeydown(e);
	}

	function onSave(e: MouseEvent) {
		if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
		e.preventDefault();
		openSave();
	}
</script>

<svelte:head>
	<title>Minhas palavras · Linguetta</title>
</svelte:head>

<svelte:window onkeydown={onKeydown} />

{#snippet sentence(text: string, term: string)}
	{#each highlightParts(text, term, data.language) as part, i (i)}{#if part.hit}<mark
				>{part.text}</mark
			>{:else}{part.text}{/if}{/each}
{/snippet}

{#snippet sortSelect(id: string)}
	<span class="txt-sel">
		<Select
			{id}
			variant="inline"
			align="end"
			prefix="Ordem:"
			label="Ordem"
			value={order}
			options={ORDERS.map(([value, label]) => ({ value, label }))}
			onchange={pickOrder}
		/>
	</span>
{/snippet}

{#snippet deckSelect(id: string)}
	<span class="txt-sel">
		<Select
			{id}
			variant="inline"
			align="end"
			prefix="Baralho:"
			label="Baralho"
			value={deckFilter ?? ''}
			options={[
				{ value: '', label: 'Todos os baralhos' },
				...data.decks.map((d) => ({
					value: d.id,
					label: deckLabel(d.name) ?? d.name,
					indent: d.depth > 0
				}))
			]}
			onchange={pickDeck}
		/>
	</span>
{/snippet}

<div class="top" class:bare={data.items.length === 0}>
	<h1>Minhas palavras</h1>
	{#if data.items.length > 0}
		<div class="acts">
			<Popover label="Exibir na lista" bind:open={showOpen} width={268}>
				{#snippet trigger({ toggle, expanded, id })}
					<button
						class="btn btn-ghost show-btn"
						type="button"
						aria-haspopup="dialog"
						aria-expanded={expanded}
						aria-controls={id}
						aria-label="Exibir"
						onclick={toggle}
						><Icon name="eye" size="sm" /><span class="lbl">Exibir</span><Icon
							name="down"
							size="sm"
						/></button
					>
				{/snippet}
				<div class="show">
					<p class="show-h">Exibir na lista</p>
					{#each SWITCHES as [key, label] (key)}
						<button
							class="sw"
							type="button"
							role="switch"
							aria-checked={view.on[key]}
							onclick={() => view.toggle(key)}>{label}<span class="switch"></span></button
						>
					{/each}
					<div class="sep"></div>
					<button
						class="sw"
						type="button"
						role="switch"
						aria-checked={view.on.estudo}
						onclick={() => view.toggle('estudo')}>Modo estudo<span class="switch"></span></button
					>
					<p class="show-note">Esconde a tradução até passar o mouse. Atalho <kbd>H</kbd></p>
					<!-- No mobile a ordem e o deck moram aqui (a linha das abas não tem espaço). -->
					<div class="show-m">
						<div class="sep"></div>
						{@render sortSelect('ordem-m')}
						{#if data.decks.length > 1}{@render deckSelect('deck-m')}{/if}
					</div>
				</div>
			</Popover>
			{#if counts.novas > 0}
				<button
					class="btn btn-ghost add-btn"
					type="button"
					title="Puxa 5 palavras novas para a revisão de hoje"
					disabled={adding}
					onclick={addNew}><Icon name="plus" size="sm" />5 novas</button
				>
			{/if}
			<a class="btn btn-primary review-btn" href={resolve('/flashcards/estudar')}
				><Icon name="play" size="sm" />Revisar{#if toReview > 0}&nbsp;{toReview}{/if}</a
			>
		</div>

		<nav class="tabs" aria-label="Filtro">
			{#each FILTERS as [key, label] (key)}
				<a
					href={resolve(`/palavras${searchWith({ f: key, item: null })}`)}
					data-f={key}
					aria-current={filter === key ? 'page' : undefined}
					onclick={(e) => pickFilter(e, key)}
					>{#if key === 'hoje' && late > 0}<span
							class="late-dot"
							aria-hidden="true"
							title={plural(late, 'atrasada', 'atrasadas')}
						></span>{/if}{label}<span class="c">{counts[key]}</span></a
				>
			{/each}
		</nav>
		<div class="tools">
			<form
				class="search"
				class:has-q={q.trim() !== ''}
				method="GET"
				role="search"
				onsubmit={(e) => e.preventDefault()}
			>
				<label for="busca"><Icon name="search" size="sm" /></label>
				{#if filter !== 'todas'}<input type="hidden" name="f" value={filter} />{/if}
				<input
					id="busca"
					name="q"
					type="search"
					placeholder="Buscar"
					aria-label="Buscar"
					autocomplete="off"
					bind:value={q}
					oninput={syncUrl}
					onkeydown={(e) => e.key === 'Escape' && (e.currentTarget as HTMLInputElement).blur()}
				/>
				<kbd>/</kbd>
			</form>
			{#if data.decks.length > 1}{@render deckSelect('deck-filtro')}{/if}
			{@render sortSelect('ordem')}
		</div>
	{/if}
</div>

{#if data.items.length === 0}
	<div class="empty">
		<div>
			<Mark class="mark mark-hero" />
			<h2>Seu banco está vazio</h2>
			<p>
				Guarde palavras à mão ou toque nelas na legenda do Stremio. Elas aparecem aqui, com a frase
				onde você as viu.
			</p>
			<div class="acts">
				<a class="btn btn-primary btn-lg" href={resolve('/palavras?guardar')} onclick={onSave}
					><Icon name="plus" />Guardar palavra</a
				>
			</div>
		</div>
	</div>
{:else if rows.length === 0}
	<div class="no-res">
		<b>Nada por aqui</b>{q.trim()
			? `Nenhuma palavra com “${q.trim()}”.`
			: 'Nenhuma palavra neste filtro.'}
	</div>
{:else}
	<ul
		class="list"
		class:picking={sel.size > 0}
		class:study={view.on.estudo}
		style:--cols={cols}
		aria-label="Palavras"
	>
		{#each rows as item (item.id)}
			{@const enc = item.encounters[0]}
			<li data-sel-id={item.id} class:picked={sel.has(item.id)}>
				<input
					class="ck"
					type="checkbox"
					aria-label="Selecionar {item.lemma}"
					checked={sel.has(item.id)}
					onclick={(e) => sel.toggle(item.id, e.shiftKey)}
				/>
				<a
					class="r"
					class:cur={item.id === data.selectedId}
					href={resolve(`/palavras${searchWith({ item: item.id })}`)}
					data-sveltekit-noscroll
					data-sveltekit-keepfocus
					data-sveltekit-replacestate
					aria-current={item.id === data.selectedId ? 'true' : undefined}
				>
					<span
						class="st"
						data-st={item.leech ? 'leech' : DOTS[item.review]}
						aria-hidden="true"
						title={item.leech ? 'Teimosa' : DOT_LABELS[item.review]}
					></span>
					<span class="w"
						><b {...study}>{item.lemma}</b>{#if view.on.leitura && (item.reading || item.ipa)}<small
								{...item.reading ? study : {}}>{item.reading || item.ipa}</small
							>{/if}</span
					>
					{#if view.on.traducao}
						<span class="t" class:faint={!item.sense}>{item.sense || 'Sem tradução'}</span>
					{/if}
					{#if view.on.frase}
						<span class="x"
							>{#if enc?.sentence}{@render sentence(
									enc.sentence,
									enc.highlight || item.lemma
								)}{/if}</span
						>
					{/if}
					{#if view.on.origem}
						<span class="src" title={enc ? enc.source || enc.originLabel : 'Guardada à mão'}
							><Icon name={ORIGIN_ICONS[enc?.origin ?? 'manual']} size="sm" /></span
						>
					{/if}
					<span class="when" class:late={item.review === 'atrasada' && !item.leech}
						>{#if item.leech}<span class="chip-leech" title="Errou {item.lapses} vezes"
								>Teimosa</span
							>{:else if item.review === 'conhecida'}Já sei{:else if item.review !== 'hoje'}{item.when}{/if}</span
					>
					{#if !item.leech && item.review !== 'conhecida'}<span class="visually-hidden"
							>, {DOT_LABELS[item.review]}</span
						>{/if}
				</a>
			</li>
		{/each}
	</ul>
	<div class="foot">
		<span><span class="st" data-st="late"></span>Atrasada</span>
		<span><span class="st" data-st="today"></span>Revisar hoje</span>
		<span><span class="st" data-st="learn"></span>Aprendendo</span>
		<span><span class="st" data-st="new"></span>Nova</span>
		<span><span class="st" data-st="done"></span>Em dia</span>
		<span><span class="st" data-st="leech"></span>Teimosa</span>
		<span class="gap"><Icon name="tv" size="sm" />Série/filme</span>
		<span><Icon name="bookmark" size="sm" />Livro</span>
		<span><Icon name="music" size="sm" />Música</span>
		<span><Icon name="pencil" size="sm" />À mão</span>
	</div>
{/if}

<BulkBar count={sel.size} label="Ações das palavras" onclear={() => sel.clear()}>
	<Popover label="Mover para baralho" bind:open={moveOpen} align="start" placement="above">
		{#snippet trigger({ toggle, expanded, id })}
			<button
				class="btn btn-ghost"
				type="button"
				aria-haspopup="dialog"
				aria-expanded={expanded}
				aria-controls={id}
				onclick={toggle}><Icon name="folder" size="sm" />Mover para baralho…</button
			>
		{/snippet}
		<DeckPicker decks={pickerDecks} current={deckFilter} pending={moving} onpick={moveTo} />
	</Popover>
</BulkBar>

{#if selected}
	<WordSheet
		item={selected}
		media={data.selectedMedia}
		cards={data.selectedCards}
		history={data.history}
		historyTotal={data.historyTotal}
		historyLapses={data.historyLapses}
		decks={data.decks}
		language={data.language}
		nativeLanguage={data.uiLanguage}
		translationLanguage={data.nativeLanguage}
		{now}
		clock={data.shell?.clock}
		position={selectedIndex >= 0 ? { index: selectedIndex, total: rows.length } : null}
		closeHref={resolve(`/palavras${searchWith({ item: null })}`)}
		onclose={closeDrawer}
		onprev={() => step(-1)}
		onnext={() => step(1)}
		ondeleted={afterDelete}
	/>
{/if}

<style>
	/* Cabeçalho: título e ações; embaixo, abas sublinhadas com busca e ordem à direita. */
	.top {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		grid-template-areas: 'title acts' 'tabs tools';
		align-items: center;
		margin-bottom: 8px;
	}
	.top.bare {
		margin-bottom: 28px;
	}
	.top h1 {
		grid-area: title;
		margin: 0 0 20px;
		font: 600 30px/1.2 var(--f-head);
		letter-spacing: -0.02em;
	}
	.acts {
		grid-area: acts;
		align-self: start;
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.acts .btn {
		height: 36px;
		padding: 0 13px;
		font-size: 15px;
		gap: 7px;
	}
	.show-btn :global(.ic:last-child) {
		width: 13px;
		height: 13px;
		margin-left: -2px;
	}
	.tabs {
		grid-area: tabs;
		display: flex;
		align-items: flex-end;
		gap: 28px;
		min-width: 0;
		border-bottom: 1px solid var(--line);
	}
	.tabs a {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 7px;
		height: 44px;
		font-size: 15.5px;
		font-weight: 500;
		color: var(--ink-3);
		text-decoration: none;
		white-space: nowrap;
		transition: color 0.15s;
	}
	.tabs a:hover,
	.tabs a[aria-current='page'] {
		color: var(--ink);
	}
	.tabs a[aria-current='page']::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		bottom: -1px;
		height: 2px;
		border-radius: 2px;
		background: var(--ink);
	}
	.tabs .c {
		font-size: 13px;
		color: var(--ink-3);
		font-variant-numeric: tabular-nums;
	}
	.late-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--terra-ink);
	}
	.tools {
		grid-area: tools;
		align-self: stretch;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 2px;
		padding-left: 16px;
		border-bottom: 1px solid var(--line);
	}

	/* Busca compacta: ícone + "Buscar" + /; cresce no foco. */
	.search {
		position: relative;
		margin: 0;
		width: 210px;
		transition: width 0.2s var(--ease);
	}
	.search:focus-within,
	.search.has-q {
		width: 280px;
	}
	.search label {
		position: absolute;
		left: 10px;
		top: 50%;
		translate: 0 -50%;
		display: grid;
		color: var(--ink-3);
		cursor: text;
	}
	.search input {
		width: 100%;
		height: 34px;
		padding: 0 36px 0 34px;
		border: 0;
		border-radius: var(--r-m);
		outline: none;
		background: transparent;
		font-size: 14.5px;
		color: var(--ink);
		transition:
			background-color 0.15s,
			box-shadow 0.15s;
	}
	.search input::placeholder {
		color: var(--ink-3);
	}
	.search input:hover {
		background: var(--hover);
	}
	.search input:focus {
		background: var(--sunk);
		box-shadow:
			inset 0 0 0 1px var(--line-2),
			0 0 0 3px var(--ring);
	}
	.search kbd {
		position: absolute;
		right: 8px;
		top: 50%;
		translate: 0 -50%;
		pointer-events: none;
	}
	.search:focus-within kbd,
	.search.has-q kbd {
		display: none;
	}

	/* Seletor só texto ("Ordem: Mais recentes ▾"): o select de verdade fica por cima, invisível. */
	.txt-sel {
		display: inline-flex;
	}

	/* Popover Exibir */
	.show {
		margin: -8px;
	}
	.show-h {
		margin: 0;
		padding: 6px 10px 4px;
		font-size: 13px;
		font-weight: 500;
		color: var(--ink-3);
	}
	.sw {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 8px 10px;
		border: 0;
		border-radius: var(--r-m);
		background: none;
		font-size: 15px;
		color: var(--ink);
		text-align: left;
		cursor: pointer;
	}
	.sw:hover {
		background: var(--hover);
	}
	.switch {
		position: relative;
		flex: none;
		width: 28px;
		height: 16px;
		margin-left: auto;
		border-radius: 99px;
		background: var(--line-2);
		transition: background-color 0.18s;
	}
	.switch::after {
		content: '';
		position: absolute;
		top: 2px;
		left: 2px;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: var(--raise);
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
		transition: left 0.18s var(--ease);
	}
	.sw[aria-checked='true'] .switch {
		background: var(--primary);
	}
	.sw[aria-checked='true'] .switch::after {
		left: 14px;
		background: var(--on-primary);
	}
	.sep {
		height: 1px;
		margin: 6px 4px;
		background: var(--line);
	}
	.show-note {
		margin: 0;
		padding: 2px 10px 6px;
		font-size: 13px;
		color: var(--ink-3);
	}
	.show-m {
		display: none;
	}

	/* Lista: uma linha por palavra. */
	.list {
		margin: 0 -14px;
		padding: 0;
		list-style: none;
	}
	.list li {
		position: relative;
	}
	.r {
		display: grid;
		grid-template-columns: var(--cols);
		gap: 18px;
		align-items: center;
		min-height: 52px;
		padding: 0 16px;
		border-radius: var(--r-m);
		position: relative;
		color: inherit;
		text-decoration: none;
		transition: background-color 0.15s;
	}
	li + li .r::before {
		content: '';
		position: absolute;
		left: 16px;
		right: 16px;
		top: 0;
		height: 1px;
		background: var(--line);
	}
	.r:hover,
	.r.cur {
		background: var(--hover);
	}
	.list li.picked .r {
		background: var(--sel);
	}
	li:hover .r::before,
	li:hover + li .r::before,
	li:has(.cur) .r::before,
	li:has(.cur) + li .r::before,
	li.picked .r::before,
	li.picked + li .r::before {
		opacity: 0;
	}
	/* Seleção (Mover para deck…): a caixa toma o lugar do pontinho. */
	.list .ck {
		position: absolute;
		left: 16px;
		top: 50%;
		translate: 0 -50%;
		z-index: 1;
		margin: 0;
		opacity: 0;
		transition: opacity 0.15s;
	}
	.list li:hover .ck,
	.list li:focus-within .ck,
	.list.picking .ck,
	.list .ck:checked {
		opacity: 1;
	}
	.list li:hover .st,
	.list li:focus-within .st,
	.list.picking .st {
		opacity: 0;
	}

	.st {
		display: inline-block;
		flex: none;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		transition: opacity 0.15s;
	}
	.st[data-st='today'] {
		background: var(--salvia);
	}
	.st[data-st='late'] {
		background: var(--terra-ink);
	}
	.st[data-st='learn'] {
		box-shadow: inset 0 0 0 1.5px var(--salvia);
	}
	.st[data-st='new'] {
		box-shadow: inset 0 0 0 1.5px var(--ink-3);
		opacity: 0.7;
	}
	.st[data-st='done'] {
		background: var(--line-2);
	}
	.st[data-st='leech'] {
		background: var(--gold-ink);
	}
	.w {
		display: flex;
		align-items: baseline;
		gap: 8px;
		min-width: 0;
	}
	.w b {
		font: 600 17px/1.3 var(--f-head);
		letter-spacing: -0.01em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.w small {
		font-size: 14px;
		color: var(--ink-3);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.t {
		color: var(--ink-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		transition: opacity 0.15s;
	}
	.t.faint {
		color: var(--ink-3);
	}
	/* Modo estudo: a tradução só aparece com o mouse em cima (ou foco na linha). */
	.list.study .t {
		opacity: 0;
	}
	.list.study li:hover .t,
	.list.study .r:focus-visible .t,
	.list.study .r.cur .t {
		opacity: 1;
	}
	.x {
		font-size: 15px;
		color: var(--ink-3);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.x :global(mark) {
		background: transparent;
		color: var(--ink);
		font-weight: 600;
		padding: 0;
		margin: 0;
	}
	.src {
		display: inline-grid;
		place-items: center;
		color: var(--ink-3);
	}
	.when {
		font-size: 14px;
		color: var(--ink-3);
		text-align: right;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
	.when.late {
		color: var(--terra-ink);
		font-weight: 500;
	}
	.chip-leech {
		display: inline-flex;
		align-items: center;
		height: 20px;
		padding: 0 7px;
		border-radius: 4px;
		font-size: 12.5px;
		font-weight: 600;
		color: var(--gold-ink);
		background: var(--gold-soft);
	}
	.foot {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 16px;
		margin-top: 18px;
		font-size: 13.5px;
		color: var(--ink-3);
	}
	.foot > span {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.foot .gap {
		margin-left: 8px;
	}
	.no-res {
		text-align: center;
		padding: 56px 0;
		color: var(--ink-3);
	}
	.no-res b {
		display: block;
		color: var(--ink);
		font: 600 18.5px var(--f-head);
		margin-bottom: 4px;
	}

	/* Sem mouse não há hover: a caixa fica sempre à vista, à esquerda do pontinho. */
	@media (hover: none) {
		.list .ck {
			opacity: 1;
		}
		.r {
			padding-left: 44px;
		}
		.list li:hover .st,
		.list li:focus-within .st,
		.list.picking .st {
			opacity: 1;
		}
	}

	@media (max-width: 980px) {
		.search {
			width: 160px;
		}
		.search:focus-within,
		.search.has-q {
			width: 220px;
		}
	}

	/* Mobile: título com busca e Exibir em ícones; filtros em pílulas que rolam. */
	@media (max-width: 768px) {
		.top {
			position: relative;
			grid-template-columns: minmax(0, 1fr) auto auto;
			grid-template-areas: 'title tools acts' 'tabs tabs tabs';
			margin: 0 0 6px;
		}
		.top h1 {
			margin: 0;
			font-size: 27px;
		}
		.tools,
		.tabs {
			border: 0;
		}
		.tools {
			padding: 0;
			align-self: center;
		}
		.tools > .txt-sel,
		.add-btn,
		.review-btn,
		.show-btn .lbl,
		.show-btn :global(.ic:last-child) {
			display: none;
		}
		.acts .show-btn {
			width: 38px;
			padding: 0;
		}
		.show-m {
			display: block;
		}
		.show-m .txt-sel {
			display: flex;
		}
		.show-m .txt-sel :global(.trigger) {
			height: 38px;
			padding: 0 10px;
			font-size: 15px;
		}
		.search,
		.search:focus-within,
		.search.has-q {
			width: 38px;
		}
		.search input {
			height: 38px;
			padding: 0;
			color: transparent;
		}
		.search input::placeholder,
		.search kbd {
			display: none;
			color: transparent;
		}
		.search label {
			left: 11px;
			color: var(--ink-2);
		}
		/* Aberta, a busca cobre a linha do título. */
		.search:focus-within,
		.search.has-q {
			position: absolute;
			left: 0;
			right: 0;
			top: 0;
			width: auto;
			z-index: 2;
			background: var(--page);
		}
		.search:focus-within input,
		.search.has-q input {
			padding: 0 12px 0 36px;
			color: var(--ink);
			background: var(--sunk);
		}
		.search:focus-within input::placeholder,
		.search.has-q input::placeholder {
			display: initial;
			color: var(--ink-3);
		}
		.tabs {
			gap: 6px;
			margin: 12px -16px 4px;
			padding: 0 16px;
			overflow-x: auto;
			scrollbar-width: none;
		}
		.tabs::-webkit-scrollbar {
			display: none;
		}
		.tabs a {
			flex: none;
			height: 34px;
			padding: 0 13px;
			border-radius: 99px;
			font-size: 14.5px;
			color: var(--ink-2);
			box-shadow: inset 0 0 0 1px var(--line-2);
		}
		.tabs a[aria-current='page'] {
			background: var(--primary);
			color: var(--on-primary);
			box-shadow: none;
		}
		.tabs a[aria-current='page']::after {
			display: none;
		}
		.tabs a[aria-current='page'] .c {
			color: inherit;
			opacity: 0.7;
		}
		.list {
			margin: 0 -8px;
		}
		.r {
			grid-template-columns: 8px auto minmax(0, 1fr) auto;
			grid-template-areas: 'st w t n' 'st x x n';
			gap: 2px 10px;
			min-height: 0;
			padding: 11px 12px;
		}
		.st {
			grid-area: st;
		}
		.w {
			grid-area: w;
		}
		.t {
			grid-area: t;
			align-self: baseline;
		}
		.x {
			grid-area: x;
			font-size: 14px;
		}
		.when {
			grid-area: n;
			font-size: 13.5px;
		}
		.src {
			display: none;
		}
		.w b {
			font-size: 16.5px;
		}
		li + li .r::before {
			left: 12px;
			right: 12px;
		}
		.list .ck {
			left: 8px;
		}
		.foot {
			display: none;
		}
	}
</style>
