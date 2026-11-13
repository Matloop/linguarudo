<!--
	Casca dos diálogos de formulário (Guardar palavra, Nova ficha): cabeçalho com título e
	um chip (idioma), corpo, rodapé com as dicas de teclado, Cancelar e o botão de enviar.
	No celular vira folha inferior acima do teclado, sem rodapé (o enviar vai no topo).
	Os botões de enviar ficam fora do <form> do corpo e apontam para ele por `form={id}-form`.

	<FormDialog id="guardar" title="Guardar palavra" submitLabel="Guardar" open={aberto}
		onclose={() => (aberto = false)} onopen={() => campo.focus()} {pending}>
		{#snippet chip()}<LanguageSwitch … />{/snippet}
		{#snippet hint()}<kbd>Tab</kbd> campo{/snippet}
		<form id="guardar-form" …>…</form>
	</FormDialog>
-->
<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	let {
		id,
		title,
		submitLabel,
		open,
		pending = false,
		ssrOpen = false,
		onopen,
		onclose,
		onkeydown,
		chip,
		actions,
		hint,
		children
	}: {
		/** Prefixo dos ids: `{id}-titulo` e o formulário `{id}-form`. */
		id: string;
		title: string;
		submitLabel: string;
		open: boolean;
		pending?: boolean;
		/** Sem JS, a página já chega com o diálogo aberto (lido uma vez). */
		ssrOpen?: boolean;
		/** Acabou de abrir (foco no primeiro campo). */
		onopen?: () => void;
		/** Fechou (Esc, X, Cancelar, fundo ou `open` false): quem chama zera o estado. */
		onclose: () => void;
		onkeydown?: (e: KeyboardEvent) => void;
		/** Ao lado do título (o chip de idioma). */
		chip?: Snippet;
		/** Antes do X (ex.: apagar). */
		actions?: Snippet;
		/** Esquerda do rodapé: atalhos de teclado. */
		hint?: Snippet;
		children: Snippet;
	} = $props();

	const formId = $derived(`${id}-form`);
	const openOnServer = untrack(() => ssrOpen);

	let dialog = $state<HTMLDialogElement>();
	let lastFocus: HTMLElement | null = null;

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.matches(':modal')) {
			lastFocus = document.activeElement as HTMLElement | null;
			// Aberto pelo servidor (sem modal): tira o atributo sem disparar "close".
			dialog.removeAttribute('open');
			dialog.showModal();
			untrack(() => onopen?.());
		} else if (!open && dialog.matches(':modal')) {
			// Só fecha o que abriu: o aberto pelo servidor espera o `open` de quem chama,
			// que chega num efeito do pai, depois deste.
			dialog.close();
		}
	});

	// Folha inferior acima do teclado do celular: a altura que o teclado come.
	$effect(() => {
		const el = dialog;
		const vv = window.visualViewport;
		if (!open || !el || !vv) return;
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

	function closed() {
		onclose();
		lastFocus?.focus?.({ preventScroll: true });
	}

	const close = () => dialog?.close();
</script>

{#snippet body()}
	<div class="grab" aria-hidden="true"></div>
	<div class="dh">
		<h2 id="{id}-titulo">{title}</h2>
		{@render chip?.()}
		<span class="sp"></span>
		<button type="submit" form={formId} class="btn btn-primary m-save" disabled={pending}
			>{submitLabel}</button
		>
		{@render actions?.()}
		<button type="button" class="icon-btn" aria-label="Fechar" onclick={close}
			><Icon name="x" /></button
		>
	</div>
	<div class="db">
		{@render children()}
	</div>
	<div class="df">
		<span class="hint">{@render hint?.()}</span>
		<div class="acts">
			<button type="button" class="btn btn-ghost" onclick={close}>Cancelar</button>
			<button type="submit" form={formId} class="btn btn-primary" disabled={pending}
				>{submitLabel}<kbd>↵</kbd></button
			>
		</div>
	</div>
{/snippet}

<!-- `open` literal (nunca reativo): reaplicado a cada re-render, fecharia o modal do cliente. -->
{#if openOnServer}
	<dialog
		class="modal"
		bind:this={dialog}
		onclose={closed}
		{onkeydown}
		onclick={(e) => e.target === dialog && close()}
		aria-labelledby="{id}-titulo"
		open
	>
		{@render body()}
	</dialog>
{:else}
	<dialog
		class="modal"
		bind:this={dialog}
		onclose={closed}
		{onkeydown}
		onclick={(e) => e.target === dialog && close()}
		aria-labelledby="{id}-titulo"
	>
		{@render body()}
	</dialog>
{/if}

<style>
	.modal {
		width: min(560px, calc(100% - 32px));
		max-width: none;
		/* Cabe abaixo da margem de cima, com "Mais campos" aberto e tudo. */
		max-height: calc(100dvh - 14vh - 24px);
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
	.modal :global(form) {
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
	/* Rodapé grudado embaixo: o corpo rola por trás. */
	.df {
		position: sticky;
		bottom: 0;
		z-index: 1;
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
	}
</style>
