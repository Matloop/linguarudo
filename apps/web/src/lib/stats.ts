/**
 * Estatísticas no molde das do Anki: tudo agregado no servidor, por dia de estudo
 * do usuário (fuso + hora da virada). A página só fatia por período e desenha.
 */
import { dayStart, nextDayStart, type DayClock } from './review.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Intervalo a partir do qual o Anki chama a revisão de madura. */
export const MATURE_DAYS = 21;
/** Quantos dias à frente a previsão cobre. */
export const FORECAST_DAYS = 365;

export type Range = '1m' | '3m' | '1a' | 'tudo';
export const RANGES: [Range, string][] = [
	['1m', '1 mês'],
	['3m', '3 meses'],
	['1a', '1 ano'],
	['tudo', 'Tudo']
];
/** Dias de cada período; 'tudo' vai até o primeiro registro. */
export const RANGE_DAYS: Record<Exclude<Range, 'tudo'>, number> = { '1m': 30, '3m': 90, '1a': 365 };

export interface StatsCard {
	state: number;
	due_at: string;
	stability: number;
	difficulty: number;
	scheduled_days: number;
	/** Item marcado como "já sei": fora da revisão. */
	known: boolean;
}

/** Log com os metadados preenchidos (o servidor reconstrói os antigos). */
export interface StatsLog {
	rating: number;
	reviewed_at: string;
	duration_ms: number | null;
	state_before: number;
	last_interval_days: number;
}

/** Tipo de revisão, como no revlog do Anki. */
export type ReviewKind = 'aprender' | 'recente' | 'madura' | 'reaprender';
export const REVIEW_KINDS: [ReviewKind, string][] = [
	['aprender', 'Aprendendo'],
	['recente', 'Recentes'],
	['madura', 'Maduras'],
	['reaprender', 'Reaprendendo']
];

export function reviewKind(log: Pick<StatsLog, 'state_before' | 'last_interval_days'>): ReviewKind {
	if (log.state_before === 3) return 'reaprender';
	if (log.state_before === 2) return log.last_interval_days >= MATURE_DAYS ? 'madura' : 'recente';
	return 'aprender';
}

export type CountKey =
	'novos' | 'aprendendo' | 'reaprendendo' | 'recentes' | 'maduros' | 'conhecidos';
export const COUNT_LABELS: [CountKey, string][] = [
	['novos', 'Novos'],
	['aprendendo', 'Aprendendo'],
	['reaprendendo', 'Reaprendendo'],
	['recentes', 'Recentes'],
	['maduros', 'Maduros'],
	['conhecidos', 'Já sei']
];

export type ButtonGroup = 'aprendendo' | 'recentes' | 'maduros';
export const BUTTON_GROUPS: [ButtonGroup, string][] = [
	['aprendendo', 'Aprendendo'],
	['recentes', 'Recentes'],
	['maduros', 'Maduros']
];

/** Um dia com revisões. day é relativo a hoje (0 = hoje, -1 = ontem). */
export interface HistoryDay {
	day: number;
	n: Record<ReviewKind, number>;
	ms: Record<ReviewKind, number>;
	/** Respostas Errei no dia (para a retenção do calendário). */
	again: number;
}

export interface PassFail {
	pass: number;
	fail: number;
}

export interface RetentionRow {
	label: string;
	recente: PassFail;
	madura: PassFail;
}

export interface HourBucket {
	hour: number;
	total: number;
	correct: number;
}

export interface Stats {
	/** Início do dia de estudo de hoje (ISO); rótulos de dia saem daqui. */
	todayStart: string;
	/** Dia da semana de hoje no fuso do usuário (0 = domingo). */
	todayWeekday: number;
	/** Dia (relativo) do primeiro registro; 0 sem histórico. */
	firstDay: number;
	today: {
		cards: number;
		ms: number;
		again: number;
		byKind: Record<ReviewKind, number>;
		matureCorrect: number;
		matureTotal: number;
	};
	/** forecast[i] = revisões que vencem no dia i; atrasadas entram no dia 0. */
	forecast: number[];
	overdue: number;
	beyond: number;
	history: HistoryDay[];
	/** Itens adicionados por dia (relativo), só os dias com algum. */
	added: { day: number; n: number }[];
	counts: Record<CountKey, number>;
	/** Intervalo atual (dias) dos cartões em revisão. */
	intervals: number[];
	/** Estabilidade (dias) dos cartões já estudados. */
	stability: number[];
	/** Dificuldade 0–100 % dos cartões já estudados. */
	difficulty: number[];
	retention: RetentionRow[];
	hours: Record<Range, HourBucket[]>;
	buttons: Record<Range, Record<ButtonGroup, [number, number, number, number]>>;
	streak: { current: number; longest: number };
}

const zeroKinds = (): Record<ReviewKind, number> => ({
	aprender: 0,
	recente: 0,
	madura: 0,
	reaprender: 0
});

