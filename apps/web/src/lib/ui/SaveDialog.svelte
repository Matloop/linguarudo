<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import type { SubmitFunction } from '$app/forms';
	import { langAttrs, languageLabel, type Language, type UiLanguage } from '#lib/languages.ts';
	import { LIMITS } from '#lib/items.ts';
	import Icon from './Icon.svelte';
	import { toast, ui } from './app-state.svelte.ts';

	let {
		language,
		uiLanguage,
		ssrOpen = false
	}: {
		language: Language;
		uiLanguage: UiLanguage;
		/** Sem JS, /qualquer-tela?guardar já chega com o diálogo aberto. */
		ssrOpen?: boolean;
	} = $props();

	// Lido uma vez: o diálogo só nasce aberto quando a página chega com ?guardar.
	const openOnServer = untrack(() => ssrOpen);

	let dialog = $state<HTMLDialogElement>();
	let word: HTMLInputElement;
	let form: HTMLFormElement;
	let errors = $state<Record<string, string>>({});
	let pending = $state(false);
	let lastFocus: HTMLElement | null = null;

	$effect(() => {
		if (!dialog) return;
		if (ui.saveOpen && !dialog.matches(':modal')) {
			lastFocus = document.activeElement as HTMLElement | null;
			// Aberto pelo servidor (sem modal): tira o atributo sem disparar "close".
			dialog.removeAttribute('open');
			dialog.showModal();
			requestAnimationFrame(() => word?.focus());
		} else if (!ui.saveOpen && dialog.open) {
			dialog.close();
		}
	});

	function onClose() {
		ui.saveOpen = false;
		errors = {};
		form?.reset();
		lastFocus?.focus?.({ preventScroll: true });
	}

	const submit: SubmitFunction = ({ formData, cancel }) => {
		if (!String(formData.get('lemma') ?? '').trim()) {
			errors = { lemma: 'Escreva a palavra para guardar.' };
			word.focus();
			cancel();
			return;
		}
		pending = true;
		return async ({ result }) => {
			pending = false;
			if (result.type === 'success') {
				ui.saveOpen = false;
				toast(String(result.data?.message ?? 'Guardada.'));
				await invalidateAll();
			} else if (result.type === 'failure') {
				errors = (result.data?.errors as Record<string, string>) ?? {
					form: 'Não deu para salvar agora.'
				};
			} else {
				errors = { form: 'Não deu para salvar agora. Tente de novo.' };
			}
		};
	};

	function onContextKey(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			form.requestSubmit();
		}
	}

	const errorText = $derived(errors.lemma ?? errors.form ?? errors.sense ?? errors.sentence ?? '');
</script>

