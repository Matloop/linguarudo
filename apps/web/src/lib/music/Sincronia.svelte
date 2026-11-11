<script lang="ts">
	import { formatOffset } from './offset.ts';

	interface Props {
		lines: readonly { start: number; end: number; text: string }[];
		/** Deslocamento atual (s): a letra entra este tanto mais tarde no vídeo. */
		offset: number;
		/** Linha que a pessoa vai marcar com "Começou agora" (= lines.length no fim). */
		target: number;
		/** Tempo do vídeo (s). */
		time: number;
		duration: number;
		playing: boolean;
		feedback: string;
		onmark: () => void;
		onnudge: (delta: number) => void;
		onzero: () => void;
		onrestart: () => void;
		onback: () => void;
		ontoggle: () => void;
		oncancel: () => void;
		onconclude: () => void;
	}

	let {
		lines,
		offset,
		target,
		time,
		duration,
		playing,
		feedback,
		onmark,
		onnudge,
		onzero,
		onrestart,
		onback,
		ontoggle,
		oncancel,
		onconclude
	}: Props = $props();

	const targetLine = $derived(lines[target] ?? null);
	const explain = $derived(
		Math.abs(offset) < 0.05
			? 'letra no tempo da faixa original'
			: offset > 0
				? 'a letra entra mais tarde no vídeo'
				: 'a letra entra mais cedo no vídeo'
	);

	// Faixa: o vídeo inteiro, com a letra (bloco e uma marca por linha) por cima.
	const span = $derived(Math.max(duration, (lines.at(-1)?.end ?? 0) + offset, 1));
	const pct = (s: number) => `${Math.max(0, Math.min(100, (s / span) * 100))}%`;
	const block = $derived.by(() => {
		if (lines.length === 0) return null;
		const a = Math.max(0, lines[0].start + offset);
		const b = Math.max(a, lines[lines.length - 1].end + offset);
		return { left: pct(a), width: `${Math.min(100, ((b - a) / span) * 100)}%` };
	});
	const clock = (s: number) => {
		const v = Math.max(0, s);
		return `${Math.floor(v / 60)}:${String(Math.floor(v % 60)).padStart(2, '0')}`;
	};
</script>

