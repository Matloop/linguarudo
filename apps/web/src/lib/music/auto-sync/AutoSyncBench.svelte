<script lang="ts">
	// Bancada só de desenvolvimento: captura a aba uma vez e manda as MESMAS janelas
	// para o Whisper tiny e o base, comparando com as âncoras manuais (gabarito).
	import { onDestroy } from 'svelte';
	import { createTabCapture } from './capture';
	import {
		CaptureError,
		type AutoSyncModel,
		type CaptureSource,
		type Transcriber
	} from './contracts';
	import { whisperLanguage } from './languages';
	import { matchWindow, type MatchLine, type TranscriptChunk } from './match';
	import { createWorkerTranscriber } from './transcriber';
	import { Windower, type AudioWindow } from './windows';

	interface Props {
		lines: readonly MatchLine[];
		lang: string;
		getVideoTime(): number;
		isPlaying(): boolean;
		/** Gabarito: âncoras tocadas à mão. */
		manualAnchors: readonly { line: number; video: number }[];
	}

	let { lines, lang, getVideoTime, isPlaying, manualAnchors }: Props = $props();

	const MODELS: AutoSyncModel[] = ['tiny', 'base'];
	/** Erro até isto (s) conta como acerto. */
	const HIT_S = 1;

	interface Hit {
		line: number;
		video: number;
		score: number;
	}
	interface ModelRun {
		ms: number;
		hits: Hit[];
		chunks: TranscriptChunk[];
		error?: string;
	}
	interface Row {
		id: number;
		videoStart: number;
		runs: Partial<Record<AutoSyncModel, ModelRun>>;
	}
	interface ModelInfo {
		progress: number;
		loadMs: number | null;
		device: string | null;
		error: string | null;
	}

	let running = $state(false);
	let message = $state('');
	let rows = $state<Row[]>([]);
	let pendingCount = $state(0);
	let discarded = $state(0);
	let info = $state<Record<AutoSyncModel, ModelInfo>>({
		tiny: { progress: 0, loadMs: null, device: null, error: null },
		base: { progress: 0, loadMs: null, device: null, error: null }
	});

	let capture: CaptureSource | null = null;
	let workers: Partial<Record<AutoSyncModel, Transcriber>> = {};
	let queue: AudioWindow[] = [];
	let busy = false;
	let round = 0;

	const truth = $derived(new Map(manualAnchors.map((a) => [a.line, a.video])));

	function errorOf(h: Hit): number | null {
		const t = truth.get(h.line);
		return t === undefined ? null : h.video - t;
	}

	const summary = $derived(
		MODELS.map((model) => {
			const runs = rows.flatMap((r) => (r.runs[model] ? [r.runs[model]] : []));
			const hits = runs.flatMap((r) => r.hits);
			const errors = hits.map(errorOf).filter((e): e is number => e !== null);
			const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
			return {
				model,
				windows: runs.length,
				anchors: hits.length,
				checked: errors.length,
				meanAbs: mean(errors.map(Math.abs)),
				meanSigned: mean(errors),
				hitRate: errors.length
					? errors.filter((e) => Math.abs(e) <= HIT_S).length / errors.length
					: null,
				latency: mean(runs.map((r) => r.ms)),
				loadMs: info[model].loadMs,
				device: info[model].device
			};
		})
	);

	function fmt(n: number | null, digits = 1): string {
		return n === null ? '—' : n.toFixed(digits).replace('.', ',');
	}

	function signed(n: number): string {
		return `${n < 0 ? '−' : '+'}${fmt(Math.abs(n))}`;
	}

	async function start() {
		if (running) return;
		const mine = ++round;
		running = true;
		rows = [];
		discarded = 0;
		message = 'Escolha esta aba e marque “Compartilhar áudio da aba”.';
		const windower = new Windower();
		capture = createTabCapture();
		try {
			await capture.start({
				onAudio: (samples) => {
					if (mine !== round) return;
					for (const e of windower.push(samples, { video: getVideoTime(), playing: isPlaying() })) {
						if (e.kind === 'descartada') discarded++;
						else queue.push(e.window);
					}
					pendingCount = queue.length;
					void pump(mine);
				},
				onEnded: () => stop()
			});
		} catch (err) {
			message = err instanceof CaptureError ? `Captura: ${err.code}` : String(err);
			stop(false);
			return;
		}
		message = 'Carregando os dois modelos…';
		await Promise.all(
			MODELS.map(async (model) => {
				const t = createWorkerTranscriber(model);
				workers[model] = t;
				try {
					const r = await t.load((p) => (info[model].progress = p));
					info[model] = { progress: 1, loadMs: r.loadMs, device: r.device, error: null };
				} catch (err) {
					info[model].error = err instanceof Error ? err.message : String(err);
				}
			})
		);
		if (mine !== round) return;
		message = 'Ouvindo. As janelas de 20 s vão aparecendo abaixo.';
		void pump(mine);
	}

	async function pump(mine: number) {
		const ready = MODELS.every((m) => info[m].device !== null || info[m].error !== null);
		if (busy || !ready || mine !== round) return;
		const win = queue.shift();
		pendingCount = queue.length;
		if (!win) return;
		busy = true;
		const row: Row = { id: win.id, videoStart: win.videoStart, runs: {} };
		rows.push(row);
		const language = whisperLanguage(lang);
		// Um modelo de cada vez, para a latência de um não atrapalhar a do outro.
		for (const model of MODELS) {
			const t = workers[model];
			if (!t || info[model].error) continue;
			try {
				const r = await t.transcribe(win.samples, language);
				if (mine !== round) return;
				const hits = matchWindow(lines, { chunks: r.chunks, windowVideoStart: win.videoStart });
				rows[rows.length - 1].runs[model] = { ms: r.ms, hits, chunks: r.chunks };
			} catch (err) {
				if (mine !== round) return;
				rows[rows.length - 1].runs[model] = {
					ms: 0,
					hits: [],
					chunks: [],
					error: err instanceof Error ? err.message : String(err)
				};
			}
		}
		busy = false;
		void pump(mine);
	}

	function stop(clear = true) {
		round++;
		running = false;
		busy = false;
		queue = [];
		pendingCount = 0;
		capture?.stop();
		capture = null;
		for (const t of Object.values(workers)) t?.dispose();
		workers = {};
		for (const m of MODELS) info[m] = { progress: 0, loadMs: null, device: null, error: null };
		if (clear) message = 'Parado.';
	}

	onDestroy(() => stop());
