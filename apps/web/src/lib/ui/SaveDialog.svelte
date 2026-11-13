<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import type { SubmitFunction } from '$app/forms';
	import type { Language, UiLanguage } from '#lib/languages.ts';
	import type { LanguageSummary } from '#lib/server/summary.ts';
	import { formatTags, saveDialogKey, type WordEdit } from '#lib/word-fields.ts';
	import { mergeSuggestion, parseSuggestion, type FillFields } from '#lib/ai-fill.ts';
	import FormDialog from './FormDialog.svelte';
	import { toast, ui } from './app-state.svelte.ts';
	import { postAction } from './post-action.ts';
	import { DeckOptions } from './word/deck-options.svelte.ts';
	import LanguageSwitch from './word/LanguageSwitch.svelte';
	import MoreFields from './word/MoreFields.svelte';
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

	let lemma = $state<ReturnType<typeof WordField>>();
	let form = $state<HTMLFormElement>();
	let errors = $state<Record<string, string>>({});
	let pending = $state(false);
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

	function onOpen() {
		chosen = language;
		if (edit) {
			lemmaText = edit.lemma;
			// Com algo em "Mais campos", a seção já abre mostrando.
			more = !!(edit.reading || edit.note || edit.tags.length || edit.image || edit.audio);
		}
		requestAnimationFrame(() => lemma?.focus());
	}

	// Baralhos do idioma escolhido, buscados quando "Mais campos" abre.
	const decks = new DeckOptions(() => (more && isOpen ? chosen : null));

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

<FormDialog
	id={pfx}
	title={editing ? 'Editar palavra' : 'Guardar palavra'}
	submitLabel={editing ? 'Salvar' : 'Guardar'}
	open={isOpen}
	ssrOpen={!editing && ssrOpen}
	{pending}
	onopen={onOpen}
	onclose={onClose}
	onkeydown={onDialogKey}
>
	{#snippet chip()}
		{#if !editing}
			<LanguageSwitch bind:value={chosen} bind:open={langOpen} {options} {native} ui={uiLanguage} />
		{/if}
	{/snippet}
	{#snippet hint()}
		{#if !editing}<kbd>⌥L</kbd> idioma ·{/if} <kbd>Tab</kbd> campo
	{/snippet}
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
				<MoreFields
					bind:open={more}
					pills={['leitura', 'nota', 'tags', 'imagem', 'áudio', 'baralho']}
				>
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
							decks={decks.list}
							value={edit?.deckId ?? null}
							loading={decks.loading}
							error={errors.deck}
						/>
					{/key}
				</MoreFields>
			</form>
		{/key}{/key}
</FormDialog>

<style>
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
	.minis {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
		padding: 12px 0 12px 32px;
		border-top: 1px solid var(--line);
	}
	@media (max-width: 768px) {
		.minis {
			grid-template-columns: 1fr;
			padding-left: 0;
		}
	}
</style>
