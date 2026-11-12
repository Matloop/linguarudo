<script lang="ts">
	import { resolve } from '$app/paths';
	import Mark from '#lib/ui/Mark.svelte';
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
		/** Faixa seguinte, quando a música faz parte de um álbum. */
		next?: { title: string; href: string } | null;
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
		onagain,
		next = null
	}: Props = $props();

	const missing = $derived(wrong.filter((g) => !isInBank(g.key)));
	const perfect = $derived(total > 0 && correct === total);

	let gulp = $state(false);
	let lastSaved = 0;
	$effect(() => {
		if (saved.length > lastSaved) {
			gulp = false;
			// Reinicia a animação do símbolo a cada palavra nova.
			requestAnimationFrame(() => (gulp = true));
		}
		lastSaved = saved.length;
	});

	let again: HTMLButtonElement | undefined = $state();
	$effect(() => again?.focus({ preventScroll: true }));
</script>

<div class="tela" role="presentation">
	<div class="cartao" role="dialog" aria-labelledby="resumo-titulo">
		<div class="simbolo" class:engole={gulp}>
			<Mark />
		</div>
		<h2 id="resumo-titulo">{perfect ? 'Todas de primeira!' : 'Música fechada!'}</h2>
		<p class="sub">
			{#if perfect}
				Nenhum erro na música inteira.
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
				{#each wrong as gap (gap.key)}
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
		{#if next}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- href já vem resolvido do load -->
			<a class="proxima" href={next.href} data-sveltekit-reload>
				<span>Próxima faixa</span>
				<b>{next.title}</b>
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
			</a>
		{/if}
		<a class="voltar" href={resolve('/musica')}>Voltar às músicas</a>
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
		max-width: 600px;
		text-align: center;
		animation: surge 0.3s var(--ease);
		margin: auto;
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
		width: 44px;
		height: 48px;
		margin: 4px auto 14px;
		color: var(--ink);
	}

	.simbolo :global(svg) {
		width: 100%;
		height: 100%;
		display: block;
	}

	.simbolo.engole {
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
		margin: 4px 0 4px;
		font: 600 30px/1.2 var(--f-head);
		letter-spacing: -0.02em;
	}

	.sub {
		margin: 0;
		color: var(--ink-2);
		text-wrap: pretty;
	}

	.stats {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 8px;
		margin: 20px 0 16px;
	}

	.stat {
		background: var(--tile);
		box-shadow: inset 0 0 0 1px var(--line);
		border-radius: var(--r-l);
		padding: 14px 8px 12px;
	}

	.stat b {
		display: block;
		font: 600 28px/1.15 var(--f-head);
		font-variant-numeric: tabular-nums;
	}

	.stat span {
		font-size: 14px;
		color: var(--ink-2);
	}

	.stat.err b {
		color: var(--terra-ink);
	}

	.stat.sal b {
		color: var(--gold-ink);
	}

	.grupo {
		text-align: left;
		margin-top: 14px;
	}

	.grupo h3 {
		margin: 0;
		font-size: 15px;
		font-weight: 500;
		color: var(--ink);
		display: flex;
		align-items: baseline;
		gap: 8px;
		flex-wrap: wrap;
	}

	.grupo h3 small {
		font-weight: 400;
		color: var(--ink-3);
		font-size: 14px;
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
		background: var(--tile);
		box-shadow: inset 0 0 0 1px var(--line);
		border-radius: 99px;
		padding: 5px 12px;
		font-weight: 500;
		font-size: 16px;
	}

	.chip em {
		font-style: normal;
		font-weight: 400;
		color: var(--ink-2);
		font-size: 14px;
	}

	.chip.err {
		background: var(--terra-soft);
	}

	.chip.sal {
		background: var(--gold-soft);
	}

	.chip.nobk {
		background: var(--ok-soft);
	}

	.chip .mini {
		font-size: 12px;
		font-weight: 500;
		color: var(--ink-2);
		background: var(--sunk);
		border-radius: 4px;
		padding: 1px 6px;
	}

	.chip.vazio {
		background: none;
		box-shadow: none;
		border: 1.5px dashed var(--line-2);
		color: var(--ink-3);
		font-weight: 400;
	}

	.placar {
		display: flex;
		justify-content: center;
		flex-wrap: wrap;
		gap: 4px 14px;
		font-size: 14.5px;
		color: var(--ink-3);
		margin: 16px 0 0;
	}

	.placar b {
		color: var(--ink);
		font-weight: 600;
	}

	.mensagem {
		min-height: 1.4em;
		margin: 6px 0 0;
		font-size: 15px;
		font-weight: 500;
		color: var(--ok-ink);
	}

	.acoes {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
		margin-top: 10px;
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

	.coral:hover:not(:disabled) {
		background: var(--primary-hover);
	}

	.coral:disabled {
		background: var(--tile);
		box-shadow: inset 0 0 0 1px var(--line);
		color: var(--ink-3);
		cursor: default;
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

	.proxima {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-top: 8px;
		padding: 12px 14px;
		border-radius: var(--r-m);
		background: var(--tile);
		box-shadow: inset 0 0 0 1px var(--line);
		color: var(--ink);
		text-decoration: none;
		text-align: left;
		transition: background-color 0.18s var(--ease);
	}

	.proxima:hover {
		background: var(--hover);
	}

	.proxima span {
		font-size: 14px;
		color: var(--ink-3);
		flex: none;
	}

	.proxima b {
		flex: 1;
		min-width: 0;
		font: 600 16px/1.3 var(--f-head);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.voltar {
		display: inline-block;
		margin-top: 14px;
		font-size: 15px;
		font-weight: 500;
		color: var(--ink-2);
	}

	@media (max-width: 520px) {
		.cartao {
			padding: 20px 16px;
		}

		.acoes {
			grid-template-columns: 1fr;
		}

		.stat b {
			font-size: 24px;
		}
	}
</style>
