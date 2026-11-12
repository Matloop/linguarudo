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
		versions: readonly LyricVersion[];
		version: number | null;
		/** Onde "Ouvir a linha" começa (um pouco antes da linha escolhida). */
		listenFrom: () => number;
		onsend: (event: MusicEvent) => void;
		onversion: (id: number) => void;
	}

	let { sync, lines, time, duration, versions, version, listenFrom, onsend, onversion }: Props =
		$props();

	const selected = $derived(lines[sync.selected] ?? null);
	const explain = $derived.by(() => {
		if (sync.anchors.length === 0) return 'sem marcas, a letra segue o tempo original';
		const o = sync.offset;
		if (Math.abs(o) < 0.05) return 'neste trecho a letra está no tempo original';
		const amount = formatOffset(Math.abs(o)).slice(1);
		return o > 0
			? `neste trecho a letra entra ${amount} mais tarde`
			: `neste trecho a letra entra ${amount} mais cedo`;
	});

	const clock = (s: number) => {
		const v = Math.max(0, s);
		return `${Math.floor(v / 60)}:${String(Math.floor(v % 60)).padStart(2, '0')}`;
	};
	const rateText = (r: number) => r.toFixed(3).replace('.', ',');

	// ---------- mover a letra: botões (segurar repete, acelerando) ----------
	const STEPS = [-5, -1, -0.1, 0.1, 1, 5] as const;
	const stepLabel = (d: number) =>
		`${d < 0 ? '−' : '+'}${Math.abs(d) >= 1 ? `${Math.abs(d)} s` : '0,1'}`;
	const REPEAT_FIRST_MS = 420;
	let repeat: ReturnType<typeof setTimeout> | null = null;

	function holdStart(e: PointerEvent, delta: number) {
		if (e.button !== 0) return;
		e.preventDefault();
		let n = 0;
		const go = () => {
			onsend({ type: 'nudge', delta, merge: n > 0 });
			n++;
			repeat = setTimeout(go, n === 1 ? REPEAT_FIRST_MS : Math.max(50, 180 - n * 12));
		};
		go();
	}

	function holdEnd() {
		if (repeat) clearTimeout(repeat);
		repeat = null;
	}

	// ---------- valor digitado ----------
	let typed = $state('');
	let typedBad = $state(false);

	function submitTyped(e: SubmitEvent) {
		e.preventDefault();
		const v = Number(typed.trim().replace(',', '.').replace('−', '-').replace(/\s*s$/, ''));
		if (typed.trim() === '' || !Number.isFinite(v)) {
			typedBad = true;
			return;
		}
		typedBad = false;
		onsend({ type: 'setOffset', offset: v });
		typed = '';
	}

	// ---------- linha do tempo ----------
	const NEAR_S = 30;
	let zoom = $state<'all' | 'near'>('all');
	let trackW = $state(0);

	const total = $derived(Math.max(duration, (lines.at(-1)?.end ?? 0) + 1, 1));
	const win = $derived.by<[number, number]>(() => {
		if (zoom === 'all' || total <= NEAR_S) return [0, total];
		const c = Math.max(NEAR_S / 2, Math.min(total - NEAR_S / 2, time));
		return [c - NEAR_S / 2, c + NEAR_S / 2];
	});
	const span = $derived(win[1] - win[0]);
	const pct = (s: number) => ((s - win[0]) / span) * 100;
	const ticks = $derived.by(() => {
		const step = zoom === 'near' ? 5 : ([10, 20, 30, 60, 120].find((s) => span / s <= 8) ?? 300);
		const out: number[] = [];
		for (let s = Math.ceil(win[0] / step) * step; s <= win[1]; s += step) out.push(s);
		return out;
	});

	/** Deslocamento do trecho que contém a linha (o mesmo que o controlador usa). */
	function offsetOf(line: number): number {
		if (sync.anchors.length === 0) return 0;
		let k = 0;
		sync.anchors.forEach((a, i) => {
			if (a.line <= line) k = i;
		});
		return sync.anchors[k].offset;
	}
	const segmentOfLine = (line: number) => {
		if (sync.anchors.length === 0) return -1;
		let k = 0;
		sync.anchors.forEach((a, i) => {
			if (a.line <= line) k = i;
		});
		return k;
	};

	interface Drag {
		x: number;
		off0: number;
		moved: boolean;
		line: number;
	}
	let drag = $state<Drag | null>(null);
	// O trecho não passa das marcas vizinhas: mostra onde ele ficou de verdade.
	const dragText = $derived(drag?.moved ? `trecho em ${formatOffset(sync.offset)}` : '');

	function dragStart(e: PointerEvent) {
		if (e.button !== 0) return;
		const blk = (e.target as HTMLElement).closest<HTMLElement>('[data-line]');
		const line = blk ? Number(blk.dataset.line) : sync.selected;
		if (line !== sync.selected) onsend({ type: 'moveSelection', delta: line - sync.selected });
		drag = { x: e.clientX, off0: offsetOf(line), moved: false, line };
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function dragMove(e: PointerEvent) {
		if (!drag || trackW === 0) return;
		const dx = e.clientX - drag.x;
		if (!drag.moved && Math.abs(dx) < 3) return;
		const offset = Math.round((drag.off0 + (dx / trackW) * span) * 10) / 10;
		onsend({ type: 'setOffset', offset, merge: drag.moved });
		drag.moved = true;
	}

	function dragEnd() {
		drag = null;
	}

	function seekRuler(e: PointerEvent) {
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		onsend({ type: 'syncSeek', to: win[0] + ((e.clientX - r.left) / r.width) * span });
	}

	let moreOpen = $state(false);
</script>

<section class="sinc" aria-label="Sincronizar a letra">
	<div class="cab">
		<div>
			<h2>Sincronizar letra</h2>
			<p>O jogo está pausado. Quando ouvir uma linha começar, toque nela na letra.</p>
		</div>
		<span class="esp"></span>
		<button
			class="bt fant"
			type="button"
			onclick={() => onsend({ type: 'closeSync', conclude: false })}>Cancelar</button
		>
		<button
			class="bt pri"
			type="button"
			onclick={() => onsend({ type: 'closeSync', conclude: true })}>Concluir</button
		>
	</div>

	<div class="corpo">
		<div class="esq">
			<div class="video" role="group" aria-label="Vídeo">
				<button
					class="play"
					type="button"
					aria-label={sync.videoPlaying ? 'Pausar' : 'Tocar'}
					onclick={() => onsend({ type: 'syncTogglePlay' })}
					>{#if sync.videoPlaying}<svg viewBox="0 0 24 24" aria-hidden="true"
							><path d="M7 5h3v14H7zM14 5h3v14h-3z" /></svg
						>{:else}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z" /></svg
						>{/if}</button
				>
				<span class="relogio">{clock(time)}</span>
				<span class="esp"></span>
				<button
					class="mini"
					type="button"
					onclick={() => onsend({ type: 'syncSeek', to: time - 10 })}>−10 s</button
				>
				<button
					class="mini"
					type="button"
					onclick={() => onsend({ type: 'syncSeek', to: time + 10 })}>+10 s</button
				>
				<button
					class="mini"
					type="button"
					title="Volta um pouco antes da linha escolhida e toca"
					onclick={() => onsend({ type: 'syncSeek', to: listenFrom(), play: true })}
					>Ouvir a linha</button
				>
			</div>

			<button class="marcar" type="button" onclick={() => onsend({ type: 'mark' })}>
				<span class="mc">
					<span>Começou agora</span>
					<small data-testid="sinc-alvo"
						>Linha {sync.selected + 1}{#if selected}
							· {#each selected.parts as p, i (i)}{#if p.kind === 'gap'}<span
										class="gap"
										role="img"
										aria-label="lacuna começando com {p.initial}"
										>{p.initial}<i style:width="{p.rest * 0.55}em"></i></span
									>{:else}{p.text}{/if}{/each}{/if}</small
					>
				</span>
				<kbd>Espaço</kbd>
			</button>
		</div>

		<div class="dir">
			<div class="leitura">
				<b data-testid="sinc-offset">{formatOffset(sync.offset)}</b>
				<span>{explain}</span>
			</div>
			<div class="passos" role="group" aria-label="Mover o trecho da linha escolhida">
				{#each STEPS as d (d)}
					<button
						type="button"
						class:grande={Math.abs(d) === 5}
						aria-label="Trecho {stepLabel(d).replace('−', 'menos ')} {d < 0
							? 'mais cedo'
							: 'mais tarde'}"
						onpointerdown={(e) => holdStart(e, d)}
						onpointerup={holdEnd}
						onpointerleave={holdEnd}
						onpointercancel={holdEnd}
						onclick={(e) => {
							// Teclado (Enter/Espaço no botão): um passo só.
							if (e.detail === 0) onsend({ type: 'nudge', delta: d });
						}}>{stepLabel(d)}</button
					>
				{/each}
			</div>
			<form class="digitar" onsubmit={submitTyped}>
				<label for="sinc-digitar">ou digite o deslocamento</label>
				<input
					id="sinc-digitar"
					inputmode="decimal"
					autocomplete="off"
					placeholder="+23,5"
					class:ruim={typedBad}
					aria-invalid={typedBad}
					bind:value={typed}
				/>
				<span>s</span>
			</form>
			{#if sync.rateSuggestion !== null}
				<p class="vel" data-testid="sinc-vel">
					O vídeo parece tocar a {rateText(sync.rateSuggestion)}× da letra.
					<button type="button" class="link" onclick={() => onsend({ type: 'acceptRate' })}
						>Usar</button
					>
				</p>
			{/if}
		</div>
	</div>

	<div class="tempo">
		<div class="tcab">
			<strong>Arraste a letra</strong>
			<span class="dica">até ela cair onde a voz entra. Move o trecho da linha escolhida.</span>
			<span class="esp"></span>
			<div class="zoom" role="group" aria-label="Zoom da linha do tempo">
				<button type="button" class:on={zoom === 'all'} onclick={() => (zoom = 'all')}>Tudo</button>
				<button type="button" class:on={zoom === 'near'} onclick={() => (zoom = 'near')}
					>{NEAR_S} s</button
				>
			</div>
		</div>
		<div class="pista" bind:clientWidth={trackW}>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="regua" onpointerdown={seekRuler} title="Ir para este ponto do vídeo">
				{#each ticks as s (s)}
					<span class="tick" style:left="{pct(s)}%">{clock(s)}</span>
				{/each}
			</div>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="letras"
				class:arrastando={drag?.moved}
				onpointerdown={dragStart}
				onpointermove={dragMove}
				onpointerup={dragEnd}
				onpointercancel={dragEnd}
			>
				{#each lines as l (l.index)}
					{@const seg = segmentOfLine(l.index)}
					<i
						class="blk"
						data-line={l.index}
						class:trecho={seg === sync.segment}
						class:sel={l.index === sync.selected}
						class:cut={!l.present}
						class:lit={l.present && time >= l.start && time < l.end}
						style:left="{pct(l.start)}%"
						style:width="max(3px, {pct(l.end) - pct(l.start)}%)"
					></i>
				{/each}
				{#each sync.anchors as a (a.line)}
					<i class="an" style:left="{pct(a.video)}%"></i>
				{/each}
			</div>
			<i class="ph" style:left="{pct(time)}%"></i>
		</div>
		<div class="leg">
			<span>{clock(win[0])}</span><span aria-live="polite">{dragText}</span><span
				>{clock(win[1])}</span
			>
		</div>
	</div>

	<div class="pe">
		<button
			type="button"
			class="link"
			aria-expanded={moreOpen}
			onclick={() => (moreOpen = !moreOpen)}
			>Marcas{sync.anchors.length > 0 ? ` (${sync.anchors.length})` : ''}{versions.length > 1
				? ' e outras versões da letra'
				: ''}
			{moreOpen ? '▴' : '▾'}</button
		>
		<span class="esp"></span>
		<button
			class="bt fant"
			type="button"
			disabled={!sync.canUndo}
			onclick={() => onsend({ type: 'undo' })}>Desfazer</button
		>
	</div>

	<div class="mais" hidden={!moreOpen}>
		<ul class="trechos" data-testid="sinc-trechos">
			{#each sync.anchors as a, i (a.line)}
				<li class:cur={i === sync.segment}>
					<span>Linha {a.line + 1} em diante</span>
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
		<div class="acoes">
			<button
				class="bt"
				type="button"
				disabled={sync.anchors.length === 0}
				onclick={() => onsend({ type: 'zero' })}>Apagar todas as marcas</button
			>
		</div>
		{#if versions.length > 1}
			<div class="versoes">
				<p>Outras versões da letra</p>
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
			</div>
		{/if}
	</div>

	<p class="teclas">
		Toque na linha = começou agora · <kbd>↑</kbd><kbd>↓</kbd> escolhe · <kbd>Espaço</kbd> marca a
		escolhida · <kbd>←</kbd><kbd>→</kbd> 0,1 s · <kbd>Shift</kbd> 1 s · <kbd>Alt</kbd> 5 s ·
		<kbd>P</kbd> tocar/pausar · <kbd>O</kbd> ouvir a linha · <kbd>Enter</kbd> conclui ·
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
		gap: 14px;
	}

	.cab {
		display: flex;
		align-items: center;
		gap: 8px;
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

	.esp {
		flex: 1;
	}

	.corpo {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 14px;
	}

	.esq,
	.dir {
		display: flex;
		flex-direction: column;
		gap: 10px;
		min-width: 0;
	}

	/* vídeo */
	.video {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 8px 10px;
		border-radius: var(--r-l);
		background: var(--tile);
		box-shadow: inset 0 0 0 1px var(--line);
	}

	.play {
		width: 38px;
		height: 38px;
		flex: none;
		border: 0;
		border-radius: 50%;
		background: var(--primary);
		color: var(--on-primary);
		display: grid;
		place-items: center;
	}

	.play:hover {
		background: var(--primary-hover);
	}

	.play svg {
		width: 18px;
		height: 18px;
		fill: currentColor;
	}

	.relogio {
		font: 600 19px/1 var(--f-head);
		font-variant-numeric: tabular-nums;
		margin-left: 4px;
	}

	.mini {
		border: 0;
		border-radius: var(--r-s);
		background: none;
		box-shadow: inset 0 0 0 1px var(--line);
		color: var(--ink-2);
		font: inherit;
		font-size: 13.5px;
		font-weight: 500;
		height: 32px;
		padding: 0 10px;
		white-space: nowrap;
	}

	.mini:hover {
		background: var(--hover);
		color: var(--ink);
	}

	/* começou agora */
	.marcar {
		width: 100%;
		min-height: 64px;
		border: 0;
		border-radius: var(--r-m);
		background: var(--primary);
		color: var(--on-primary);
		font: 600 16.5px/1.2 var(--f-body);
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 14px;
		padding: 10px 14px;
		transition:
			transform 0.08s,
			background-color 0.18s;
	}

	.marcar:hover {
		background: var(--primary-hover);
	}

	.marcar:active {
		transform: scale(0.99);
	}

	.mc {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 3px;
		min-width: 0;
	}

	.mc small {
		font-weight: 400;
		font-size: 13px;
		opacity: 0.75;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.marcar kbd {
		background: var(--kbd-on-primary);
		color: var(--kbd-on-primary-ink);
		box-shadow: none;
	}

	/* lacuna: só a inicial e o tamanho */
	.gap {
		display: inline-block;
		border-bottom: 1.5px dashed currentColor;
		line-height: 1.05;
	}

	.gap i {
		display: inline-block;
	}

	/* deslocamento */
	.leitura {
		display: flex;
		align-items: baseline;
		gap: 10px;
		flex-wrap: wrap;
	}

	.leitura b {
		font: 600 30px/1.1 var(--f-head);
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.02em;
		white-space: nowrap;
	}

	.leitura span {
		font-size: 14px;
		color: var(--ink-2);
	}

	.passos {
		display: grid;
		grid-template-columns: repeat(6, minmax(0, 1fr));
		gap: 6px;
	}

	.passos button,
	.bt {
		border: 0;
		border-radius: var(--r-m);
		background: var(--soft-bg);
		box-shadow: var(--sh-card);
		color: var(--ink);
		font: inherit;
		font-weight: 500;
		font-size: 14.5px;
		height: 38px;
		padding: 0 12px;
		transition: background-color 0.15s;
		white-space: nowrap;
	}

	.passos button {
		padding: 0;
		font-variant-numeric: tabular-nums;
		touch-action: manipulation;
		user-select: none;
	}

	.passos button.grande {
		color: var(--gold-ink);
	}

	.passos button:hover,
	.bt:hover:not(:disabled) {
		background: var(--soft-hover);
	}

	.bt:disabled {
		opacity: 0.4;
	}

	.digitar {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13.5px;
		color: var(--ink-2);
	}

	.digitar input {
		width: 96px;
		height: 32px;
		border: 0;
		border-radius: var(--r-s);
		background: var(--sunk);
		box-shadow: inset 0 0 0 1px var(--line);
		color: var(--ink);
		font: 500 14px/1 var(--f-body);
		font-variant-numeric: tabular-nums;
		padding: 0 10px;
	}

	.digitar input.ruim {
		box-shadow: inset 0 0 0 2px var(--terra-ink);
	}

	.vel {
		margin: 0;
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

	/* linha do tempo */
	.tcab {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 8px;
	}

	.tcab strong {
		font-size: 14px;
		font-weight: 600;
		white-space: nowrap;
	}

	.tcab .dica {
		font-size: 13.5px;
		color: var(--ink-2);
	}

	.zoom {
		display: inline-flex;
		flex: none;
		border-radius: var(--r-s);
		box-shadow: inset 0 0 0 1px var(--line);
		overflow: hidden;
	}

	.zoom button {
		border: 0;
		background: none;
		color: var(--ink-2);
		font: inherit;
		font-size: 13px;
		padding: 5px 12px;
	}

	.zoom button.on {
		background: var(--soft-bg);
		color: var(--ink);
	}

	.pista {
		position: relative;
		height: 84px;
		border-radius: var(--r-m);
		background: var(--sunk);
		box-shadow: inset 0 0 0 1px var(--line);
		overflow: hidden;
		user-select: none;
	}

	.regua {
		position: absolute;
		inset: 0 0 auto;
		height: 24px;
		border-bottom: 1px dashed var(--line);
		cursor: pointer;
	}

	.tick {
		position: absolute;
		top: 5px;
		transform: translateX(-50%);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		color: var(--ink-3);
		pointer-events: none;
	}

	.letras {
		position: absolute;
		inset: 24px 0 0;
		cursor: grab;
		touch-action: none;
	}

	.letras.arrastando {
		cursor: grabbing;
	}

	.letras i {
		position: absolute;
	}

	.blk {
		top: 12px;
		height: 30px;
		border-radius: 6px;
		background: var(--soft-bg);
		box-shadow: inset 0 0 0 1px var(--line);
	}

	.blk.trecho {
		background: var(--gold-soft);
		box-shadow: inset 0 0 0 1px var(--gold-ink);
	}

	.blk.sel {
		box-shadow: inset 0 0 0 2px var(--gold-ink);
	}

	.blk.lit {
		background: var(--gold-ink);
	}

	.blk.cut {
		background: none;
		box-shadow: inset 0 0 0 1px var(--ink-3);
		opacity: 0.5;
	}

	.an {
		top: 2px;
		bottom: 0;
		width: 2px;
		margin-left: -1px;
		background: var(--gold-ink);
		pointer-events: none;
	}

	.an::before {
		content: '';
		position: absolute;
		top: -3px;
		left: -4px;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--gold-ink);
	}

	.ph {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2px;
		margin-left: -1px;
		background: var(--ink);
		pointer-events: none;
	}

	.leg {
		display: flex;
		justify-content: space-between;
		margin-top: 4px;
		font-size: 12.5px;
		font-variant-numeric: tabular-nums;
		color: var(--ink-3);
	}

	/* rodapé */
	.pe {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 14px;
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

	.bt.pri {
		background: var(--primary);
		box-shadow: none;
		color: var(--on-primary);
	}

	.bt.pri:hover {
		background: var(--primary-hover);
	}

	.mais {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.mais[hidden] {
		display: none;
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

	.versoes p {
		margin: 0;
		font-size: 13.5px;
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
		.tcab .dica,
		.digitar label {
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
</style>
