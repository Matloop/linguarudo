<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import { languageProfile, listLanguages } from '@linguetta/language';
	import { languageLabel, parseLanguage, type Language, type UiLanguage } from '#lib/languages.ts';
	import Icon from './Icon.svelte';

	// Lista pesquisável de idiomas (nome, nome no próprio idioma e código) mais um
	// campo livre para qualquer tag BCP 47. Cada escolha envia um formulário POST
	// com `name=<tag>`; sem JS a lista vem inteira e o campo livre continua valendo.

	let {
		id,
		action,
		name,
		ui,
		exclude = [],
		hidden = {},
		submit,
		autofocus = false
	}: {
		id: string;
		action: string;
		name: string;
		ui: UiLanguage;
		exclude?: readonly Language[];
		hidden?: Record<string, string>;
		submit?: SubmitFunction;
		autofocus?: boolean;
	} = $props();

	const T = {
		search: 'Buscar idioma',
		searchPlaceholder: 'Buscar por nome ou código',
		empty: 'Nenhum idioma com esse nome.',
		useCode: 'Usar o código',
		other: 'Outro código',
		otherHint: 'Qualquer código BCP 47: pt-BR, tet, zh-Hant',
		otherPlaceholder: 'ex.: tet',
		otherInvalid: 'Esse código de idioma não existe.',
		use: 'Usar'
	} as const;

	let query = $state('');
	let other = $state('');
	let list: HTMLUListElement;

	const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

	const options = $derived(listLanguages(ui).filter((o) => !exclude.includes(o.tag)));
	const shown = $derived.by(() => {
		const q = fold(query);
		if (!q) return options;
		return options.filter(
			(o) => fold(o.name).includes(q) || fold(o.endonym).includes(q) || o.tag.toLowerCase() === q
		);
	});
	/** A busca já é um código válido fora da lista: oferece usar direto. */
	const typedTag = $derived.by(() => {
		const tag = parseLanguage(query);
		if (!tag || exclude.includes(tag) || options.some((o) => o.tag === tag)) return null;
		return tag;
	});
	const otherTag = $derived(parseLanguage(other));
	const otherBlocked = $derived(!!otherTag && exclude.includes(otherTag));

	function onSearchKey(e: KeyboardEvent) {
		if (e.key !== 'Enter') return;
		e.preventDefault();
		list?.querySelector<HTMLButtonElement>('button')?.click();
	}
</script>

<div class="picker">
	<label class="search">
		<Icon name="search" size="sm" />
		<span class="visually-hidden">{T.search}</span>
		<!-- svelte-ignore a11y_autofocus -->
		<input
			type="search"
			placeholder={T.searchPlaceholder}
			autocomplete="off"
			spellcheck="false"
			aria-controls="{id}-lista"
			bind:value={query}
			onkeydown={onSearchKey}
			{autofocus}
		/>
	</label>

	<form method="POST" {action} use:enhance={submit}>
		{#each Object.entries(hidden) as [k, v] (k)}<input type="hidden" name={k} value={v} />{/each}
		<ul id="{id}-lista" bind:this={list}>
			{#if typedTag}
				<li>
					<button {name} value={typedTag} data-testid="idioma-codigo">
						<span class="t"
							><b>{T.useCode} {typedTag}</b><span>{languageLabel(typedTag, ui)}</span></span
						>
						<code>{typedTag}</code>
					</button>
				</li>
			{/if}
			{#each shown as o (o.tag)}
				<li>
					<button {name} value={o.tag}>
						<span class="t"
							><b>{o.name}</b><span lang={o.tag} dir={languageProfile(o.tag).dir}>{o.endonym}</span
							></span
						>
						<code>{o.tag}</code>
					</button>
				</li>
			{/each}
		</ul>
		{#if shown.length === 0 && !typedTag}<p class="empty">{T.empty}</p>{/if}
	</form>

	<form class="other" method="POST" {action} use:enhance={submit}>
		{#each Object.entries(hidden) as [k, v] (k)}<input type="hidden" name={k} value={v} />{/each}
		<label for="{id}-outro">{T.other}</label>
		<div class="row">
			<input
				id="{id}-outro"
				{name}
				placeholder={T.otherPlaceholder}
				autocomplete="off"
				spellcheck="false"
				aria-describedby="{id}-outro-dica"
				aria-invalid={other.trim() !== '' && !otherTag}
				bind:value={other}
			/>
			<button class="btn btn-soft" disabled={!otherTag || otherBlocked}>{T.use}</button>
		</div>
		<span class="hint" id="{id}-outro-dica" aria-live="polite">
			{#if other.trim() && !otherTag}<span class="err">{T.otherInvalid}</span>
			{:else if otherTag}{otherTag} · {languageLabel(otherTag, ui)}
			{:else}{T.otherHint}{/if}
		</span>
	</form>
</div>

<style>
	.picker {
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 0;
	}
	.picker form {
		margin: 0;
	}
	.search {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 36px;
		padding: 0 10px;
		border-radius: var(--r-m);
		background: var(--sunk);
		box-shadow: inset 0 0 0 1px var(--line);
		color: var(--ink-3);
	}
	.search input {
		flex: 1;
		min-width: 0;
		border: 0;
		background: none;
		color: var(--ink);
		font: inherit;
		font-size: 14px;
		outline: none;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		max-height: 260px;
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	ul button {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 7px 10px;
		border: 0;
		border-radius: var(--r-m);
		background: none;
		color: var(--ink);
		text-align: start;
		cursor: pointer;
	}
	ul button:hover,
	ul button:focus-visible {
		background: var(--hover);
	}
	.t {
		flex: 1;
		min-width: 0;
		line-height: 1.25;
	}
	.t b {
		display: block;
		font-weight: 500;
	}
	.t span {
		font-size: 12px;
		color: var(--ink-3);
	}
	code {
		font: 500 11.5px/1 var(--f-body);
		color: var(--ink-3);
		font-variant-numeric: tabular-nums;
	}
	.empty {
		margin: 4px 10px;
		font-size: 13px;
		color: var(--ink-3);
	}
	.other {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding-top: 8px;
		border-top: 1px solid var(--line);
	}
	.other label {
		font-size: 12px;
		font-weight: 500;
		color: var(--ink-3);
	}
	.other .row {
		display: flex;
		gap: 8px;
	}
	.other input {
		flex: 1;
		min-width: 0;
		height: 34px;
		padding: 0 10px;
		border: 0;
		border-radius: var(--r-m);
		background: var(--sunk);
		box-shadow: inset 0 0 0 1px var(--line);
		color: var(--ink);
		font: inherit;
		font-size: 14px;
	}
	.other input[aria-invalid='true'] {
		box-shadow: inset 0 0 0 1px var(--terra-ink);
	}
	.hint {
		font-size: 12px;
		color: var(--ink-3);
	}
	.err {
		color: var(--terra-ink);
	}
</style>
