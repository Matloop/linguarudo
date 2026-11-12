<script lang="ts">
	import { resolve } from '$app/paths';
	import { tick } from 'svelte';
	import { isPausedIn, type DeckSummary } from '#lib/decks.ts';
	import {
		DECK_NAME_UI_MAX,
		deckDisplayName,
		forToday,
		hubSubtitle,
		plural,
		rowCounts,
		todayBreakdown,
		todayTotals
	} from '#lib/decks-ui.ts';
	import BulkBar from '#lib/ui/BulkBar.svelte';
	import DeckPicker from '#lib/ui/DeckPicker.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import Mark from '#lib/ui/Mark.svelte';
	import Popover from '#lib/ui/Popover.svelte';
	import { toast } from '#lib/ui/app-state.svelte.ts';
	import { postAction } from '#lib/ui/post-action.ts';
	import { Selection } from '#lib/ui/selection.svelte.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const decks = $derived(data.decks);
	const totals = $derived(todayTotals(decks, data.budget));
	const subtitle = $derived(hubSubtitle(decks, data.flashcards));
	const onlyDefault = $derived(decks.length === 1);
	const nothing = $derived(
		data.flashcards === 0 && decks.every((d) => !d.total.items && !d.total.fichas)
	);
	const perDayTotal = $derived(data.budget.perDay + data.budget.extraNew);
	/** Barra da faixa: novas começadas hoje sobre o orçamento do dia; cheia quando tudo em dia. */
	const barPct = $derived(
		totals.total === 0
			? 100
			: perDayTotal
				? Math.min(100, Math.round((data.budget.newDoneToday / perDayTotal) * 100))
				: 0
	);

	const sel = new Selection(() => decks.map((d) => d.id));
	$effect(() => {
		void decks;
		sel.prune();
	});
	const chosen = $derived(decks.filter((d) => sel.has(d.id)));
	const allPaused = $derived(chosen.length > 0 && chosen.every((d) => d.paused));
	const hasChildren = (d: DeckSummary) => decks.some((c) => c.parentId === d.id);
	const canNest = $derived(chosen.length > 0 && !chosen.some(hasChildren));
	/** Modo seleção no mobile (sem hover, o botão "Selecionar" mostra as caixas). */
	let picking = $state(false);

	const studyHref = $derived(
		resolve(`/flashcards/estudar?${chosen.map((d) => `deck=${d.id}`).join('&')}`)
	);

	// ---------- Novo deck ----------
	let createOpen = $state(false);
	let createName = $state('');
	let createError = $state('');
	let creating = $state(false);
	let flashId = $state<string | null>(null);

	async function create(e: SubmitEvent) {
		e.preventDefault();
		if (creating || !createName.trim()) return;
		creating = true;
		const r = await postAction('create', { name: createName });
		creating = false;
		if (!r.ok) {
			createError = r.message;
			return;
		}
		const deck = r.data.deck as { id: string; name: string };
		toast(`Deck “${deckDisplayName(deck.name)}” criado`);
		createOpen = false;
		createName = '';
		createError = '';
		flashId = deck.id;
		setTimeout(() => (flashId = null), 1600);
	}

	// ---------- Barra de seleção ----------
	let renameOpen = $state(false);
	let renameName = $state('');
	let renameError = $state('');
	let moveOpen = $state(false);
	let busy = $state(false);

	$effect(() => {
		if (renameOpen && chosen.length === 1) {
			renameName = chosen[0].name;
			renameError = '';
		}
	});

	async function togglePause() {
		const paused = !allPaused;
		busy = true;
		const r = await postAction('pause', { id: chosen.map((d) => d.id), paused: String(paused) });
		busy = false;
		if (!r.ok) return toast(r.message);
		toast(
			paused
				? `${plural(chosen.length, 'deck pausado', 'decks pausados')}: fora do Estudar tudo`
				: `${plural(chosen.length, 'deck retomado', 'decks retomados')}`
		);
	}

	async function rename(e: SubmitEvent) {
		e.preventDefault();
		if (busy || chosen.length !== 1) return;
		busy = true;
		const r = await postAction('rename', { id: chosen[0].id, name: renameName });
		busy = false;
		if (!r.ok) {
			renameError = r.message;
			return;
		}
		renameOpen = false;
		toast('Deck renomeado');
	}

	const nestTargets = $derived([
		{ id: '', name: 'Nenhum (deck de topo)', depth: 0 },
		...decks
			.filter((d) => d.depth === 0 && !sel.has(d.id))
			.map((d) => ({ id: d.id, name: d.name, depth: 0 }))
	]);

	async function nest(choice: { deckId: string } | { newName: string }) {
		if (!('deckId' in choice)) return;
		busy = true;
		const r = await postAction('nest', { id: chosen.map((d) => d.id), parent: choice.deckId });
		busy = false;
		moveOpen = false;
		if (!r.ok) return toast(r.message);
		const target = decks.find((d) => d.id === choice.deckId);
		toast(target ? `Movido para ${deckDisplayName(target.name)}` : 'Agora é deck de topo');
		sel.clear();
	}

	function onkeydown(e: KeyboardEvent) {
		sel.onkeydown(e);
	}

	function focusName(node: HTMLInputElement) {
		void tick().then(() => {
			node.focus();
			node.select();
		});
	}

	const cell = (n: number) => (n === 0 ? 'zero' : '');
