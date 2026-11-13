<!--
	Diálogo da ficha (frente e verso livres), com a mesma cara do Guardar palavra: frente
	grande no topo, verso numa linha com ícone, o resto (tags, mídia, inverso, baralho) em
	"Mais campos". Frente e verso aceitam <b>/<i> (botões B/I ou Ctrl+B/I); o servidor
	sanitiza (fichas.ts).

	Modo "add": a Nova ficha do app inteiro, montada no layout e aberta por openFicha()
	(ui.fichaOpen) ou por ?ficha na URL. Salva em /flashcards/fichas?/create.
	Modo "edit": a mesma ficha aberta por `open`, com os valores de `edit` (FichaEdit).
	Salva em /flashcards/fichas/[id]?/save; com `ondeleted`, mostra o Apagar.
		<FichaDialog mode="edit" bind:open edit={ficha} uiLanguage={ui} onsaved={…} />
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance, type SubmitFunction } from '$app/forms';
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import {
		FICHA_LIMITS,
		clozeCount,
		fichaTextToHtml,
		type FichaEdit,
		type FichaMediaField
	} from '#lib/fichas.ts';
	import { langAttrs, type Language, type UiLanguage } from '#lib/languages.ts';
	import type { LanguageSummary } from '#lib/server/summary.ts';
	import { formatTags, saveDialogKey } from '#lib/word-fields.ts';
	import FormDialog from './FormDialog.svelte';
	import Icon from './Icon.svelte';
	import MediaField from './MediaField.svelte';
	import { toast, ui } from './app-state.svelte.ts';
	import { postAction } from './post-action.ts';
	import { DeckOptions } from './word/deck-options.svelte.ts';
	import FieldRow from './word/FieldRow.svelte';
	import LanguageSwitch from './word/LanguageSwitch.svelte';
	import MoreFields from './word/MoreFields.svelte';
	import WordDeckField from './word/WordDeckField.svelte';
	import WordField from './word/WordField.svelte';

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
		onsaved,
		ondeleted,
		onclose
	}: {
		/** Idioma ativo: o padrão do chip de idioma (no modo edit, vale o da ficha). */
		language: Language;
		study?: Language[];
		native?: Language | null;
		summaries?: LanguageSummary[] | null;
		uiLanguage: UiLanguage;
		/** Sem JS, já chega aberto (/qualquer-tela?ficha, ou o link direto da ficha). */
		ssrOpen?: boolean;
		mode?: 'add' | 'edit';
		/** Modo edit: a ficha (valores iniciais dos campos). */
		edit?: FichaEdit | null;
		/** Modo edit: aberto ou fechado. */
		open?: boolean;
		/** Modo edit: depois de salvar, antes de fechar. */
		onsaved?: () => void | Promise<void>;
		/** Modo edit: com ele, o diálogo mostra "Apagar ficha"; roda depois de apagar. */
		ondeleted?: () => void | Promise<void>;
		/** Depois de fechar (salvo, apagado ou cancelado). */
		onclose?: () => void;
	} = $props();

	const editing = untrack(() => mode === 'edit');
	/** Prefixo dos ids: a nova (layout) e a de edição cabem na mesma página. */
	const pfx = editing ? 'editar-ficha' : 'nova-ficha';
	const isOpen = $derived(editing ? open && !!edit : ui.fichaOpen);
	function setOpen(value: boolean) {
		if (editing) open = value;
		else ui.fichaOpen = value;
	}

	// Com JS, ?ficha abre o diálogo e sai da URL (sem JS, o servidor já mandou aberto).
	$effect(() => {
		if (editing || !page.url.searchParams.has('ficha')) return;
		ui.fichaOpen = true;
		const url = new URL(page.url.href);
		url.searchParams.delete('ficha');
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- tira ?ficha da URL atual
		goto(url, { replace: true, reset: false });
	});

	let errors = $state<Record<string, string>>({});
	let pending = $state(false);
	/** Muda a cada fechamento: o formulário nasce de novo, vazio (tags, mídia, baralho inclusive). */
	let generation = $state(0);

	let chosen = $state<Language>(untrack(() => language));
	let langOpen = $state(false);
	let more = $state(false);

	let front = $state('');
	let back = $state('');
	let reverse = $state(false);
	let frontEl = $state<HTMLTextAreaElement>();
	let backEl = $state<HTMLTextAreaElement>();

	const cloze = $derived(!!edit?.cloze);
	const generates = $derived(cloze ? Math.max(1, clozeCount(front)) : reverse ? 2 : 1);
	/** Prévia só quando há marcação: o texto puro já se vê no próprio campo. */
	const preview = $derived(
		/<\/?[bi]>/.test(front + back)
			? { front: fichaTextToHtml(front), back: fichaTextToHtml(back) }
			: null
	);
	const attrs = $derived(langAttrs(chosen));

	const options = $derived(
		(study ?? []).map((l) => ({
			language: l,
			items: summaries?.find((s) => s.language === l)?.items ?? null
		}))
	);

	function onOpen() {
		if (edit) {
			chosen = edit.language;
			front = edit.front;
			back = edit.back;
			reverse = edit.reverse;
			// Com algo em "Mais campos", a seção já abre mostrando.
			more = edit.tags.length > 0 || Object.values(edit.media).some(Boolean);
		} else {
			chosen = language;
		}
		requestAnimationFrame(() => frontEl?.focus());
	}

	function onClose() {
		setOpen(false);
		front = '';
		back = '';
		reverse = false;
		errors = {};
		more = false;
		langOpen = false;
		generation += 1;
		onclose?.();
	}

	// Baralhos do idioma da ficha, buscados quando "Mais campos" abre.
	const decks = new DeckOptions(() => (more && isOpen ? chosen : null));

	// ---------- B/I ----------
	function wrap(which: 'front' | 'back', tag: 'b' | 'i') {
		const el = which === 'front' ? frontEl : backEl;
		if (!el) return;
		const { selectionStart: s, selectionEnd: e, value } = el;
		const next = `${value.slice(0, s)}<${tag}>${value.slice(s, e)}</${tag}>${value.slice(e)}`;
		if (which === 'front') front = next;
		else back = next;
		requestAnimationFrame(() => {
			el.focus();
			el.setSelectionRange(s + tag.length + 2, e + tag.length + 2);
		});
	}

	/** Ctrl/⌘+B/I embrulha a seleção; Enter envia, Shift+Enter quebra a linha. */
	function onFaceKey(e: KeyboardEvent, which: 'front' | 'back') {
		if ((e.ctrlKey || e.metaKey) && !e.altKey) {
			const tag = e.key === 'b' ? 'b' : e.key === 'i' ? 'i' : null;
			if (!tag) return;
			e.preventDefault();
			wrap(which, tag);
		} else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
			e.preventDefault();
			(e.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
		}
	}

	/** Erros dos campos de "Mais campos" abrem a seção. */
	const MORE_FIELDS: string[] = [
		'tags',
		'deck',
		'front_image',
		'front_audio',
		'back_image',
		'back_audio'
	];

	const submit: SubmitFunction = ({ cancel }) => {
		if (!front.trim()) {
			errors = { front: 'Escreva a frente.' };
			frontEl?.focus();
			cancel();
			return;
		}
		pending = true;
		return async ({ result }) => {
			pending = false;
			if (result.type === 'success') {
				if (editing) await onsaved?.();
				else await invalidateAll();
				setOpen(false);
				toast(String(result.data?.message ?? (editing ? 'Ficha salva' : 'Ficha criada')));
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

	async function remove() {
		const target = edit;
		if (!target || pending) return;
		if (!confirm('Apagar esta ficha e os flashcards dela?')) return;
		pending = true;
		const r = await postAction(`/flashcards/fichas/${target.id}?/delete`, {}, { reload: false });
		pending = false;
		if (!r.ok) {
			errors = { form: r.message };
			return;
		}
		await ondeleted?.();
		setOpen(false);
		toast('Ficha apagada');
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

{#snippet bold(which: 'front' | 'back')}
	<span class="tb">
		<button
			type="button"
			title="Negrito (Ctrl+B)"
			aria-label="Negrito"
			onclick={() => wrap(which, 'b')}><b>B</b></button
		>
		<button
			type="button"
			title="Itálico (Ctrl+I)"
			aria-label="Itálico"
			onclick={() => wrap(which, 'i')}><i>I</i></button
		>
	</span>
{/snippet}

{#snippet media(side: 'front' | 'back')}
	{@const image: FichaMediaField = `${side}_image`}
	{@const audio: FichaMediaField = `${side}_audio`}
	<FieldRow
		icon="image"
		label={side === 'front' ? 'Mídia da frente' : 'Mídia do verso'}
		error={errors[image] ?? errors[audio] ?? ''}
	>
		<div class="minis">
			<MediaField
				name={image}
				kind="image"
				label="Imagem"
				path={edit?.media[image] ?? null}
				url={edit?.mediaUrls[image] ?? null}
			/>
			<MediaField
				name={audio}
				kind="audio"
				label="Áudio"
				path={edit?.media[audio] ?? null}
				url={edit?.mediaUrls[audio] ?? null}
			/>
		</div>
	</FieldRow>
{/snippet}

<FormDialog
	id={pfx}
	title={editing ? 'Editar ficha' : 'Nova ficha'}
	submitLabel={editing ? 'Salvar' : 'Guardar'}
	open={isOpen}
	{ssrOpen}
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
	{#snippet actions()}
		{#if editing && ondeleted}
			<button
				type="button"
				class="icon-btn"
				aria-label="Apagar ficha"
				title="Apagar ficha"
				disabled={pending}
				onclick={remove}><Icon name="trash" /></button
			>
		{/if}
	{/snippet}
	{#snippet hint()}
		{#if !editing}<kbd>⌥L</kbd> idioma ·{/if} <kbd>⇧↵</kbd> nova linha · <kbd>Ctrl B</kbd> negrito
	{/snippet}
	<!-- Na edição, outra ficha (ou a mesma recarregada) também refaz o formulário (tags, mídia, baralho). -->
	{#key edit}{#key generation}
			<form
				id="{pfx}-form"
				method="POST"
				action={edit ? `/flashcards/fichas/${edit.id}?/save` : '/flashcards/fichas?/create'}
				autocomplete="off"
				use:enhance={submit}
				oninput={() => (errors = {})}
			>
				<input type="hidden" name="language" value={chosen} />
				<div class="front-row">
					<div class="front">
						<textarea
							class="f-front"
							id="{pfx}-frente"
							name="front"
							rows="1"
							placeholder="Frente: pergunta, regra, frase…"
							aria-label="Frente"
							maxlength={FICHA_LIMITS.face}
							bind:value={front}
							bind:this={frontEl}
							onkeydown={(e) => onFaceKey(e, 'front')}
							aria-invalid={errors.front ? 'true' : undefined}
							aria-describedby="{pfx}-frente-erro"
							{...attrs}></textarea>
						<div
							class="f-err"
							class:on={!!(errors.front ?? errors.language ?? errors.form)}
							id="{pfx}-frente-erro"
							role="alert"
						>
							{errors.front ?? errors.language ?? errors.form ?? ''}
						</div>
					</div>
					{@render bold('front')}
				</div>
				<FieldRow icon="arrow" label="Verso" labelFor="{pfx}-verso" error={errors.back}>
					<textarea
						class="f-back"
						id="{pfx}-verso"
						name="back"
						rows="2"
						placeholder="Resposta, tradução, explicação"
						maxlength={FICHA_LIMITS.face}
						bind:value={back}
						bind:this={backEl}
						onkeydown={(e) => onFaceKey(e, 'back')}
						aria-invalid={errors.back ? 'true' : undefined}></textarea>
					{#snippet aside()}{@render bold('back')}{/snippet}
				</FieldRow>
				{#if preview}
					<FieldRow icon="eye" label="Prévia">
						<!-- HTML do próprio formulário, passado pelo mesmo sanitizador do servidor. -->
						<!-- eslint-disable-next-line svelte/no-at-html-tags -->
						<div class="pf" {...attrs}>{@html preview.front}</div>
						{#if preview.back}
							<!-- eslint-disable-next-line svelte/no-at-html-tags -->
							<div class="pb">{@html preview.back}</div>
						{/if}
					</FieldRow>
				{/if}
				<MoreFields
					bind:open={more}
					pills={cloze
						? ['tags', 'imagem', 'áudio', 'baralho']
						: ['tags', 'imagem', 'áudio', 'inverso', 'baralho']}
				>
					<WordField
						field="tags"
						id="{pfx}-tags"
						placeholder="gramática, verbos…"
						value={edit ? formatTags(edit.tags) : ''}
						error={errors.tags}
					/>
					{@render media('front')}
					{@render media('back')}
					{#if cloze}
						<FieldRow icon="repeat" label="Lacunas">
							<p class="gen">
								Vai gerar {generates}
								{generates === 1 ? 'flashcard' : 'flashcards'}, um por lacuna
							</p>
						</FieldRow>
					{:else}
						<FieldRow
							icon="repeat"
							label="Inverso"
							hint="Vai gerar {generates} {generates === 1 ? 'flashcard' : 'flashcards'}"
						>
							<label class="check">
								<input type="checkbox" name="reverse" bind:checked={reverse} />
								Criar também o inverso (verso → frente)
							</label>
						</FieldRow>
					{/if}
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
	/* Frente: o campo grande do topo, como a palavra no Guardar. */
	.front-row {
		display: flex;
		align-items: flex-start;
		gap: 8px;
	}
	.front {
		flex: 1;
		min-width: 0;
	}
	.f-front {
		display: block;
		width: 100%;
		border: 0;
		outline: none;
		background: none;
		padding: 10px 0 6px;
		resize: none;
		field-sizing: content;
		max-height: 10em;
		color: var(--ink);
		font: 600 26px/1.25 var(--f-head);
		letter-spacing: -0.02em;
	}
	.f-front::placeholder {
		color: var(--ink-3);
		opacity: 0.55;
	}
	.f-err {
		color: var(--terra-ink);
		font-size: 14px;
		height: 0;
		overflow: hidden;
		transition: height 0.2s;
	}
	.f-err.on {
		height: auto;
		min-height: 20px;
	}
	.front-row > .tb {
		margin-top: 12px;
	}
	.f-back {
		display: block;
		width: 100%;
		border: 0;
		outline: none;
		background: none;
		padding: 0;
		resize: none;
		field-sizing: content;
		min-height: 3em;
		max-height: 12em;
		color: var(--ink);
		font-size: 16px;
		line-height: 1.5;
	}
	.f-back::placeholder {
		color: var(--ink-3);
		opacity: 0.75;
	}
	.tb {
		display: inline-flex;
		flex: none;
		gap: 2px;
	}
	.tb button {
		width: 28px;
		height: 26px;
		border: 0;
		border-radius: 6px;
		background: transparent;
		color: var(--ink-3);
		font-size: 14px;
		cursor: pointer;
	}
	.tb button:hover {
		background: var(--hover);
		color: var(--ink-2);
	}
	.tb button:focus-visible {
		outline: none;
		box-shadow: 0 0 0 3px var(--ring);
	}
	.pf {
		font-size: 17px;
		line-height: 1.45;
		overflow-wrap: anywhere;
	}
	.pb {
		margin-top: 4px;
		font-size: 14px;
		color: var(--ink-2);
		line-height: 1.5;
		overflow-wrap: anywhere;
	}
	.minis {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
		padding-top: 4px;
	}
	.check {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 15px;
		color: var(--ink);
		cursor: pointer;
	}
	.gen {
		margin: 0;
		font-size: 15px;
		color: var(--ink-2);
	}
	@media (max-width: 768px) {
		.f-front {
			font-size: 23px;
		}
		.minis {
			grid-template-columns: 1fr;
		}
	}
</style>
