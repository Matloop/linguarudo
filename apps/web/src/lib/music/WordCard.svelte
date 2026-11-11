<script lang="ts">
	import { tick } from 'svelte';
	import { LIMITS } from '#lib/items.ts';
	import type { MusicLanguage } from './wordlists.ts';
	import type { Token } from './tokenize.ts';
	import { speak } from './speech.ts';

	interface Props {
		lang: MusicLanguage;
		/** Palavra tocada, como aparece na letra. */
		text: string;
		/** A linha inteira, com a palavra destacada. */
		tokens: readonly Token[];
		highlightIndex: number;
		/** Posição da palavra na tela, para o cartão abrir perto dela. */
		anchor: { left: number; top: number; bottom: number; width: number };
		/** Dados do banco do usuário; null se a palavra ainda não está lá. */
		inBank: { sense: string; ipa: string; pos: string } | null;
		saving: boolean;
		onsave: (sense: string) => void;
		onclose: () => void;
	}

	let { lang, text, tokens, highlightIndex, anchor, inBank, saving, onsave, onclose }: Props =
		$props();

	let sense = $state('');
	let card: HTMLDivElement | undefined = $state();
	let pos = $state({ left: 12, top: 12 });

	const CARD_WIDTH = 310;

	$effect(() => {
		// Posiciona perto da palavra; no celular o CSS vira bottom sheet e ignora isto.
		const height = card?.offsetHeight ?? 260;
		const left = Math.min(
			innerWidth - CARD_WIDTH - 12,
			Math.max(12, anchor.left + anchor.width / 2 - CARD_WIDTH / 2)
		);
		let top = anchor.bottom + 10;
		if (top + height > innerHeight - 12) top = anchor.top - height - 10;
		pos = { left, top: Math.max(12, top) };
	});

	$effect(() => {
		void tick().then(() => card?.focus({ preventScroll: true }));
	});

	function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!inBank && !saving) onsave(sense);
	}
</script>

<div class="veu" role="presentation" onclick={onclose}></div>
<div
	class="cartao"
	bind:this={card}
	role="dialog"
	aria-modal="true"
	aria-labelledby="cartao-palavra"
	tabindex="-1"
	style:--x="{pos.left}px"
	style:--y="{pos.top}px"
