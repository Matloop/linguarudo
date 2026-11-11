<!--
	Barra flutuante da seleção (hub, página do deck, /palavras): contagem em aria-live, as
	ações da tela e ✕ para limpar. Presa ao rodapé, centrada no painel; no mobile, acima da
	tab bar. Popovers dentro dela abrem para cima (placement="above").
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { selectionLabel } from '#lib/decks-ui.ts';
	import Icon from './Icon.svelte';

	let {
		count,
		label = 'Ações da seleção',
		onclear,
		children
	}: { count: number; label?: string; onclear: () => void; children: Snippet } = $props();

	// Centrada no painel principal (não na janela, que inclui a barra lateral).
	let left = $state<number | null>(null);
	let width = $state<number | null>(null);
	$effect(() => {
		const main = document.querySelector<HTMLElement>('main.panel');
		if (!main) return;
		const place = () => {
			const r = main.getBoundingClientRect();
			left = r.left;
			width = r.width;
		};
		place();
		const ro = new ResizeObserver(place);
		ro.observe(main);
		window.addEventListener('resize', place);
		return () => {
			ro.disconnect();
			window.removeEventListener('resize', place);
		};
	});
</script>

<div
	class="bulk-slot"
	style:left={left === null ? undefined : `${left}px`}
	style:width={width === null ? undefined : `${width}px`}
>
	<div class="bulk" role="toolbar" aria-label={label} hidden={count === 0}>
		<span class="cnt" aria-live="polite"
			>{#if count}<b>{count}</b><span class="word"
					>{selectionLabel(count).slice(String(count).length)}</span
				>{/if}</span
		>
		{@render children()}
		<span class="sep" aria-hidden="true"></span>
		<button
			class="icon-btn"
			type="button"
			aria-label="Limpar seleção"
			title="Limpar (Esc)"
			onclick={onclear}><Icon name="x" size="sm" /></button
		>
	</div>
</div>

<style>
	.bulk-slot {
		position: fixed;
		bottom: 20px;
		left: 0;
		width: 100%;
		z-index: 25;
		display: flex;
		justify-content: center;
		pointer-events: none;
	}
	.bulk {
		pointer-events: auto;
		display: flex;
		align-items: center;
		gap: 2px;
		max-width: calc(100% - 16px);
		padding: 6px 6px 6px 14px;
		border-radius: var(--r-l);
		background: var(--raise);
		box-shadow: var(--sh-pop);
		white-space: nowrap;
		animation: up 0.16s var(--ease) both;
	}
	.bulk[hidden] {
		display: none;
	}
	:global(.tema-escuro) .bulk {
		background: var(--raise-2);
	}
	@keyframes up {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
	}
	.cnt {
		margin-right: 8px;
		color: var(--ink-2);
		font-size: 14.5px;
		font-variant-numeric: tabular-nums;
	}
	.sep {
		width: 1px;
		height: 20px;
		margin: 0 4px;
		background: var(--line-2);
		flex: none;
	}
	.bulk :global(.btn) {
		flex: none;
	}
	.cnt b {
		font-weight: inherit;
	}
	@media (max-width: 767px) {
		.bulk-slot {
			bottom: calc(var(--tab-h) + var(--safe-b) + 12px);
		}
		/* 390px: só o número em pílula (a palavra fica para leitores de tela) e botões sem ícone. */
		.bulk {
			padding-left: 8px;
		}
		.cnt {
			margin-right: 4px;
		}
		.cnt b {
			display: inline-grid;
			place-items: center;
			min-width: 26px;
			height: 26px;
			padding: 0 7px;
			border-radius: 999px;
			background: var(--primary);
			color: var(--on-primary);
			font-weight: 600;
			font-size: 13.5px;
		}
		.cnt .word {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
		}
		.bulk :global(.btn) {
			padding-inline: 9px;
		}
		.bulk :global(.btn > svg) {
			display: none;
		}
	}
</style>
