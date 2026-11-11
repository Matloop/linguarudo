<script lang="ts">
	import mascote from '#lib/assets/mascote.png';

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
		<img src={mascote} alt="" width="372" height="352" />
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
		background: #073026f2;
		display: grid;
		place-items: center;
		padding: 20px;
		overflow: auto;
	}

	.cartao {
		background: var(--creme);
		color: var(--verde-escuro);
		border-radius: 28px;
		padding: 22px 26px 20px;
		width: 100%;
		max-width: 520px;
		text-align: center;
		animation: surge 0.3s;
	}

	@keyframes surge {
		from {
			opacity: 0;
			transform: translateY(8px) scale(0.97);
		}
	}

	img {
		width: 120px;
		height: auto;
		display: block;
		margin: -4px auto 0;
		filter: grayscale(0.35);
	}

	h2 {
		margin: 4px 0 2px;
		font-size: 28px;
		color: var(--verde);
	}

	.sub {
		margin: 0;
		color: var(--tinta-suave);
		font-weight: 600;
	}

	q {
		font-weight: 800;
		color: var(--verde);
	}

	.placar {
		display: flex;
		justify-content: center;
		flex-wrap: wrap;
		gap: 4px 12px;
		font-size: 14px;
		color: var(--tinta-suave);
		font-weight: 700;
		margin: 14px 0 0;
	}

	.placar b {
		color: var(--verde);
	}

	.acoes {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
		margin-top: 18px;
	}

	.acoes button {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		border: 0;
		border-radius: 16px;
		padding: 14px 10px;
		font-weight: 850;
		font-size: 16px;
	}

	.coral {
		background: var(--coral);
		color: var(--verde-escuro);
		box-shadow: 0 4px 0 var(--coral-escuro);
	}

	.verde {
		background: var(--verde);
		color: var(--creme);
		box-shadow: 0 4px 0 var(--verde-escuro);
	}

	.acoes button:active {
		transform: translateY(3px);
		box-shadow: none;
	}

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

	.sair {
		margin-top: 12px;
		border: 0;
		background: none;
		font-size: 15px;
		font-weight: 750;
		color: var(--tinta-suave);
		text-decoration: underline;
		padding: 6px 12px;
	}

	@media (max-width: 520px) {
		.acoes {
			grid-template-columns: 1fr;
		}
	}
</style>