/**
 * Converte instantes em dias de estudo relativos a hoje. Monta as viradas uma vez
 * (do primeiro registro até a previsão) e faz busca binária, em vez de consultar
 * o fuso a cada log.
 */
export function dayIndexer(now: Date, clock: DayClock, earliestMs: number) {
	const today = dayStart(now, clock).getTime();
	const past: number[] = [];
	for (let t = today; t > earliestMs && past.length < 20_000;) {
		t = dayStart(new Date(t - 1), clock).getTime();
		past.push(t);
	}
	past.reverse();
	const future: number[] = [today];
	for (let i = 0; i <= FORECAST_DAYS; i++) {
		future.push(nextDayStart(new Date(future[future.length - 1]), clock).getTime());
	}
	const bounds = [...past, ...future];
	const zero = past.length;

	/** Último índice com bounds[i] <= t (ou -1). */
	function find(t: number) {
		let lo = 0;
		let hi = bounds.length - 1;
		if (t < bounds[0]) return -1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (bounds[mid] <= t) lo = mid;
			else hi = mid - 1;
		}
		return lo;
	}

	return {
		today,
		/** Dia relativo (pode passar de FORECAST_DAYS no fim do intervalo montado). */
		day(t: number): number {
			const i = find(t);
			if (i < 0) return -zero - Math.ceil((bounds[0] - t) / DAY);
			if (i === bounds.length - 1) return i - zero + Math.floor((t - bounds[i]) / DAY);
			return i - zero;
		},
		/** Hora local do relógio (a virada conta como startHour). */
		hour(t: number): number {
			const i = find(t);
			const start = i < 0 ? bounds[0] : bounds[i];
			const h = Math.floor((t - start) / HOUR);
			return (((clock.startHour + h) % 24) + 24) % 24;
		}
	};
}

function weekday(at: Date, timeZone: string): number {
	const name = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(at);
	return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name);
}

function streaks(days: Set<number>, firstDay: number) {
	let current = 0;
	// Hoje sem revisão ainda não quebra a sequência.
	for (let d = days.has(0) ? 0 : -1; days.has(d); d--) current++;
	let longest = 0;
	let run = 0;
	for (let d = firstDay; d <= 0; d++) {
		run = days.has(d) ? run + 1 : 0;
		longest = Math.max(longest, run);
	}
	return { current, longest };
}

