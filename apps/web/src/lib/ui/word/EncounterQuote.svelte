<!--
	Um contexto (encontro) no painel da palavra: a frase no idioma de estudo, com a palavra
	marcada, e embaixo a tradução na língua nativa, apagada, com o sentido em negrito.
	Sem tradução: "Sem tradução · ✦ traduzir". Frase do Blend sem tradução é "frase
	misturada": "✦ Passar para o <idioma>". O lápis abre a edição no lugar (frase e
	tradução, "✦ Completar com IA", Ctrl+Enter salva, Esc cancela). Os botões de IA da
	vista abrem a edição já preenchida: nada é salvo antes do Salvar.
-->
<script lang="ts">
	import { tick } from 'svelte';
	import type { Origin } from '#lib/items.ts';
	import { LIMITS } from '#lib/items.ts';
	import { langAttrs, languageInline, type Language } from '#lib/languages.ts';
	import { formatAgo, highlightParts } from '#lib/review.ts';
	import { isMixedSentence, senseParts, type SentencePair } from '#lib/sentence.ts';
	import Icon from '../Icon.svelte';
	import { toast } from '../app-state.svelte.ts';
	import { ORIGIN_ICONS } from '../origins.ts';
	import { postAction } from '../post-action.ts';
	import { completeSentenceWithAi } from '../sentence-ai.ts';

	let {
		encounter: e,
		lemma,
		sense,
		language,
		native,
		now,
		timeZone
	}: {
		encounter: {
			id: string;
			sentence: string;
			highlight: string;
			translation: string;
			sense: string;
			origin: Origin;
			originLabel: string;
			source: string;
			seenAt: string;
		};
		/** Lema e sentido principal do item (destaque e negrito, pedido à IA). */
		lemma: string;
		sense: string;
		language: Language;
		/** Língua nativa: a da tradução. */
		native: Language;
		now: Date;
		timeZone: string;
	} = $props();

	const study = $derived(langAttrs(language));
	const nativeAttrs = $derived(langAttrs(native));
	const studyName = $derived(languageInline(language, 'pt'));
	const nativeName = $derived(languageInline(native, 'pt'));
	const mixed = $derived(isMixedSentence(e));

	let editing = $state(false);
	let draft = $state<SentencePair>({ sentence: '', translation: '' });
	let errors = $state<Record<string, string>>({});
	let saving = $state(false);
	/** Pedido à IA em andamento (na vista ou na edição). */
	let asking = $state(false);
	let aiAbort: AbortController | null = null;
	let box = $state<HTMLElement>();

	async function open(pair: SentencePair = { sentence: e.sentence, translation: e.translation }) {
		draft = { ...pair };
		errors = {};
		editing = true;
		await tick();
		box?.querySelector<HTMLTextAreaElement>('textarea')?.focus();
	}

	function cancel() {
		aiAbort?.abort();
		editing = false;
		errors = {};
	}

	async function askAi(from: SentencePair): Promise<SentencePair | null> {
		aiAbort?.abort();
		const controller = new AbortController();
		aiAbort = controller;
		asking = true;
		const r = await completeSentenceWithAi({ language, lemma, sense }, from, controller.signal);
		if (aiAbort === controller) {
			aiAbort = null;
			asking = false;
		}
		if (controller.signal.aborted) return null;
		if (!r.ok) {
			toast(r.message);
			return null;
		}
		return r.pair;
	}

	/** Da vista: "✦ traduzir" ou "✦ Passar para o …" abrem a edição com o resultado. */
	async function aiFromView() {
		if (asking) return;
		const pair = await askAi({ sentence: e.sentence, translation: e.translation });
		if (pair) await open(pair);
	}

	async function aiInEdit() {
		if (asking) return aiAbort?.abort();
		const pair = await askAi({ ...draft });
		if (pair && editing) draft = pair;
	}

	async function save() {
		if (saving) return;
		saving = true;
		errors = {};
		const r = await postAction('/palavras?/editEncounter', {
			id: e.id,
			sentence: draft.sentence,
			translation: draft.translation
		});
		saving = false;
		if (r.ok) {
			editing = false;
			return;
		}
		const fieldErrors = (r.data?.errors ?? {}) as Record<string, string>;
		errors = Object.keys(fieldErrors).length > 0 ? fieldErrors : { form: r.message };
	}

	function onEditKey(ev: KeyboardEvent) {
		if (ev.key === 'Escape') {
			// Esc cancela a edição; não fecha o painel.
			ev.preventDefault();
			ev.stopPropagation();
			cancel();
		} else if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
			ev.preventDefault();
			void save();
		}
	}
</script>

