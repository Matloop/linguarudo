<!--
	"Guardar em": chip com o idioma escolhido e um popover com os idiomas de estudo (e
	quantas palavras cada um tem), ⌥1…⌥9 na frente de cada um. "Outro idioma…" abre o
	LanguagePicker do seletor da barra (adiciona o idioma aos de estudo e já usa ele).
	Fica fora do <form> do diálogo (o LanguagePicker tem os próprios formulários).
-->
<script lang="ts">
	import { tick } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import type { SubmitFunction } from '$app/forms';
	import {
		MAX_STUDY_LANGUAGES,
		languageLabel,
		type Language,
		type UiLanguage
	} from '#lib/languages.ts';
	import Icon from '../Icon.svelte';
	import LanguagePicker from '../LanguagePicker.svelte';
	import Popover from '../Popover.svelte';
	import { toast } from '../app-state.svelte.ts';

	let {
		value = $bindable(),
		options,
		native = null,
		ui,
		open = $bindable(false)
	}: {
		value: Language;
		/** Idiomas de estudo, na ordem do usuário, com a contagem de palavras (null = sem número). */
		options: { language: Language; items: number | null }[];
		native?: Language | null;
		ui: UiLanguage;
		open?: boolean;
	} = $props();

	let view = $state<'list' | 'add'>('list');
	let list = $state<HTMLElement>();

	const label = (l: Language) => languageLabel(l, ui);
	const back = $derived(page.url.pathname + page.url.search);
	const study = $derived(options.map((o) => o.language));
	const canAdd = $derived(study.length < MAX_STUDY_LANGUAGES);
	const excluded = $derived(native ? [...study, native] : study);

	// Aberto por ⌥L (sem passar pelo botão): foco no idioma atual.
	$effect(() => {
		if (!open) {
			view = 'list';
			return;
		}
		tick().then(() => {
			if (view !== 'list') return;
			const cur = list?.querySelector<HTMLElement>('[aria-checked="true"]');
			if (cur && !list?.contains(document.activeElement)) cur.focus();
		});
	});

	function choose(l: Language, close: () => void) {
		value = l;
		close();
	}

	/** Idioma novo: grava nos de estudo (vira o ativo) e já guarda nele. */
	const submit: SubmitFunction = ({ formData }) => {
		const lang = formData.get('idioma') as Language;
		open = false;
		return async ({ result }) => {
			if (result.type === 'redirect' || result.type === 'success') {
				await invalidateAll();
				value = lang;
				toast(`${label(lang)} adicionado aos seus idiomas`);
			} else if (result.type === 'failure') {
				toast(String(result.data?.message ?? 'Não deu para adicionar agora.'));
			}
		};
	};

	function listKey(e: KeyboardEvent) {
		if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
		e.preventDefault();
		const items = [...(list?.querySelectorAll<HTMLElement>('.li') ?? [])];
		const i = items.indexOf(document.activeElement as HTMLElement);
		const next = e.key === 'ArrowDown' ? i + 1 : i - 1;
		items[(next + items.length) % items.length]?.focus();
	}
</script>

