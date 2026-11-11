<script lang="ts">
	import { barX, barY, cell, defineChart, group, lineY } from '@tanstack/charts';
	import { scaleBand } from '@tanstack/charts/scales/band';
	import { scaleLinear } from '@tanstack/charts/scales/linear';
	import { scalePoint } from '@tanstack/charts/scales/point';
	import { Chart } from '@tanstack/charts/svelte';
	import { tooltip } from '@tanstack/charts/tooltip';
	import { languageInline } from '#lib/languages.ts';
	import { GRADE_LABELS, GRADES } from '#lib/review.ts';
	import {
		BUTTON_GROUPS,
		COUNT_LABELS,
		FORECAST_DAYS,
		RANGES,
		REVIEW_KINDS,
		bucketSize,
		histogram,
		percentile,
		rangeFrom,
		retentionRate,
		type HistoryDay,
		type PassFail,
		type Range
	} from '#lib/stats.ts';
	import Bars, { type BarRow } from './Bars.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const stats = $derived(data.stats);
	const langName = $derived(languageInline(data.language, data.shell?.uiLanguage ?? 'pt'));
	const DAY = 86_400_000;

	// ---------- Formatação ----------
	const nf = new Intl.NumberFormat('pt-BR');
	const pf = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 });
	const n = (v: number) => nf.format(v);
	const pct = (v: number | null) => (v == null ? '—' : pf.format(v));
	const plural = (v: number, one: string, many: string) => `${n(v)} ${v === 1 ? one : many}`;
	function minutes(ms: number) {
		const min = ms / 60_000;
		if (min < 1) return `${Math.round(ms / 1000)} s`;
		if (min < 60) return `${Math.round(min)} min`;
		return `${(min / 60).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`;
	}

	const dateFmt = $derived(
		new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: data.timeZone })
	);
	const longDateFmt = $derived(
		new Intl.DateTimeFormat('pt-BR', {
			weekday: 'short',
			day: 'numeric',
			month: 'short',
			timeZone: data.timeZone
		})
	);
	const monthFmt = $derived(
		new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: data.timeZone })
	);
	/** Meio-dia do dia de estudo: a data certa mesmo com troca de horário. */
	const dayDate = (day: number) =>
		new Date(Date.parse(stats.todayStart) + day * DAY + 12 * 3_600_000);
	const dayLabel = (day: number) => (day === 0 ? 'hoje' : dateFmt.format(dayDate(day)));
	const dayLong = (day: number) => longDateFmt.format(dayDate(day));
	function spanLabel(from: number, size: number) {
		return size === 1 ? dayLong(from) : `${dayLabel(from)} a ${dayLabel(from + size - 1)}`;
	}

	// ---------- Períodos ----------
	let forecastRange = $state<Exclude<Range, 'tudo'>>('1m');
	let reviewsRange = $state<Range>('1m');
	let reviewsTime = $state(false);
	let addedRange = $state<Range>('1m');
	let hoursRange = $state<Range>('1m');
	let buttonsRange = $state<Range>('1m');
	type Spread = '1m' | '50' | '95' | 'tudo';
	const SPREADS: [Spread, string][] = [
		['1m', '1 mês'],
		['50', '50%'],
		['95', '95%'],
		['tudo', 'Tudo']
	];
	let intervalSpread = $state<Spread>('95');
	let stabilitySpread = $state<Spread>('95');

	// ---------- Hoje ----------
	const today = $derived(stats.today);
	const todayCorrect = $derived(
		today.cards === 0 ? null : (today.cards - today.again) / today.cards
	);

	// ---------- Previsão ----------
	const FORECAST_SPAN = { '1m': 31, '3m': 91, '1a': FORECAST_DAYS + 1 } as const;
	const forecast = $derived.by(() => {
		const days = FORECAST_SPAN[forecastRange];
		const size = bucketSize(days);
		const rows: BarRow[] = [];
		let cum = 0;
		for (let from = 0; from < days; from += size) {
			let v = 0;
			for (let d = from; d < Math.min(days, from + size); d++) v += stats.forecast[d];
			cum += v;
			rows.push({
				x: from,
				n: v,
				label: dayLabel(from),
				tip: `${spanLabel(from, Math.min(size, days - from))}: ${plural(v, 'revisão', 'revisões')} · ${n(cum)} no acumulado`
			});
		}
		const total = stats.forecast.slice(0, days).reduce((a, b) => a + b, 0);
		return { rows, total, perDay: total / days };
	});

	// ---------- Histórico (revisões) ----------
	function bucketHistory(range: Range) {
		const from = rangeFrom(range, stats.firstDay);
		const days = 1 - from;
		const size = bucketSize(days);
		const buckets: Record<number, HistoryDay> = {};
		for (const h of stats.history) {
			if (h.day < from) continue;
			const key = from + Math.floor((h.day - from) / size) * size;
			let b = buckets[key];
			if (!b) {
				b = {
					day: key,
					n: { aprender: 0, recente: 0, madura: 0, reaprender: 0 },
					ms: { aprender: 0, recente: 0, madura: 0, reaprender: 0 },
					again: 0
				};
				buckets[key] = b;
			}
			for (const [k] of REVIEW_KINDS) {
				b.n[k] += h.n[k];
				b.ms[k] += h.ms[k];
			}
			b.again += h.again;
		}
		return { from, days, size, buckets };
	}

	const reviews = $derived.by(() => {
		const { from, days, size, buckets } = bucketHistory(reviewsRange);
		const xs: number[] = [];
		for (let d = from; d <= 0; d += size) xs.push(d);
		const rows = Object.values(buckets).flatMap((b) =>
			REVIEW_KINDS.map(([k, label]) => ({
				x: b.day,
				kind: label,
				v: reviewsTime ? b.ms[k] / 60_000 : b.n[k],
				size
			})).filter((r) => r.v > 0)
		);
		const totals = { n: 0, ms: 0 };
		const byKind = { aprender: 0, recente: 0, madura: 0, reaprender: 0 };
		let studied = 0;
		for (const h of stats.history) {
			if (h.day < from) continue;
			studied++;
			for (const [k] of REVIEW_KINDS) {
				totals.n += h.n[k];
				totals.ms += h.ms[k];
				byKind[k] += reviewsTime ? h.ms[k] : h.n[k];
			}
		}
		return { xs, rows, size, days, studied, totals, byKind };
	});
	const reviewsChart = $derived.by(() => {
		const { xs, size } = reviews;
		return defineChart({
			marks: [
				barY(reviews.rows, {
					x: 'x',
					y: 'v',
					color: 'kind',
					stroke: 'var(--surface)',
					strokeWidth: 1,
					inset: 1
				})
			],
			scales: {
				x: {
					scale: () => scaleBand<number>().domain(xs).padding(0.12),
					axis: { ticks: { size: 0, format: (x: number) => dayLabel(x) } }
				},
				y: {
					scale: scaleLinear,
					nice: true,
					grid: true,
					axis: { line: false, ticks: { size: 0, count: 4 } }
				}
			},
			color: {
				domain: REVIEW_KINDS.map(([, l]) => l),
				range: REVIEW_KINDS.map(([k]) => `var(--kind-${k})`)
			},
			focus: 'group-x',
			tooltip: {
				use: tooltip,
				formatGroup: (points) => {
					const first = points[0]?.datum;
					if (!first) return '';
					const lines = points.map(
						(p) => `${p.datum.kind}: ${reviewsTime ? minutes(p.datum.v * 60_000) : n(p.datum.v)}`
					);
					return [spanLabel(first.x, Math.min(size, 1 - first.x)), ...lines].join('\n');
				}
			}
		});
	});

	// ---------- Calendário ----------
	const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
	const calendar = $derived.by(() => {
		const start = -(52 * 7 + stats.todayWeekday);
		const byDay = new Map(
			stats.history.map((h) => [h.day, h.n.aprender + h.n.recente + h.n.madura + h.n.reaprender])
		);
		const max = Math.max(1, ...[...byDay.values()]);
		const cells = [];
		const monthTicks: number[] = [];
		let lastMonth = '';
		for (let d = start; d <= 0; d++) {
			const col = Math.floor((d - start) / 7);
			const row = (d - start) % 7;
			const v = byDay.get(d) ?? 0;
			const level = v === 0 ? 0 : Math.min(4, Math.ceil((v / max) * 4));
			cells.push({ col, row, v, day: d, level });
			const month = monthFmt.format(dayDate(d));
			if (month !== lastMonth && row === 0) {
				if (lastMonth) monthTicks.push(col);
				lastMonth = month;
			}
		}
		const monthOf = new Map(monthTicks.map((c) => [c, monthFmt.format(dayDate(start + c * 7))]));
		const cols = Array.from({ length: Math.floor(-start / 7) + 1 }, (_, i) => i);
		// Dias estudados desde o primeiro registro.
		const span = 1 - stats.firstDay;
		const studied = stats.history.length;
		const total = [...byDay.values()].reduce((a, b) => a + b, 0);
		return { cells, cols, monthTicks, monthOf, span, studied, total };
	});
	const calendarChart = $derived(
		defineChart({
			marks: [
				cell(calendar.cells, {
					x: 'col',
					y: 'row',
					color: 'level',
					inset: 1.5,
					radius: 2
				})
			],
			scales: {
				x: {
					scale: () => scaleBand<number>().domain(calendar.cols).padding(0),
					axis: {
						line: false,
						ticks: {
							size: 0,
							values: calendar.monthTicks,
							format: (c: number) => calendar.monthOf.get(c) ?? ''
						}
					}
				},
				y: {
					scale: () => scaleBand<number>().domain([0, 1, 2, 3, 4, 5, 6]).padding(0),
					axis: {
						line: false,
						ticks: { size: 0, values: [1, 3, 5], format: (r: number) => WEEKDAYS[r] }
					}
				}
			},
			color: {
				domain: [0, 1, 2, 3, 4],
				range: [0, 1, 2, 3, 4].map((l) => `var(--heat-${l})`)
			},
			tooltip: {
				use: tooltip,
				format: (p) => `${dayLong(p.datum.day)}: ${plural(p.datum.v, 'revisão', 'revisões')}`
			}
		})
	);

	// ---------- Adicionados ----------
	const added = $derived.by(() => {
		const from = rangeFrom(addedRange, stats.firstDay);
		const size = bucketSize(1 - from);
		const sums: Record<number, number> = {};
		let total = 0;
		for (const a of stats.added) {
			if (a.day < from) continue;
			const key = from + Math.floor((a.day - from) / size) * size;
			sums[key] = (sums[key] ?? 0) + a.n;
			total += a.n;
		}
		const rows: BarRow[] = [];
		for (let d = from; d <= 0; d += size) {
			const v = sums[d] ?? 0;
			rows.push({
				x: d,
				n: v,
				label: dayLabel(d),
				tip: `${spanLabel(d, Math.min(size, 1 - d))}: ${plural(v, 'palavra', 'palavras')}`
			});
		}
		return { rows, total, perDay: total / (1 - from) };
	});

	// ---------- Contagem ----------
	const countTotal = $derived(Object.values(stats.counts).reduce((a, b) => a + b, 0));
	const countsChart = $derived.by(() => {
		const rows = COUNT_LABELS.map(([k, label]) => ({ label, v: stats.counts[k] }));
		const tick = new Map(rows.map((r) => [r.label, `${r.label}  ${n(r.v)}`]));
		return defineChart({
			marks: [
				barX(rows, {
					x: 'v',
					y: 'label',
					fill: 'var(--k-1)',
					inset: 3,
					radius: [0, 3, 3, 0]
				})
			],
			scales: {
				x: {
					scale: scaleLinear,
					nice: true,
					grid: true,
					axis: { line: false, ticks: { size: 0, count: 4 } }
				},
				y: {
					scale: () =>
						scaleBand<string>()
							.domain(rows.map((r) => r.label))
							.padding(0.1),
					axis: { line: false, ticks: { size: 0, format: (l: string) => tick.get(l) ?? l } }
				}
			},
			tooltip: {
				use: tooltip,
				format: (p) =>
					`${p.datum.label}: ${plural(p.datum.v, 'cartão', 'cartões')} (${pct(countTotal ? p.datum.v / countTotal : null)})`
			}
		});
	});

	// ---------- Histogramas ----------
	function spreadMax(values: readonly number[], spread: Spread) {
		if (spread === '1m') return 30;
		if (spread === '50') return Math.max(1, percentile(values, 0.5));
		if (spread === '95') return Math.max(1, percentile(values, 0.95));
		return Math.max(1, ...values);
	}
	function histRows(
		values: readonly number[],
		max: number,
		unit: (from: number, to: number) => string
	) {
		const h = histogram(values, max, 40);
		const rows: BarRow[] = h.bins.map((b) => ({
			x: b.from,
			n: b.n,
			label: String(b.from),
			tip: `${unit(b.from, b.to)}: ${plural(b.n, 'cartão', 'cartões')}`
		}));
		return { rows, over: h.over };
	}
	const days = (from: number, to: number) =>
		from === to ? plural(from, 'dia', 'dias') : `${n(from)} a ${n(to)} dias`;
	const avg = (values: readonly number[]) =>
		values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;

	const intervals = $derived(
		histRows(stats.intervals, spreadMax(stats.intervals, intervalSpread), days)
	);
	const stability = $derived(
		histRows(stats.stability, spreadMax(stats.stability, stabilitySpread), days)
	);
	const difficulty = $derived.by(() => {
		const rows: BarRow[] = [];
		for (let from = 0; from < 100; from += 5) {
			const v = stats.difficulty.filter(
				(d) => d >= from && (from === 95 ? d <= 100 : d < from + 5)
			).length;
			rows.push({
				x: from,
				n: v,
				label: `${from}%`,
				tip: `${from}% a ${from === 95 ? 100 : from + 4}%: ${plural(v, 'cartão', 'cartões')}`
			});
		}
		return rows;
	});

	// ---------- Por hora ----------
	const hours = $derived(stats.hours[hoursRange]);
	const hourRows = $derived<BarRow[]>(
		hours.map((h) => ({
			x: h.hour,
			n: h.total,
			label: `${h.hour}h`,
			tip: `${h.hour}h: ${plural(h.total, 'revisão', 'revisões')} · ${pct(h.total ? h.correct / h.total : null)} de acerto`
		}))
	);
	const hourChart = $derived.by(() => {
		const rows = hours
			.filter((h) => h.total > 0)
			.map((h) => ({ hour: h.hour, rate: h.correct / h.total, total: h.total }));
		return defineChart({
			marks: [
				lineY(rows, {
					x: 'hour',
					y: 'rate',
					stroke: 'var(--kind-recente)',
					strokeWidth: 2,
					points: true
				})
			],
			scales: {
				x: {
					scale: () =>
						scalePoint<number>()
							.domain(Array.from({ length: 24 }, (_, i) => i))
							.padding(0.5),
					axis: { ticks: { size: 0, format: (h: number) => `${h}h` } }
				},
				y: {
					scale: scaleLinear().domain([0, 1]),
					grid: true,
					axis: {
						line: false,
						ticks: { size: 0, values: [0, 0.5, 1], format: (v: number) => pct(v) }
					}
				}
			},
			tooltip: {
				use: tooltip,
				format: (p) => `${p.datum.hour}h: ${pct(p.datum.rate)} de acerto em ${n(p.datum.total)}`
			}
		});
	});

	// ---------- Botões ----------
	const buttons = $derived(stats.buttons[buttonsRange]);
	const buttonsChart = $derived.by(() => {
		const rows = BUTTON_GROUPS.flatMap(([g, label]) =>
			GRADES.map((grade) => ({
				group: label,
				grade: GRADE_LABELS[grade],
				v: buttons[g][grade - 1],
				share: (() => {
					const t = buttons[g].reduce((a, b) => a + b, 0);
					return t ? buttons[g][grade - 1] / t : null;
				})()
			}))
		);
		return defineChart({
			marks: [
				barY(rows, {
					x: 'group',
					y: 'v',
					color: 'grade',
					layout: group(),
					inset: 1,
					radius: [3, 3, 0, 0]
				})
			],
			scales: {
				x: {
					scale: () =>
						scaleBand<string>()
							.domain(BUTTON_GROUPS.map(([, l]) => l))
							.padding(0.2),
					axis: { ticks: { size: 0 } }
				},
				y: {
					scale: scaleLinear,
					nice: true,
					grid: true,
					axis: { line: false, ticks: { size: 0, count: 4 } }
				}
			},
			color: {
				domain: GRADES.map((g) => GRADE_LABELS[g]),
				range: GRADES.map((g) => `var(--grade-${g})`)
			},
			tooltip: {
				use: tooltip,
				format: (p) =>
					`${p.datum.group} · ${p.datum.grade}: ${n(p.datum.v)} (${pct(p.datum.share)})`
			}
		});
	});
	const buttonsCorrect = (g: (typeof BUTTON_GROUPS)[number][0]) => {
		const [again, ...rest] = buttons[g];
		const t = again + rest.reduce((a, b) => a + b, 0);
		return t === 0 ? null : (t - again) / t;
	};

	// ---------- Retenção ----------
	const sum = (a: PassFail, b: PassFail): PassFail => ({
		pass: a.pass + b.pass,
		fail: a.fail + b.fail
	});