{#snippet body()}
	<form
		method="POST"
		action="/palavras?/add"
		autocomplete="off"
		bind:this={form}
		use:enhance={submit}
		aria-labelledby="guardar-titulo"
	>
		<input type="hidden" name="language" value={language} />
		<div class="mh">
			<span class="lang-chip"
				><span class="code">{language.toUpperCase()}</span><span id="guardar-titulo"
					>Guardar em {languageLabel(language, uiLanguage)}</span
				></span
			>
			<button
				type="button"
				class="icon-btn"
				aria-label="Fechar"
				onclick={() => (ui.saveOpen = false)}><Icon name="x" /></button
			>
		</div>
		<div class="mb">
			<input
				class="f-word"
				name="lemma"
				{...langAttrs(language)}
				bind:this={word}
				placeholder="Palavra ou expressão"
				aria-label="Palavra"
				maxlength={LIMITS.lemma}
				aria-invalid={errors.lemma ? 'true' : undefined}
				aria-describedby="guardar-erro"
				oninput={() => (errors = {})}
			/>
			<div class="f-err" class:on={errorText} id="guardar-erro" role="alert">{errorText}</div>
			<div class="field">
				<Icon name="globe" />
				<div>
					<label for="guardar-sentido">Tradução <i>· opcional</i></label>
					<input
						id="guardar-sentido"
						name="sense"
						placeholder="O que ela quer dizer"
						maxlength={LIMITS.sense}
					/>
				</div>
			</div>
			<div class="field">
				<Icon name="pencil" />
				<div>
					<label for="guardar-frase">Contexto <i>· opcional</i></label>
					<textarea
						id="guardar-frase"
						name="sentence"
						rows="2"
						placeholder="A frase onde você encontrou a palavra"
						maxlength={LIMITS.sentence}
						onkeydown={onContextKey}></textarea>
				</div>
			</div>
		</div>
		<div class="mf">
			<span class="hint"><kbd>Esc</kbd> fecha</span>
			<div class="acts">
				<button type="button" class="btn btn-ghost" onclick={() => (ui.saveOpen = false)}
					>Cancelar</button
				>
				<button type="submit" class="btn btn-primary" disabled={pending}>Guardar<kbd>↵</kbd></button
				>
			</div>
		</div>
	</form>
{/snippet}

<!-- `open` literal (nunca reativo): reaplicado a cada re-render, fecharia o modal do cliente. -->
{#if openOnServer}
	<dialog
		class="modal"
		bind:this={dialog}
		onclose={onClose}
		onclick={(e) => e.target === dialog && (ui.saveOpen = false)}
		aria-labelledby="guardar-titulo"
		open
	>
		{@render body()}
	</dialog>
{:else}
	<dialog
		class="modal"
		bind:this={dialog}
		onclose={onClose}
		onclick={(e) => e.target === dialog && (ui.saveOpen = false)}
		aria-labelledby="guardar-titulo"
	>
		{@render body()}
	</dialog>
{/if}

<style>
	.modal {
		width: min(560px, calc(100% - 32px));
		max-width: none;
		margin: 16vh auto auto;
		padding: 0;
		border: 0;
		color: var(--ink);
		background: var(--raise-2);
		border-radius: var(--r-l);
		box-shadow: var(--sh-pop);
		overflow: hidden;
	}
	.modal[open] {
		animation: modalIn 0.3s var(--ease) both;
	}
	.modal::backdrop {
		background: var(--scrim);
		animation: fade 0.22s var(--ease) both;
	}
	@keyframes modalIn {
		from {
			opacity: 0;
			transform: translateY(-6px);
		}
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
	form {
		margin: 0;
	}
	.mh {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 14px 14px 0 20px;
	}
	.lang-chip {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		height: 26px;
		padding: 0 10px 0 3px;
		border-radius: var(--r-s);
		background: var(--tile);
		box-shadow: inset 0 0 0 1px var(--line);
		font-size: 14px;
		font-weight: 500;
		color: var(--ink-2);
	}
	.lang-chip .code {
		width: 20px;
		height: 20px;
		font-size: 10.5px;
		border-radius: 4px;
		box-shadow: none;
		background: var(--sunk);
	}
	.mb {
		padding: 10px 20px 4px;
	}
	.f-word {
		width: 100%;
		border: 0;
		outline: none;
		background: none;
		font: 600 32.5px/1.2 var(--f-head);
		letter-spacing: -0.025em;
		padding: 8px 0 6px;
	}
	.f-word::placeholder {
		color: var(--ink-3);
		opacity: 0.55;
	}
	.field {
		display: grid;
		grid-template-columns: 22px 1fr;
		gap: 12px;
		align-items: start;
		padding: 12px 0;
		border-top: 1px solid var(--line);
	}
	.field > :global(.ic) {
		margin-top: 3px;
		color: var(--ink-3);
	}
	.field label {
		display: block;
		font-size: 13.5px;
		font-weight: 500;
		color: var(--ink-3);
		margin-bottom: 2px;
	}
	.field label i {
		font-style: normal;
		font-weight: 400;
	}
	.field input,
	.field textarea {
		width: 100%;
		border: 0;
		outline: none;
		background: none;
		padding: 0;
		resize: none;
		font-size: 16.5px;
		line-height: 1.5;
	}
	.field input::placeholder,
	.field textarea::placeholder {
		color: var(--ink-3);
		opacity: 0.75;
	}
	.mf {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 12px 14px 14px 20px;
		background: var(--tile);
		border-top: 1px solid var(--line);
	}
	.mf .hint {
		font-size: 14px;
		color: var(--ink-3);
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.mf .acts {
		display: flex;
		gap: 6px;
	}
	.f-err {
		color: var(--terra-ink);
		font-size: 14px;
		height: 0;
		overflow: hidden;
		transition: height 0.2s;
	}
	.f-err.on {
		height: 20px;
	}
	@media (max-width: 768px) {
		.modal {
			margin-top: calc(10px + var(--safe-t));
			width: calc(100% - 20px);
		}
		.mf .hint {
			display: none;
		}
		.mf .acts {
			width: 100%;
		}
		.mf .acts .btn-primary {
			flex: 1;
		}
		.f-word {
			font-size: 29px;
		}
	}
</style>
