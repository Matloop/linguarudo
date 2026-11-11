<script lang="ts">
	import { resolve } from '$app/paths';
	import { DIFFICULTIES, DIFFICULTY_LABELS, type Difficulty } from './gaps.ts';
	import { formatOffset } from './offset.ts';
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
		onapplyhint?: () => void;
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
		onapplyhint,
		onsynchint,
		ondismisshint
	}: Props = $props();

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
						<small>A letra pode sair do tempo. Aplique o palpite ou sincronize você mesmo.</small>
					</p>
					<div class="dica-bts">
						<button type="button" class="pri" onclick={onapplyhint}
							>Aplicar {formatOffset(hint)}</button
						>
						<button type="button" onclick={onsynchint}>Sincronizar</button>
						<button type="button" class="fant" onclick={ondismisshint}>Ignorar</button>
					</div>
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
		padding: 26px;
		width: 100%;
		max-width: 560px;
		animation: surge 0.3s;
		margin: auto;
	}

	@keyframes surge {
		from {
			opacity: 0;
			transform: translateY(8px) scale(0.97);
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
		font-size: 12px;
		font-weight: 850;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--coral-escuro);
	}

	.tg {
		font-size: 12px;
		font-weight: 850;
		letter-spacing: 0.05em;
		border-radius: 6px;
		padding: 2px 8px;
		background: var(--salvia-claro);
		color: var(--verde);
	}

	.tg.it {
		background: #f6e2c2;
		color: #7a4b12;
	}

	.musica {
		background: #fff;
		border: 1.5px solid var(--linha);
		border-radius: 18px;
		padding: 14px 16px;
		display: flex;
		flex-direction: column;
	}

	.musica b {
		font-size: 20px;
		color: var(--verde);
		overflow-wrap: anywhere;
	}

	.musica span {
		font-size: 14px;
		color: var(--tinta-suave);
		font-weight: 650;
	}

	.rot {
		font-size: 14px;
		font-weight: 850;
		color: var(--verde);
		margin: 20px 0 8px;
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 8px;
	}

	.rot small {
		font-weight: 650;
		color: var(--tinta-suave);
		font-size: 13px;
	}

	.difs {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 10px;
	}

	.dif {
		border: 2px solid var(--linha);
		background: #fff;
		border-radius: 16px;
		padding: 12px;
		text-align: left;
		color: var(--verde-escuro);
	}

	.dif b {
		display: block;
		font-size: 17px;
	}

	.dif span {
		display: block;
		font-size: 13px;
		color: var(--tinta-suave);
		font-weight: 650;
	}

	.dif[aria-checked='true'] {
		border-color: var(--verde);
		background: var(--salvia-claro);
	}

	.prior {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		background: var(--creme-escuro);
		border-radius: 14px;
		padding: 10px 12px;
		margin: 10px 0 0;
		font-size: 14px;
		font-weight: 650;
		color: #5c4320;
	}

	.prior i {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--ouro);
		flex: none;
		margin-top: 5px;
	}

	.ir {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		width: 100%;
		border: 0;
		border-radius: 16px;
		padding: 15px;
		font-weight: 850;
		font-size: 17px;
		background: var(--coral);
		color: var(--verde-escuro);
		box-shadow: 0 4px 0 var(--coral-escuro);
		margin-top: 20px;
	}

	.ir:active {
		transform: translateY(3px);
		box-shadow: 0 1px 0 var(--coral-escuro);
	}

	svg {
		width: 20px;
		height: 20px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2.2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.dica {
		margin: 10px 0 0;
		border: 1.5px solid var(--ouro);
		border-radius: 14px;
		padding: 10px 12px;
		font-size: 14px;
		font-weight: 650;
	}

	.dica p {
		margin: 0;
	}

	.dica small {
		display: block;
		font-weight: 550;
		color: var(--tinta-suave);
		margin-top: 2px;
	}

	.dica-bts {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 8px;
	}

	.dica-bts button {
		border: 1px solid #0000001f;
		background: none;
		border-radius: 10px;
		padding: 7px 12px;
		font: inherit;
		font-size: 13.5px;
		font-weight: 750;
		color: var(--verde-escuro);
	}

	.dica-bts .pri {
		background: var(--verde);
		border-color: transparent;
		color: var(--creme);
	}

	.dica-bts .fant {
		border-color: transparent;
		color: var(--tinta-suave);
	}

	.nota {
		text-align: center;
		font-size: 13px;
		color: var(--tinta-suave);
		font-weight: 600;
		margin: 10px 0 0;
	}

	.estado {
		margin: 22px 0 6px;
		text-align: center;
		font-weight: 700;
		color: var(--tinta-suave);
	}

	.estado.erro {
		color: var(--verde-escuro);
	}

	.saidas {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
	}

	.voltar {
		margin-top: 14px;
		font-size: 14px;
		font-weight: 750;
		color: var(--tinta-suave);
	}

	@media (max-width: 520px) {
		.cartao {
			padding: 20px 18px;
		}

		.difs {
			gap: 8px;
		}

		.dif {
			padding: 10px;
		}
	}
</style>
