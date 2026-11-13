<!--
	Dropdown próprio do Linguetta: substitui o <select> nativo em todo o app (regra do AGENTS.md).
	- variant 'field': parece um campo de formulário (largura total).
	- variant 'inline': texto discreto "Ordem: Mais recentes ▾" para barras de ferramentas.
	Teclado: setas, Home/End, Enter/Espaço, Esc, digitar para pular. Com muitas opções
	(> 12) aparece uma busca no topo. `name` gera um <input hidden> para formulários.
-->
<script module lang="ts">
	export type SelectOption<V> = { value: V; label: string; indent?: boolean; disabled?: boolean };
</script>

<script lang="ts" generics="T extends string | number | null">
	import { tick } from 'svelte';
	import Icon from './Icon.svelte';

	let {
		options,
		value = $bindable(),
		onchange,
		name,
		id,
		label,
		labelledby,
		prefix,
		placeholder = 'Escolher',
		variant = 'field',
		align = 'start',
		disabled = false,
		searchable = options.length > 12
	}: {
		options: SelectOption<T>[];
		value: T;
		onchange?: (value: T) => void;
		/** Nome do campo no <form> (gera um input hidden). */
		name?: string;
		id?: string;
		/** Rótulo acessível quando não há <label for> nem labelledby. */
		label?: string;
		labelledby?: string;
		/** Só no 'inline': texto antes do valor ("Ordem:"). */
		prefix?: string;
		placeholder?: string;
		variant?: 'field' | 'inline';
		align?: 'start' | 'end';
		disabled?: boolean;
		searchable?: boolean;
	} = $props();

	const uid = `sel-${Math.random().toString(36).slice(2, 9)}`;
	const buttonId = $derived(id ?? `${uid}-btn`);
	let open = $state(false);
	let active = $state(-1);
	let q = $state('');
	let root: HTMLElement | undefined = $state();
	let button: HTMLButtonElement | undefined = $state();
	let list: HTMLElement | undefined = $state();
	let search: HTMLInputElement | undefined = $state();

	const current = $derived(options.find((o) => o.value === value));
	const needle = $derived(q.trim().toLocaleLowerCase());
	const shown = $derived(
		needle ? options.filter((o) => o.label.toLocaleLowerCase().includes(needle)) : options
	);

	$effect(() => {
		void needle;
		if (needle) active = shown.findIndex((o) => !o.disabled);
	});

	async function show() {
		if (disabled) return;
		open = true;
		q = '';
		active = Math.max(
			0,
			options.findIndex((o) => o.value === value)
		);
		await tick();
		if (searchable) search?.focus();
		scrollActive();
	}

	function hide(focusButton = true) {
		if (!open) return;
		open = false;
		if (focusButton) button?.focus();
	}

	function choose(o: SelectOption<T> | undefined) {
		if (!o || o.disabled) return;
		const changed = o.value !== value;
		value = o.value;
		hide();
		if (changed) onchange?.(o.value);
	}

	function move(step: number) {
		const n = shown.length;
		if (!n) return;
		let i = active;
		for (let k = 0; k < n; k++) {
			i = (i + step + n) % n;
			if (!shown[i].disabled) break;
		}
		active = i;
		scrollActive();
	}

	async function scrollActive() {
		await tick();
		list?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
	}

	let typed = '';
	let typedAt = 0;
	function typeahead(ch: string) {
		const t = Date.now();
		typed = t - typedAt > 700 ? ch : typed + ch;
		typedAt = t;
		const i = shown.findIndex(
			(o) => !o.disabled && o.label.toLocaleLowerCase().startsWith(typed.toLocaleLowerCase())
		);
		if (i < 0) return;
		if (open) {
			active = i;
			scrollActive();
		} else choose(shown[i]);
	}

	function onkeydown(e: KeyboardEvent) {
		if (disabled) return;
		const k = e.key;
		if (!open) {
			if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' ') {
				e.preventDefault();
				show();
			} else if (k.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) typeahead(k);
			return;
		}
		if (k === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			hide();
		} else if (k === 'Tab') hide(false);
		else if (k === 'ArrowDown') {
			e.preventDefault();
			move(1);
		} else if (k === 'ArrowUp') {
			e.preventDefault();
			move(-1);
		} else if (k === 'Home' || k === 'End') {
			e.preventDefault();
			active = k === 'Home' ? -1 : 0;
			move(k === 'Home' ? 1 : -1);
		} else if (k === 'Enter' || (k === ' ' && !searchable)) {
			e.preventDefault();
			choose(shown[active]);
		} else if (!searchable && k.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) typeahead(k);
	}

	function onpointerdown(e: PointerEvent) {
		if (open && root && !root.contains(e.target as Node)) hide(false);
	}
</script>