<span class="lang-sw">
	<Popover bind:open label="Guardar em" align="start" width={264}>
		{#snippet trigger({ toggle, expanded, id })}
			<button
				type="button"
				class="lang-chip"
				title="Trocar idioma (⌥L)"
				aria-label="Idioma: {label(value)}. Trocar idioma"
				aria-expanded={expanded}
				aria-controls={id}
				onclick={toggle}
			>
				<span class="code" data-testid="guardar-idioma">{value.toUpperCase()}</span>
				<span class="ln">{label(value)}</span>
				<Icon name="down" size="sm" />
			</button>
		{/snippet}
		{#snippet children({ close })}
			{#if view === 'list'}
				<div class="ph2">Guardar em</div>
				<div class="list" role="menu" tabindex="-1" bind:this={list} onkeydown={listKey}>
					{#each options as o, i (o.language)}
						<button
							type="button"
							class="li"
							role="menuitemradio"
							aria-checked={o.language === value}
							onclick={() => choose(o.language, close)}
						>
							<span class="code">{o.language.toUpperCase()}</span>
							<span class="nm">{label(o.language)}</span>
							{#if o.items !== null}<span class="n">{o.items}</span>{/if}
							{#if i < 9}<kbd>⌥{i + 1}</kbd>{/if}
						</button>
					{/each}
					{#if canAdd}
						<div class="sep"></div>
						<button type="button" class="li" role="menuitem" onclick={() => (view = 'add')}>
							<Icon name="plus" size="sm" />
							<span class="nm">Outro idioma…</span>
						</button>
					{/if}
				</div>
			{:else}
				<div class="ph2 back">
					<button type="button" class="icon-btn" aria-label="Voltar" onclick={() => (view = 'list')}
						><Icon name="right" size="sm flip" /></button
					>Outro idioma
				</div>
				<LanguagePicker
					id="guardar-outro-idioma"
					action="/perfil?/adicionarIdioma"
					name="idioma"
					{ui}
					exclude={excluded}
					hidden={{ voltar: back }}
					{submit}
					autofocus
				/>
				<div class="det">Entra nos seus idiomas de estudo, com o próprio banco e revisão.</div>
			{/if}
		{/snippet}
	</Popover>
</span>

<style>
	.lang-sw {
		display: inline-flex;
		flex: none;
		vertical-align: middle;
	}
	.lang-chip {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		height: 26px;
		padding: 0 8px 0 3px;
		border: 0;
		border-radius: var(--r-s);
		background: var(--tile);
		box-shadow: inset 0 0 0 1px var(--line);
		color: var(--ink-2);
		font: inherit;
		font-size: 14px;
		font-weight: 500;
		white-space: nowrap;
		cursor: pointer;
	}
	.lang-chip:hover,
	.lang-chip[aria-expanded='true'] {
		box-shadow: inset 0 0 0 1px var(--ink-3);
	}
	.lang-chip .code {
		width: 20px;
		height: 20px;
		font-size: 10.5px;
		border-radius: 4px;
		box-shadow: none;
		background: var(--sunk);
	}
	.lang-chip > :global(.ic) {
		width: 12px;
		height: 12px;
		margin-left: -2px;
		opacity: 0.6;
	}
	.ph2 {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 0 10px 6px;
		font-size: 12.5px;
		font-weight: 500;
		color: var(--ink-3);
	}
	.ph2.back .icon-btn {
		width: 26px;
		height: 26px;
		margin: -4px 0 -4px -6px;
	}
	.list {
		display: flex;
		flex-direction: column;
		outline: none;
	}
	.li {
		display: flex;
		align-items: center;
		gap: 9px;
		width: 100%;
		padding: 7px 10px;
		border: 0;
		border-radius: var(--r-s);
		background: none;
		color: var(--ink);
		font: 500 14.5px var(--f-body);
		text-align: left;
		cursor: pointer;
	}
	.li:hover,
	.li:focus-visible,
	.li[aria-checked='true'] {
		background: var(--tile);
		outline: none;
	}
	.li .code {
		width: 22px;
		height: 20px;
		font-size: 10px;
		border-radius: 4px;
		box-shadow: none;
		background: var(--sunk);
		color: var(--ink-2);
	}
	.li > :global(.ic) {
		width: 22px;
		color: var(--ink-3);
	}
	.nm {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.n {
		margin-left: auto;
		font-size: 13px;
		color: var(--ink-3);
	}
	.li kbd {
		margin-left: 6px;
	}
	.li .nm + kbd {
		margin-left: auto;
	}
	.sep {
		height: 1px;
		background: var(--line);
		margin: 6px 4px;
	}
	.det {
		padding: 8px 10px 2px;
		font-size: 12.5px;
		color: var(--ink-3);
	}
</style>
