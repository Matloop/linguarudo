<!--
	"Mais campos" dos diálogos de formulário (Guardar palavra, Nova ficha): fechado, mostra
	os nomes dos campos escondidos em fichinhas; no celular só as `narrow` primeiras e "+N".
	Os campos seguem no DOM mesmo fechados (o <form> envia tudo).
		<MoreFields bind:open={more} pills={['leitura', 'nota', 'tags']} narrow={2}>…</MoreFields>
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from '../Icon.svelte';

	let {
		open = $bindable(false),
		pills,
		narrow = 2,
		children
	}: {
		open?: boolean;
		pills: readonly string[];
		/** Quantas fichinhas aparecem no celular antes do "+N". */
		narrow?: number;
		children: Snippet;
	} = $props();

	const rest = $derived(pills.length - narrow);
</script>

<details class="more-wrap" bind:open>
	<summary class="more">
		<Icon name={open ? 'down' : 'right'} size="sm" />
		{open ? 'Menos campos' : 'Mais campos'}
		{#if !open}
			<span class="pills" aria-hidden="true"
				>{#each pills as pill, i (pill)}<span class:wide={i >= narrow}>{pill}</span
					>{/each}{#if rest > 0}<span class="narrow">+{rest}</span>{/if}</span
			>
		{/if}
	</summary>
	{@render children()}
</details>

<style>
	.more-wrap > summary {
		list-style: none;
	}
	.more-wrap > summary::-webkit-details-marker {
		display: none;
	}
	.more {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 11px 0;
		border-top: 1px solid var(--line);
		font-size: 14px;
		font-weight: 500;
		color: var(--ink-3);
		cursor: pointer;
		user-select: none;
	}
	.more:hover {
		color: var(--ink-2);
	}
	.more:focus-visible {
		outline: none;
		box-shadow: 0 0 0 3px var(--ring);
		border-radius: 6px;
	}
	.pills {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-left: 6px;
	}
	.pills span {
		padding: 1px 7px;
		border-radius: 99px;
		background: var(--sunk);
		font-size: 12.5px;
		font-weight: 500;
	}
	.pills .narrow {
		display: none;
	}
	@media (max-width: 768px) {
		.pills .wide {
			display: none;
		}
		.pills .narrow {
			display: inline;
		}
	}
</style>
