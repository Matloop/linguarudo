<!--
	Tags como fichinhas: Enter ou vírgula fecha a tag, Backspace no campo vazio tira a
	última. Num <form>, o input escondido `name` leva tudo separado por vírgula (inclusive
	o que ainda está sendo digitado), como o parseTags lê.
-->
<script lang="ts">
	import { parseTags } from '#lib/tags.ts';
	import { formatTags } from '#lib/word-fields.ts';
	import Icon from '../Icon.svelte';

	let {
		tags = $bindable([]),
		draft = $bindable(''),
		name,
		id,
		placeholder = 'filme, gíria…',
		maxlength,
		invalid = false,
		describedby,
		onkeydown,
		input = $bindable()
	}: {
		tags?: string[];
		/** O que está digitado e ainda não virou tag. */
		draft?: string;
		/** Nome do campo escondido no formulário; sem ele, nada vai no envio. */
		name?: string;
		id?: string;
		placeholder?: string;
		maxlength?: number;
		invalid?: boolean;
		describedby?: string;
		onkeydown?: (e: KeyboardEvent) => void;
		input?: HTMLInputElement;
	} = $props();

	const all = $derived(parseTags([...tags, draft]));

	function commit() {
		if (!draft.trim()) return;
		tags = parseTags([...tags, ...draft.split(',')]);
		draft = '';
	}

	function remove(i: number) {
		tags = tags.filter((_, j) => j !== i);
		input?.focus();
	}

	function keydown(e: KeyboardEvent) {
		if ((e.key === 'Enter' || e.key === ',') && draft.trim()) {
			e.preventDefault();
			commit();
			return;
		}
		if (e.key === 'Backspace' && draft === '' && tags.length > 0) {
			e.preventDefault();
			tags = tags.slice(0, -1);
			return;
		}
		onkeydown?.(e);
	}
</script>

<div class="tags-in">
	{#if name}<input type="hidden" {name} value={formatTags(all)} />{/if}
	{#each tags as tag, i (tag)}
		<span class="tagc"
			>{tag}<button
				type="button"
				class="xx"
				aria-label="Tirar a tag {tag}"
				tabindex="-1"
				onclick={() => remove(i)}><Icon name="x" size="sm" /></button
			></span
		>
	{/each}
	<input
		{id}
		bind:this={input}
		bind:value={draft}
		placeholder={tags.length ? '' : placeholder}
		{maxlength}
		autocomplete="off"
		aria-invalid={invalid ? 'true' : undefined}
		aria-describedby={describedby}
		onkeydown={keydown}
		onblur={commit}
	/>
</div>

<style>
	.tags-in {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		min-height: 26px;
	}
	.tagc {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		height: 24px;
		padding: 0 4px 0 9px;
		border-radius: 99px;
		font-size: 13px;
		color: var(--ink-2);
		background: var(--tile);
		box-shadow: inset 0 0 0 1px var(--line);
	}
	.xx {
		display: grid;
		place-items: center;
		width: 18px;
		height: 18px;
		padding: 0;
		border: 0;
		border-radius: 99px;
		background: none;
		color: var(--ink-3);
	}
	.xx:hover {
		background: var(--hover);
	}
	.xx :global(.ic) {
		width: 12px;
		height: 12px;
	}
	input {
		flex: 1;
		min-width: 90px;
		border: 0;
		outline: none;
		background: none;
		padding: 0;
		font-size: 16px;
		line-height: 1.5;
		color: var(--ink);
	}
	input::placeholder {
		color: var(--ink-3);
		opacity: 0.75;
	}
</style>
