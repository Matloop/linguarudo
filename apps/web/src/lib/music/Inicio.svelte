<script lang="ts">
	import { resolve } from '$app/paths';
	import { DIFFICULTIES, DIFFICULTY_LABELS, type Difficulty } from './gaps.ts';
	import type { LyricVersion } from './Sincronia.svelte';
	import { formatOffset } from './timeline.ts';
	import type { MusicLanguage } from './wordlists.ts';

	interface Props {
		title: string;
		artist: string;
		lang: MusicLanguage;
		difficulty: Difficulty;
		/** Quantas lacunas cada dificuldade tem nesta letra, e quantas são palavras do banco. */
		counts: Record<Difficulty, { gaps: number; fromBank: number }>;
		status: 'loading' | 'ready' | 'no-lyrics' | 'unavailable' | 'player-error';
		message: string;
		onstart: () => void;
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
		difficulty = $bindable(),
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

	const current = $derived(counts[difficulty]);
	let go: HTMLButtonElement | undefined = $state();
	$effect(() => {
		if (status === 'ready') go?.focus({ preventScroll: true });
	});
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
			<div class="rot">Dificuldade <small>muda quantas lacunas há</small></div>
			<div class="difs" role="radiogroup" aria-label="Dificuldade">
				{#each DIFFICULTIES as d (d)}
					<button
						type="button"
						class="dif"
						role="radio"
						aria-checked={difficulty === d}
						onclick={() => (difficulty = d)}
					>
						<b>{DIFFICULTY_LABELS[d]}</b>
						<span>{counts[d].gaps} {counts[d].gaps === 1 ? 'lacuna' : 'lacunas'}</span>
					</button>
				{/each}
			</div>
			<p class="prior">
				<i aria-hidden="true"></i>
				<span>
					<b>{current.fromBank} de {current.gaps}</b> lacunas são palavras que já estão no seu
					banco. Elas vêm primeiro{current.fromBank < current.gaps
						? '; o resto completa a letra'
						: ''}.
				</span>
			</p>
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
			<button class="ir" type="button" bind:this={go} onclick={onstart}>
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8z" /></svg>
				Começar
			</button>
			<p class="nota">
				O vídeo toca sem parar. Se a linha acabar sem resposta, ele espera 10 segundos por você.
			</p>
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

	.rot {
		font-size: 15px;
		font-weight: 500;
		color: var(--ink);
		margin: 22px 0 8px;
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 8px;
	}

	.rot small {
		color: var(--ink-3);
		font-size: 14px;
		font-weight: 400;
	}

	.difs {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 8px;
	}

	.dif {
		border: 0;
		background: var(--tile);
		box-shadow: inset 0 0 0 1px var(--line);
		border-radius: var(--r-l);
		padding: 12px 14px;
		text-align: left;
		color: var(--ink);
		transition:
			background-color 0.15s,
			box-shadow 0.15s;
	}

	.dif:hover {
		background: var(--hover);
	}

	.dif b {
		display: block;
		font: 600 18px/1.3 var(--f-head);
	}

	.dif span {
		display: block;
		font-size: 14px;
		color: var(--ink-2);
	}

	.dif[aria-checked='true'] {
		background: var(--sel);
		box-shadow: inset 0 0 0 1.5px var(--ink);
	}

	.prior {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		background: var(--gold-soft);
		border-radius: var(--r-m);
		padding: 11px 13px;
		margin: 10px 0 0;
		font-size: 15px;
		color: var(--ink-2);
	}

	.prior :global(b) {
		color: var(--ink);
		font-weight: 600;
	}

	.prior i {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--gold-ink);
		flex: none;
		margin-top: 8px;
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

	.nota {
		text-align: center;
		font-size: 14px;
		color: var(--ink-3);
		margin: 12px 0 0;
		text-wrap: pretty;
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

		.difs {
			gap: 6px;
		}

		.dif {
			padding: 10px;
		}
	}
</style>
