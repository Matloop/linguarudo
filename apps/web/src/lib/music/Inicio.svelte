<script lang="ts">
	import { resolve } from '$app/paths';
	import { DIFFICULTIES, DIFFICULTY_LABELS, type Difficulty } from './gaps.ts';
	import type { DifficultyCounts } from './session.ts';
	import type { LyricVersion } from './Sincronia.svelte';
	import { formatOffset } from './timeline.ts';
	import type { MusicLanguage } from './wordlists.ts';

	interface Props {
		title: string;
		artist: string;
		lang: MusicLanguage;
		/** A última escolhida; recebe o foco quando a tela abre. */
		difficulty: Difficulty;
		counts: DifficultyCounts;
		status: 'loading' | 'ready' | 'no-lyrics' | 'unavailable' | 'player-error';
		message: string;
		onstart: (difficulty: Difficulty) => void;
		onretry: () => void;
		/** Quanto o vídeo tem a mais que a faixa, se a música nunca foi sincronizada. */
		hint?: number | null;
		/** Outras versões da letra no LRCLIB (a atual incluída). */
		versions?: readonly LyricVersion[];
		version?: number | null;
		onversion?: (id: number) => void;
		onsynchint?: () => void;
		ondismisshint?: () => void;
	}

	let {
		title,
		artist,
		lang,
		difficulty,
		counts,
		status,
		message,
		onstart,
		onretry,
		hint = null,
		versions = [],
		version = null,
		onversion,
		onsynchint,
		ondismisshint
	}: Props = $props();

	let versionsOpen = $state(false);

	const hintText = $derived(
		hint === null
			? ''
			: hint > 0
				? `Este vídeo tem ${formatOffset(hint).slice(1)} a mais que a música. Pode ser uma intro de clipe.`
				: `Este vídeo tem ${formatOffset(hint).slice(1)} a menos que a música. Pode ser outra versão.`
	);

	let rows: Record<string, HTMLButtonElement> = $state({});
	$effect(() => {
		if (status === 'ready') rows[difficulty]?.focus({ preventScroll: true });
	});

	const share = (n: number) => (counts.words > 0 ? (n / counts.words) * 100 : 0);
</script>

