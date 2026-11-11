<script lang="ts">
	import { resolve } from '$app/paths';
	import mascote from '#lib/assets/mascote.png';
	import type { SessionGap } from './session.ts';

	interface Props {
		correct: number;
		total: number;
		score: number;
		maxCombo: number;
		/** Lacunas erradas, na ordem da música. */
		wrong: SessionGap[];
		/** Palavras que já estão no banco (inclusive as salvas agora). */
		isInBank: (key: string) => boolean;
		/** Palavras salvas nesta partida. */
		saved: { key: string; sense: string }[];
		senseOf: (key: string) => string;
		bankTotal: number;
		saving: boolean;
		message: string;
		onsaveall: () => void;
		onagain: () => void;
	}

	let {
		correct,
		total,
		score,
		maxCombo,
		wrong,
		isInBank,
		saved,
		senseOf,
		bankTotal,
		saving,
		message,
		onsaveall,
		onagain
	}: Props = $props();

	const missing = $derived(wrong.filter((g) => !isInBank(g.key)));
	const perfect = $derived(total > 0 && correct === total);

	let gulp = $state(false);
	let lastSaved = 0;
	$effect(() => {
		if (saved.length > lastSaved) {
			gulp = false;
			// Reinicia a animação do Rudo a cada palavra nova.
			requestAnimationFrame(() => (gulp = true));
		}
		lastSaved = saved.length;
	});

	let again: HTMLButtonElement | undefined = $state();
	$effect(() => again?.focus({ preventScroll: true }));
</script>

