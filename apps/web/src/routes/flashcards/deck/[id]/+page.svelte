<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { isPausedIn, NEW_ORDERS, type NewOrder } from '#lib/decks.ts';
	import {
		DECK_NAME_UI_MAX,
		deckDisplayName,
		deckSubtitle,
		deleteMoveText,
		forToday,
		inTab,
		plural,
		rowCounts,
		type DeckTab
	} from '#lib/decks-ui.ts';
	import { answers } from '#lib/ui/answers.svelte.ts';
	import AnswersToggle from '#lib/ui/AnswersToggle.svelte';
	import BulkBar from '#lib/ui/BulkBar.svelte';
	import DeckLimits from '#lib/ui/DeckLimits.svelte';
	import DeckPicker from '#lib/ui/DeckPicker.svelte';
	import { clozePlain } from '#lib/fichas.ts';
	import Icon from '#lib/ui/Icon.svelte';
	import Popover from '#lib/ui/Popover.svelte';
	import { toast } from '#lib/ui/app-state.svelte.ts';
	import { postAction } from '#lib/ui/post-action.ts';
	import { Selection } from '#lib/ui/selection.svelte.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const deck = $derived(data.deck);
	const name = $derived(deckDisplayName(deck.name));
	const paused = $derived(isPausedIn(deck, data.decks));
	const today = $derived(forToday(rowCounts(deck)));
	const empty = $derived(data.entries.length === 0);

	const TABS: [DeckTab, string][] = [
		['todas', 'Todas'],
		['hoje', 'Na fila hoje'],
		['novas', 'Novas'],
		['aprendendo', 'Aprendendo'],
		['teimosas', 'Teimosas']
	];
	const ORDER_LABELS: Record<NewOrder, string> = {
		importance: 'Importância',
		deck: 'Ordem do baralho',
		random: 'Aleatória'
	};

	let tab = $state<DeckTab>('todas');

	onMount(() => answers.load());
	const counts = $derived(
		Object.fromEntries(
			TABS.map(([k]) => [k, data.entries.filter((e) => inTab(e.flags, k)).length])
		) as Record<DeckTab, number>
	);
	const tabs = $derived(TABS.filter(([k]) => k !== 'teimosas' || counts.teimosas > 0));
	$effect(() => {
		if (tab === 'teimosas' && counts.teimosas === 0) tab = 'todas';
	});
	const shown = $derived(data.entries.filter((e) => inTab(e.flags, tab)));

	const key = (e: { kind: string; id: string }) => `${e.kind}:${e.id}`;
	const sel = new Selection(() => shown.map(key));
	$effect(() => {
		void shown;
		sel.prune();
	});
	const chosen = $derived(shown.filter((e) => sel.has(key(e))));
	const idsOf = (kind: 'item' | 'ficha') => chosen.filter((e) => e.kind === kind).map((e) => e.id);

	const pickerDecks = $derived(data.decks.map((d) => ({ id: d.id, name: d.name, depth: d.depth })));
	const deckName = (id: string) => data.decks.find((d) => d.id === id)?.name ?? '';

	let busy = $state(false);

	async function save(action: string, fields: Record<string, string | string[]>, done?: string) {
		busy = true;
		const r = await postAction(action, fields);
		busy = false;
		if (!r.ok) {
			toast(r.message);
			return null;
		}
		if (done) toast(done);
		return r.data;
	}

	// ---------- Mover / voltar para a fila ----------
	let moveOpen = $state(false);
	async function move(choice: { deckId: string } | { newName: string }) {
		const fields: Record<string, string | string[]> = {
			item: idsOf('item'),
			ficha: idsOf('ficha'),
			...('deckId' in choice ? { deck: choice.deckId } : { newName: choice.newName })
		};
		const r = await save('move', fields);
		moveOpen = false;
		if (!r) return;
		toast(`${plural(Number(r.n), 'movido', 'movidos')} para ${deckDisplayName(String(r.target))}`);
		sel.clear();
	}

	async function release(entries: { kind: 'item' | 'ficha'; id: string }[]) {
		const r = await save('release', {
			item: entries.filter((e) => e.kind === 'item').map((e) => e.id),
			ficha: entries.filter((e) => e.kind === 'ficha').map((e) => e.id)
		});
		if (!r) return;
		toast(`${plural(Number(r.n), 'voltou', 'voltaram')} para a fila`);
		sel.clear();
	}

	// ---------- Opções ----------
	let optsOpen = $state(false);
	let renameName = $state('');
	let renameError = $state('');
	$effect(() => {
		if (optsOpen) {
			renameName = deck.name;
			renameError = '';
		}
	});

	async function rename(e: SubmitEvent) {
		e.preventDefault();
		if (busy || !renameName.trim() || renameName.trim() === deck.name) return;
		busy = true;
		const r = await postAction('rename', { id: deck.id, name: renameName });
		busy = false;
		if (!r.ok) {
			renameError = r.message;
			return;
		}
		toast('Baralho renomeado');
	}

	const setOrder = (o: NewOrder) =>
		o !== deck.newOrder && save('options', { id: deck.id, newOrder: o }, 'Ordem salva');
	const setPaused = (p: boolean) =>
		save('options', { id: deck.id, paused: String(p) }, p ? 'Baralho pausado' : 'Baralho retomado');
	const setReader = (on: boolean) =>
		save(
			'options',
			{ id: deck.id, onReader: String(on) },
			on ? 'Aparece no leitor' : 'Fora do leitor'
		);
	const makeDefault = () => save('default', { id: deck.id }, `Palavras guardadas caem em ${name}`);

	// ---------- Apagar ----------
	let delDialog: HTMLDialogElement | undefined = $state();
	let delMode = $state<'move' | 'delete'>('move');
	const content = $derived(deck.total.items + deck.total.fichas);
	async function remove(e: SubmitEvent) {
		e.preventDefault();
		const r = await save('delete', { id: deck.id, mode: delMode });
		if (!r) return;
		delDialog?.close();
		toast(
			delMode === 'move'
				? `Baralho apagado; ${plural(content, 'carta foi', 'cartas foram')} para ${deckDisplayName(data.defaultName)}`
				: 'Baralho apagado'
		);
		await goto(resolve('/flashcards'));
	}

	function onkeydown(e: KeyboardEvent) {
		sel.onkeydown(e);
		answers.onkeydown(e);
	}