export function buildStats(input: {
	cards: readonly StatsCard[];
	logs: readonly StatsLog[];
	/** created_at de cada item do idioma. */
	addedAt: readonly string[];
	now: Date;
	clock: DayClock;
}): Stats {
	const { cards, logs, addedAt, now, clock } = input;
	const times = logs.map((l) => Date.parse(l.reviewed_at));
	const addedTimes = addedAt.map((a) => Date.parse(a));
	// Sem spread: dezenas de milhares de argumentos estouram a pilha.
	const earliest = [...times, ...addedTimes].reduce((m, t) => (t < m ? t : m), now.getTime());
	const idx = dayIndexer(now, clock, earliest);
	const nowMs = now.getTime();

	// ---------- Histórico de revisões ----------
	const byDay = new Map<number, HistoryDay>();
	const today = {
		cards: 0,
		ms: 0,
		again: 0,
		byKind: zeroKinds(),
		matureCorrect: 0,
		matureTotal: 0
	};
	const rangeStart: Record<Range, number> = {
		'1m': -(RANGE_DAYS['1m'] - 1),
		'3m': -(RANGE_DAYS['3m'] - 1),
		'1a': -(RANGE_DAYS['1a'] - 1),
		tudo: -Infinity
	};
	const ranges = Object.keys(rangeStart) as Range[];
	const hours = Object.fromEntries(
		ranges.map((r) => [
			r,
			Array.from({ length: 24 }, (_, hour) => ({ hour, total: 0, correct: 0 }))
		])
	) as Record<Range, HourBucket[]>;
	const buttons = Object.fromEntries(
		ranges.map((r) => [
			r,
			{ aprendendo: [0, 0, 0, 0], recentes: [0, 0, 0, 0], maduros: [0, 0, 0, 0] }
		])
	) as Stats['buttons'];
	const retentionSpans: [string, number][] = [
		['Hoje', 0],
		['Ontem', -1],
		['Últimos 7 dias', -6],
		['Últimos 30 dias', -29],
		['Último ano', -364],
		['Desde o começo', -Infinity]
	];
	const retention: RetentionRow[] = retentionSpans.map(([label]) => ({
		label,
		recente: { pass: 0, fail: 0 },
		madura: { pass: 0, fail: 0 }
	}));
	let firstDay = 0;

	logs.forEach((log, i) => {
		const t = times[i];
		const day = idx.day(t);
		firstDay = Math.min(firstDay, day);
		const kind = reviewKind(log);
		const ms = log.duration_ms ?? 0;
		const pass = log.rating > 1;

		let entry = byDay.get(day);
		if (!entry) {
			entry = { day, n: zeroKinds(), ms: zeroKinds(), again: 0 };
			byDay.set(day, entry);
		}
		entry.n[kind]++;
		entry.ms[kind] += ms;
		if (!pass) entry.again++;

		if (day === 0) {
			today.cards++;
			today.ms += ms;
			today.byKind[kind]++;
			if (!pass) today.again++;
			if (kind === 'madura') {
				today.matureTotal++;
				if (pass) today.matureCorrect++;
			}
		}

		const group: ButtonGroup =
			kind === 'madura' ? 'maduros' : kind === 'recente' ? 'recentes' : 'aprendendo';
		const hour = idx.hour(t);
		const grade = Math.min(4, Math.max(1, log.rating)) - 1;
		for (const r of ranges) {
			if (day < rangeStart[r]) continue;
			hours[r][hour].total++;
			if (pass) hours[r][hour].correct++;
			buttons[r][group][grade]++;
		}

		// Retenção verdadeira: só revisões de cartões já em revisão.
		if (kind === 'recente' || kind === 'madura') {
			retentionSpans.forEach(([, from], j) => {
				const inSpan = from === -1 ? day === -1 : day >= from;
				if (!inSpan) return;
				const cell = retention[j][kind];
				if (pass) cell.pass++;
				else cell.fail++;
			});
		}
	});

	// ---------- Itens adicionados ----------
	const addedByDay = new Map<number, number>();
	for (const t of addedTimes) {
		const day = idx.day(t);
		firstDay = Math.min(firstDay, day);
		addedByDay.set(day, (addedByDay.get(day) ?? 0) + 1);
	}

	// ---------- Estado atual dos cartões ----------
	const forecast = new Array<number>(FORECAST_DAYS + 1).fill(0);
	let overdue = 0;
	let beyond = 0;
	const counts: Record<CountKey, number> = {
		novos: 0,
		aprendendo: 0,
		reaprendendo: 0,
		recentes: 0,
		maduros: 0,
		conhecidos: 0
	};
	const intervals: number[] = [];
	const stability: number[] = [];
	const difficulty: number[] = [];
	for (const c of cards) {
		if (c.known) {
			counts.conhecidos++;
			continue;
		}
		if (c.state === 0) {
			counts.novos++;
			continue;
		}
		if (c.state === 1) counts.aprendendo++;
		else if (c.state === 3) counts.reaprendendo++;
		else if (c.scheduled_days >= MATURE_DAYS) counts.maduros++;
		else counts.recentes++;

		if (c.state === 2) intervals.push(Math.max(0, Math.round(c.scheduled_days)));
		stability.push(Math.max(0, Math.round(c.stability)));
		difficulty.push(Math.round(((Math.min(10, Math.max(1, c.difficulty)) - 1) / 9) * 100));

		const due = Date.parse(c.due_at);
		const day = due <= nowMs ? 0 : idx.day(due);
		if (due <= nowMs) overdue++;
		if (day > FORECAST_DAYS) beyond++;
		else forecast[Math.max(0, day)]++;
	}

	const studied = new Set(byDay.keys());
	return {
		todayStart: new Date(idx.today).toISOString(),
		todayWeekday: weekday(new Date(idx.today + 12 * HOUR), clock.timeZone),
		firstDay,
		today,
		forecast,
		overdue,
		beyond,
		history: [...byDay.values()].sort((a, b) => a.day - b.day),
		added: [...addedByDay].map(([day, n]) => ({ day, n })).sort((a, b) => a.day - b.day),
		counts,
		intervals,
		stability,
		difficulty,
		retention,
		hours,
		buttons,
		streak: streaks(studied, firstDay)
	};
}

// ---------- Ajudas da página ----------

/** Primeiro dia (relativo) de um período passado. */
export function rangeFrom(range: Range, firstDay: number): number {
	return range === 'tudo' ? Math.min(0, firstDay) : -(RANGE_DAYS[range] - 1);
}

/** Tamanho do balde (em dias) para caber ~maxBars barras. */
export function bucketSize(days: number, maxBars = 60): number {
	if (days <= maxBars) return 1;
	if (days <= maxBars * 7) return 7;
	return Math.ceil(days / maxBars / 30) * 30;
}

/** Histograma de inteiros >= 0 em baldes de largura igual. */
export function histogram(values: readonly number[], maxValue: number, maxBars = 40) {
	const top = Math.max(1, maxValue);
	const width = Math.max(1, Math.ceil((top + 1) / maxBars));
	const bins = Array.from({ length: Math.ceil((top + 1) / width) }, (_, i) => ({
		from: i * width,
		to: i * width + width - 1,
		n: 0
	}));
	let over = 0;
	for (const v of values) {
		if (v > top) {
			over++;
			continue;
		}
		bins[Math.floor(v / width)].n++;
	}
	return { bins, width, over };
}

/** Percentil simples (para cortar a cauda longa dos intervalos). */
export function percentile(values: readonly number[], p: number): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

export function retentionRate(pf: PassFail): number | null {
	const total = pf.pass + pf.fail;
	return total === 0 ? null : pf.pass / total;
}
