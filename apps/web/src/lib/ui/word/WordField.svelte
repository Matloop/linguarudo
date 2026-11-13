<!--
	Campo de texto de uma palavra (Item): lema, tradução, frase, leitura, nota ou tags.
	O mesmo componente no diálogo Guardar e no painel de /palavras (decisão "Edição (i)").

	Modo "form" (padrão): um input comum com `name` = field, dentro de um <form> seu.
		<WordField field="sense" value={values.sense} error={errors.sense} {language} />
		<WordField field="lemma" bind:this={lemma} />   lemma.focus()

	Modo "inline" (painel): mostra o valor como texto; clique ou Enter abre o input;
	sair do campo salva pelo ?/edit de /palavras (manda junto o resto do item, ver
	itemEditFields), Esc desfaz, erros do servidor aparecem embaixo. A frase não edita
	no lugar (no painel ela é um encontro).
		<WordField mode="inline" field="note" item={selected} language={data.language} />
	`item` precisa de id, lemma, reading, sense, note e tags (o tipo EditableItem); depois de
	salvar, os dados da página recarregam (invalidateAll) e `item` chega atualizado.

	Os outros campos: WordMediaField (imagem/áudio) e WordDeckField (deck), mesma API de modo.
-->
<script lang="ts">
	import { tick } from 'svelte';
	import { langAttrs, type Language } from '#lib/languages.ts';
	import { parseTags } from '#lib/tags.ts';
	import {
		WORD_FIELDS,
		formatTags,
		itemEditFields,
		itemFieldValue,
		isInlineField,
		type EditableItem,
		type InlineTextField,
		type WordTextField
	} from '#lib/word-fields.ts';
	import FieldRow from './FieldRow.svelte';
	import TagsInput from './TagsInput.svelte';
	import { EDIT_ACTION, saveField } from './inline-save.ts';

	let {
		field,
		mode = 'form',
		value = '',
		item,
		language,
		error = '',
		id,
		action = EDIT_ACTION,
		label,
		placeholder,
		onkeydown,
		onsaved
	}: {
		field: WordTextField;
		mode?: 'form' | 'inline';
		/** Modo form: valor inicial (tags separadas por vírgula). No inline vem do item. */
		value?: string;
		/** Modo inline: o item que está sendo editado. */
		item?: EditableItem;
		/** Idioma de estudo: lang/dir dos campos escritos nele (lema, frase, leitura). */
		language?: Language;
		/** Modo form: erro vindo da action (no inline, o próprio campo mostra o dele). */
		error?: string;
		id?: string;
		/** Modo inline: action que recebe o campo (padrão /palavras?/edit). */
		action?: string;
		label?: string;
		placeholder?: string;
		/** Modo form: teclas extras (ex.: Enter na frase envia o diálogo). */
		onkeydown?: (e: KeyboardEvent) => void;
		/** Modo inline: depois de salvar com sucesso. */
		onsaved?: (field: InlineTextField, value: string) => void;
	} = $props();

	const meta = $derived(WORD_FIELDS[field]);
	const text = $derived({
		label: label ?? meta.label,
		placeholder: placeholder ?? meta.placeholder
	});
	const uid = `wf-${Math.random().toString(36).slice(2, 9)}`;
	const inputId = $derived(id ?? `${uid}-${field}`);
	const errId = $derived(`${inputId}-erro`);
	const attrs = $derived(meta.inTargetLanguage && language ? langAttrs(language) : {});

	let el = $state<HTMLInputElement | HTMLTextAreaElement>();

	/** Põe o foco no campo (no inline, abre a edição). */
	export function focus() {
		if (mode === 'inline') start();
		else el?.focus();
	}

	// ---------- modo form ----------
	let formTags = $state<string[]>([]);
	$effect.pre(() => {
		if (mode === 'form' && field === 'tags') formTags = parseTags(value);
	});

	// ---------- modo inline ----------
	// O postAction só responde depois de recarregar a página: `item` já chega salvo.
	const shown = $derived(
		mode === 'inline' && item && isInlineField(field) ? itemFieldValue(item, field) : value
	);

	let editing = $state(false);
	let saving = $state(false);
	let inlineError = $state('');
	let draft = $state('');
	let draftTags = $state<string[]>([]);
	let tagDraft = $state('');
	let tagInput = $state<HTMLInputElement>();
	let box = $state<HTMLElement>();

	async function start() {
		if (editing || mode !== 'inline') return;
		draft = shown;
		draftTags = parseTags(shown);
		tagDraft = '';
		inlineError = '';
		editing = true;
		await tick();
		const target = field === 'tags' ? tagInput : el;
		target?.focus();
		if (target && 'select' in target && field !== 'tags') target.select();
	}

	function cancel() {
		editing = false;
		inlineError = '';
	}

	function nextValue(): string {
		return field === 'tags' ? formatTags(parseTags([...draftTags, tagDraft])) : draft;
	}

	async function commit() {
		if (!editing || saving || !item || !isInlineField(field)) return;
		const next = nextValue();
		const same =
			field === 'tags' ? next === formatTags(parseTags(shown)) : next.trim() === shown.trim();
		if (same) {
			cancel();
			return;
		}
		saving = true;
		const target = item;
		const f = field;
		const r = await saveField(action, () => itemEditFields(target, f, next), f);
		saving = false;
		if (r.ok) {
			editing = false;
			inlineError = '';
			onsaved?.(f, next);
		} else {
			inlineError = r.error;
		}
	}

	function inlineKey(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			// Esc desfaz o campo; não fecha o painel nem o diálogo em volta.
			e.preventDefault();
			e.stopPropagation();
			cancel();
			box?.querySelector<HTMLElement>('.ed')?.focus();
		} else if (e.key === 'Enter' && !(meta.multiline && e.shiftKey) && field !== 'tags') {
			e.preventDefault();
			(e.currentTarget as HTMLElement).blur();
		} else if (e.key === 'Enter' && field === 'tags' && !tagDraft.trim()) {
			e.preventDefault();
			tagInput?.blur();
		}
	}

	/** Tags: só salva quando o foco sai do grupo (as fichinhas ficam dentro). */
	function tagsFocusOut(e: FocusEvent) {
		if (box && e.relatedTarget instanceof Node && box.contains(e.relatedTarget)) return;
		commit();
	}

	function displayKey(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			start();
		}
	}

	const hint = $derived(
		mode === 'inline' && editing
			? saving
				? 'Salvando…'
				: 'Salva ao sair do campo · Esc desfaz'
			: ''
	);
	const shownError = $derived(mode === 'inline' ? inlineError : error);
