<script lang="ts">
	import { tick } from 'svelte';
	import { LIMITS, type Lang } from '#lib/words.ts';
	import type { Token } from './tokenize.ts';
	import { speak } from './speech.ts';

	interface Props {
		lang: Lang;
		/** Palavra tocada, como aparece na letra. */
		text: string;
		/** A linha inteira, com a palavra destacada. */
		tokens: readonly Token[];
		highlightIndex: number;
		/** Posição da palavra na tela, para o cartão abrir perto dela. */
		anchor: { left: number; top: number; bottom: number; width: number };
		/** Dados do banco do usuário; null se a palavra ainda não está lá. */
		inBank: { translation: string; ipa: string; pos: string } | null;
		saving: boolean;
		onsave: (translation: string) => void;
		onclose: () => void;
	}

	let { lang, text, tokens, highlightIndex, anchor, inBank, saving, onsave, onclose }: Props =
		$props();

	let translation = $state('');
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
		if (!inBank && !saving) onsave(translation);
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
		<p class="traducao">{inBank.translation || 'Sem tradução guardada ainda.'}</p>
	{/if}

	<p class="exemplo" {lang}>
		{#each tokens as token, i (i)}{#if i === highlightIndex}<mark>{token.text}</mark
				>{:else}{token.text}{/if}{/each}
	</p>

	<form onsubmit={submit}>
		{#if !inBank}
			<label class="campo">
				<span>Tradução <small>(opcional)</small></span>
				<input
					bind:value={translation}
					maxlength={LIMITS.translation}
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
		width: 20px;
		height: 20px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2.2;
		stroke-linecap: round;
		stroke-linejoin: round;
		flex: none;
	}

	.veu {
		position: fixed;
		inset: 0;
		z-index: 39;
		background: #07302680;
		display: none;
	}

	.cartao {
		position: fixed;
		z-index: 40;
		left: var(--x);
		top: var(--y);
		width: 310px;
		background: var(--creme);
		color: var(--verde-escuro);
		border-radius: 18px;
		padding: 16px;
		box-shadow: 0 18px 40px #0008;
		animation: surge 0.22s;
	}

	@keyframes surge {
		from {
			opacity: 0;
			transform: translateY(6px) scale(0.97);
		}
	}

	.fechar {
		position: absolute;
		right: 8px;
		top: 8px;
		border: 0;
		background: none;
		width: 36px;
		height: 36px;
		border-radius: 10px;
		display: grid;
		place-items: center;
		color: var(--tinta-suave);
	}

	.fechar:hover {
		background: #0c40330d;
	}

	.meta {
		display: flex;
		gap: 6px;
		align-items: center;
		font-size: 12px;
		font-weight: 800;
		color: var(--tinta-suave);
	}

	.tg {
		font-size: 11px;
		font-weight: 850;
		letter-spacing: 0.05em;
		border-radius: 6px;
		padding: 1px 6px;
		background: var(--salvia-claro);
		color: var(--verde);
	}

	.tg.it {
		background: #f6e2c2;
		color: #7a4b12;
	}

	.palavra {
		margin: 6px 0 0;
		display: flex;
		align-items: baseline;
		gap: 10px;
		flex-wrap: wrap;
	}

	.palavra b {
		font-size: 28px;
		letter-spacing: -0.02em;
		color: var(--verde);
		overflow-wrap: anywhere;
	}

	.ipa {
		font-size: 15px;
		color: var(--tinta-suave);
		font-family: var(--fonte-livro);
	}

	.traducao {
		margin: 2px 0 0;
		font-size: 18px;
		font-weight: 750;
	}

	.exemplo {
		margin: 10px 0 12px;
		padding: 10px 12px;
		background: var(--papel);
		border-radius: 12px;
		font-size: 15px;
		font-weight: 650;
		border: 1px solid var(--linha);
		white-space: pre-wrap;
	}

	mark {
		background: #e0a45840;
		color: inherit;
		border-radius: 4px;
		padding: 0 2px;
	}

	.campo {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-bottom: 10px;
		font-size: 13px;
		font-weight: 700;
		color: var(--verde);
	}

	.campo small {
		font-weight: 550;
		color: var(--cinza);
	}

	.campo input {
		border: 2px solid var(--linha);
		background: #fff;
		border-radius: var(--raio-p);
		padding: 9px 11px;
		font-size: 16px;
		width: 100%;
	}

	.campo input:focus {
		border-color: var(--salvia);
		outline: none;
	}

	.acoes {
		display: flex;
		gap: 8px;
	}

	.acoes button {
		flex: 1;
		border: 0;
		border-radius: 12px;
		padding: 12px;
		font-weight: 850;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
	}

	.ouvir {
		background: var(--salvia-claro);
		color: var(--verde);
	}

	.ouvir:hover {
		background: #cfe0c8;
	}

	.salvar {
		background: var(--coral);
		color: var(--verde-escuro);
		box-shadow: 0 3px 0 var(--coral-escuro);
	}

	.salvar:disabled {
		background: var(--salvia-claro);
		box-shadow: none;
		cursor: default;
		color: var(--verde);
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
			border-radius: 22px 22px 0 0;
			padding: 20px 18px calc(18px + env(safe-area-inset-bottom));
		}
	}
</style>
