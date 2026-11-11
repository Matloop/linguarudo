<script module lang="ts">
	export interface BarRow {
		x: number;
		n: number;
		/** Rótulo do eixo para esta barra. */
		label: string;
		/** Texto do tooltip. */
		tip: string;
	}
</script>

<script lang="ts">
	// Barras de uma série só (previsão, adicionados, histogramas, por hora).
	import { barY, defineChart } from '@tanstack/charts';
	import { scaleBand } from '@tanstack/charts/scales/band';
	import { scaleLinear } from '@tanstack/charts/scales/linear';
	import { Chart } from '@tanstack/charts/svelte';
	import { tooltip } from '@tanstack/charts/tooltip';

	let {
		rows,
		ariaLabel,
		height = 200,
		fill = 'var(--k-1)'
	}: { rows: BarRow[]; ariaLabel: string; height?: number; fill?: string } = $props();

	const definition = $derived.by(() => {
		const labels = new Map(rows.map((r) => [r.x, r.label]));
		return defineChart({
			marks: [barY(rows, { x: 'x', y: 'n', fill, inset: 1, radius: [3, 3, 0, 0] })],
			scales: {
				x: {
					scale: () =>
						scaleBand<number>()
							.domain(rows.map((r) => r.x))
							.padding(0.12),
					axis: { ticks: { size: 0, format: (x: number) => labels.get(x) ?? '' } }
				},
				y: {
					scale: scaleLinear,
					nice: true,
					grid: true,
					axis: { line: false, ticks: { size: 0, count: 4 } }
				}
			},
			tooltip: { use: tooltip, format: (point) => point.datum.tip }
		});
	});
</script>

<Chart class="chart" {definition} {ariaLabel} {height} />