>
	<button class="fechar" type="button" onclick={onclose} aria-label="Fechar cartão">
		<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
	</button>

	<div class="meta">
		<span class="tg" class:it={lang === 'it'}>{lang.toUpperCase()}</span>
		{#if inBank?.pos}<span>{inBank.pos}</span>{/if}
	</div>
	<p class="palavra">
		<b id="cartao-palavra">{text}</b>
		{#if inBank?.ipa}<span class="ipa">{inBank.ipa}</span>{/if}
	</p>

	{#if inBank}
		<p class="traducao">{inBank.sense || 'Sem sentido guardado ainda.'}</p>
	{/if}

	<p class="exemplo" {lang}>
		{#each tokens as token, i (i)}{#if i === highlightIndex}<mark>{token.text}</mark
				>{:else}{token.text}{/if}{/each}
	</p>

	<form onsubmit={submit}>
		{#if !inBank}
			<label class="campo">
				<span>Sentido <small>(opcional)</small></span>
				<input
					bind:value={sense}
					maxlength={LIMITS.sense}
					autocomplete="off"
					placeholder="Em português"
				/>
			</label>
		{/if}
		<div class="acoes">
			<button class="ouvir" type="button" onclick={() => speak(text, lang)}>
				<svg viewBox="0 0 24 24" aria-hidden="true"
					><path d="M4 9v6h4l5 4V5L8 9z" /><path d="M16.5 8.5a5 5 0 0 1 0 7" /></svg
				>
				Ouvir
			</button>
			<button class="salvar" type="submit" disabled={saving || inBank !== null}>
				{#if inBank}
					<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
					Já no seu banco
				{:else}
					<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
					{saving ? 'Salvando…' : 'Salvar'}
				{/if}
			</button>
		</div>
	</form>
</div>

<style>
	svg {
		width: 19px;
		height: 19px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.7;
		stroke-linecap: round;
		stroke-linejoin: round;
		flex: none;
	}

	.veu {
		position: fixed;
		inset: 0;
		z-index: 39;
		background: var(--scrim);
		display: none;
	}

	.cartao {
		position: fixed;
		z-index: 40;
		left: var(--x);
		top: var(--y);
		width: 320px;
		background: var(--raise);
		color: var(--ink);
		border-radius: var(--r-l);
		padding: 18px;
		box-shadow: var(--sh-pop);
		animation: surge 0.22s var(--ease);
	}

	:global(.tema-escuro) .cartao {
		background: var(--raise-2);
	}

	@keyframes surge {
		from {
			opacity: 0;
			transform: translateY(6px) scale(0.98);
		}
	}

	.fechar {
		position: absolute;
		right: 8px;
		top: 8px;
		border: 0;
		background: none;
		width: 34px;
		height: 34px;
		border-radius: var(--r-m);
		display: grid;
		place-items: center;
		color: var(--ink-3);
	}

	.fechar:hover {
		background: var(--hover);
		color: var(--ink);
	}

	.meta {
		display: flex;
		gap: 6px;
		align-items: center;
		font-size: 13.5px;
		color: var(--ink-3);
	}

	.tg {
		font: 600 12px/1 var(--f-head);
		letter-spacing: 0.04em;
		border-radius: 4px;
		padding: 3px 5px;
		background: var(--tile);
		color: var(--ink-2);
		box-shadow: inset 0 0 0 1px var(--line-2);
	}

	.palavra {
		margin: 8px 0 0;
		display: flex;
		align-items: baseline;
		gap: 10px;
		flex-wrap: wrap;
	}

	.palavra b {
		font: 600 30px/1.15 var(--f-head);
		letter-spacing: -0.02em;
		overflow-wrap: anywhere;
	}

	.ipa {
		font-size: 16px;
		color: var(--ink-3);
	}

	.traducao {
		margin: 4px 0 0;
		font-size: 19px;
		color: var(--ink);
	}

	.exemplo {
		margin: 12px 0 14px;
		padding: 11px 13px;
		background: var(--tile);
		box-shadow: inset 0 0 0 1px var(--line);
		border-radius: var(--r-m);
		font-size: 16px;
		line-height: 1.5;
		color: var(--ink-2);
		white-space: pre-wrap;
	}

	.campo {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-bottom: 12px;
		font-size: 14px;
		font-weight: 500;
		color: var(--ink-2);
	}

	.campo small {
		font-weight: 400;
		color: var(--ink-3);
	}

	.campo input {
		border: 0;
		background: var(--sunk);
		box-shadow: inset 0 0 0 1px var(--line);
		border-radius: var(--r-m);
		padding: 9px 12px;
		font-size: 16.5px;
		color: var(--ink);
		width: 100%;
		transition:
			box-shadow 0.18s,
			background-color 0.18s;
	}

	.campo input:focus {
		background: var(--raise);
		box-shadow:
			inset 0 0 0 1px var(--line-2),
			0 0 0 3px var(--ring);
		outline: none;
	}

	.acoes {
		display: flex;
		gap: 8px;
	}

	.acoes button {
		flex: 1;
		border: 0;
		border-radius: var(--r-m);
		height: 42px;
		padding: 0 12px;
		font: 500 15.5px/1 var(--f-body);
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 7px;
		transition: background-color 0.18s var(--ease);
	}

	.ouvir {
		background: var(--soft-bg);
		box-shadow: var(--sh-card);
		color: var(--ink);
	}

	.ouvir:hover {
		background: var(--soft-hover);
	}

	.salvar {
		background: var(--primary);
		color: var(--on-primary);
	}

	.salvar:hover:not(:disabled) {
		background: var(--primary-hover);
	}

	.salvar:disabled {
		background: var(--ok-soft);
		color: var(--ok-ink);
		cursor: default;
	}

	@media (max-width: 860px) {
		.veu {
			display: block;
		}

		.cartao {
			left: 0;
			right: 0;
			top: auto;
			bottom: 0;
			width: 100%;
			border-radius: 16px 16px 0 0;
			padding: 20px 18px calc(18px + env(safe-area-inset-bottom));
		}
	}
</style>
