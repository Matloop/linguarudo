<script lang="ts">
	import { resolve } from '$app/paths';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import type { SubmitFunction } from '$app/forms';
	import {
		MAX_STUDY_LANGUAGES,
		languageLabel,
		type Language,
		type UiLanguage
	} from '#lib/languages.ts';
	import type { LanguageSummary } from '#lib/server/summary.ts';
	import Icon from './Icon.svelte';
	import LanguagePicker from './LanguagePicker.svelte';
	import { toast } from './app-state.svelte.ts';

	let {
		active,
		study,
		native,
		ui,
		summaries,
		compact = false,
		id
	}: {
		active: Language | null;
		study: Language[];
		native: Language | null;
		ui: UiLanguage;
		summaries: LanguageSummary[] | null;
		compact?: boolean;
		id: string;
	} = $props();

	const T = {
		choose: 'Escolher idioma',
		chooseSub: 'O que você estuda?',
		switchLabel: (name: string) => `Idioma: ${name}. Trocar idioma`,
		switchTitle: 'Trocar idioma',
		yours: 'Seus idiomas',
		add: 'Adicionar idioma',
		back: 'Voltar',
		none: 'Nenhuma palavra ainda',
		forToday: (n: number) => `${n} para hoje`,
		words: (n: number) => (n === 1 ? '1 palavra' : `${n} palavras`),
		added: (name: string) => `${name} adicionado aos seus idiomas`,
		failed: 'Não deu para trocar agora.',
		note: 'Cada idioma tem o seu banco e a sua revisão.'
	} as const;

	const label = (l: Language) => languageLabel(l, ui);

	let open = $state(false);
	let view = $state<'list' | 'add'>('list');
	let root: HTMLDetailsElement;

	const back = $derived(page.url.pathname + page.url.search);
	const canAdd = $derived(study.length < MAX_STUDY_LANGUAGES);
	const excluded = $derived(native ? [...study, native] : study);
	const summaryOf = (l: Language | null) => summaries?.find((s) => s.language === l) ?? null;

	function sub(l: Language) {
		const s = summaryOf(l);
		if (!s) return '';
		if (s.items === 0) return T.none;
		return s.toReview > 0 ? `${T.words(s.items)} · ${T.forToday(s.toReview)}` : T.words(s.items);
	}
	const activeSub = $derived.by(() => {
		if (!active) return T.chooseSub;
		const s = summaryOf(active);
		return !s ? '' : s.items === 0 ? T.none : T.words(s.items);
	});
	const activeName = $derived(active ? label(active) : T.choose);

	function close() {
		open = false;
		view = 'list';
	}

	/** Troca sem sair da página: o cookie muda no servidor e os dados recarregam. */
	const submit: SubmitFunction = ({ formData }) => {
		const lang = formData.get('idioma') as Language;
		const adding = !study.includes(lang);
		close();
		return async ({ result }) => {
			if (result.type === 'redirect' || result.type === 'success') {
				await invalidateAll();
				if (adding) toast(T.added(label(lang)));
			} else if (result.type === 'failure') {
				toast(String(result.data?.message ?? T.failed));
			}
		};
	};

	function onWindowClick(e: MouseEvent) {
		// composedPath guarda o caminho do clique: o alvo pode já ter saído do DOM (troca de vista).
		if (open && root && !e.composedPath().includes(root)) close();
	}
	function onKeydown(e: KeyboardEvent) {
		if (open && e.key === 'Escape') {
			close();
			root.querySelector('summary')?.focus();
		}
	}
</script>

<svelte:window onclick={onWindowClick} onkeydown={onKeydown} />