<section class="sinc" aria-label="Sincronizar a letra">
	<div class="cab">
		<h2>Sincronizar letra</h2>
		<p>O jogo está pausado. Ouça o vídeo e toque quando a linha começar a ser cantada.</p>
	</div>

	<div class="corpo">
		<div class="alvo">
			<small>Próxima linha</small>
			<p class="txt" data-testid="sinc-alvo">
				{targetLine?.text ?? 'Fim da letra. Toque numa linha acima para marcar outra.'}
			</p>
			<button class="marcar" type="button" onclick={onmark} disabled={!targetLine}>
				Começou agora <kbd>Espaço</kbd>
			</button>
			<p class="fb" aria-live="polite">{feedback}</p>
		</div>

		<div class="ajuste">
			<div class="leitura">
				<b data-testid="sinc-offset">{formatOffset(offset)}</b>
				<span>{explain}</span>
			</div>
			<div class="fino" role="group" aria-label="Ajuste fino">
				<button type="button" onclick={() => onnudge(-1)}>−1 s</button>
				<button type="button" onclick={() => onnudge(-0.1)} aria-label="Letra 0,1 s mais cedo"
					>−0,1</button
				>
				<button type="button" onclick={() => onnudge(0.1)} aria-label="Letra 0,1 s mais tarde"
					>+0,1</button
				>
				<button type="button" onclick={() => onnudge(1)}>+1 s</button>
			</div>
			<div class="faixa" aria-hidden="true">
				<div class="tr">
					{#if block}<i class="bloco" style:left={block.left} style:width={block.width}></i>{/if}
					{#each lines as l, i (i)}
						<i class="mk" class:on={i === target} style:left={pct(l.start + offset)}></i>
					{/each}
					<i class="ph" style:left={pct(time)}></i>
				</div>
				<div class="leg">
					<span>0:00</span><span>a letra sobre o vídeo</span><span>{clock(span)}</span>
				</div>
			</div>
		</div>
	</div>

	<div class="pe">
		<button class="bt" type="button" onclick={onrestart}>Do começo</button>
		<button class="bt" type="button" onclick={onback}>−5 s</button>
		<button class="bt" type="button" onclick={ontoggle}>{playing ? 'Pausar' : 'Tocar'}</button>
		<span class="esp"></span>
		<button class="bt fant" type="button" onclick={onzero}>Zerar</button>
		<button class="bt" type="button" onclick={oncancel}>Cancelar</button>
		<button class="bt pri" type="button" onclick={onconclude}>Concluir</button>
	</div>
	<p class="teclas">
		<kbd>Espaço</kbd> marca · <kbd>←</kbd><kbd>→</kbd> 0,1 s · <kbd>Shift</kbd>+seta 1 s ·
		<kbd>↑</kbd><kbd>↓</kbd> troca a linha · <kbd>P</kbd> pausa · <kbd>Enter</kbd> conclui ·
		<kbd>Esc</kbd> cancela
	</p>
</section>

<style>
	.sinc {
		background: var(--panel);
		box-shadow: var(--sh-panel);
		border-radius: var(--r-l);
		padding: 16px 18px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.cab h2 {
		margin: 0;
		font: 600 17px/1.3 var(--f-head);
	}

	.cab p {
		margin: 2px 0 0;
		font-size: 14.5px;
		color: var(--ink-2);
	}

	.corpo {
		display: grid;
		grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
		gap: 14px;
	}

	.alvo {
		background: var(--tile);
		box-shadow: inset 0 0 0 1px var(--line);
		border-radius: var(--r-l);
		padding: 12px 14px;
	}

	.alvo small {
		font-size: 12.5px;
		font-weight: 500;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--gold-ink);
	}

	.alvo .txt {
		margin: 4px 0 12px;
		font: 600 18.5px/1.3 var(--f-head);
	}

	.marcar {
		width: 100%;
		height: 48px;
		border: 0;
		border-radius: var(--r-m);
		background: var(--primary);
		color: var(--on-primary);
		font: 500 16.5px/1 var(--f-body);
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 10px;
		transition:
			transform 0.08s,
			background-color 0.18s;
	}

	.marcar:hover:not(:disabled) {
		background: var(--primary-hover);
	}

	.marcar:active {
		transform: scale(0.98);
	}

	.marcar:disabled {
		opacity: 0.4;
	}

	.marcar kbd {
		background: var(--kbd-on-primary);
		color: var(--kbd-on-primary-ink);
		box-shadow: none;
	}

	.fb {
		min-height: 18px;
		margin: 8px 0 0;
		font-size: 14px;
		color: var(--ok-ink);
	}

	.ajuste {
		display: flex;
		flex-direction: column;
		gap: 10px;
		min-width: 0;
	}

	.leitura {
		display: flex;
		align-items: baseline;
		gap: 10px;
		flex-wrap: wrap;
	}

	.leitura b {
		font: 600 32px/1.1 var(--f-head);
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.02em;
	}

	.leitura span {
		font-size: 14.5px;
		color: var(--ink-2);
	}

	.fino {
		display: flex;
		gap: 6px;
	}

	.fino button,
	.bt {
		border: 0;
		border-radius: var(--r-m);
		background: var(--soft-bg);
		box-shadow: var(--sh-card);
		color: var(--ink);
		font: inherit;
		font-weight: 500;
		font-size: 14.5px;
		height: 36px;
		padding: 0 12px;
		transition: background-color 0.15s;
	}

	.fino button {
		flex: 1;
		font-variant-numeric: tabular-nums;
	}

	.fino button:hover,
	.bt:hover {
		background: var(--soft-hover);
	}

	.tr {
		position: relative;
		height: 28px;
		border-radius: var(--r-s);
		background: var(--sunk);
		box-shadow: inset 0 0 0 1px var(--line);
		overflow: hidden;
	}

	.tr i {
		position: absolute;
	}

	.bloco {
		top: 6px;
		bottom: 6px;
		background: var(--ok-soft);
		border-radius: 3px;
		transition: left 0.25s;
	}

	.mk {
		top: 4px;
		bottom: 4px;
		width: 2px;
		margin-left: -1px;
		background: var(--ok-ink);
		transition: left 0.25s;
	}

	.mk.on {
		width: 3px;
		background: var(--gold-ink);
	}

	.ph {
		top: 0;
		bottom: 0;
		width: 2px;
		background: var(--ink);
	}

	.leg {
		display: flex;
		justify-content: space-between;
		margin-top: 4px;
		font-size: 12.5px;
		font-variant-numeric: tabular-nums;
		color: var(--ink-3);
	}

	.pe {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
	}

	.esp {
		flex: 1;
	}

	.bt.fant {
		background: none;
		box-shadow: none;
		color: var(--ink-2);
	}

	.bt.fant:hover {
		background: var(--hover);
		color: var(--ink);
	}

	.bt.pri {
		background: var(--primary);
		box-shadow: none;
		color: var(--on-primary);
	}

	.bt.pri:hover {
		background: var(--primary-hover);
	}

	.teclas {
		margin: 0;
		font-size: 13.5px;
		color: var(--ink-3);
		line-height: 2;
	}

	@media (max-width: 860px) {
		.sinc {
			margin: 0 -12px;
			border-radius: var(--r-l) var(--r-l) 0 0;
			padding: 12px 12px calc(14px + env(safe-area-inset-bottom));
		}

		.cab p,
		.teclas,
		.leg {
			display: none;
		}

		.corpo {
			grid-template-columns: 1fr;
			gap: 10px;
		}

		.leitura b {
			font-size: 26px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.bloco,
		.mk {
			transition: none;
		}
	}
</style>
