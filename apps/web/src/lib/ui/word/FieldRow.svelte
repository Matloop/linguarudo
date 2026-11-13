<!--
	Linha de um campo da palavra: ícone, rótulo, conteúdo e, embaixo, erro ou dica.
	Base visual de WordField, WordDeckField e da mídia (diálogo Guardar e painel).
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon, { type IconName } from '../Icon.svelte';

	let {
		icon,
		label,
		labelFor,
		error = '',
		hint = '',
		errorId,
		editing = false,
		children,
		aside
	}: {
		icon: IconName;
		label: string;
		/** id do input; sem ele o rótulo é só texto (campo em leitura). */
		labelFor?: string;
		error?: string;
		hint?: string;
		/** id do texto de erro, para o aria-describedby do input. */
		errorId?: string;
		/** Campo aberto para edição no lugar (realce do rótulo). */
		editing?: boolean;
		children: Snippet;
		/** À direita da linha (ex.: chevron do deck). */
		aside?: Snippet;
	} = $props();
</script>

<div class="field" class:editing>
	<Icon name={icon} />
	<div class="body">
		{#if labelFor}
			<label class="lbl" for={labelFor}>{label}</label>
		{:else}
			<span class="lbl">{label}</span>
		{/if}
		{@render children()}
		{#if error}
			<p class="f-err" id={errorId} role="alert">{error}</p>
		{:else if hint}
			<p class="f-hint" aria-live="polite">{hint}</p>
		{/if}
	</div>
	{#if aside}{@render aside()}{/if}
</div>

<style>
	.field {
		display: grid;
		grid-template-columns: 20px minmax(0, 1fr) auto;
		gap: 12px;
		align-items: start;
		padding: 11px 0;
		border-top: 1px solid var(--line);
	}
	.field > :global(.ic) {
		margin-top: 2px;
		color: var(--ink-3);
	}
	.body {
		min-width: 0;
	}
	.lbl {
		display: block;
		margin-bottom: 2px;
		font-size: 13px;
		font-weight: 500;
		color: var(--ink-3);
	}
	.editing .lbl {
		color: var(--ink-2);
	}
	.f-err,
	.f-hint {
		margin: 6px 0 0;
		font-size: 12.5px;
	}
	.f-err {
		color: var(--terra-ink);
	}
	.f-hint {
		color: var(--ink-3);
	}
</style>