</script>

{#snippet control(name: string | undefined, initial: string)}
	{#if field === 'tags'}
		{#if mode === 'form'}
			<TagsInput
				bind:tags={formTags}
				{name}
				id={inputId}
				placeholder={text.placeholder}
				maxlength={meta.max}
				invalid={!!shownError}
				describedby={shownError ? errId : undefined}
				{onkeydown}
			/>
		{:else}
			<TagsInput
				bind:tags={draftTags}
				bind:draft={tagDraft}
				bind:input={tagInput}
				id={inputId}
				placeholder={text.placeholder}
				maxlength={meta.max}
				invalid={!!shownError}
				describedby={shownError ? errId : undefined}
				onkeydown={inlineKey}
			/>
		{/if}
	{:else if meta.multiline}
		{#if mode === 'form'}
			<textarea
				{name}
				id={inputId}
				bind:this={el}
				rows="2"
				placeholder={text.placeholder}
				maxlength={meta.max}
				value={initial}
				aria-invalid={shownError ? 'true' : undefined}
				aria-describedby={shownError ? errId : undefined}
				{onkeydown}
				{...attrs}></textarea>
		{:else}
			<textarea
				id={inputId}
				bind:this={el}
				bind:value={draft}
				rows="2"
				placeholder={text.placeholder}
				maxlength={meta.max}
				disabled={saving}
				aria-invalid={shownError ? 'true' : undefined}
				aria-describedby={shownError ? errId : undefined}
				onkeydown={inlineKey}
				onblur={commit}
				{...attrs}></textarea>
		{/if}
	{:else if mode === 'form'}
		<input
			{name}
			id={inputId}
			bind:this={el}
			placeholder={text.placeholder}
			maxlength={meta.max}
			value={initial}
			autocomplete="off"
			aria-invalid={shownError ? 'true' : undefined}
			aria-describedby={shownError ? errId : undefined}
			{onkeydown}
			{...attrs}
		/>
	{:else}
		<input
			id={inputId}
			bind:this={el}
			bind:value={draft}
			placeholder={text.placeholder}
			maxlength={meta.max}
			autocomplete="off"
			disabled={saving}
			aria-invalid={shownError ? 'true' : undefined}
			aria-describedby={shownError ? errId : undefined}
			onkeydown={inlineKey}
			onblur={commit}
			{...attrs}
		/>
	{/if}
{/snippet}

{#snippet display()}
	<div
		class="ed"
		class:big={field === 'lemma'}
		role="button"
		tabindex="0"
		aria-label="Editar {text.label.toLowerCase()}{shown ? `: ${shown}` : ''}"
		onclick={start}
		onkeydown={displayKey}
	>
		{#if !shown}
			<span class="ph0">{text.placeholder}</span>
		{:else if field === 'tags'}
			<span class="tags"
				>{#each parseTags(shown) as tag (tag)}<span class="tagc">{tag}</span>{/each}</span
			>
		{:else}
			<span class="val" {...attrs}>{shown}</span>
		{/if}
	</div>
{/snippet}

{#if field === 'lemma'}
	<div class="lemma" bind:this={box} class:editing>
		{#if mode === 'form'}
			<input
				class="f-word"
				name="lemma"
				id={inputId}
				bind:this={el}
				placeholder={text.placeholder}
				aria-label={text.label}
				maxlength={meta.max}
				{value}
				autocomplete="off"
				aria-invalid={shownError ? 'true' : undefined}
				aria-describedby={errId}
				{onkeydown}
				{...attrs}
			/>
		{:else if editing}
			<input
				class="f-word ed-in"
				id={inputId}
				bind:this={el}
				bind:value={draft}
				aria-label={text.label}
				maxlength={meta.max}
				autocomplete="off"
				disabled={saving}
				aria-invalid={shownError ? 'true' : undefined}
				aria-describedby={errId}
				onkeydown={inlineKey}
				onblur={commit}
				{...attrs}
			/>
		{:else}
			{@render display()}
		{/if}
		<div class="f-err" class:on={!!shownError} id={errId} role="alert">{shownError}</div>
		{#if hint}<p class="f-hint" aria-live="polite">{hint}</p>{/if}
	</div>
{:else}
	<div
		class="wrap"
		bind:this={box}
		class:inline={mode === 'inline'}
		class:editing
		onfocusout={field === 'tags' && editing ? tagsFocusOut : undefined}
	>
		<FieldRow
			icon={meta.icon ?? 'pencil'}
			label={text.label}
			labelFor={mode === 'form' || editing ? inputId : undefined}
			error={shownError}
			errorId={errId}
			{hint}
			{editing}
		>
			{#if mode === 'form'}
				{@render control(field, value)}
			{:else if editing}
				<div class="ed-box">{@render control(undefined, '')}</div>
			{:else}
				{@render display()}
			{/if}
		</FieldRow>
	</div>
{/if}

<style>
	/* Lema: o campo grande do topo. */
	.f-word {
		width: 100%;
		border: 0;
		outline: none;
		background: none;
		padding: 8px 0 6px;
		color: var(--ink);
		font: 600 32px/1.2 var(--f-head);
		letter-spacing: -0.025em;
	}
	.f-word::placeholder {
		color: var(--ink-3);
		opacity: 0.55;
	}
	.lemma .f-err {
		color: var(--terra-ink);
		font-size: 14px;
		height: 0;
		overflow: hidden;
		transition: height 0.2s;
	}
	.lemma .f-err.on {
		height: auto;
		min-height: 20px;
	}
	.lemma .f-hint {
		margin: 4px 0 0;
		font-size: 12.5px;
		color: var(--ink-3);
	}

	/* Controles dentro da linha (modo form e edição no lugar). */
	.wrap :global(input:not([type='hidden'])),
	.wrap textarea {
		width: 100%;
		border: 0;
		outline: none;
		background: none;
		padding: 0;
		resize: none;
		color: var(--ink);
		font-size: 16px;
		line-height: 1.5;
	}
	.wrap textarea {
		field-sizing: content;
		min-height: 3em;
		max-height: 12em;
	}
	.wrap input::placeholder,
	.wrap textarea::placeholder {
		color: var(--ink-3);
		opacity: 0.75;
	}

	/* Edição no lugar: texto que vira campo. */
	.ed {
		position: relative;
		margin: 0 -6px;
		padding: 1px 26px 1px 6px;
		border-radius: 6px;
		min-height: 26px;
		font-size: 16px;
		line-height: 1.5;
		overflow-wrap: anywhere;
		white-space: pre-wrap;
		cursor: text;
		transition:
			background-color 0.15s,
			box-shadow 0.15s;
	}
	.ed:hover {
		background: var(--hover);
	}
	.ed:focus-visible {
		outline: none;
		box-shadow: 0 0 0 3px var(--ring);
	}
	.ed:hover::after {
		content: '';
		position: absolute;
		right: 6px;
		top: 50%;
		translate: 0 -50%;
		width: 13px;
		height: 13px;
		background: var(--ink-3);
		opacity: 0.6;
		mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='M14.4 5.6l4 4M4.7 15.3L15.8 4.2a2 2 0 0 1 2.8 0l1.4 1.4a2 2 0 0 1 0 2.8L8.9 19.5 4 20z'/%3E%3C/svg%3E")
			center / contain no-repeat;
	}
	.ed.big {
		font: 600 32px/1.2 var(--f-head);
		letter-spacing: -0.025em;
		padding-top: 4px;
		padding-bottom: 4px;
	}
	.ph0 {
		color: var(--ink-3);
		opacity: 0.75;
	}
	.ed-box,
	.ed-in {
		margin: 0 -6px;
		padding: 1px 6px;
		border-radius: 6px;
		background: var(--raise);
		box-shadow:
			inset 0 0 0 1px var(--line-2),
			0 0 0 3px var(--ring);
	}
	:global(.tema-escuro) .ed-box,
	:global(.tema-escuro) .ed-in {
		background: rgba(0, 0, 0, 0.18);
	}
	.ed-in {
		padding: 4px 6px;
	}
	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		padding: 1px 0;
	}
	.tagc {
		display: inline-flex;
		align-items: center;
		height: 24px;
		padding: 0 9px;
		border-radius: 99px;
		font-size: 13px;
		color: var(--ink-2);
		background: var(--tile);
		box-shadow: inset 0 0 0 1px var(--line);
	}

	@media (max-width: 768px) {
		.f-word,
		.ed.big {
			font-size: 28px;
		}
	}
</style>