</script>

<section class="bench">
	<header>
		<h2>Bancada: Whisper tiny × base</h2>
		<button type="button" onclick={() => (running ? stop() : start())}>
			{running ? 'Parar' : 'Começar'}
		</button>
	</header>
	<p class="msg">
		{message}
		{#if running}
			<span>
				{#each MODELS as m (m)}
					{m}: {info[m].error
						? `erro (${info[m].error})`
						: info[m].device
							? info[m].device
							: `${Math.round(info[m].progress * 100)}%`}
					·
				{/each}
				na fila: {pendingCount} · descartadas: {discarded}
			</span>
		{/if}
	</p>

	<table>
		<thead>
			<tr>
				<th>Modelo</th>
				<th>Janelas</th>
				<th>Âncoras</th>
				<th>Com gabarito</th>
				<th>Erro médio</th>
				<th>Viés</th>
				<th>Acerto ≤ {HIT_S} s</th>
				<th>Latência</th>
				<th>Carga</th>
			</tr>
		</thead>
		<tbody>
			{#each summary as s (s.model)}
				<tr>
					<td>{s.model} <small>{s.device ?? ''}</small></td>
					<td>{s.windows}</td>
					<td>{s.anchors}</td>
					<td>{s.checked}</td>
					<td>{fmt(s.meanAbs, 2)} s</td>
					<td>{s.meanSigned === null ? '—' : `${signed(s.meanSigned)} s`}</td>
					<td>{s.hitRate === null ? '—' : `${Math.round(s.hitRate * 100)}%`}</td>
					<td>{fmt(s.latency, 0)} ms</td>
					<td>{s.loadMs === null ? '—' : `${fmt(s.loadMs / 1000)} s`}</td>
				</tr>
			{/each}
		</tbody>
	</table>

	{#if rows.length > 0}
		<table class="janelas">
			<thead>
				<tr>
					<th>Janela</th>
					<th>Modelo</th>
					<th>Latência</th>
					<th>Linhas (vídeo, erro)</th>
					<th>Transcrição</th>
				</tr>
			</thead>
			<tbody>
				{#each [...rows].reverse() as row (row.id)}
					{#each MODELS as model, i (model)}
						{@const run = row.runs[model]}
						<tr class:first={i === 0}>
							{#if i === 0}
								<td rowspan={MODELS.length}>#{row.id} · {fmt(row.videoStart)} s</td>
							{/if}
							<td>{model}</td>
							<td>{run ? `${run.ms} ms` : '…'}</td>
							<td>
								{#if run?.error}
									<span class="bad">{run.error}</span>
								{:else if run}
									{#each run.hits as h (h.line)}
										{@const e = errorOf(h)}
										<span class="hit" class:bad={e !== null && Math.abs(e) > HIT_S}>
											L{h.line} @ {fmt(h.video)} s{e === null ? '' : ` (${signed(e)})`}
										</span>
									{:else}
										—
									{/each}
								{/if}
							</td>
							<td class="txt">
								{#if run}
									{#each run.chunks as c, k (k)}
										<span>[{fmt(c.start)}] {c.text.trim()}</span>
									{/each}
								{/if}
							</td>
						</tr>
					{/each}
				{/each}
			</tbody>
		</table>
	{/if}
</section>

<style>
	.bench {
		background: var(--panel);
		box-shadow: var(--sh-panel);
		border-radius: var(--r-l);
		padding: 16px 18px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		font-size: 13.5px;
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}

	h2 {
		margin: 0;
		font: 600 17px/1.3 var(--f-head);
	}

	button {
		height: 36px;
		padding: 0 16px;
		border: 0;
		border-radius: var(--r-m);
		background: var(--primary);
		color: var(--on-primary);
		font: 500 14.5px/1 var(--f-body);
		cursor: pointer;
	}

	button:hover {
		background: var(--primary-hover);
	}

	.msg {
		margin: 0;
		color: var(--ink-2);
	}

	.msg span {
		display: block;
		color: var(--ink-3);
		font-variant-numeric: tabular-nums;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-variant-numeric: tabular-nums;
	}

	th {
		text-align: left;
		font-weight: 500;
		color: var(--ink-3);
		padding: 4px 8px;
		border-bottom: 1px solid var(--line);
	}

	td {
		padding: 4px 8px;
		vertical-align: top;
	}

	tr.first td {
		border-top: 1px solid var(--line);
	}

	small {
		color: var(--ink-3);
	}

	.hit {
		display: inline-block;
		margin-right: 8px;
		color: var(--ok-ink);
	}

	.bad {
		color: var(--gold-ink);
	}

	.txt {
		color: var(--ink-2);
		max-width: 420px;
	}

	.txt span {
		display: block;
	}
</style>
