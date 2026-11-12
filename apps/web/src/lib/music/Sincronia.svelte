<script lang="ts">
	import type { LineView, MusicEvent, SyncView } from './controller.ts';
	import { formatOffset } from './timeline.ts';

	export interface LyricVersion {
		id: number;
		label: string;
	}

	interface Props {
		sync: SyncView;
		lines: readonly LineView[];
		/** Tempo do vídeo (s). */
		time: number;
		duration: number;
		/** null = o navegador não sabe sincronizar sozinho (o botão some). */
		auto: { running: boolean; message: string } | null;
		versions: readonly LyricVersion[];
		version: number | null;
		onsend: (event: MusicEvent) => void;
		onauto: () => void;
		onversion: (id: number) => void;
	}

	let { sync, lines, time, duration, auto, versions, version, onsend, onauto, onversion }: Props =
		$props();

	const selected = $derived(lines[sync.selected] ?? null);
	const explain = $derived(
		sync.anchors.length === 0
			? 'Toque numa linha da letra quando ela começar a ser cantada.'
			: Math.abs(sync.offset) < 0.05
				? 'neste trecho a letra está no tempo da faixa original'
				: sync.offset > 0
					? 'neste trecho a letra entra mais tarde no vídeo'
					: 'neste trecho a letra entra mais cedo no vídeo'
	);

	// Faixa: o vídeo inteiro, com cada linha (onde ela cai no vídeo) por cima.
	const span = $derived(Math.max(duration, (lines.at(-1)?.end ?? 0) + 1, 1));
	const pct = (s: number) => `${Math.max(0, Math.min(100, (s / span) * 100))}%`;
	const width = (a: number, b: number) =>
		`${Math.max(0.4, Math.min(100, ((b - a) / span) * 100))}%`;
	const clock = (s: number) => {
		const v = Math.max(0, s);
		return `${Math.floor(v / 60)}:${String(Math.floor(v % 60)).padStart(2, '0')}`;
	};
	const rateText = (r: number) => r.toFixed(3).replace('.', ',');

	let versionsOpen = $state(false);
</script>