<div class="tela">
	<div class="cartao" role="dialog" aria-labelledby="inicio-titulo">
		<div class="topo">
			<span class="olho">Música · Escolha</span>
			<span class="tg" class:it={lang === 'it'}>{lang.toUpperCase()}</span>
		</div>

		<div class="musica">
			<b id="inicio-titulo">{title}</b>
			<span>{artist}</span>
		</div>

		{#if status === 'ready'}
			<div class="difs" role="group" aria-label="Dificuldade">
				{#each DIFFICULTIES as d (d)}
					{@const n = counts.gaps[d]}
					<button type="button" class="dif" bind:this={rows[d]} onclick={() => onstart(d)}>
						<b>{DIFFICULTY_LABELS[d]}</b>
						<span class="n">{n} de {counts.words} palavras</span>
						<span class="barra" aria-hidden="true"><i style:width="{share(n)}%"></i></span>
						<svg class="seta" viewBox="0 0 24 24" aria-hidden="true"
							><path d="M5 12h14M13 6l6 6-6 6" /></svg
						>
					</button>
				{/each}
			</div>
			{#if hint !== null}
				<div class="dica" data-testid="dica-sincronia">
					<p>
						{hintText}
						<small
							>A letra pode sair do tempo. Tente outra versão da letra ou sincronize você mesmo.</small
						>
					</p>
					<div class="dica-bts">
						{#if versions.length > 1}
							<button
								type="button"
								class="pri"
								aria-expanded={versionsOpen}
								onclick={() => (versionsOpen = !versionsOpen)}>Ver outras versões</button
							>
						{/if}
						<button type="button" class:pri={versions.length <= 1} onclick={onsynchint}
							>Sincronizar</button
						>
						<button type="button" class="fant" onclick={ondismisshint}>Ignorar</button>
					</div>
					{#if versionsOpen}
						<ul class="versoes" data-testid="versoes">
							{#each versions as v (v.id)}
								<li>
									<button
										type="button"
										class="fant"
										disabled={v.id === version}
										onclick={() => onversion?.(v.id)}>{v.label}</button
									>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			{/if}
		{:else if status === 'loading'}
			<p class="estado" role="status">Abrindo o vídeo e buscando a letra…</p>
		{:else}
			<p class="estado erro" role="alert">{message}</p>
			<div class="saidas">
				{#if status === 'unavailable' || status === 'player-error'}
					<button class="ir" type="button" onclick={onretry}>Tentar de novo</button>
				{/if}
				<a class="voltar" href={resolve('/musica')}>Escolher outra música</a>
			</div>
		{/if}
	</div>
</div>

<style>
	.versoes {
		list-style: none;
		margin: 8px 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

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
		padding: 26px;
		width: 100%;
		max-width: 560px;
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

	.topo {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 14px;
	}

	.olho {
		font-size: 13px;
		font-weight: 500;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--ink-3);
	}

	.tg {
		font: 600 12px/1 var(--f-head);
		letter-spacing: 0.04em;
		border-radius: 4px;
		padding: 4px 6px;
		background: var(--tile);
		color: var(--ink-2);
		box-shadow: inset 0 0 0 1px var(--line-2);
	}

	.musica {
		background: var(--tile);
		box-shadow: inset 0 0 0 1px var(--line);
		border-radius: var(--r-l);
		padding: 14px 16px;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.musica b {
		font: 600 21px/1.25 var(--f-head);
		letter-spacing: -0.01em;
		overflow-wrap: anywhere;
	}

	.musica span {
		font-size: 15.5px;
		color: var(--ink-2);
	}

	.difs {
		margin-top: 18px;
		display: flex;
		flex-direction: column;
		border-radius: var(--r-l);
		box-shadow: inset 0 0 0 1px var(--line);
		overflow: hidden;
	}

	.dif {
		display: flex;
		align-items: center;
		gap: 14px;
		border: 0;
		border-top: 1px solid var(--line);
		background: none;
		padding: 15px 16px;
		text-align: left;
		color: var(--ink);
		font: inherit;
		transition: background-color 0.15s;
	}

	.dif:first-child {
		border-top: 0;
	}

	.dif:hover,
	.dif:focus-visible {
		background: var(--hover);
	}

	.dif:focus-visible {
		outline: 2px solid var(--ink);
		outline-offset: -2px;
	}

	.dif b {
		flex: 1;
		font: 500 16.5px/1.3 var(--f-head);
	}

	.dif .n {
		font-size: 14.5px;
		color: var(--ink-2);
		font-variant-numeric: tabular-nums;
	}

	.barra {
		width: 46px;
		height: 4px;
		border-radius: 2px;
		background: var(--line-2);
		overflow: hidden;
		flex: none;
	}

	.barra i {
		display: block;
		height: 100%;
		border-radius: 2px;
		background: var(--gold-ink);
	}

	.dif .seta {
		color: var(--ink-3);
		transition:
			transform 0.15s var(--ease),
			color 0.15s;
	}

	.dif:hover .seta,
	.dif:focus-visible .seta {
		color: var(--ink);
		transform: translateX(2px);
	}

	.ir {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		width: 100%;
		height: 48px;
		border: 0;
		border-radius: var(--r-m);
		font: 500 16.5px/1 var(--f-body);
		background: var(--primary);
		color: var(--on-primary);
		margin-top: 20px;
		transition: background-color 0.18s var(--ease);
	}

	.ir:hover {
		background: var(--primary-hover);
	}

	svg {
		width: 19px;
		height: 19px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.7;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.dica {
		margin: 10px 0 0;
		background: var(--gold-soft);
		box-shadow: inset 0 0 0 1px var(--line);
		border-radius: var(--r-m);
		padding: 11px 13px;
		font-size: 15px;
		font-weight: 500;
	}

	.dica p {
		margin: 0;
	}

	.dica small {
		display: block;
		font-weight: 400;
		color: var(--ink-2);
		margin-top: 2px;
	}

	.dica-bts {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 10px;
	}

	.dica-bts button {
		border: 0;
		box-shadow: var(--sh-card);
		background: var(--soft-bg);
		border-radius: var(--r-m);
		height: 34px;
		padding: 0 12px;
		font: inherit;
		font-size: 14.5px;
		font-weight: 500;
		color: var(--ink);
	}

	.dica-bts .pri {
		background: var(--primary);
		box-shadow: none;
		color: var(--on-primary);
	}

	.dica-bts .fant {
		background: none;
		box-shadow: none;
		color: var(--ink-2);
	}

	.estado {
		margin: 22px 0 6px;
		text-align: center;
		font-weight: 500;
		color: var(--ink-2);
	}

	.estado.erro {
		color: var(--terra-ink);
	}

	.saidas {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
	}

	.voltar {
		margin-top: 14px;
		font-size: 15px;
		font-weight: 500;
		color: var(--ink-2);
	}

	@media (max-width: 520px) {
		.cartao {
			padding: 20px 18px;
		}

		.dif {
			padding: 14px;
			gap: 10px;
		}
	}
</style>
