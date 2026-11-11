<script lang="ts">
	import Mark from '#lib/ui/Mark.svelte';

	interface Props {
		/** Texto da linha em que o tempo acabou. */
		line: string;
		correct: number;
		total: number;
		answered: number;
		wrong: number;
		onretry: () => void;
		oncontinue: () => void;
		onleave: () => void;
	}

	let { line, correct, total, answered, wrong, onretry, oncontinue, onleave }: Props = $props();

	let first: HTMLButtonElement | undefined = $state();
	$effect(() => first?.focus({ preventScroll: true }));
</script>

<div class="tela" role="presentation">
	<div class="cartao" role="alertdialog" aria-labelledby="fim-titulo" aria-describedby="fim-sub">
		<span class="simbolo"><Mark /></span>
		<h2 id="fim-titulo">Fim de jogo</h2>
		<p id="fim-sub" class="sub">
			O tempo acabou sem resposta para a lacuna de
			<q>{line}</q>
		</p>

		<p class="placar">
			<span><b>{correct}</b> de {total} certas</span>
			<span aria-hidden="true">·</span>
			<span><b>{answered}</b> respondidas</span>
			{#if wrong > 0}
				<span aria-hidden="true">·</span>
				<span><b>{wrong}</b> para revisar</span>
			{/if}
		</p>

		<div class="acoes">
			<button class="coral" type="button" bind:this={first} onclick={onretry}>
				<svg viewBox="0 0 24 24" aria-hidden="true"
					><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg
				>
				Tentar de novo
			</button>
			<button class="verde" type="button" onclick={oncontinue}>
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8z" /></svg>
				Continuar jogando
			</button>
		</div>
		<button class="sair" type="button" onclick={onleave}>Sair</button>
	</div>
</div>

<style>
	.tela {
		position: fixed;
		inset: 0;
		z-index: 50;
		background: var(--scrim);
		backdrop-filter: blur(6px);
		display: grid;
		place-items: center;
		padding: 20px;
		overflow: auto;
	}

	.cartao {
		background: var(--raise);
		color: var(--ink);
		border-radius: 16px;
		box-shadow: var(--sh-pop);
		padding: 26px 26px 20px;
		width: 100%;
		max-width: 520px;
		text-align: center;
		animation: surge 0.3s var(--ease);
	}

	:global(.tema-escuro) .cartao {
		background: var(--raise-2);
	}

	@keyframes surge {
		from {
			opacity: 0;
			transform: translateY(8px) scale(0.98);
		}
	}

	.simbolo {
		display: block;
		width: 40px;
		height: 44px;
		margin: 4px auto 14px;
		color: var(--ink-3);
	}

	.simbolo :global(svg) {
		width: 100%;
		height: 100%;
		display: block;
	}

	h2 {
		margin: 4px 0 4px;
		font: 600 30px/1.2 var(--f-head);
		letter-spacing: -0.02em;
	}

	.sub {
		margin: 0;
		color: var(--ink-2);
		text-wrap: pretty;
	}

	q {
		font-weight: 600;
		color: var(--ink);
	}

	.placar {
		display: flex;
		justify-content: center;
		flex-wrap: wrap;
		gap: 4px 14px;
		font-size: 15px;
		color: var(--ink-3);
		margin: 16px 0 0;
	}

	.placar b {
		color: var(--ink);
		font-weight: 600;
	}

	.acoes {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
		margin-top: 20px;
	}

	.acoes button {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		border: 0;
		border-radius: var(--r-m);
		height: 46px;
		padding: 0 12px;
		font: 500 16px/1 var(--f-body);
		transition: background-color 0.18s var(--ease);
	}

	.coral {
		background: var(--primary);
		color: var(--on-primary);
	}

	.coral:hover {
		background: var(--primary-hover);
	}

	.verde {
		background: var(--soft-bg);
		box-shadow: var(--sh-card);
		color: var(--ink);
	}

	.verde:hover {
		background: var(--soft-hover);
	}

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

	.sair {
		margin-top: 12px;
		border: 0;
		background: none;
		font-size: 15px;
		font-weight: 500;
		color: var(--ink-2);
		padding: 6px 12px;
		border-radius: var(--r-m);
	}

	.sair:hover {
		background: var(--hover);
		color: var(--ink);
	}

	@media (max-width: 520px) {
		.acoes {
			grid-template-columns: 1fr;
		}
	}
</style>