<details class="lang-wrap" class:compact bind:this={root} bind:open>
	<summary class="lang" aria-label={T.switchLabel(activeName)} title={T.switchTitle}>
		<span class="code" data-testid="idioma-ativo"
			>{#if active}{active.toUpperCase()}{:else}<Icon name="globe" size="sm" />{/if}</span
		>
		<span class="t"
			><b>{activeName}</b>{#if activeSub}<span>{activeSub}</span>{/if}</span
		>
		<Icon name="down" size="sm" />
	</summary>

	<div class="menu" {id}>
		{#if view === 'list'}
			{#if study.length > 0}<div class="mhd"><b>{T.yours}</b></div>{/if}
			{#each study as l (l)}
				<form method="POST" action="/perfil?/idioma" use:enhance={submit}>
					<input type="hidden" name="voltar" value={back} />
					<button
						class="mi"
						name="idioma"
						value={l}
						role="menuitemradio"
						aria-checked={l === active}
					>
						<span class="code">{l.toUpperCase()}</span>
						<span class="t"><b>{label(l)}</b><span>{sub(l)}</span></span>
						<Icon name="check" size="sm" />
					</button>
				</form>
			{/each}
			{#if canAdd}
				{#if study.length > 0}<div class="sep"></div>{/if}
				<a
					class="mi add"
					href={resolve('/perfil#idiomas')}
					onclick={(e) => {
						e.preventDefault();
						view = 'add';
					}}
				>
					<span class="code"><Icon name="plus" size="sm" /></span>
					<span class="t"><b>{T.add}</b></span>
					<Icon name="right" size="sm" />
				</a>
			{/if}
		{:else}
			<div class="mhd">
				<button
					type="button"
					class="icon-btn mback"
					aria-label={T.back}
					onclick={() => (view = 'list')}><Icon name="right" size="sm flip" /></button
				><b>{T.add}</b>
			</div>
			<div class="pick">
				<LanguagePicker
					id="{id}-add"
					action="/perfil?/adicionarIdioma"
					name="idioma"
					{ui}
					exclude={excluded}
					hidden={{ voltar: back }}
					{submit}
					autofocus
				/>
			</div>
			<div class="sep"></div>
			<div class="note">{T.note}</div>
		{/if}
	</div>
</details>

<style>
	.lang-wrap {
		position: relative;
	}
	.lang {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 5px 8px 5px 5px;
		border-radius: var(--r-m);
		text-align: left;
		cursor: pointer;
		list-style: none;
		transition: background-color 0.15s;
	}
	.lang::-webkit-details-marker {
		display: none;
	}
	.lang:hover,
	[open] > .lang {
		background: var(--hover);
	}
	.lang .t {
		flex: 1;
		min-width: 0;
		line-height: 1.2;
	}
	.lang .t b {
		display: block;
		font: 600 15.5px/1.25 var(--f-head);
	}
	.lang .t span {
		font-size: 13.5px;
		color: var(--ink-3);
		display: block;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.lang > :global(.ic) {
		color: var(--ink-3);
	}
	.menu {
		position: absolute;
		z-index: 40;
		top: calc(100% + 6px);
		left: 0;
		width: 268px;
		max-height: min(460px, 70vh);
		overflow-y: auto;
		background: var(--raise-2);
		border-radius: var(--r-l);
		padding: 6px;
		box-shadow: var(--sh-pop);
		animation: menuIn 0.18s var(--ease) both;
	}
	@keyframes menuIn {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
	}
	.menu form {
		margin: 0;
	}
	.mi {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 7px 10px;
		border: 0;
		border-radius: var(--r-m);
		background: none;
		text-align: left;
		text-decoration: none;
		cursor: pointer;
	}
	.mi:hover {
		background: var(--hover);
	}
	.mi .t {
		flex: 1;
		line-height: 1.25;
	}
	.mi .t b {
		font-weight: 500;
		display: block;
	}
	.mi .t span {
		font-size: 13.5px;
		color: var(--ink-3);
	}
	.mi > :global(.ic) {
		color: var(--accent-ink);
		opacity: 0;
	}
	.mi[aria-checked='true'] > :global(.ic) {
		opacity: 1;
	}
	.mi.add > :global(.ic) {
		opacity: 0.55;
		color: var(--ink-3);
	}
	.mi.add .code {
		background: none;
	}
	.mhd {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 6px 10px;
		font-size: 13.5px;
		font-weight: 500;
		color: var(--ink-3);
	}
	.mhd b {
		font-weight: 500;
	}
	.mhd .mback {
		width: 26px;
		height: 26px;
		margin: -4px 0 -4px -6px;
	}
	.sep {
		height: 1px;
		background: var(--line);
		margin: 6px 4px;
	}
	.pick {
		padding: 2px 4px 4px;
	}
	.note {
		font-size: 13.5px;
		color: var(--ink-3);
		padding: 4px 10px 6px;
	}

	/* Barra recolhida: só o código. */
	:global(.mini) .lang {
		justify-content: center;
		padding: 5px;
	}
	:global(.mini) .lang .t,
	:global(.mini) .lang > :global(.ic) {
		display: none;
	}

	/* Topo do celular: código e nome, sem a contagem. */
	.compact .lang {
		width: auto;
		padding: 4px 8px 4px 4px;
	}
	.compact .lang .code {
		width: 26px;
		height: 26px;
	}
	.compact .lang .t span {
		display: none;
	}
	@media (max-width: 768px) {
		.menu {
			width: min(300px, calc(100vw - 24px));
		}
	}
</style>