<svelte:window {onpointerdown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="sel {variant}"
	class:open
	class:end={align === 'end'}
	bind:this={root}
	{onkeydown}
	data-popover-open={open ? '' : undefined}
>
	{#if name}<input type="hidden" {name} value={value ?? ''} />{/if}
	<button
		bind:this={button}
		id={buttonId}
		type="button"
		class="trigger"
		role="combobox"
		aria-haspopup="listbox"
		aria-expanded={open}
		aria-controls="{uid}-list"
		aria-activedescendant={open && active >= 0 ? `${uid}-o${active}` : undefined}
		aria-label={labelledby ? undefined : label}
		aria-labelledby={labelledby}
		{disabled}
		onclick={() => (open ? hide() : show())}
	>
		{#if variant === 'inline' && prefix}<span class="pre">{prefix}</span>{/if}
		<span class="val" class:ph={!current}>{current?.label ?? placeholder}</span>
		<Icon name="down" size="sm" />
	</button>

	{#if open}
		<div class="menu">
			{#if searchable}
				<input
					bind:this={search}
					bind:value={q}
					class="search"
					type="search"
					placeholder="Buscar"
					autocomplete="off"
					aria-label="Buscar opção"
					aria-controls="{uid}-list"
				/>
			{/if}
			<ul bind:this={list} id="{uid}-list" role="listbox" aria-label={label}>
				{#each shown as o, i (i)}
					<li
						id="{uid}-o{i}"
						data-i={i}
						role="option"
						aria-selected={o.value === value}
						aria-disabled={o.disabled || undefined}
						class:active={i === active}
						class:indent={o.indent}
						onpointermove={() => !o.disabled && (active = i)}
						onclick={() => choose(o)}
						onkeydown={() => {}}
					>
						<span>{o.label}</span>
						{#if o.value === value}<Icon name="check" size="sm" />{/if}
					</li>
				{:else}
					<li class="none" role="presentation">Nada encontrado</li>
				{/each}
			</ul>
		</div>
	{/if}
</div>

<style>
	.sel {
		position: relative;
		display: inline-flex;
		min-width: 0;
	}
	.sel.field {
		display: flex;
		width: 100%;
	}
	.trigger {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		border: 0;
		font: inherit;
		color: inherit;
		text-align: left;
		outline: none;
		transition:
			background-color 0.15s,
			color 0.15s,
			box-shadow 0.15s;
	}
	.trigger:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.trigger :global(.ic) {
		flex: none;
		width: 13px;
		height: 13px;
		color: var(--ink-3);
	}
	.val {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.val.ph {
		color: var(--ink-3);
	}

	/* Campo de formulário */
	.field .trigger {
		width: 100%;
		height: 38px;
		padding: 0 10px 0 12px;
		border-radius: var(--r-m);
		background: var(--sunk);
		box-shadow: inset 0 0 0 1px var(--line);
		font-size: 15px;
		color: var(--ink);
	}
	.field .val {
		flex: 1;
	}
	.field .trigger:hover:not(:disabled) {
		box-shadow: inset 0 0 0 1px var(--line-2);
	}
	.field .trigger:focus-visible,
	.field.open .trigger {
		background: var(--raise);
		box-shadow:
			inset 0 0 0 1px var(--line-2),
			0 0 0 3px var(--ring);
	}

	/* Texto discreto da barra de ferramentas */
	.inline .trigger {
		height: 32px;
		padding: 0 8px;
		border-radius: var(--r-s);
		background: none;
		font-size: 14px;
		color: var(--ink-3);
		white-space: nowrap;
	}
	.inline .val {
		max-width: 160px;
		color: var(--ink-2);
		font-weight: 500;
	}
	.inline .trigger:hover:not(:disabled),
	.inline.open .trigger {
		background: var(--hover);
		color: var(--ink);
	}
	.inline .trigger:focus-visible {
		box-shadow: 0 0 0 3px var(--ring);
	}

	.menu {
		position: absolute;
		top: calc(100% + 6px);
		left: 0;
		z-index: 40;
		min-width: max(100%, 180px);
		max-width: min(360px, calc(100vw - 32px));
		padding: 5px;
		border-radius: var(--r-l);
		background: var(--raise);
		box-shadow: var(--sh-pop);
		animation: menuIn 0.12s var(--ease) both;
	}
	.end .menu {
		left: auto;
		right: 0;
	}
	:global(.tema-escuro) .menu {
		background: var(--raise-2);
	}
	@keyframes menuIn {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
	}
	.search {
		display: block;
		width: 100%;
		margin: 0 0 5px;
		padding: 7px 10px;
		border: 0;
		border-radius: var(--r-m);
		background: var(--sunk);
		box-shadow: inset 0 0 0 1px var(--line);
		font: inherit;
		font-size: 14px;
		color: var(--ink);
		outline: none;
	}
	ul {
		max-height: min(300px, 50vh);
		margin: 0;
		padding: 0;
		overflow-y: auto;
		list-style: none;
		overscroll-behavior: contain;
	}
	li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 7px 10px;
		border-radius: var(--r-s);
		font-size: 14px;
		color: var(--ink-2);
		cursor: pointer;
		white-space: nowrap;
	}
	li span {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	li.indent {
		padding-left: 24px;
	}
	li.active {
		background: var(--hover);
		color: var(--ink);
	}
	li[aria-selected='true'] {
		color: var(--ink);
		font-weight: 500;
	}
	li[aria-disabled] {
		opacity: 0.45;
		cursor: default;
	}
	li :global(.ic) {
		flex: none;
		width: 14px;
		height: 14px;
	}
	li.none {
		color: var(--ink-3);
		cursor: default;
	}
</style>