<section class="sinc" aria-label="Sincronizar a letra">
	<div class="cab">
		<h2>Sincronizar letra</h2>
		<p>
			O jogo está congelado. Toque numa linha quando ela começar; cada toque vale daquela linha em
			diante.
		</p>
	</div>

	<div class="corpo">
		<div class="alvo">
			<small>Linha escolhida · {sync.selected + 1}</small>
			<p class="txt" data-testid="sinc-alvo">
				{#if selected}
					{#each selected.parts as p, i (i)}{#if p.kind === 'gap'}<span
								class="gap"
								role="img"
								aria-label="lacuna começando com {p.initial}"
								>{p.initial}<i style:width="{p.rest * 0.55}em"></i></span
							>{:else}{p.text}{/if}{/each}
				{/if}
			</p>
			<button class="marcar" type="button" onclick={() => onsend({ type: 'mark' })}>
				Começou agora <kbd>Espaço</kbd>
			</button>
			{#if sync.rateSuggestion !== null}
				<p class="vel" data-testid="sinc-vel">
					O vídeo parece tocar a {rateText(sync.rateSuggestion)}× da letra.
					<button type="button" class="link" onclick={() => onsend({ type: 'acceptRate' })}
						>Usar</button
					>
				</p>
			{/if}
		</div>

		<div class="ajuste">
			<div class="leitura">
				<b data-testid="sinc-offset">{formatOffset(sync.offset)}</b>
				<span>{explain}</span>
			</div>
			<div class="fino" role="group" aria-label="Ajuste fino do trecho">
				<button type="button" onclick={() => onsend({ type: 'nudge', delta: -1 })}>−1 s</button>
				<button
					type="button"
					onclick={() => onsend({ type: 'nudge', delta: -0.1 })}
					aria-label="Trecho 0,1 s mais cedo">−0,1</button
				>
				<button
					type="button"
					onclick={() => onsend({ type: 'nudge', delta: 0.1 })}
					aria-label="Trecho 0,1 s mais tarde">+0,1</button
				>
				<button type="button" onclick={() => onsend({ type: 'nudge', delta: 1 })}>+1 s</button>
			</div>
			<div class="faixa" aria-hidden="true">
				<div class="tr">
					{#each lines as l (l.index)}
						<i
							class="ln"
							class:sel={l.index === sync.selected}
							class:cut={!l.present}
							style:left={pct(l.start)}
							style:width={width(l.start, l.end)}
						></i>
					{/each}
					{#each sync.anchors as a (a.line)}
						<i class="an" class:auto={a.source === 'auto'} style:left={pct(a.video)}></i>
					{/each}
					<i class="ph" style:left={pct(time)}></i>
				</div>
				<div class="leg">
					<span>0:00</span><span>a letra sobre o vídeo</span><span>{clock(span)}</span>
				</div>
			</div>
		</div>
	</div>

	<ul class="trechos" data-testid="sinc-trechos">
		{#each sync.anchors as a, i (a.line)}
			<li class:cur={i === sync.segment}>
				<span
					>Linha {a.line + 1} em diante{#if a.source === 'auto'}<em class="auto">auto</em
						>{/if}</span
				>
				<span class="off">{formatOffset(a.offset)}</span>
				<button
					type="button"
					class="x"
					aria-label="Apagar a marca da linha {a.line + 1}"
					onclick={() => onsend({ type: 'deleteAnchor', index: i })}>✕</button
				>
			</li>
		{:else}
			<li class="vazio">Nenhuma marca ainda.</li>
		{/each}
	</ul>

	<div class="pe">
		<button class="bt" type="button" onclick={() => onsend({ type: 'syncRestart' })}
			>Do começo</button
		>
		<button class="bt" type="button" onclick={() => onsend({ type: 'syncBack', seconds: 5 })}
			>−5 s</button
		>
		<button class="bt" type="button" onclick={() => onsend({ type: 'syncTogglePlay' })}
			>{sync.videoPlaying ? 'Pausar' : 'Tocar'}</button
		>
		{#if auto}
			<button class="bt auto" type="button" onclick={onauto} aria-pressed={auto.running}
				>{auto.running ? '✦ Parar' : '✦ Sincronizar sozinho'}</button
			>
		{/if}
		<span class="esp"></span>
		<button
			class="bt fant"
			type="button"
			disabled={!sync.canUndo}
			onclick={() => onsend({ type: 'undo' })}>Desfazer</button
		>
		<button class="bt fant" type="button" onclick={() => onsend({ type: 'zero' })}>Zerar</button>
		<button class="bt" type="button" onclick={() => onsend({ type: 'closeSync', conclude: false })}
			>Cancelar</button
		>
		<button
			class="bt pri"
			type="button"
			onclick={() => onsend({ type: 'closeSync', conclude: true })}>Concluir</button
		>
	</div>

	{#if auto?.message}<p class="auto-msg" aria-live="polite">{auto.message}</p>{/if}

	{#if versions.length > 1}
		<div class="versoes">
			<button
				type="button"
				class="link"
				aria-expanded={versionsOpen}
				onclick={() => (versionsOpen = !versionsOpen)}>Outras versões da letra ▾</button
			>
			{#if versionsOpen}
				<ul>
					{#each versions as v (v.id)}
						<li>
							<button
								type="button"
								class="link"
								class:atual={v.id === version}
								disabled={v.id === version}
								onclick={() => onversion(v.id)}>{v.label}</button
							>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}

	<p class="teclas">
		Toque na linha = marca agora · <kbd>↑</kbd><kbd>↓</kbd> escolhe · <kbd>Espaço</kbd> marca a
		escolhida · <kbd>←</kbd><kbd>→</kbd> 0,1 s · <kbd>Shift</kbd>+seta 1 s · <kbd>P</kbd> pausa ·
		<kbd>Enter</kbd> conclui · <kbd>Esc</kbd> cancela
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

	/* lacuna: só a inicial e o tamanho */
	.gap {
		display: inline-block;
		border-bottom: 2px dashed currentColor;
		line-height: 1.05;
		opacity: 0.75;
	}

	.gap i {
		display: inline-block;
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

	.marcar:hover {
		background: var(--primary-hover);
	}

	.marcar:active {
		transform: scale(0.98);
	}

	.marcar kbd {
		background: var(--kbd-on-primary);
		color: var(--kbd-on-primary-ink);
		box-shadow: none;
	}

	.vel {
		margin: 10px 0 0;
		font-size: 14px;
		color: var(--ink-2);
	}

	.link {
		border: 0;
		background: none;
		padding: 0;
		font: inherit;
		font-weight: 500;
		color: var(--gold-ink);
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	.link:disabled {
		color: var(--ink-3);
		text-decoration: none;
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
	.bt:hover:not(:disabled) {
		background: var(--soft-hover);
	}

	.bt:disabled {
		opacity: 0.4;
	}

	.tr {
		position: relative;
		height: 30px;
		border-radius: var(--r-s);
		background: var(--sunk);
		box-shadow: inset 0 0 0 1px var(--line);
		overflow: hidden;
	}

	.tr i {
		position: absolute;
	}

	.ln {
		top: 7px;
		height: 10px;
		background: var(--ok-soft);
		border-radius: 2px;
		transition:
			left 0.25s,
			width 0.25s;
	}

	.ln.sel {
		background: var(--gold-ink);
	}

	.ln.cut {
		background: none;
		box-shadow: inset 0 0 0 1px var(--ink-3);
		opacity: 0.6;
	}

	.an {
		top: 19px;
		width: 2px;
		height: 8px;
		margin-left: -1px;
		background: var(--ok-ink);
	}

	.an.auto {
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

	.trechos {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.trechos li {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 6px 4px 10px;
		border-radius: var(--r-m);
		background: var(--tile);
		box-shadow: inset 0 0 0 1px var(--line);
		font-size: 14px;
	}

	.trechos li.cur {
		box-shadow: inset 0 0 0 2px var(--gold-ink);
	}

	.trechos li.vazio {
		background: none;
		box-shadow: none;
		color: var(--ink-3);
		padding-left: 0;
	}

	.trechos .off {
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}

	.trechos em.auto {
		margin-left: 6px;
		font-style: normal;
		font-size: 12px;
		color: var(--gold-ink);
	}

	.x {
		border: 0;
		background: none;
		color: var(--ink-3);
		font-size: 13px;
		width: 24px;
		height: 24px;
		border-radius: var(--r-s);
	}

	.x:hover {
		background: var(--hover);
		color: var(--ink);
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

	.bt.fant:hover:not(:disabled) {
		background: var(--hover);
		color: var(--ink);
	}

	.bt.auto[aria-pressed='true'] {
		box-shadow: inset 0 0 0 2px var(--gold-ink);
	}

	.bt.pri {
		background: var(--primary);
		box-shadow: none;
		color: var(--on-primary);
	}

	.bt.pri:hover {
		background: var(--primary-hover);
	}

	.auto-msg {
		margin: 0;
		font-size: 14px;
		color: var(--ink-2);
	}

	.versoes ul {
		list-style: none;
		margin: 6px 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 14px;
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
			max-height: 62vh;
			overflow-y: auto;
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
		.ln {
			transition: none;
		}
	}
</style>
