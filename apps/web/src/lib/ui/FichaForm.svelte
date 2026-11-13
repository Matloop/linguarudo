<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	type ActionResult = Parameters<
		ReturnType<SubmitFunction> extends infer R ? Extract<R, (...a: never[]) => unknown> : never
	>[0]['result'];
	import { resolve } from '$app/paths';
	import {
		FICHA_LIMITS,
		clozeCount,
		fichaTextToHtml,
		type FichaField,
		type FichaMedia,
		type FichaMediaField
	} from '#lib/fichas.ts';
	import { languageLabel, type Language, type UiLanguage } from '#lib/languages.ts';
	import Icon from './Icon.svelte';
	import MediaField from './MediaField.svelte';

	// Formulário da ficha (nova e edição). Frente e verso são textareas com uma barra
	// de B/I que embrulha a seleção em <b>/<i>; o servidor sanitiza (fichas.ts).

	let {
		values,
		mediaUrls = {},
		errors = {},
		languages,
		ui,
		action = undefined,
		cloze = false,
		submitLabel = 'Salvar ficha',
		onresult = undefined
	}: {
		/** Com ele, o resultado do envio fica com quem chamou (modal) em vez de navegar. */
		onresult?: (result: ActionResult) => void;
		values: {
			language: Language;
			front: string;
			back: string;
			reverse: boolean;
			tags: string;
			media?: FichaMedia;
		};
		/** URLs assinadas da mídia que a ficha já tem. */
		mediaUrls?: Partial<Record<FichaMediaField, string>>;
		errors?: Partial<Record<FichaField | FichaMediaField | 'form', string>>;
		languages: readonly Language[];
		ui: UiLanguage;
		/** Action do SvelteKit ("?/save"); sem ela, a default. */
		action?: string;
		/** Ficha de lacunas (do Anki): sem inverso, um flashcard por lacuna. */
		cloze?: boolean;
		submitLabel?: string;
	} = $props();

	let front = $state('');
	let back = $state('');
	let reverse = $state(false);
	let busy = $state(false);
	$effect.pre(() => {
		front = values.front;
		back = values.back;
		reverse = values.reverse;
	});

	let frontEl: HTMLTextAreaElement | undefined = $state();
	let backEl: HTMLTextAreaElement | undefined = $state();

	const generates = $derived(cloze ? Math.max(1, clozeCount(front)) : reverse ? 2 : 1);
	const preview = $derived({ front: fichaTextToHtml(front), back: fichaTextToHtml(back) });

	function wrap(el: HTMLTextAreaElement | undefined, tag: 'b' | 'i', set: (v: string) => void) {
		if (!el) return;
		const { selectionStart: s, selectionEnd: e, value } = el;
		const next = `${value.slice(0, s)}<${tag}>${value.slice(s, e)}</${tag}>${value.slice(e)}`;
		set(next);
		requestAnimationFrame(() => {
			el.focus();
			el.setSelectionRange(s + tag.length + 2, e + tag.length + 2);
		});
	}

	function onkey(e: KeyboardEvent, which: 'front' | 'back') {
		if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
		const tag = e.key === 'b' ? 'b' : e.key === 'i' ? 'i' : null;
		if (!tag) return;
		e.preventDefault();
		if (which === 'front') wrap(frontEl, tag, (v) => (front = v));
		else wrap(backEl, tag, (v) => (back = v));
	}
</script>

