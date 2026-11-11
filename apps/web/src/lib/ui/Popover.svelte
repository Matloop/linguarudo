<!--
	Popover ancorado no botão que o abre (Novo deck, "···", opções do deck, Mover para deck).
	Fecha com Esc, clique fora ou `open = false`; devolve o foco ao botão. No mobile vira
	bottom sheet. Marca data-popover-open para os atalhos globais ficarem quietos.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { tick } from 'svelte';

	let {
		open = $bindable(false),
		label,
		align = 'end',
		placement = 'below',
		width = 300,
		trigger,
		children
	}: {
		open?: boolean;
		label: string;
		align?: 'start' | 'end';
		/** 'above' para gatilhos presos ao rodapé (barra de seleção). */
		placement?: 'below' | 'above';
		width?: number;
		trigger: Snippet<[{ toggle: () => void; expanded: boolean; id: string }]>;
		children: Snippet<[{ close: () => void }]>;
	} = $props();

	const id = `pop-${Math.random().toString(36).slice(2, 9)}`;
	let root: HTMLElement | undefined = $state();
	let panel: HTMLElement | undefined = $state();

	async function toggle() {
		open = !open;
		if (open) {
			await tick();
			const first = panel?.querySelector<HTMLElement>(
				'[autofocus], input:not([type=hidden]), button:not(:disabled), [href]'
			);
			first?.focus();
		}
	}

	function close() {
		if (!open) return;
		open = false;
		root?.querySelector<HTMLElement>('[aria-controls]')?.focus();
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && open) {
			e.stopPropagation();
			e.preventDefault();
			close();
		}
	}

	function onpointerdown(e: PointerEvent) {
		if (open && root && !root.contains(e.target as Node)) open = false;
	}
</script>

<svelte:window {onpointerdown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="pop-wrap" bind:this={root} {onkeydown}>
	{@render trigger({ toggle, expanded: open, id })}
	{#if open}
		<button class="pop-scrim" type="button" tabindex="-1" aria-label="Fechar" onclick={close}
		></button>
		<div
			class="pop"
			class:start={align === 'start'}
			class:above={placement === 'above'}
			{id}
			role="dialog"
			aria-label={label}
			style:--w="{width}px"
			bind:this={panel}
			data-popover-open
		>
			{@render children({ close })}
		</div>
	{/if}
</div>

<style>
	.pop-wrap {
		position: relative;
		display: inline-flex;
	}
	.pop-scrim {
		display: none;
	}
	.pop {
		position: absolute;
		top: calc(100% + 6px);
		right: 0;
		z-index: 30;
		width: var(--w);
		max-width: calc(100vw - 32px);
		padding: 14px;
		border-radius: var(--r-l);
		background: var(--raise);
		box-shadow: var(--sh-pop);
		text-align: left;
		animation: popIn 0.14s var(--ease) both;
	}
	.pop.start {
		right: auto;
		left: 0;
	}
	.pop.above {
		top: auto;
		bottom: calc(100% + 10px);
	}
	:global(.tema-escuro) .pop {
		background: var(--raise-2);
	}
	@keyframes popIn {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
	}
	@media (max-width: 560px) {
		.pop-scrim {
			display: block;
			position: fixed;
			inset: 0;
			z-index: 60;
			border: 0;
			background: var(--scrim);
		}
		.pop {
			position: fixed;
			top: auto;
			left: 0;
			right: 0;
			bottom: 0;
			z-index: 61;
			width: 100%;
			max-width: none;
			max-height: 85vh;
			overflow-y: auto;
			padding: 20px 18px calc(18px + var(--safe-b));
			border-radius: var(--r-l) var(--r-l) 0 0;
			animation-name: sheetIn;
		}
		@keyframes sheetIn {
			from {
				transform: translateY(24px);
				opacity: 0;
			}
		}
	}
</style>
