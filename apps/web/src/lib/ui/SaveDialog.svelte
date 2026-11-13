<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import type { SubmitFunction } from '$app/forms';
	import type { Language, UiLanguage } from '#lib/languages.ts';
	import type { LanguageSummary } from '#lib/server/summary.ts';
	import { formatTags, saveDialogKey, type DeckOption, type WordEdit } from '#lib/word-fields.ts';
	import { mergeSuggestion, parseSuggestion, type FillFields } from '#lib/ai-fill.ts';
	import Icon from './Icon.svelte';
	import { toast, ui } from './app-state.svelte.ts';
	import { postAction } from './post-action.ts';
	import LanguageSwitch from './word/LanguageSwitch.svelte';
	import WordDeckField from './word/WordDeckField.svelte';
	import WordField from './word/WordField.svelte';
	import WordMediaField from './word/WordMediaField.svelte';

	// Diálogo Guardar ("Diálogo A"): palavra grande, tradução e frase; o resto do item
	// (leitura, nota, tags, mídia, deck) em "Mais campos", com os mesmos campos do painel.
	// No celular vira folha inferior, acima do teclado.
	//
	// Modo "edit" (lápis da revisão): o mesmo diálogo para uma palavra que já existe. Sem
	// "Guardar em" (o idioma é o do item); salva pelo ?/edit de /palavras, depois a frase do
	// cartão pelo ?/editEncounter e o deck pelo ?/move, só o que mudou.
	//	<SaveDialog mode="edit" bind:open edit={word} language={lang} study={[lang]} {uiLanguage} onsaved={…} />

	let {
		language,
		study,
		native = null,
		summaries = null,
		uiLanguage,
		ssrOpen = false,
		mode = 'add',
		edit = null,
		open = $bindable(false),
		onsaved
	}: {
		/** Idioma ativo: o padrão do "Guardar em" (no modo edit, o idioma do item). */
		language: Language;
		study: Language[];
		native?: Language | null;
		summaries?: LanguageSummary[] | null;
		uiLanguage: UiLanguage;
		/** Sem JS, /qualquer-tela?guardar já chega com o diálogo aberto. */
		ssrOpen?: boolean;
		/** "add": o Guardar do app inteiro, aberto por ui.saveOpen. "edit": aberto por `open`. */
		mode?: 'add' | 'edit';
		/** Modo edit: a palavra (valores iniciais dos campos). */
		edit?: WordEdit | null;
		/** Modo edit: aberto ou fechado. */
		open?: boolean;
		/** Modo edit: depois de salvar tudo, antes de fechar. */
		onsaved?: () => void | Promise<void>;
	} = $props();

	const editing = untrack(() => mode === 'edit');
	/** Prefixo dos ids: os dois diálogos (Guardar e editar) cabem na mesma página. */
	const pfx = editing ? 'editar' : 'guardar';
	const isOpen = $derived(editing ? open && !!edit : ui.saveOpen);
	function setOpen(value: boolean) {
		if (editing) open = value;
		else ui.saveOpen = value;
	}

	// Lido uma vez: o diálogo só nasce aberto quando a página chega com ?guardar.
	const openOnServer = untrack(() => !editing && ssrOpen);

	let dialog = $state<HTMLDialogElement>();
	let lemma = $state<ReturnType<typeof WordField>>();
	let form = $state<HTMLFormElement>();
	let errors = $state<Record<string, string>>({});
	let pending = $state(false);
	let lastFocus: HTMLElement | null = null;
	/** Muda a cada fechamento: o formulário nasce de novo, vazio (tags, mídia, deck inclusive). */
	let generation = $state(0);

	let chosen = $state<Language>(untrack(() => language));
	let langOpen = $state(false);
	let more = $state(false);

	const options = $derived(
		study.map((l) => ({
			language: l,
			items: summaries?.find((s) => s.language === l)?.items ?? null
		}))
	);

	$effect(() => {
		if (!dialog) return;
		if (isOpen && !dialog.matches(':modal')) {
			lastFocus = document.activeElement as HTMLElement | null;
			untrack(() => {
				chosen = language;
				if (edit) {
					lemmaText = edit.lemma;
					// Com algo em "Mais campos", a seção já abre mostrando.
					more = !!(edit.reading || edit.note || edit.tags.length || edit.image || edit.audio);
				}
			});
			// Aberto pelo servidor (sem modal): tira o atributo sem disparar "close".
			dialog.removeAttribute('open');
			dialog.showModal();
			requestAnimationFrame(() => lemma?.focus());
		} else if (!isOpen && dialog.open) {
			dialog.close();
		}
	});

	// Folha inferior acima do teclado do celular: a altura que o teclado come.
	$effect(() => {
		const el = dialog;
		const vv = window.visualViewport;
		if (!isOpen || !el || !vv) return;
		const update = () =>
			el.style.setProperty(
				'--kb',
				`${Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))}px`
			);
		update();
		vv.addEventListener('resize', update);
		vv.addEventListener('scroll', update);
		return () => {
			vv.removeEventListener('resize', update);
			vv.removeEventListener('scroll', update);
		};
	});

	// Decks do idioma escolhido, buscados quando "Mais campos" abre.
	let decks = $state<DeckOption[]>([]);
	let decksFor = $state<Language | null>(null);
	let decksLoading = $state(false);
	$effect(() => {
		if (!more || !isOpen) return;
		const lang = chosen;
		if (untrack(() => decksFor) === lang) return;
		decksFor = lang;
		decks = [];
		decksLoading = true;
		fetch(`/palavras/decks?idioma=${encodeURIComponent(lang)}`)
			.then((r) => (r.ok ? (r.json() as Promise<DeckOption[]>) : []))
			.catch(() => [])
			.then((list) => {
				if (decksFor !== lang) return;
				decks = list;
				decksLoading = false;
			});
	});

	// ---------- Preencher com IA ----------
	// Os campos (WordField, modo form) não são controlados: lê e escreve pelo `name`
	// no próprio formulário. Os de "Mais campos" seguem no DOM mesmo fechados.
	let lemmaText = $state('');
	let filling = $state(false);
	let fillAbort: AbortController | null = null;

	const T = $derived(
		uiLanguage === 'en'
			? {
					fill: 'Fill with AI',
					filling: 'Filling…',
					fillTitle:
						'Dictionary form, reading, translation and an example with its translation, by AI',
					fillFailed: 'Couldn’t fill in right now. Try again.',
					fillEmpty: 'The AI had no suggestion for this word.'
				}
			: {
					fill: 'Preencher com IA',
					filling: 'Preenchendo…',
					fillTitle: 'Forma de dicionário, leitura, tradução e um exemplo traduzido, pela IA',
					fillFailed: 'Não deu para preencher agora. Tente de novo.',
					fillEmpty: 'A IA não teve sugestão para essa palavra.'
				}
	);

	type FillKey = keyof FillFields;
	const FILL_KEYS: FillKey[] = ['lemma', 'reading', 'sense', 'sentence', 'translation'];

	function fieldEl(name: FillKey) {
		const el = form?.elements.namedItem(name);
		return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el : null;
	}

	function readFields(): FillFields {
		const v = (name: FillKey) => fieldEl(name)?.value ?? '';
		return {
			lemma: v('lemma'),
			reading: v('reading'),
			sense: v('sense'),
			sentence: v('sentence'),
			translation: v('translation')
		};
	}

	function cancelFill() {
		fillAbort?.abort();
		fillAbort = null;
		filling = false;
	}

	async function fillWithAi() {
		// Clicar de novo cancela o pedido em andamento.
		if (filling) return cancelFill();
		const current = readFields();
		const text = current.lemma.trim();
		if (!text) return;
		const controller = new AbortController();
		fillAbort = controller;
		filling = true;
		errors = {};
		const sentence = current.sentence.trim();
		try {
			const res = await fetch('/palavras/sugerir', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ language: chosen, text, ...(sentence ? { sentence } : {}) }),
				signal: controller.signal
			});
			const body: unknown = await res.json().catch(() => null);
			if (controller.signal.aborted) return;
			if (!res.ok) {
				const message = (body as { message?: unknown } | null)?.message;
				errors = { form: typeof message === 'string' && message ? message : T.fillFailed };
				return;
			}
			const suggestion = parseSuggestion(body);
			if (!suggestion) {
				errors = { form: T.fillEmpty };
				return;
			}
			// Relê: o usuário pode ter digitado enquanto a IA respondia.
			const now = readFields();
			const next = mergeSuggestion(now, suggestion);
			for (const key of FILL_KEYS) {
				const el = fieldEl(key);
				if (el && next[key] !== now[key]) el.value = next[key];
			}
			lemmaText = next.lemma;
			// A leitura mora em "Mais campos": abre para ela aparecer.
			if (next.reading !== now.reading) more = true;
		} catch {
			if (!controller.signal.aborted) errors = { form: T.fillFailed };
		} finally {
			if (fillAbort === controller) {
				fillAbort = null;
				filling = false;
			}
		}
	}

	function onClose() {
		setOpen(false);
		cancelFill();
		lemmaText = '';
		errors = {};
		more = false;
		langOpen = false;
		generation += 1;
		lastFocus?.focus?.({ preventScroll: true });
	}

	/** Erros dos campos de "Mais campos" abrem a seção. */
	const MORE_FIELDS = ['reading', 'note', 'tags', 'image', 'audio', 'deck'];

	/**
	 * Modo edit, depois do ?/edit: a frase do cartão e o deck, só se mudaram. Devolve os
	 * erros (nos nomes dos campos do formulário) ou null.
	 */
	async function saveEditExtras(
		target: WordEdit,
		formData: FormData
	): Promise<Record<string, string> | null> {
		const enc = target.encounter;
		if (enc) {
			const sentence = String(formData.get('sentence') ?? '');
			const translation = String(formData.get('translation') ?? '');
			if (sentence.trim() !== enc.sentence || translation.trim() !== enc.translation) {
				const r = await postAction(
					'/palavras?/editEncounter',
					{ id: enc.id, sentence, translation },
					{ reload: false }
				);
				if (!r.ok) return (r.data?.errors as Record<string, string>) ?? { form: r.message };
			}
		}
		const deck = String(formData.get('deck') ?? '');
		if (deck && deck !== target.deckId) {
			const r = await postAction('/palavras?/move', { item: target.id, deck }, { reload: false });
			if (!r.ok) return { deck: r.message };
		}
		return null;
	}

	const submit: SubmitFunction = ({ formData, cancel }) => {
		if (!String(formData.get('lemma') ?? '').trim()) {
			errors = { lemma: editing ? 'Escreva a palavra.' : 'Escreva a palavra para guardar.' };
			lemma?.focus();
			cancel();
			return;
		}
		pending = true;
		const target = editing ? edit : null;
		return async ({ result }) => {
			if (result.type === 'success' && target) {
				const failed = await saveEditExtras(target, formData);
				if (failed) {
					pending = false;
					errors = failed;
					if (MORE_FIELDS.some((f) => errors[f])) more = true;
					return;
				}
				await onsaved?.();
				pending = false;
				setOpen(false);
				toast('Salva.');
				return;
			}
			pending = false;
			if (result.type === 'success') {
				setOpen(false);
				toast(String(result.data?.message ?? 'Guardada.'));
				await invalidateAll();
			} else if (result.type === 'failure') {
				errors = (result.data?.errors as Record<string, string>) ?? {
					form: 'Não deu para salvar agora.'
				};
				if (MORE_FIELDS.some((f) => errors[f])) more = true;
			} else {
				errors = { form: 'Não deu para salvar agora. Tente de novo.' };
			}
		};
	};

	function onSentenceKey(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			form?.requestSubmit();
		}
	}

	function onDialogKey(e: KeyboardEvent) {
		if (editing) return;
		const key = saveDialogKey(e);
		if (!key) return;
		e.preventDefault();
		if (key.type === 'idiomas') langOpen = !langOpen;
		else if (options[key.index]) {
			chosen = options[key.index].language;
			langOpen = false;
		}
	}