</script>

<svelte:head>
	<title>{name} · Linguetta</title>
</svelte:head>

<svelte:window {onkeydown} />

<nav class="crumbs" aria-label="Caminho">
	<a href={resolve('/flashcards')}>Baralhos</a>
	<Icon name="right" size="sm" />
	{#if data.parent}
		<a href={resolve('/flashcards/deck/[id]', { id: data.parent.id })}>{data.parent.name}</a>
		<Icon name="right" size="sm" />
	{/if}
</nav>

<div class="ph">
	<div class="ttl">
		<h1 title={name}>{deck.name.split('::').at(-1)}</h1>
		<p data-testid="deck-sub">{deckSubtitle(rowCounts(deck).flashcards, deck.limits)}</p>
	</div>
	<div class="ph-acts">
		<DeckLimits {deck} />
		<Popover label="Opções do baralho" bind:open={optsOpen} width={340}>
			{#snippet trigger({ toggle, expanded, id })}
				<button
					class="icon-btn more-btn"
					type="button"
					aria-label="Opções do baralho"
					title="Opções do baralho"
					aria-haspopup="dialog"
					aria-expanded={expanded}
					aria-controls={id}
					onclick={toggle}><Icon name="more" /></button
				>
			{/snippet}
			{#snippet children({ close })}
				<div class="opts">
					<form class="opt" onsubmit={rename}>
						<label for="deck-nome">Nome</label>
						<div class="inline">
							<input
								id="deck-nome"
								class="input"
								maxlength={DECK_NAME_UI_MAX}
								autocomplete="off"
								aria-invalid={renameError ? 'true' : undefined}
								bind:value={renameName}
								oninput={() => (renameError = '')}
							/>
							<button
								class="btn btn-soft"
								disabled={busy || !renameName.trim() || renameName.trim() === deck.name}
								>Renomear</button
							>
						</div>
						{#if renameError}<p class="err" role="alert">{renameError}</p>{/if}
					</form>

					<div class="opt">
						<span class="lbl" id="ordem-lbl">Ordem das novas</span>
						<div class="seg" role="group" aria-labelledby="ordem-lbl">
							{#each NEW_ORDERS as o (o)}
								<button
									type="button"
									aria-pressed={deck.newOrder === o}
									disabled={busy}
									onclick={() => setOrder(o)}>{ORDER_LABELS[o]}</button
								>
							{/each}
						</div>
					</div>

					<div class="toggles">
						<label class="tg">
							<span><b>Pausado</b><span>Fora do Estudar tudo</span></span>
							<input
								class="switch"
								type="checkbox"
								checked={deck.paused}
								disabled={busy}
								onchange={(e) => setPaused(e.currentTarget.checked)}
							/>
						</label>
						<label class="tg">
							<span><b>No leitor</b><span>Aparece na lista do e-reader</span></span>
							<input
								class="switch"
								type="checkbox"
								checked={deck.onReader}
								disabled={busy}
								onchange={(e) => setReader(e.currentTarget.checked)}
							/>
						</label>
						<label class="tg">
							<span
								><b>Baralho padrão</b><span
									>{deck.isDefault
										? 'Palavras guardadas caem aqui'
										: 'Palavras guardadas passam a cair aqui'}</span
								></span
							>
							<input
								class="switch"
								type="checkbox"
								checked={deck.isDefault}
								disabled={deck.isDefault || busy}
								onchange={makeDefault}
							/>
						</label>
					</div>

					{#if !deck.isDefault}
						<button
							class="btn btn-danger del"
							type="button"
							onclick={() => {
								close();
								delMode = 'move';
								delDialog?.showModal();
							}}><Icon name="archive" size="sm" />Apagar baralho…</button
						>
					{/if}
				</div>
			{/snippet}
		</Popover>
		{#if today > 0}
			<a
				class="btn btn-primary"
				href={resolve(`/flashcards/estudar?deck=${deck.id}`)}
				data-testid="estudar-deck"><Icon name="play" size="sm" />Estudar {today}</a
			>
		{:else}
			<span class="btn btn-soft is-off" aria-disabled="true">Nada para hoje</span>
		{/if}
	</div>
</div>

{#if paused}
	<div class="banner" role="status">
		<Icon name="pause" size="sm" />
		<span
			>{deck.paused
				? 'Pausado: fora do Estudar tudo.'
				: `Pausado pelo baralho ${data.parent?.name ?? ''}: fora do Estudar tudo.`}</span
		>
		{#if deck.paused}
			<button class="btn btn-soft" type="button" disabled={busy} onclick={() => setPaused(false)}
				>Retomar</button
			>
		{/if}
	</div>
{/if}

{#if empty}
	<div class="empty">
		<div>
			<h2>Baralho vazio</h2>
			<p>Mova palavras para cá em Minhas palavras, ou crie uma ficha.</p>
			<div class="acts">
				<a class="btn btn-soft" href={resolve('/palavras')}>Minhas palavras</a>
				<a class="btn btn-ghost" href={resolve('/flashcards/fichas/nova')}>Nova ficha</a>
			</div>
		</div>
	</div>
{:else}
	<div class="tabs-row">
		<nav class="seg tabs" aria-label="Filtro">
			{#each tabs as [k, label] (k)}
				<button
					type="button"
					data-f={k}
					aria-pressed={tab === k}
					onclick={() => {
						tab = k;
						sel.clear();
					}}>{label}<span class="c">{counts[k]}</span></button
				>
			{/each}
		</nav>
		<AnswersToggle />
	</div>

	{#if tab === 'teimosas'}
		<p class="leech-hint faint">
			Saíram da fila depois de muitos erros. Voltam sozinhas quando você as encontra de novo, ou à
			mão aqui.
		</p>
	{/if}

	{#if shown.length === 0}
		<p class="none faint">Nada nesta aba.</p>
	{:else}
		<ul class="list" class:picking={sel.size > 0}>
			{#each shown as e (key(e))}
				{@const k = key(e)}
				<li data-sel-id={k} class:sel={sel.has(k)}>
					<input
						class="ck"
						type="checkbox"
						aria-label="Selecionar {e.title}"
						checked={sel.has(k)}
						onclick={(ev) => sel.toggle(k, ev.shiftKey)}
					/>
					<a
						class="wrow"
						href={e.kind === 'item'
							? resolve(`/palavras?item=${e.id}&deck=${e.deckId}`)
							: resolve('/flashcards/fichas/[id]', { id: e.id })}
					>
						<span class="w"
							><b>{e.kind === 'ficha' ? clozePlain(e.title, answers.shown) : e.title}</b
							>{#if answers.shown}<span>{e.sub || ' '}</span>{:else}<span
									class="veil"
									aria-label="Resposta oculta"
								></span>{/if}</span
						>
						<span class="kind" title={e.kind === 'ficha' ? 'Ficha' : 'Palavra'}
							><Icon name={e.kind === 'ficha' ? 'cards' : 'bookmark'} size="sm" /></span
						>
						{#if e.deckId !== deck.id}
							<span class="sub-deck faint" title={deckName(e.deckId)}
								>{deckName(e.deckId).split('::').at(-1)}</span
							>
						{:else}
							<span></span>
						{/if}
						<span class="next" class:hoje={e.flags.today}
							>{#if e.flags.leech}<span class="teimosa">Teimosa</span>{:else}{e.next}{/if}</span
						>
					</a>
					{#if tab === 'teimosas'}
						<button
							class="btn btn-ghost back"
							type="button"
							disabled={busy}
							onclick={() => release([e])}>Voltar para a fila</button
						>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
{/if}

<BulkBar count={sel.size} label="Ações da seleção" onclear={() => sel.clear()}>
	{#if tab === 'teimosas'}
		<button class="btn btn-ghost" type="button" disabled={busy} onclick={() => release(chosen)}
			><Icon name="undo" size="sm" />Voltar para a fila</button
		>
	{/if}
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
		<DeckPicker decks={pickerDecks} current={deck.id} pending={busy} onpick={move} />
	</Popover>
</BulkBar>

<dialog class="del-dialog" bind:this={delDialog} aria-labelledby="del-title">
	<form onsubmit={remove}>
		<h2 id="del-title">Apagar “{name}”?</h2>
		{#if content > 0}
			<fieldset>
				<legend class="visually-hidden">O que fazer com o conteúdo</legend>
				<label class="radio"
					><input type="radio" name="mode" value="move" bind:group={delMode} />
					<span
						><b>{deleteMoveText(content, deckDisplayName(data.defaultName))}</b><span
							>O progresso fica.</span
						></span
					></label
				>
				<label class="radio"
					><input type="radio" name="mode" value="delete" bind:group={delMode} />
					<span
						><b>Apagar junto</b><span
							>{plural(content, 'palavra ou ficha some', 'palavras e fichas somem')} com o histórico.</span
						></span
					></label
				>
			</fieldset>
		{:else}
			<p class="faint">O baralho está vazio.</p>
		{/if}
		<div class="d-acts">
			<button class="btn btn-ghost" type="button" onclick={() => delDialog?.close()}
				>Cancelar</button
			>
			<button class="btn btn-danger" disabled={busy}
				>{delMode === 'delete' && content > 0 ? 'Apagar tudo' : 'Apagar baralho'}</button
			>
		</div>
	</form>
</dialog>

<style>
	.crumbs {
		display: flex;
		align-items: center;
		gap: 4px;
		margin-bottom: 6px;
		font-size: 14.5px;
		color: var(--ink-3);
	}
	.crumbs a {
		color: var(--ink-3);
		text-decoration: none;
		max-width: 260px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.crumbs a:hover {
		color: var(--ink);
	}
	.ttl {
		min-width: 0;
	}
	.ttl h1 {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ph-acts {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: none;
	}
	.more-btn {
		width: 38px;
		height: 38px;
	}
	.is-off {
		pointer-events: none;
		color: var(--ink-3);
	}

	.opts {
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	.opt {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin: 0;
	}
	.opt label,
	.lbl {
		font-size: 13.5px;
		color: var(--ink-3);
	}
	.inline {
		display: flex;
		gap: 6px;
	}
	.opt .seg {
		display: flex;
	}
	.opt .seg > button {
		flex: 1;
		padding: 0 8px;
		font-size: 13.5px;
	}
	.err {
		margin: 0;
		color: var(--terra-ink);
		font-size: 13.5px;
	}
	.toggles {
		display: flex;
		flex-direction: column;
		border-top: 1px solid var(--line);
	}
	.tg {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 0;
		border-bottom: 1px solid var(--line);
		cursor: pointer;
	}
	.tg b {
		display: block;
		font-weight: 500;
		font-size: 15px;
	}
	.tg span span {
		display: block;
		font-size: 13px;
		color: var(--ink-3);
	}
	.del {
		align-self: flex-start;
	}

	.banner {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 20px;
		padding: 10px 12px 10px 14px;
		border-radius: var(--r-m);
		background: var(--sunk);
		box-shadow: inset 0 0 0 1px var(--line);
		color: var(--ink-2);
		font-size: 14.5px;
	}
	.banner span {
		flex: 1;
	}

	.tabs {
		margin-bottom: 14px;
	}
	.seg .c {
		margin-left: 6px;
		font: 500 13.5px/1 var(--f-body);
		font-variant-numeric: tabular-nums;
		color: var(--ink-3);
	}
	.seg [data-f='hoje'] .c {
		color: var(--terra-ink);
	}
	.leech-hint {
		margin: 0 0 10px;
		font-size: 14.5px;
	}
	.none {
		padding: 24px 0;
	}

	.list {
		display: flex;
		flex-direction: column;
		margin: 0 -14px;
		padding: 0;
		list-style: none;
	}
	.list li {
		position: relative;
		display: flex;
		align-items: center;
		border-radius: var(--r-m);
		transition: background-color 0.15s;
	}
	.list li + li::before {
		content: '';
		position: absolute;
		left: 16px;
		right: 16px;
		top: 0;
		height: 1px;
		background: var(--line);
	}
	.list li:hover,
	.list li:focus-within {
		background: var(--hover);
	}
	.list li.sel {
		background: var(--sel);
	}
	.list li:hover::before,
	.list li.sel::before,
	.list li:hover + li::before,
	.list li.sel + li::before {
		opacity: 0;
	}
	.list .ck {
		position: absolute;
		left: 14px;
		z-index: 1;
		opacity: 0;
	}
	.list li:hover .ck,
	.list li:focus-within .ck,
	.picking .ck,
	.ck:checked {
		opacity: 1;
	}
	@media (hover: none) {
		.list .ck {
			opacity: 1;
		}
	}
	.wrow {
		flex: 1;
		min-width: 0;
		display: grid;
		grid-template-columns: minmax(0, 1fr) 28px minmax(0, 160px) 120px;
		align-items: center;
		gap: 20px;
		padding: 14px 16px 14px 46px;
		color: inherit;
		text-decoration: none;
		border-radius: var(--r-m);
	}
	.wrow:focus-visible {
		outline: none;
		box-shadow: inset 0 0 0 2px var(--ring);
	}
	.w {
		min-width: 0;
	}
	.w b {
		display: block;
		font: 600 17px/1.3 var(--f-head);
		letter-spacing: -0.01em;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.w span {
		display: block;
		margin-top: 2px;
		font-size: 14.5px;
		color: var(--ink-3);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.tabs-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
	}
	.w .veil {
		width: 88px;
		height: 0.8em;
		margin-top: 7px;
		border-radius: 999px;
		background: var(--line);
	}
	.kind {
		display: grid;
		place-items: center;
		color: var(--ink-3);
	}
	.sub-deck {
		font-size: 13.5px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.next {
		font-size: 14.5px;
		color: var(--ink-3);
		text-align: right;
		white-space: nowrap;
	}
	.next.hoje {
		color: var(--terra-ink);
		font-weight: 500;
	}
	.teimosa {
		display: inline-block;
		padding: 1px 7px;
		border-radius: 999px;
		background: var(--terra-soft);
		color: var(--terra-ink);
		font-size: 12.5px;
		font-weight: 500;
	}
	.back {
		flex: none;
		margin-right: 8px;
	}

	.del-dialog {
		width: min(440px, calc(100vw - 32px));
		padding: 24px;
		border: 0;
		border-radius: var(--r-l);
		background: var(--raise);
		color: var(--ink);
		box-shadow: var(--sh-pop);
	}
	.del-dialog::backdrop {
		background: var(--scrim);
	}
	.del-dialog h2 {
		margin: 0 0 16px;
		font: 600 20px/1.25 var(--f-head);
		overflow-wrap: anywhere;
	}
	fieldset {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin: 0;
		padding: 0;
		border: 0;
	}
	.radio {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 12px;
		border-radius: var(--r-m);
		box-shadow: inset 0 0 0 1px var(--line);
		cursor: pointer;
	}
	.radio:has(:checked) {
		background: var(--sel);
		box-shadow: inset 0 0 0 1px var(--line-2);
	}
	.radio input {
		margin-top: 3px;
		accent-color: var(--primary);
	}
	.radio b {
		display: block;
		font-weight: 500;
	}
	.radio span span {
		display: block;
		font-size: 13.5px;
		color: var(--ink-3);
	}
	.d-acts {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 20px;
	}

	@media (max-width: 768px) {
		.tabs {
			overflow-x: auto;
			max-width: 100%;
			scrollbar-width: none;
			justify-content: flex-start;
		}
		.tabs::-webkit-scrollbar {
			display: none;
		}
		.tabs > button {
			flex: none;
			padding: 0 11px;
		}
		.list {
			margin: 0 -8px;
		}
		.wrow {
			grid-template-columns: minmax(0, 1fr) auto;
			gap: 4px 12px;
			padding: 12px 10px 12px 42px;
		}
		.kind,
		.sub-deck,
		.wrow > span:empty {
			display: none;
		}
		.list .ck {
			left: 12px;
		}
	}
	@media (max-width: 560px) {
		.ph {
			flex-direction: column;
			align-items: stretch;
		}
		.ph-acts {
			justify-content: space-between;
		}
		.ph-acts .btn {
			flex: 1;
		}
		.back {
			display: none;
		}
		.del-dialog {
			margin: auto 0 0;
			width: 100%;
			max-width: none;
			border-radius: var(--r-l) var(--r-l) 0 0;
			padding-bottom: calc(24px + var(--safe-b));
		}
		.d-acts .btn {
			flex: 1;
		}
	}
</style>
