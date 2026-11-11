<script lang="ts">
	import { resolve } from '$app/paths';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import type { SubmitFunction } from '$app/forms';
	import { LANGUAGES, LANGUAGE_LABELS, type Language } from '#lib/languages.ts';
	import type { LanguageSummary } from '#lib/server/summary.ts';
	import Icon from './Icon.svelte';
	import { toast } from './app-state.svelte.ts';

	let {
		active,
		study,
		native,
		summaries,
		compact = false,
		id
	}: {
		active: Language;
		study: Language[];
		native: Language;
		summaries: LanguageSummary[] | null;
		compact?: boolean;
		id: string;
	} = $props();

	/** Nome do idioma na própria língua, para reconhecer de relance. */
	const ENDONYMS: Record<Language, string> = {
		en: 'English',
		it: 'Italiano',
		es: 'Español',
		fr: 'Français',
		de: 'Deutsch',
		pt: 'Português',
		ja: '日本語',
		ko: '한국어',
		zh: '中文',
		nl: 'Nederlands',
		ru: 'Русский'
	};

	let open = $state(false);
	let view = $state<'list' | 'add'>('list');
	let root: HTMLDetailsElement;

	const back = $derived(page.url.pathname + page.url.search);
	const addable = $derived(LANGUAGES.filter((l) => l !== native && !study.includes(l)));
	const summaryOf = (l: Language) => summaries?.find((s) => s.language === l) ?? null;
	const words = (n: number) => (n === 1 ? '1 palavra' : `${n} palavras`);

	function sub(l: Language) {
		const s = summaryOf(l);
		if (!s) return '';
		if (s.items === 0) return 'Nenhuma palavra ainda';
		return s.toReview > 0 ? `${words(s.items)} · ${s.toReview} para hoje` : words(s.items);
	}
	const activeSub = $derived.by(() => {
		const s = summaryOf(active);
		return !s ? '' : s.items === 0 ? 'Nenhuma palavra ainda' : words(s.items);
	});

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
				if (adding) toast(`${LANGUAGE_LABELS[lang]} adicionado aos seus idiomas`);
			} else if (result.type === 'failure') {
				toast(String(result.data?.message ?? 'Não deu para trocar agora.'));
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
	<summary
		class="lang"
		aria-label="Idioma: {LANGUAGE_LABELS[active]}. Trocar idioma"
		title="Trocar idioma"
	>
		<span class="code" data-testid="idioma-ativo">{active.toUpperCase()}</span>
		<span class="t"
			><b>{LANGUAGE_LABELS[active]}</b>{#if activeSub}<span>{activeSub}</span>{/if}</span
		>
		<Icon name="down" size="sm" />
	</summary>

	<div class="menu" {id}>
		{#if view === 'list'}
			<div class="mhd"><b>Seus idiomas</b></div>
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
						<span class="t"><b>{LANGUAGE_LABELS[l]}</b><span>{sub(l)}</span></span>
						<Icon name="check" size="sm" />
					</button>
				</form>
			{/each}
			{#if addable.length > 0}
				<div class="sep"></div>
				<a
					class="mi add"
					href={resolve('/perfil#idiomas')}
					onclick={(e) => {
						e.preventDefault();
						view = 'add';
					}}
				>
					<span class="code"><Icon name="plus" size="sm" /></span>
					<span class="t"><b>Adicionar idioma</b></span>
					<Icon name="right" size="sm" />
				</a>
			{/if}
		{:else}
			<div class="mhd">
				<button
					type="button"
					class="icon-btn mback"
					aria-label="Voltar"
					onclick={() => (view = 'list')}><Icon name="right" size="sm flip" /></button
				><b>Adicionar idioma</b>
			</div>
			{#each addable as l (l)}
				<form method="POST" action="/perfil?/adicionarIdioma" use:enhance={submit}>
					<input type="hidden" name="voltar" value={back} />
					<button class="mi addable" name="idioma" value={l}>
						<span class="code">{l.toUpperCase()}</span>
						<span class="t"><b>{LANGUAGE_LABELS[l]}</b><span>{ENDONYMS[l]}</span></span>
						<Icon name="plus" size="sm" />
					</button>
				</form>
			{/each}
			<div class="sep"></div>
			<div class="note">Cada idioma tem o seu banco e a sua revisão.</div>
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
		font: 600 14px/1.25 var(--f-head);
	}
	.lang .t span {
		font-size: 12px;
		color: var(--ink-3);
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
		font-size: 12px;
		color: var(--ink-3);
	}
	.mi > :global(.ic) {
		color: var(--accent-ink);
		opacity: 0;
	}
	.mi[aria-checked='true'] > :global(.ic) {
		opacity: 1;
	}
	.mi.addable > :global(.ic),
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
		font-size: 12px;
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
	.note {
		font-size: 12px;
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