<div class="tela" role="presentation">
	<div class="cartao" role="dialog" aria-labelledby="resumo-titulo">
		<div class="rudo" class:feliz={perfect} class:engole={gulp}>
			<img src={mascote} alt="" width="372" height="352" />
		</div>
		<h2 id="resumo-titulo">{perfect ? 'Todas de primeira!' : 'Música fechada!'}</h2>
		<p class="sub">
			{#if perfect}
				O Rudo até mudou de cor.
			{:else if wrong.length > 0}
				As que você errou ficam para revisar. Errar aqui não custa nada.
			{:else}
				Fechou a música.
			{/if}
		</p>

		<div class="stats">
			<div class="stat"><b>{correct}/{total}</b><span>de primeira</span></div>
			<div class="stat err"><b>{wrong.length}</b><span>para revisar</span></div>
			<div class="stat sal"><b>{saved.length}</b><span>salvas</span></div>
		</div>

		<div class="grupo">
			<h3>
				Para revisar
				{#if wrong.length > 0}
					<small>
						{missing.length > 0 ? 'salve para entrarem na revisão' : 'todas já estão no banco'}
					</small>
				{/if}
			</h3>
			<div class="chips">
				{#each wrong as gap (gap.line)}
					{@const inBank = isInBank(gap.key)}
					<span class="chip" class:nobk={inBank} class:err={!inBank}>
						{gap.key}
						{#if senseOf(gap.key)}<em>{senseOf(gap.key)}</em>{/if}
						{#if inBank}<span class="mini"
								>{saved.some((s) => s.key === gap.key) ? 'salva' : 'no banco'}</span
							>{/if}
					</span>
				{:else}
					<span class="chip vazio">Nenhuma. Tudo certo.</span>
				{/each}
			</div>
		</div>

		<div class="grupo">
			<h3>Salvas nesta música</h3>
			<div class="chips">
				{#each saved as s (s.key)}
					<span class="chip sal"
						>{s.key}{#if s.sense}<em>{s.sense}</em>{/if}</span
					>
				{:else}
					<span class="chip vazio">Toque numa palavra da letra para salvar.</span>
				{/each}
			</div>
		</div>

		<p class="placar">
			<span><b>{score}</b> pontos</span>
			<span aria-hidden="true">·</span>
			<span>combo máximo <b>×{maxCombo}</b></span>
			<span aria-hidden="true">·</span>
			<span>banco: <b>{bankTotal}</b></span>
		</p>
		<p class="mensagem" role="status">{message}</p>

		<div class="acoes">
			<button
				class="coral"
				type="button"
				onclick={onsaveall}
				disabled={missing.length === 0 || saving}
			>
				{#if saving}
					Salvando…
				{:else if missing.length > 0}
					<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
					Salvar {missing.length === 1 ? 'a errada' : `as ${missing.length} erradas`}
				{:else}
					<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
					{wrong.length > 0 ? 'Erradas no banco' : 'Nenhuma errada'}
				{/if}
			</button>
			<button class="verde" type="button" bind:this={again} onclick={onagain}>
				<svg viewBox="0 0 24 24" aria-hidden="true"
					><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg
				>
				Jogar de novo
			</button>
		</div>
		<a class="voltar" href={resolve('/musica')}>Voltar às músicas</a>
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
		max-width: 600px;
		text-align: center;
		animation: surge 0.3s;
		margin: auto;
	}

	@keyframes surge {
		from {
			opacity: 0;
			transform: translateY(8px) scale(0.97);
		}
	}

	.rudo {
		width: 140px;
		margin: -6px auto 0;
	}

	.rudo img {
		width: 140px;
		height: auto;
		display: block;
	}

	.rudo.feliz img {
		animation: cor 5s ease-in-out infinite;
	}

	@keyframes cor {
		50% {
			filter: hue-rotate(-60deg) saturate(1.3);
		}
	}

	.rudo.engole img {
		animation: engole 0.4s;
	}

	@keyframes engole {
		30% {
			transform: scale(1.08, 0.92);
		}
		65% {
			transform: scale(0.97, 1.04);
		}
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

	.stats {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 10px;
		margin: 18px 0 16px;
	}

	.stat {
		background: #fff;
		border-radius: 16px;
		padding: 12px 8px;
		border: 1.5px solid var(--linha);
	}

	.stat b {
		display: block;
		font-size: 26px;
		color: var(--verde);
		line-height: 1.15;
	}

	.stat span {
		font-size: 13px;
		color: var(--tinta-suave);
		font-weight: 650;
	}

	.stat.err b {
		color: var(--coral-escuro);
	}

	.stat.sal b {
		color: #a86f22;
	}

	.grupo {
		text-align: left;
		margin-top: 12px;
	}

	.grupo h3 {
		margin: 0;
		font-size: 14px;
		font-weight: 850;
		color: var(--verde);
		display: flex;
		align-items: baseline;
		gap: 8px;
		flex-wrap: wrap;
	}

	.grupo h3 small {
		font-weight: 650;
		color: var(--tinta-suave);
		font-size: 13px;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 8px;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		background: #fff;
		border: 1.5px solid var(--linha);
		border-radius: 99px;
		padding: 4px 12px;
		font-weight: 750;
		font-size: 15px;
	}

	.chip em {
		font-style: normal;
		font-weight: 600;
		color: var(--tinta-suave);
		font-size: 13px;
	}

	.chip.err {
		background: var(--coral-claro);
		border-color: #f3c3be;
	}

	.chip.sal {
		background: var(--creme-escuro);
		border-color: #ebd3a8;
	}

	.chip.nobk {
		background: var(--salvia-claro);
		border-color: #c7d9c0;
	}

	.chip .mini {
		font-size: 11px;
		font-weight: 850;
		color: var(--verde);
		background: #fff;
		border-radius: 6px;
		padding: 1px 6px;
	}

	.chip.vazio {
		background: none;
		border-style: dashed;
		color: var(--tinta-suave);
		font-weight: 600;
	}

	.placar {
		display: flex;
		justify-content: center;
		flex-wrap: wrap;
		gap: 4px 14px;
		font-size: 13px;
		color: var(--tinta-suave);
		font-weight: 700;
		margin: 14px 0 0;
	}

	.placar b {
		color: var(--verde);
	}

	.mensagem {
		min-height: 1.4em;
		margin: 6px 0 0;
		font-size: 14px;
		font-weight: 700;
		color: var(--verde);
	}

	.acoes {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
		margin-top: 8px;
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

	.coral:disabled {
		background: var(--salvia-claro);
		box-shadow: none;
		color: var(--tinta-suave);
		cursor: default;
	}

	.verde {
		background: var(--verde);
		color: var(--creme);
		box-shadow: 0 4px 0 var(--verde-escuro);
	}

	.acoes button:active:not(:disabled) {
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

	.voltar {
		display: inline-block;
		margin-top: 12px;
		font-size: 14px;
		font-weight: 750;
		color: var(--tinta-suave);
	}

	@media (max-width: 520px) {
		.cartao {
			padding: 18px 16px;
		}

		.acoes {
			grid-template-columns: 1fr;
		}

		.stat b {
			font-size: 22px;
		}
	}
</style>