</script>

{#snippet body()}
	<div class="grab" aria-hidden="true"></div>
	<div class="dh">
		<h2 id="{pfx}-titulo">{editing ? 'Editar palavra' : 'Guardar palavra'}</h2>
		{#if !editing}
			<LanguageSwitch bind:value={chosen} bind:open={langOpen} {options} {native} ui={uiLanguage} />
		{/if}
		<span class="sp"></span>
		<button type="submit" form="{pfx}-form" class="btn btn-primary m-save" disabled={pending}
			>{editing ? 'Salvar' : 'Guardar'}</button
		>
		<button type="button" class="icon-btn" aria-label="Fechar" onclick={() => setOpen(false)}
			><Icon name="x" /></button
		>
	</div>
	<!-- Na edição, outra palavra (ou a mesma recarregada) também refaz o formulário: os campos não são controlados. -->
	{#key edit}{#key generation}
			<form
				id="{pfx}-form"
				method="POST"
				action={editing ? '/palavras?/edit' : '/palavras?/add'}
				autocomplete="off"
				bind:this={form}
				use:enhance={submit}
				oninput={(e) => {
					errors = {};
					if ((e.target as HTMLInputElement).name === 'lemma')
						lemmaText = (e.target as HTMLInputElement).value;
				}}
			>
				{#if edit}
					<input type="hidden" name="id" value={edit.id} />
				{:else}
					<input type="hidden" name="language" value={chosen} />
				{/if}
				<div class="db">
					<div class="lemma-row">
						<WordField
							field="lemma"
							bind:this={lemma}
							value={edit?.lemma ?? ''}
							language={chosen}
							error={errors.lemma ?? errors.language ?? errors.form ?? ''}
						/>
						<button
							type="button"
							class="btn btn-ghost ai-fill"
							class:busy={filling}
							disabled={!filling && !lemmaText.trim()}
							aria-busy={filling}
							title={filling ? undefined : T.fillTitle}
							onclick={fillWithAi}
						>
							{#if filling}<span class="spin" aria-hidden="true"></span>{T.filling}{:else}<span
									class="spark"
									aria-hidden="true">✦</span
								>{T.fill}{/if}
						</button>
					</div>
					<WordField
						field="sense"
						id="{pfx}-sentido"
						value={edit?.sense ?? ''}
						error={errors.sense}
					/>
					<!-- Na edição, a frase é a do cartão (o encontro mais recente); sem ela, não há o que editar. -->
					{#if !edit || edit.encounter}
						<WordField
							field="sentence"
							id="{pfx}-frase"
							value={edit?.encounter?.sentence ?? ''}
							language={chosen}
							error={errors.sentence}
							onkeydown={onSentenceKey}
						/>
						<WordField
							field="translation"
							id="{pfx}-traducao-frase"
							value={edit?.encounter?.translation ?? ''}
							error={errors.translation}
							onkeydown={onSentenceKey}
						/>
					{/if}
					<details class="more-wrap" bind:open={more}>
						<summary class="more">
							<Icon name={more ? 'down' : 'right'} size="sm" />
							{more ? 'Menos campos' : 'Mais campos'}
							{#if !more}
								<span class="pills" aria-hidden="true"
									><span>leitura</span><span>nota</span><span class="wide">tags</span><span
										class="wide">imagem</span
									><span class="wide">áudio</span><span class="wide">deck</span><span class="narrow"
										>+4</span
									></span
								>
							{/if}
						</summary>
						<WordField
							field="reading"
							id="{pfx}-leitura"
							value={edit?.reading ?? ''}
							language={chosen}
							error={errors.reading}
						/>
						<WordField field="note" id="{pfx}-nota" value={edit?.note ?? ''} error={errors.note} />
						<WordField
							field="tags"
							id="{pfx}-tags"
							value={edit ? formatTags(edit.tags) : ''}
							error={errors.tags}
						/>
						<div class="minis">
							<WordMediaField
								kind="image"
								path={edit?.image ?? null}
								url={edit?.mediaUrls.image ?? null}
								error={errors.image}
								suggest={() =>
									lemmaText.trim()
										? {
												language: chosen,
												lemma: fieldEl('lemma')?.value ?? lemmaText,
												sense: fieldEl('sense')?.value,
												sentence: fieldEl('sentence')?.value
											}
										: null}
							/>
							<WordMediaField
								kind="audio"
								path={edit?.audio ?? null}
								url={edit?.mediaUrls.audio ?? null}
								error={errors.audio}
							/>
						</div>
						{#key chosen}
							<WordDeckField
								{decks}
								value={edit?.deckId ?? null}
								loading={decksLoading}
								error={errors.deck}
							/>
						{/key}
					</details>
				</div>
				<div class="df">
					<span class="hint"
						>{#if !editing}<kbd>⌥L</kbd> idioma ·{/if} <kbd>Tab</kbd> campo</span
					>
					<div class="acts">
						<button type="button" class="btn btn-ghost" onclick={() => setOpen(false)}
							>Cancelar</button
						>
						<button type="submit" class="btn btn-primary" disabled={pending}
							>{editing ? 'Salvar' : 'Guardar'}<kbd>↵</kbd></button
						>
					</div>
				</div>
			</form>
		{/key}{/key}
{/snippet}

<!-- `open` literal (nunca reativo): reaplicado a cada re-render, fecharia o modal do cliente. -->
{#if openOnServer}
	<dialog
		class="modal"
		bind:this={dialog}
		onclose={onClose}
		onkeydown={onDialogKey}
		onclick={(e) => e.target === dialog && setOpen(false)}
		aria-labelledby="{pfx}-titulo"
		open
	>
		{@render body()}
	</dialog>
{:else}
	<dialog
		class="modal"
		bind:this={dialog}
		onclose={onClose}
		onkeydown={onDialogKey}
		onclick={(e) => e.target === dialog && setOpen(false)}
		aria-labelledby="{pfx}-titulo"
	>
		{@render body()}
	</dialog>
{/if}

<style>
	.modal {
		width: min(560px, calc(100% - 32px));
		max-width: none;
		max-height: calc(100dvh - 32px);
		margin: 14vh auto auto;
		padding: 0;
		border: 0;
		color: var(--ink);
		background: var(--raise-2);
		border-radius: var(--r-l);
		box-shadow: var(--sh-pop);
		overflow-y: auto;
		overscroll-behavior: contain;
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
	.grab {
		display: none;
	}
	.dh {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 14px 14px 0 20px;
	}
	.dh h2 {
		margin: 0;
		font: 600 15px var(--f-head);
		color: var(--ink-2);
		white-space: nowrap;
	}
	.sp {
		flex: 1;
	}
	.m-save {
		display: none;
	}
	.db {
		padding: 6px 20px 4px;
	}
	.lemma-row {
		display: flex;
		align-items: flex-start;
		gap: 8px;
	}
	.lemma-row > :global(.lemma) {
		flex: 1;
		min-width: 0;
	}
	/* Centrado na linha do input grande (52px). */
	.ai-fill {
		flex: none;
		height: 30px;
		margin-top: 11px;
		padding: 0 10px;
		gap: 6px;
		font-size: 14px;
		color: var(--ink-3);
	}
	.ai-fill:disabled {
		opacity: 0.4;
	}
	.ai-fill.busy {
		color: var(--ink-2);
	}
	.ai-fill:focus-visible {
		outline: none;
		box-shadow: 0 0 0 3px var(--ring);
	}
	.spark {
		font-size: 12px;
	}
	.spin {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		border: 1.5px solid currentColor;
		border-right-color: transparent;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(1turn);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.spin {
			animation-duration: 2.4s;
		}
	}
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
	.minis {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
		padding: 12px 0 12px 32px;
		border-top: 1px solid var(--line);
	}
	.df {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 12px 14px 12px 20px;
		background: var(--tile);
		border-top: 1px solid var(--line);
	}
	.df .hint {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		color: var(--ink-3);
		white-space: nowrap;
	}
	.df .acts {
		display: flex;
		gap: 6px;
	}

	/* Celular: folha inferior acima do teclado (--kb vem do visualViewport). */
	@media (max-width: 768px) {
		.modal {
			width: 100%;
			max-height: calc(100dvh - var(--kb, 0px) - var(--safe-t) - 12px);
			margin: auto 0 var(--kb, 0px);
			border-radius: 22px 22px 0 0;
			padding-bottom: var(--safe-b);
		}
		.modal[open] {
			animation-name: sheetIn;
		}
		@keyframes sheetIn {
			from {
				transform: translateY(24px);
				opacity: 0;
			}
		}
		.grab {
			display: block;
			width: 38px;
			height: 5px;
			margin: 8px auto 0;
			border-radius: 99px;
			background: var(--line-2);
		}
		.dh {
			gap: 8px;
			padding: 6px 10px 0 18px;
		}
		.dh h2 {
			font-size: 14px;
		}
		.m-save {
			display: inline-flex;
			height: 34px;
			padding: 0 14px;
		}
		.db {
			padding: 2px 22px 12px;
		}
		.df {
			display: none;
		}
		.pills .wide {
			display: none;
		}
		.pills .narrow {
			display: inline;
		}
		.minis {
			grid-template-columns: 1fr;
			padding-left: 0;
		}
	}
</style>
