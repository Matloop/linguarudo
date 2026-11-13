<!--
	"Mover para baralho…": combobox filtrável com os decks do idioma e "Novo baralho…" no fim
	(cria com o texto digitado). Setas escolhem, Enter confirma, Esc fecha (o Popover).
-->
<script lang="ts">
	import { deckDisplayName, DECK_NAME_UI_MAX } from '#lib/decks-ui.ts';
	import Icon from './Icon.svelte';

	type Option = { id: string; name: string; depth: number; disabled?: boolean };

	let {
		decks,
		current = null,
		allowNew = true,
		pending = false,
		onpick
	}: {
		decks: Option[];
		/** Deck atual (aparece marcado e desabilitado). */
		current?: string | null;
		allowNew?: boolean;
		pending?: boolean;
		onpick: (choice: { deckId: string } | { newName: string }) => void;
	} = $props();

	const id = `dp-${Math.random().toString(36).slice(2, 9)}`;
	let q = $state('');
	let active = $state(0);
	let creating = $state(false);

	const needle = $derived(q.trim().toLocaleLowerCase());
	const shown = $derived(
		decks.filter((d) => !needle || deckDisplayName(d.name).toLocaleLowerCase().includes(needle))
	);
	const exact = $derived(decks.some((d) => d.name.toLocaleLowerCase() === needle && d.depth === 0));
	/** Opções navegáveis: os decks visíveis e, no fim, "Novo deck…". */
	const count = $derived(shown.length + (allowNew ? 1 : 0));

	$effect(() => {
		void needle;
		active = 0;
	});

	function choose(i: number) {
		if (pending) return;
		if (i < shown.length) {
			const d = shown[i];
			if (d.disabled || d.id === current) return;
			onpick({ deckId: d.id });
		} else if (allowNew) {
			if (q.trim() && !exact) onpick({ newName: q.trim() });
			else creating = true;
		}
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			active = (active + 1) % Math.max(1, count);
			e.preventDefault();
		} else if (e.key === 'ArrowUp') {
			active = (active - 1 + count) % Math.max(1, count);
			e.preventDefault();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (creating && q.trim()) onpick({ newName: q.trim() });
			else choose(active);
		}
	}
</script>

<div class="dp">
	<label class="visually-hidden" for="{id}-q"
		>{creating ? 'Nome do baralho novo' : 'Buscar baralho'}</label
	>
	<input
		id="{id}-q"
		class="input"
		role="combobox"
		aria-expanded="true"
		aria-controls="{id}-list"
		aria-activedescendant={creating ? undefined : `${id}-${active}`}
		aria-autocomplete="list"
		placeholder={creating ? 'Nome do baralho novo' : 'Buscar baralho'}
		maxlength={DECK_NAME_UI_MAX}
		autocomplete="off"
		bind:value={q}
		{onkeydown}
	/>
	{#if creating}
		<div class="new-row">
			<span class="faint">Enter cria e move</span>
			<button class="btn btn-ghost" type="button" onclick={() => (creating = false)}>Voltar</button>
			<button
				class="btn btn-primary"
				type="button"
				disabled={!q.trim() || pending}
				onclick={() => onpick({ newName: q.trim() })}>Criar</button
			>
		</div>
	{:else}
		<ul id="{id}-list" role="listbox" aria-label="Baralhos">
			{#each shown as d, i (d.id)}
				<li
					id="{id}-{i}"
					role="option"
					aria-selected={i === active}
					aria-disabled={d.disabled || d.id === current}
					class:sub={d.depth === 1}
					class:on={i === active}
					title={deckDisplayName(d.name)}
					onpointerenter={() => (active = i)}
					onclick={() => choose(i)}
					onkeydown={() => {}}
				>
					<span class="nm">{deckDisplayName(d.name)}</span>
					{#if d.id === current}<Icon name="check" size="sm" />{/if}
				</li>
			{/each}
			{#if shown.length === 0}
				<li class="none" role="presentation">Nenhum baralho com “{q.trim()}”</li>
			{/if}
			{#if allowNew}
				<li
					id="{id}-{shown.length}"
					role="option"
					aria-selected={active === shown.length}
					class="add"
					class:on={active === shown.length}
					onpointerenter={() => (active = shown.length)}
					onclick={() => choose(shown.length)}
					onkeydown={() => {}}
				>
					<Icon name="plus" size="sm" />
					{q.trim() && !exact ? `Novo baralho “${q.trim()}”` : 'Novo baralho…'}
				</li>
			{/if}
		</ul>
	{/if}
</div>

<style>
	.dp {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	ul {
		list-style: none;
		margin: 0 -6px;
		padding: 0;
		max-height: 260px;
		overflow-y: auto;
	}
	li {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 36px;
		padding: 0 10px;
		border-radius: var(--r-m);
		color: var(--ink);
		font-size: 15px;
		cursor: pointer;
	}
	li.on {
		background: var(--hover);
	}
	li.sub {
		padding-left: 26px;
		color: var(--ink-2);
	}
	li[aria-disabled='true'] {
		color: var(--ink-3);
		cursor: default;
	}
	li.add {
		color: var(--ink-2);
		border-top: 1px solid var(--line);
		border-radius: 0 0 var(--r-m) var(--r-m);
		margin-top: 4px;
	}
	li.none {
		color: var(--ink-3);
		cursor: default;
	}
	.nm {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.new-row {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.new-row .faint {
		flex: 1;
		font-size: 13.5px;
	}
</style>