</script>

<svelte:head>
	<title>Flashcards · Linguetta</title>
</svelte:head>

<svelte:window {onkeydown} />

{#snippet more()}
	<Popover label="Mais opções" width={260}>
		{#snippet trigger({ toggle, expanded, id })}
			<button
				class="icon-btn more-btn"
				type="button"
				aria-label="Mais opções"
				title="Mais opções"
				aria-haspopup="dialog"
				aria-expanded={expanded}
				aria-controls={id}
				onclick={toggle}><Icon name="more" /></button
			>
		{/snippet}
		<nav class="menu" aria-label="Mais">
			<a href={resolve('/flashcards/fichas')}><Icon name="cards" size="sm" />Fichas</a>
			<a href={resolve('/flashcards/importar')}><Icon name="upload" size="sm" />Importar do Anki</a>
			{#if data.tags.length}
				<div class="menu-label">Estudar por tag</div>
				<div class="menu-tags">
					{#each data.tags as tag (tag)}
						<a class="chip" href={resolve(`/flashcards/estudar?tag=${encodeURIComponent(tag)}`)}
							><Icon name="tag" size="sm" />{tag}</a
						>
					{/each}
				</div>
			{/if}
		</nav>
	</Popover>
{/snippet}

<div class="ph">
	<div>
		<h1>Flashcards</h1>
		{#if !nothing}<p data-testid="hub-sub">{subtitle}</p>{/if}
	</div>
	<div class="ph-acts">
		<a class="btn btn-ghost hide-s" href={resolve('/flashcards/importar')}
			><Icon name="upload" size="sm" />Importar</a
		>
		{@render more()}
		<Popover label="Novo deck" bind:open={createOpen}>
			{#snippet trigger({ toggle, expanded, id })}
				<button
					class="btn btn-soft"
					type="button"
					aria-haspopup="dialog"
					aria-expanded={expanded}
					aria-controls={id}
					onclick={toggle}><Icon name="plus" size="sm" />Novo deck</button
				>
			{/snippet}
			{#snippet children({ close })}
				<form class="pop-form" onsubmit={create}>
					<label for="novo-deck">Nome do deck</label>
					<!-- svelte-ignore a11y_autofocus -->
					<input
						id="novo-deck"
						class="input"
						autofocus
						maxlength={DECK_NAME_UI_MAX}
						autocomplete="off"
						placeholder="Ex.: Viagem"
						aria-invalid={createError ? 'true' : undefined}
						aria-describedby={createError ? 'novo-deck-erro' : undefined}
						bind:value={createName}
						oninput={() => (createError = '')}
					/>
					{#if createError}<p class="err" id="novo-deck-erro" role="alert">{createError}</p>{/if}
					<div class="pop-row">
						<span class="code" title="Idioma do deck">{data.language.toUpperCase()}</span>
						<span class="sp"></span>
						<button class="btn btn-ghost" type="button" onclick={close}>Cancelar</button>
						<button class="btn btn-primary" disabled={!createName.trim() || creating}>Criar</button>
					</div>
				</form>
			{/snippet}
		</Popover>
	</div>
</div>

{#if nothing}
	<div class="empty">
		<div>
			<Mark class="mark mark-hero" />
			<h2>Nenhum flashcard ainda</h2>
			<p>
				Guarde palavras, crie fichas ou importe um baralho do Anki. Cada uma vira flashcard no deck
				certo.
			</p>
			<div class="acts">
				<a class="btn btn-primary btn-lg" href={resolve('/flashcards?guardar')}
					><Icon name="plus" />Guardar palavra</a
				>
				<a class="btn btn-soft btn-lg" href={resolve('/flashcards/importar')}
					><Icon name="upload" />Importar do Anki</a
				>
			</div>
		</div>
	</div>
{:else}
	<section class="tile lift study" aria-label="Para hoje">
		<div class="txt">
			{#if totals.total > 0}
				<b data-testid="para-hoje">{plural(totals.total, 'para hoje', 'para hoje')}</b>
				<span class="meta">
					{#if totals.budgetSpent}
						{totals.reviews ? `${plural(totals.reviews, 'revisão', 'revisões')} · ` : ''}as {perDayTotal}
						novas de hoje já foram
					{:else}
						{todayBreakdown(totals.fresh, totals.reviews)}
					{/if}
				</span>
			{:else}
				<b data-testid="para-hoje">Tudo em dia</b>
				<span class="meta"
					>{#if data.nextDue?.startsWith('hoje')}O próximo volta {data.nextDue}{:else if data.tomorrow}Amanhã, cerca de {plural(
							data.tomorrow,
							'revisão',
							'revisões'
						)}{:else}Nada vence amanhã{/if}</span
				>
			{/if}
			<span
				class="bar"
				role="progressbar"
				aria-label="Novas de hoje"
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={barPct}><i style:width="{barPct}%"></i></span
			>
		</div>
		{#if totals.total > 0}
			<a
				class="btn btn-primary btn-lg"
				href={resolve('/flashcards/estudar')}
				data-testid="estudar-tudo"
				><Icon name="play" size="sm" />Estudar tudo<kbd aria-hidden="true">R</kbd></a
			>
		{/if}
	</section>

	<div class="table-tools">
		<button
			class="btn btn-ghost pick-btn"
			type="button"
			aria-pressed={picking}
			onclick={() => {
				picking = !picking;
				if (!picking) sel.clear();
			}}>{picking ? 'Pronto' : 'Selecionar'}</button
		>
	</div>

	<table class="decks" class:picking={picking || sel.size > 0} class:solo={onlyDefault}>
		<caption class="visually-hidden">Decks em {data.language}</caption>
		{#if !onlyDefault}
			<thead>
				<tr>
					<th scope="col" class="c-ck"
						><input
							class="ck"
							type="checkbox"
							aria-label="Selecionar todos"
							checked={sel.size === decks.length && decks.length > 0}
							indeterminate={sel.size > 0 && sel.size < decks.length}
							onclick={() => (sel.size === decks.length ? sel.clear() : sel.all())}
						/></th
					>
					<th scope="col" class="c-name">Deck</th>
					<th scope="col" class="c-n">Novas</th>
					<th scope="col" class="c-n">Aprendendo</th>
					<th scope="col" class="c-n">Revisar</th>
					<th scope="col" class="c-today">Hoje</th>
				</tr>
			</thead>
		{/if}
		<tbody>
			{#each decks as d (d.id)}
				{@const c = rowCounts(d)}
				{@const paused = isPausedIn(d, decks)}
				{@const empty = !c.items && !c.fichas}
				{@const waiting = c.newAvailable - c.newToday}
				{@const name = deckDisplayName(d.name)}
				<tr
					data-sel-id={d.id}
					class:sel={sel.has(d.id)}
					class:child={d.depth === 1}
					class:flash={flashId === d.id}
				>
					<td class="c-ck"
						><input
							class="ck"
							type="checkbox"
							aria-label="Selecionar {name}"
							checked={sel.has(d.id)}
							onclick={(e) => sel.toggle(d.id, e.shiftKey)}
						/></td
					>
					<td class="c-name">
						<div class="nm-wrap">
							<a
								class="nm"
								class:paused
								href={resolve('/flashcards/deck/[id]', { id: d.id })}
								title={name}>{name}</a
							>
							{#if d.paused}<span class="pill">Pausado</span>{/if}
							{#if d.isDefault && !onlyDefault}<span class="faint dflt">padrão</span>{/if}
						</div>
						<span class="m-meta"
							>{#if empty}Vazio{:else}{todayBreakdown(c.newToday, c.learning + c.review) ||
									'Nada para hoje'}{/if}</span
						>
					</td>
					{#if empty}
						<td class="c-n c-empty" colspan="3"><span class="faint">Vazio</span></td>
					{:else}
						<td
							class="c-n {cell(c.newToday)}"
							title={waiting > 0
								? `${plural(waiting, 'nova espera', 'novas esperam')} além de hoje`
								: undefined}>{c.newToday}</td
						>
						<td class="c-n {cell(c.learning)}">{c.learning}</td>
						<td class="c-n {cell(c.review)}" class:rev={c.review > 0 && !paused}>{c.review}</td>
					{/if}
					<td class="c-today {cell(forToday(c))}" class:rev={forToday(c) > 0 && !paused}
						>{forToday(c)}<span class="visually-hidden">&nbsp;para hoje</span></td
					>
				</tr>
			{/each}
		</tbody>
	</table>
	{#if onlyDefault}
		<p class="hint faint">
			Separe por tema ou <a href={resolve('/flashcards/importar')}>importe do Anki</a>.
		</p>
	{/if}

	<BulkBar count={sel.size} label="Ações dos decks" onclear={() => sel.clear()}>
		<a class="btn btn-ghost" href={studyHref}><Icon name="play" size="sm" />Estudar</a>
		<button class="btn btn-ghost" type="button" disabled={busy} onclick={togglePause}
			><Icon name={allPaused ? 'play' : 'pause'} size="sm" />{allPaused
				? 'Retomar'
				: 'Pausar'}</button
		>
		{#if chosen.length === 1}
			<Popover label="Renomear deck" bind:open={renameOpen} align="start" placement="above">
				{#snippet trigger({ toggle, expanded, id })}
					<button
						class="btn btn-ghost"
						type="button"
						aria-haspopup="dialog"
						aria-expanded={expanded}
						aria-controls={id}
						onclick={toggle}><Icon name="pencil" size="sm" />Renomear</button
					>
				{/snippet}
				{#snippet children({ close })}
					<form class="pop-form" onsubmit={rename}>
						<label for="renomear-deck">Nome do deck</label>
						<input
							id="renomear-deck"
							class="input"
							maxlength={DECK_NAME_UI_MAX}
							autocomplete="off"
							aria-invalid={renameError ? 'true' : undefined}
							bind:value={renameName}
							use:focusName
							oninput={() => (renameError = '')}
						/>
						{#if renameError}<p class="err" role="alert">{renameError}</p>{/if}
						<div class="pop-row">
							<span class="sp"></span>
							<button class="btn btn-ghost" type="button" onclick={close}>Cancelar</button>
							<button class="btn btn-primary" disabled={!renameName.trim() || busy}>Salvar</button>
						</div>
					</form>
				{/snippet}
			</Popover>
		{/if}
		<Popover label="Mover deck" bind:open={moveOpen} align="start" placement="above">
			{#snippet trigger({ toggle, expanded, id })}
				<button
					class="btn btn-ghost"
					type="button"
					disabled={!canNest}
					title={canNest ? undefined : 'Deck com subdecks fica no topo'}
					aria-haspopup="dialog"
					aria-expanded={expanded}
					aria-controls={id}
					onclick={toggle}><Icon name="folder" size="sm" />Mover…</button
				>
			{/snippet}
			<div>
				<p class="pop-title">Dentro de qual deck?</p>
				<DeckPicker decks={nestTargets} allowNew={false} pending={busy} onpick={nest} />
			</div>
		</Popover>
	</BulkBar>
{/if}

<style>
	.ph-acts {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.more-btn {
		width: 38px;
		height: 38px;
	}
	.menu {
		display: flex;
		flex-direction: column;
		margin: -6px;
	}
	.menu > a {
		display: flex;
		align-items: center;
		gap: 10px;
		height: 38px;
		padding: 0 10px;
		border-radius: var(--r-m);
		color: var(--ink);
		text-decoration: none;
	}
	.menu > a:hover {
		background: var(--hover);
	}
	.menu-label {
		margin: 8px 10px 6px;
		padding-top: 8px;
		border-top: 1px solid var(--line);
		font-size: 13px;
		color: var(--ink-3);
	}
	.menu-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		padding: 0 10px 8px;
	}
	.pop-form {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.pop-form label,
	.pop-title {
		font-size: 13.5px;
		color: var(--ink-3);
		margin: 0;
	}
	.pop-title {
		margin-bottom: 8px;
	}
	.pop-row {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 4px;
	}
	.sp {
		flex: 1;
	}
	.err {
		margin: 0;
		color: var(--terra-ink);
		font-size: 13.5px;
	}

	.study {
		flex-direction: row;
		align-items: center;
		gap: 24px;
		margin-bottom: 26px;
		padding: 18px 20px;
	}
	.study .txt {
		flex: 1;
		min-width: 0;
		display: grid;
		gap: 4px;
	}
	.study b {
		font: 600 21px/1.2 var(--f-head);
		letter-spacing: -0.01em;
	}
	.study .meta {
		color: var(--ink-3);
		font-size: 14.5px;
	}
	.study .bar {
		max-width: 240px;
		margin-top: 8px;
	}

	.table-tools {
		display: none;
	}
	.decks {
		width: 100%;
		border-collapse: collapse;
		font-variant-numeric: tabular-nums;
	}
	th {
		font-size: 13.5px;
		font-weight: 500;
		color: var(--ink-3);
		text-align: right;
		padding: 0 12px 10px;
		border-bottom: 1px solid var(--line);
		white-space: nowrap;
	}
	th.c-name {
		text-align: left;
	}
	td {
		padding: 0 12px;
		height: 54px;
		border-bottom: 1px solid var(--line);
		text-align: right;
		color: var(--ink);
		font-size: 15.5px;
	}
	tr {
		position: relative;
		transition: background-color 0.15s;
	}
	tbody tr:hover {
		background: var(--hover);
	}
	tbody tr.sel {
		background: var(--sel);
	}
	tr.flash {
		animation: flash 1.6s var(--ease);
	}
	@keyframes flash {
		0%,
		30% {
			background: var(--terra-soft);
		}
	}
	.c-ck {
		width: 34px;
		padding-right: 0;
		position: relative;
		z-index: 1;
	}
	.c-ck .ck {
		opacity: 0;
	}
	tr:hover .ck,
	tr:focus-within .ck,
	.picking .ck,
	.ck:checked {
		opacity: 1;
	}
	@media (hover: none) {
		.c-ck .ck {
			opacity: 1;
		}
	}
	.c-name {
		text-align: left;
		max-width: 0;
		width: 100%;
	}
	.nm-wrap {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}
	.nm {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font: 600 16.5px/1.3 var(--f-head);
		color: var(--ink);
		text-decoration: none;
	}
	/* O link cobre a linha inteira (como .wrow); a caixa fica por cima. */
	.nm::after {
		content: '';
		position: absolute;
		inset: 0;
	}
	.nm:focus-visible {
		outline: none;
	}
	.nm:focus-visible::after {
		border-radius: var(--r-m);
		box-shadow: inset 0 0 0 2px var(--ring);
	}
	.nm.paused {
		color: var(--ink-3);
	}
	.dflt {
		font-size: 13px;
		white-space: nowrap;
	}
	.child .nm-wrap {
		padding-left: 22px;
		position: relative;
	}
	.child .nm-wrap::before {
		content: '';
		position: absolute;
		left: 6px;
		top: -8px;
		width: 9px;
		height: 18px;
		border-left: 1px solid var(--line-2);
		border-bottom: 1px solid var(--line-2);
		border-bottom-left-radius: 5px;
	}
	.m-meta {
		display: none;
	}
	.c-n {
		width: 112px;
		white-space: nowrap;
	}
	.c-today {
		display: none;
	}
	.zero {
		color: var(--ink-3);
		opacity: 0.6;
	}
	.rev {
		color: var(--terra-ink);
		font-weight: 600;
	}
	.c-empty {
		text-align: right;
	}
	.solo td {
		border-bottom: 0;
	}
	.hint {
		margin: 14px 0 0 46px;
		font-size: 14.5px;
	}
	.hint a {
		color: inherit;
	}

	@media (max-width: 560px) {
		.hide-s {
			display: none;
		}
		.ph-acts {
			justify-content: flex-start;
		}
		.study {
			flex-direction: column;
			align-items: stretch;
			gap: 14px;
			padding: 16px;
		}
		.study .bar {
			max-width: none;
		}
		.study .btn {
			width: 100%;
		}
		.table-tools {
			display: flex;
			justify-content: flex-end;
			margin: -12px 0 4px;
		}
		th.c-n,
		td.c-n {
			display: none;
		}
		th.c-today,
		td.c-today {
			display: table-cell;
			width: 56px;
		}
		.c-ck {
			display: none;
		}
		.picking .c-ck {
			display: table-cell;
		}
		td {
			height: auto;
			padding-top: 12px;
			padding-bottom: 12px;
		}
		.m-meta {
			display: block;
			margin-top: 2px;
			font-size: 13.5px;
			color: var(--ink-3);
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}
		.hint {
			margin-left: 12px;
		}
	}
</style>