</script>

<svelte:head>
	<title>Estatísticas · Linguetta</title>
</svelte:head>

{#snippet seg<T extends string>(
	options: [T, string][],
	value: T,
	set: (v: T) => void,
	label: string
)}
	<div class="seg" role="group" aria-label={label}>
		{#each options as [k, l] (k)}
			<button type="button" aria-pressed={value === k} onclick={() => set(k)}>{l}</button>
		{/each}
	</div>
{/snippet}

{#snippet legend(items: [string, string][])}
	<ul class="legend">
		{#each items as [color, label] (label)}
			<li><i style:background={color}></i>{label}</li>
		{/each}
	</ul>
{/snippet}

<div class="ph">
	<div>
		<h1>Estatísticas</h1>
		<p>Seu estudo de {langName}. Os dias viram no horário que você escolheu no perfil.</p>
	</div>
</div>

<div class="stats">
	<section class="tile wide">
		<header><h2>Hoje</h2></header>
		{#if today.cards === 0}
			<p class="lead">Nenhuma revisão hoje ainda.</p>
		{:else}
			<p class="lead">
				Você estudou <b>{plural(today.cards, 'cartão', 'cartões')}</b>
				{#if today.ms > 0}em <b>{minutes(today.ms)}</b>
					({Math.round(today.ms / today.cards / 1000)} s por cartão){/if}.
			</p>
			<dl class="facts">
				<div>
					<dt>Errei</dt>
					<dd>{n(today.again)} <span>({pct(todayCorrect)} de acerto)</span></dd>
				</div>
				{#each REVIEW_KINDS as [k, label] (k)}
					<div>
						<dt>{label}</dt>
						<dd>{n(today.byKind[k])}</dd>
					</div>
				{/each}
				<div>
					<dt>Acerto nas maduras</dt>
					<dd>
						{#if today.matureTotal > 0}{n(today.matureCorrect)} de {n(today.matureTotal)}
							<span>({pct(today.matureCorrect / today.matureTotal)})</span>{:else}—{/if}
					</dd>
				</div>
			</dl>
		{/if}
		<dl class="facts streak">
			<div>
				<dt>Sequência atual</dt>
				<dd>{plural(stats.streak.current, 'dia', 'dias')}</dd>
			</div>
			<div>
				<dt>Maior sequência</dt>
				<dd>{plural(stats.streak.longest, 'dia', 'dias')}</dd>
			</div>
		</dl>
	</section>

	<section class="tile wide">
		<header>
			<div>
				<h2>Previsão</h2>
				<p>Quantas revisões vencem em cada dia. As atrasadas contam para hoje.</p>
			</div>
			{@render seg(
				RANGES.filter(([k]) => k !== 'tudo') as [Exclude<Range, 'tudo'>, string][],
				forecastRange,
				(v) => (forecastRange = v),
				'Período da previsão'
			)}
		</header>
		<Bars rows={forecast.rows} ariaLabel="Revisões previstas por dia" />
		<dl class="facts">
			<div>
				<dt>Total</dt>
				<dd>{n(forecast.total)}</dd>
			</div>
			<div>
				<dt>Média</dt>
				<dd>{forecast.perDay.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} por dia</dd>
			</div>
			<div>
				<dt>Amanhã</dt>
				<dd>{n(stats.forecast[1] ?? 0)}</dd>
			</div>
			<div>
				<dt>Atrasadas</dt>
				<dd>{n(stats.overdue)}</dd>
			</div>
			{#if stats.beyond > 0}<div>
					<dt>Depois de 1 ano</dt>
					<dd>{n(stats.beyond)}</dd>
				</div>{/if}
		</dl>
	</section>

	<section class="tile wide">
		<header>
			<div>
				<h2>Calendário</h2>
				<p>Revisões por dia no último ano. Cor mais forte, mais revisões.</p>
			</div>
		</header>
		<Chart
			class="chart"
			definition={calendarChart}
			ariaLabel="Revisões por dia no último ano"
			height={150}
		/>
		<dl class="facts">
			<div>
				<dt>Dias estudados</dt>
				<dd>
					{n(calendar.studied)} de {n(calendar.span)}
					<span>({pct(calendar.studied / calendar.span)})</span>
				</dd>
			</div>
			<div>
				<dt>Média nos dias estudados</dt>
				<dd>
					{calendar.studied
						? Math.round(calendar.total / calendar.studied).toLocaleString('pt-BR')
						: 0} revisões
				</dd>
			</div>
		</dl>
	</section>

	<section class="tile wide">
		<header>
			<div>
				<h2>Revisões</h2>
				<p>
					O que você revisou em cada {reviews.size === 1
						? 'dia'
						: reviews.size === 7
							? 'semana'
							: 'mês'}.
				</p>
			</div>
			<div class="ctl">
				{@render seg(
					[
						['n', 'Quantidade'],
						['t', 'Tempo']
					],
					reviewsTime ? 't' : 'n',
					(v) => (reviewsTime = v === 't'),
					'Medida'
				)}
				{@render seg(RANGES, reviewsRange, (v) => (reviewsRange = v), 'Período das revisões')}
			</div>
		</header>
		{#if reviews.rows.length === 0}
			<p class="none">Sem revisões neste período.</p>
		{:else}
			<Chart
				class="chart"
				definition={reviewsChart}
				ariaLabel="Revisões por dia, por tipo"
				height={220}
			/>
		{/if}
		{@render legend(
			REVIEW_KINDS.map(([k, l]) => [
				`var(--kind-${k})`,
				`${l} ${reviewsTime ? minutes(reviews.byKind[k]) : n(reviews.byKind[k])}`
			])
		)}
		<dl class="facts">
			<div>
				<dt>Dias estudados</dt>
				<dd>
					{n(reviews.studied)} de {n(reviews.days)}
					<span>({pct(reviews.studied / reviews.days)})</span>
				</dd>
			</div>
			<div>
				<dt>Total</dt>
				<dd>{plural(reviews.totals.n, 'revisão', 'revisões')}</dd>
			</div>
			<div>
				<dt>Média nos dias estudados</dt>
				<dd>{reviews.studied ? Math.round(reviews.totals.n / reviews.studied) : 0} por dia</dd>
			</div>
			<div>
				<dt>Tempo</dt>
				<dd>{minutes(reviews.totals.ms)}</dd>
			</div>
		</dl>
	</section>

	<section class="tile">
		<header>
			<div>
				<h2>Contagem</h2>
				<p>{plural(countTotal, 'cartão', 'cartões')}. Maduros têm intervalo de 21 dias ou mais.</p>
			</div>
		</header>
		<Chart class="chart" definition={countsChart} ariaLabel="Cartões por estado" height={230} />
	</section>

	<section class="tile">
		<header>
			<div>
				<h2>Retenção verdadeira</h2>
				<p>Quanto você acertou dos cartões em revisão. A meta é a retenção desejada.</p>
			</div>
		</header>
		<table class="ret">
			<thead>
				<tr><th></th><th>Recentes</th><th>Maduros</th><th>Total</th></tr>
			</thead>
			<tbody>
				{#each stats.retention as row (row.label)}
					{@const total = sum(row.recente, row.madura)}
					<tr>
						<th scope="row">{row.label}</th>
						{#each [row.recente, row.madura, total] as pfv, i (i)}
							<td title="{n(pfv.pass)} acertos, {n(pfv.fail)} erros">{pct(retentionRate(pfv))}</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
		<p class="note">
			Meta: {pct(data.shell?.retention ?? 0.9)}. Passe o mouse para ver acertos e erros.
		</p>
	</section>

	<section class="tile">
		<header>
			<div>
				<h2>Intervalos</h2>
				<p>Daqui a quantos dias cada cartão em revisão volta.</p>
			</div>
			{@render seg(SPREADS, intervalSpread, (v) => (intervalSpread = v), 'Faixa dos intervalos')}
		</header>
		{#if stats.intervals.length === 0}
			<p class="none">Nenhum cartão em revisão ainda.</p>
		{:else}
			<Bars rows={intervals.rows} ariaLabel="Cartões por intervalo em dias" />
			<p class="note">
				Média de {plural(
					Math.round(avg(stats.intervals) ?? 0),
					'dia',
					'dias'
				)}{#if intervals.over > 0}
					· {plural(intervals.over, 'cartão', 'cartões')} fora da faixa{/if}
			</p>
		{/if}
	</section>

	<section class="tile">
		<header>
			<div>
				<h2>Estabilidade</h2>
				<p>Em quantos dias a chance de lembrar cai para 90%.</p>
			</div>
			{@render seg(SPREADS, stabilitySpread, (v) => (stabilitySpread = v), 'Faixa da estabilidade')}
		</header>
		{#if stats.stability.length === 0}
			<p class="none">Nenhum cartão estudado ainda.</p>
		{:else}
			<Bars rows={stability.rows} ariaLabel="Cartões por estabilidade em dias" />
			<p class="note">
				Média de {plural(
					Math.round(avg(stats.stability) ?? 0),
					'dia',
					'dias'
				)}{#if stability.over > 0}
					· {plural(stability.over, 'cartão', 'cartões')} fora da faixa{/if}
			</p>
		{/if}
	</section>

	<section class="tile">
		<header>
			<div>
				<h2>Dificuldade</h2>
				<p>Quanto mais alta, menos o intervalo cresce a cada acerto.</p>
			</div>
		</header>
		{#if stats.difficulty.length === 0}
			<p class="none">Nenhum cartão estudado ainda.</p>
		{:else}
			<Bars rows={difficulty} ariaLabel="Cartões por dificuldade" />
			<p class="note">Média de {Math.round(avg(stats.difficulty) ?? 0)}%</p>
		{/if}
	</section>

	<section class="tile">
		<header>
			<div>
				<h2>Adicionadas</h2>
				<p>Palavras novas no seu banco.</p>
			</div>
			{@render seg(RANGES, addedRange, (v) => (addedRange = v), 'Período das adicionadas')}
		</header>
		<Bars rows={added.rows} ariaLabel="Palavras adicionadas por dia" />
		<p class="note">
			{plural(added.total, 'palavra', 'palavras')} · {added.perDay.toLocaleString('pt-BR', {
				maximumFractionDigits: 1
			})} por dia
		</p>
	</section>

	<section class="tile wide">
		<header>
			<div>
				<h2>Distribuição por hora</h2>
				<p>Quando você revisa e quanto acerta em cada hora.</p>
			</div>
			{@render seg(RANGES, hoursRange, (v) => (hoursRange = v), 'Período por hora')}
		</header>
		<div class="pair">
			<div>
				<h3>Revisões</h3>
				<Bars rows={hourRows} ariaLabel="Revisões por hora do dia" height={180} />
			</div>
			<div>
				<h3>Acerto</h3>
				<Chart
					class="chart"
					definition={hourChart}
					ariaLabel="Taxa de acerto por hora do dia"
					height={180}
				/>
			</div>
		</div>
	</section>

	<section class="tile wide">
		<header>
			<div>
				<h2>Botões de resposta</h2>
				<p>Como você respondeu em cada tipo de cartão.</p>
			</div>
			{@render seg(RANGES, buttonsRange, (v) => (buttonsRange = v), 'Período dos botões')}
		</header>
		<Chart
			class="chart"
			definition={buttonsChart}
			ariaLabel="Respostas por botão e tipo de cartão"
			height={220}
		/>
		{@render legend(GRADES.map((g) => [`var(--grade-${g})`, GRADE_LABELS[g]]))}
		<dl class="facts">
			{#each BUTTON_GROUPS as [g, label] (g)}
				<div>
					<dt>{label}</dt>
					<dd>
						{pct(buttonsCorrect(g))} de acerto
						<span>({n(buttons[g].reduce((a, b) => a + b, 0))})</span>
					</dd>
				</div>
			{/each}
		</dl>
	</section>
</div>

<style>
	/* Paletas validadas (CVD e contraste) para o creme e o carvão do app. */
	.stats {
		--surface: #f6f2ea;
		--k-1: #2f73d0;
		--kind-aprender: #2f73d0;
		--kind-recente: #3fae6a;
		--kind-madura: #0f6e3c;
		--kind-reaprender: #e8703f;
		--grade-1: #d9573a;
		--grade-2: #b07ad8;
		--grade-3: #3fae6a;
		--grade-4: #2f73d0;
		--heat-0: rgba(17, 38, 26, 0.06);
		--heat-1: #c4e3cc;
		--heat-2: #84c79a;
		--heat-3: #3f9d63;
		--heat-4: #0f6e3c;
		--ts-chart-tooltip-background: var(--raise);
		--ts-chart-tooltip-color: var(--ink);
		--ts-chart-tooltip-border: 1px solid var(--line-2);
		--ts-chart-tooltip-border-radius: var(--r-m);
		--ts-chart-tooltip-shadow: 0 8px 24px rgba(17, 30, 22, 0.12);
		--ts-chart-tooltip-font: 14px/1.45 var(--f-body);

		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 16px;
	}
	:global(.tema-escuro) .stats {
		--surface: #201d1a;
		--k-1: #3a82dc;
		--kind-aprender: #3a82dc;
		--kind-recente: #46a86c;
		--kind-madura: #127242;
		--kind-reaprender: #de6c37;
		--grade-1: #de6c37;
		--grade-2: #a97bdc;
		--grade-3: #46a86c;
		--grade-4: #3a82dc;
		--heat-0: rgba(247, 241, 230, 0.06);
		--heat-1: #1f4a30;
		--heat-2: #2a6e45;
		--heat-3: #3f9d63;
		--heat-4: #7ccf95;
		--ts-chart-tooltip-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
	}
	.tile {
		gap: 14px;
	}
	.wide {
		grid-column: 1 / -1;
	}
	header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
		flex-wrap: wrap;
	}
	h2 {
		margin: 0;
		font: 600 18px/1.3 var(--f-head);
	}
	h3 {
		margin: 0 0 6px;
		font-size: 14px;
		font-weight: 500;
		color: var(--ink-3);
	}
	header p {
		margin: 4px 0 0;
		font-size: 14.5px;
		color: var(--ink-3);
		text-wrap: pretty;
	}
	.ctl {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.lead {
		margin: 0;
		font-size: 17px;
	}
	.none,
	.note {
		margin: 0;
		font-size: 14.5px;
		color: var(--ink-3);
	}
	.none {
		padding: 32px 0;
		text-align: center;
	}
	.stats :global(.chart) {
		color: var(--ink-3);
		font-size: 12.5px;
	}
	.facts {
		display: flex;
		flex-wrap: wrap;
		gap: 10px 28px;
		margin: 0;
	}
	.facts div {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.facts dt {
		font-size: 13.5px;
		color: var(--ink-3);
	}
	.facts dd {
		margin: 0;
		font-size: 16px;
		font-weight: 500;
		font-variant-numeric: tabular-nums;
	}
	.facts dd span {
		font-weight: 400;
		color: var(--ink-3);
	}
	.streak {
		padding-top: 12px;
		border-top: 1px solid var(--line);
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 18px;
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: 14px;
		color: var(--ink-2);
		font-variant-numeric: tabular-nums;
	}
	.legend li {
		display: inline-flex;
		align-items: center;
		gap: 7px;
	}
	.legend i {
		width: 10px;
		height: 10px;
		border-radius: 3px;
	}
	.pair {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 24px;
	}
	.ret {
		width: 100%;
		border-collapse: collapse;
		font-size: 15px;
		font-variant-numeric: tabular-nums;
	}
	.ret th,
	.ret td {
		padding: 7px 8px;
		text-align: right;
		border-bottom: 1px solid var(--line);
	}
	.ret thead th {
		font-size: 13.5px;
		font-weight: 500;
		color: var(--ink-3);
	}
	.ret tbody th {
		text-align: left;
		font-weight: 400;
		color: var(--ink-2);
	}
	.ret tr:last-child > * {
		border-bottom: 0;
	}
	@media (max-width: 860px) {
		.stats,
		.pair {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