<div class="quote" class:editing bind:this={box}>
	<div class="qs">
		<Icon name={ORIGIN_ICONS[e.origin]} size="sm" /><span class="src"
			>{e.source || e.originLabel}</span
		><span class="sp"></span>
		{#if mixed && !editing}<span class="chip">frase misturada</span>{/if}
		<time datetime={e.seenAt}>{formatAgo(new Date(e.seenAt), now, timeZone)}</time>
		{#if !editing}
			<button
				type="button"
				class="icon-btn pen"
				title="Editar frase e tradução"
				aria-label="Editar frase e tradução"
				onclick={() => open()}><Icon name="pencil" size="sm" /></button
			>
		{/if}
	</div>

	{#if editing}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="edit" onkeydown={onEditKey}>
			<label class="field"
				><span>Frase em {studyName}</span><textarea
					rows="2"
					maxlength={LIMITS.sentence}
					bind:value={draft.sentence}
					disabled={saving}
					aria-invalid={errors.sentence ? 'true' : undefined}
					{...study}></textarea></label
			>
			{#if errors.sentence}<p class="err" role="alert">{errors.sentence}</p>{/if}
			<label class="field"
				><span>Tradução em {nativeName}</span><textarea
					rows="2"
					maxlength={LIMITS.translation}
					bind:value={draft.translation}
					disabled={saving}
					aria-invalid={errors.translation ? 'true' : undefined}
					{...nativeAttrs}></textarea></label
			>
			{#if errors.translation}<p class="err" role="alert">{errors.translation}</p>{/if}
			{#if errors.form}<p class="err" role="alert">{errors.form}</p>{/if}
			<div class="row">
				<button
					type="button"
					class="btn btn-ghost ai"
					aria-busy={asking}
					title="Reescreve a frase no {studyName} se estiver misturada e traduz"
					onclick={aiInEdit}
					>{#if asking}<span class="spin" aria-hidden="true"></span>Completando…{:else}<span
							aria-hidden="true">✦</span
						>Completar com IA{/if}</button
				>
				<span class="sp"></span>
				<button type="button" class="btn btn-ghost" onclick={cancel}>Cancelar</button>
				<button type="button" class="btn btn-primary" disabled={saving} onclick={save}
					>{saving ? 'Salvando…' : 'Salvar'}</button
				>
			</div>
			<p class="hint"><kbd>Ctrl</kbd>+<kbd>Enter</kbd> salva · <kbd>Esc</kbd> cancela</p>
		</div>
	{:else}
		{#if e.sentence}<p {...study}>
				{#each highlightParts(e.sentence, e.highlight || lemma, language) as part, i (i)}{#if part.hit}<mark
							>{part.text}</mark
						>{:else}{part.text}{/if}{/each}
			</p>{/if}
		{#if e.translation}
			<p class="tr" {...nativeAttrs}>
				{#each senseParts(e.translation, sense) as part, i (i)}{#if part.hit}<b>{part.text}</b
						>{:else}{part.text}{/if}{/each}
			</p>
		{:else if mixed}
			<div class="row mix">
				<span class="hint">Veio do Blend, metade em {nativeName}.</span>
				<button type="button" class="btn btn-ghost ai" aria-busy={asking} onclick={aiFromView}
					>{#if asking}<span class="spin" aria-hidden="true"></span>Passando…{:else}<span
							aria-hidden="true">✦</span
						>Passar para o {studyName}{/if}</button
				>
			</div>
		{:else if e.sentence}
			<p class="tr none">
				Sem tradução ·
				<button type="button" class="link" aria-busy={asking} onclick={aiFromView}
					>{asking ? 'traduzindo…' : '✦ traduzir'}</button
				>
			</p>
		{/if}
		{#if e.sense && e.sense !== sense}<div class="pt">{e.sense}</div>{/if}
	{/if}
</div>

<style>
	.quote {
		padding: 12px 14px;
		border-radius: var(--r-m);
		background: var(--tile);
		box-shadow: inset 0 0 0 1px var(--line);
	}
	.quote.editing {
		box-shadow: inset 0 0 0 1px var(--line-2);
	}
	.quote + .quote {
		margin-top: 6px;
	}
	.qs {
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: 12.5px;
		color: var(--ink-3);
		margin-bottom: 6px;
		min-height: 24px;
	}
	.qs .src {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.qs time {
		flex: none;
	}
	.sp {
		flex: 1;
	}
	.pen {
		flex: none;
		width: 24px;
		height: 24px;
		margin: -4px -6px -4px 0;
		color: var(--ink-3);
	}
	.chip {
		flex: none;
		font-size: 11.5px;
		padding: 1px 8px;
		border-radius: 999px;
		color: var(--gold-ink);
		background: var(--gold-soft);
	}
	p {
		margin: 0;
		font-size: 14.5px;
		line-height: 1.5;
	}
	.tr {
		margin-top: 3px;
		color: var(--ink-3);
		font-size: 13.5px;
	}
	.tr b {
		color: var(--ink);
		font-weight: 600;
	}
	.tr.none {
		color: var(--ink-3);
		opacity: 0.85;
	}
	.link {
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		color: var(--ink-2);
		text-decoration: underline;
		text-underline-offset: 2px;
		cursor: pointer;
	}
	.pt {
		color: var(--ink-3);
		font-size: 13px;
		margin-top: 4px;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 6px;
	}
	.row.mix {
		justify-content: space-between;
	}
	.btn {
		height: 30px;
		padding: 0 10px;
		font-size: 13.5px;
	}
	.ai {
		gap: 6px;
		color: var(--ink-2);
	}
	.hint {
		color: var(--ink-3);
		font-size: 12.5px;
	}
	p.hint {
		margin-top: 6px;
	}
	.field {
		display: block;
		margin-bottom: 8px;
	}
	.field > span {
		display: block;
		font-size: 12px;
		color: var(--ink-3);
		margin-bottom: 4px;
	}
	textarea {
		display: block;
		width: 100%;
		min-height: 44px;
		padding: 7px 10px;
		border: 0;
		border-radius: var(--r-m);
		background: var(--raise-2);
		box-shadow: inset 0 0 0 1px var(--line-2);
		color: var(--ink);
		font: inherit;
		font-size: 14.5px;
		line-height: 1.45;
		resize: vertical;
	}
	textarea:focus-visible {
		outline: none;
		box-shadow:
			inset 0 0 0 1px var(--line-2),
			0 0 0 3px var(--ring);
	}
	.err {
		margin: -4px 0 8px;
		font-size: 12.5px;
		color: var(--terra-ink);
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
			transform: rotate(360deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.spin {
			animation-duration: 2.4s;
		}
	}
</style>