{#snippet toolbar(which: 'front' | 'back')}
	<span class="tb">
		<button
			type="button"
			title="Negrito (Ctrl+B)"
			aria-label="Negrito"
			onclick={() =>
				which === 'front'
					? wrap(frontEl, 'b', (v) => (front = v))
					: wrap(backEl, 'b', (v) => (back = v))}><b>B</b></button
		>
		<button
			type="button"
			title="Itálico (Ctrl+I)"
			aria-label="Itálico"
			onclick={() =>
				which === 'front'
					? wrap(frontEl, 'i', (v) => (front = v))
					: wrap(backEl, 'i', (v) => (back = v))}><i>I</i></button
		>
	</span>
{/snippet}

{#snippet mediaRow(side: 'front' | 'back')}
	{@const image: FichaMediaField = `${side}_image`}
	{@const audio: FichaMediaField = `${side}_audio`}
	<div class="media-row">
		<MediaField
			name={image}
			kind="image"
			label="Imagem"
			path={values.media?.[image] ?? null}
			url={mediaUrls[image] ?? null}
		/>
		<MediaField
			name={audio}
			kind="audio"
			label="Áudio"
			path={values.media?.[audio] ?? null}
			url={mediaUrls[audio] ?? null}
		/>
	</div>
	{#if errors[image]}<p class="err" role="alert">{errors[image]}</p>{/if}
	{#if errors[audio]}<p class="err" role="alert">{errors[audio]}</p>{/if}
{/snippet}

<form
	class="ficha-form"
	method="POST"
	{action}
	use:enhance={() => {
		busy = true;
		return async ({ update, result }) => {
			if (onresult) onresult(result);
			else await update({ reset: false });
			busy = false;
		};
	}}
>
	<div class="grid2">
		<div class="fld">
			<div class="lbl">
				<label for="ficha-front">Frente</label>
				{@render toolbar('front')}
			</div>
			<textarea
				id="ficha-front"
				name="front"
				rows="5"
				required
				maxlength={FICHA_LIMITS.face}
				bind:value={front}
				bind:this={frontEl}
				onkeydown={(e) => onkey(e, 'front')}
				aria-invalid={errors.front ? 'true' : undefined}></textarea>
			{#if errors.front}<p class="err" role="alert">{errors.front}</p>{/if}
			{@render mediaRow('front')}
		</div>
		<div class="fld">
			<div class="lbl">
				<label for="ficha-back">Verso</label>
				{@render toolbar('back')}
			</div>
			<textarea
				id="ficha-back"
				name="back"
				rows="5"
				maxlength={FICHA_LIMITS.face}
				bind:value={back}
				bind:this={backEl}
				onkeydown={(e) => onkey(e, 'back')}
				aria-invalid={errors.back ? 'true' : undefined}></textarea>
			{#if errors.back}<p class="err" role="alert">{errors.back}</p>{/if}
			{@render mediaRow('back')}
		</div>
	</div>

	<div class="grid2">
		<div class="fld">
			<label for="ficha-language">Idioma</label>
			<select id="ficha-language" name="language" value={values.language}>
				{#each languages as language (language)}
					<option value={language}>{languageLabel(language, ui)}</option>
				{/each}
			</select>
			{#if errors.language}<p class="err" role="alert">{errors.language}</p>{/if}
		</div>
		<div class="fld">
			<label for="ficha-tags">Tags <i class="opt">· separadas por vírgula</i></label>
			<input
				id="ficha-tags"
				name="tags"
				value={values.tags}
				placeholder="gramática, verbos"
				autocomplete="off"
				aria-invalid={errors.tags ? 'true' : undefined}
			/>
			{#if errors.tags}<p class="err" role="alert">{errors.tags}</p>{/if}
		</div>
	</div>

	{#if !cloze}
		<label class="check">
			<input type="checkbox" name="reverse" bind:checked={reverse} />
			Criar também o inverso (verso → frente)
		</label>
	{/if}

	{#if preview.front}
		<div class="preview" aria-label="Prévia">
			<!-- HTML do próprio formulário, passado pelo mesmo sanitizador do servidor. -->
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			<div class="pf">{@html preview.front}</div>
			{#if preview.back}
				<div class="divider"></div>
				<!-- eslint-disable-next-line svelte/no-at-html-tags -->
				<div class="pb">{@html preview.back}</div>
			{/if}
		</div>
	{/if}

	{#if errors.form}<p class="err" role="alert">{errors.form}</p>{/if}

	<div class="foot">
		<span class="gen"
			><Icon name="cards" size="sm" />Vai gerar {generates}
			{generates === 1 ? 'flashcard' : 'flashcards'}</span
		>
		<a class="btn btn-ghost" href={resolve('/flashcards/fichas')}>Cancelar</a>
		<button class="btn btn-primary" disabled={busy}>{submitLabel}</button>
	</div>
</form>

<style>
	.ficha-form {
		max-width: 760px;
	}
	.grid2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
		margin-bottom: 16px;
	}
	.fld label,
	.lbl {
		font-size: 12px;
		font-weight: 500;
		color: var(--ink-3);
	}
	.lbl {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.media-row {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 16px;
		margin-top: 8px;
	}
	.opt {
		font-style: normal;
		font-weight: 400;
	}
	.tb {
		display: inline-flex;
		gap: 2px;
	}
	.tb button {
		width: 26px;
		height: 24px;
		border: 0;
		border-radius: 6px;
		background: transparent;
		color: var(--ink-2);
		font-size: 13px;
	}
	.tb button:hover {
		background: var(--tile);
	}
	textarea,
	input:not([type='checkbox']),
	select {
		display: block;
		width: 100%;
		margin-top: 6px;
		padding: 9px 12px;
		border: 0;
		border-radius: var(--r-m);
		background: var(--sunk);
		box-shadow: inset 0 0 0 1px var(--line);
		font-size: 15px;
		color: var(--ink);
		outline: none;
	}
	textarea {
		resize: vertical;
		line-height: 1.45;
	}
	textarea:focus,
	input:focus,
	select:focus {
		background: var(--raise);
		box-shadow:
			inset 0 0 0 1px var(--line-2),
			0 0 0 3px var(--ring);
	}
	.check {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 14px;
		color: var(--ink-2);
		margin: 4px 0 18px;
	}
	.preview {
		background: var(--raise);
		box-shadow: var(--sh-card);
		border-radius: var(--r-l);
		padding: 22px 26px;
		text-align: center;
		margin-bottom: 18px;
	}
	.pf {
		font-size: 18px;
		line-height: 1.45;
		overflow-wrap: anywhere;
	}
	.pb {
		font-size: 14px;
		color: var(--ink-2);
		line-height: 1.5;
		overflow-wrap: anywhere;
	}
	.divider {
		width: 40px;
		height: 1px;
		background: var(--line-2);
		margin: 12px auto;
	}
	.err {
		margin: 6px 0 0;
		color: var(--terra-ink);
		font-size: 12.5px;
	}
	.foot {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.gen {
		margin-right: auto;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		color: var(--ink-3);
	}
	@media (max-width: 768px) {
		.grid2 {
			grid-template-columns: 1fr;
		}
		.foot {
			flex-wrap: wrap;
		}
		.gen {
			width: 100%;
		}
	}
</style>
