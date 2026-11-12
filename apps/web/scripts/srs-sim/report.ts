// Junta as sementes de scripts/srs-sim/out e escreve o resumo no terminal e em report.html.
// Uso: bun scripts/srs-sim/report.ts <pasta out>
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Day = {
	day: number;
	known: number;
	reviews: number;
	new: number;
	seconds: number;
	dueReviews: number;
	dueOk: number;
};
type Run = {
	days: Day[];
	knownEnd: number;
	knownIn30: number;
	seen: number;
	params: Record<string, unknown>;
	sameAnswers?: {
		reviews: number;
		byGrade: { grade: number; n: number; anki: number | null; linguetta: number | null }[];
	};
};

const out = process.argv[2];
if (!out) throw new Error('uso: report.ts <pasta out>');
const seeds = readdirSync(out)
	.filter((d) => d.startsWith('seed-'))
	.map((d) => join(out, d));
const load = (f: string): Run[] => seeds.map((s) => JSON.parse(readFileSync(join(s, f), 'utf8')));

const ENGINES = [
	{ id: 'sm2', label: 'Anki (SM-2, padrão)', runs: load('anki-sm2.json') },
	{ id: 'fsrs', label: 'Anki (FSRS)', runs: load('anki-fsrs.json') },
	{ id: 'linguetta', label: 'Linguetta', runs: load('linguetta-vs-sm2.json') }
];
const params = ENGINES[0].runs[0].params;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
function stat(runs: Run[], f: (r: Run) => number) {
	const xs = runs.map(f);
	return { mean: mean(xs), min: Math.min(...xs), max: Math.max(...xs) };
}

const rows = ENGINES.map((e) => {
	const minutes = stat(e.runs, (r) => sum(r.days.map((d) => d.seconds)) / 60);
	const answers = stat(e.runs, (r) => sum(r.days.map((d) => d.reviews)));
	const retention = stat(
		e.runs,
		(r) => sum(r.days.map((d) => d.dueOk)) / Math.max(1, sum(r.days.map((d) => d.dueReviews)))
	);
	const knownEnd = stat(e.runs, (r) => r.knownEnd);
	const knownIn30 = stat(e.runs, (r) => r.knownIn30);
	const perHour = stat(e.runs, (r) => r.knownEnd / (sum(r.days.map((d) => d.seconds)) / 3600));
	const lastWeek = stat(e.runs, (r) => mean(r.days.slice(-7).map((d) => d.seconds / 60)));
	return { ...e, minutes, answers, retention, knownEnd, knownIn30, perHour, lastWeek };
});

// Média por dia, para os gráficos.
const nDays = ENGINES[0].runs[0].days.length;
const daily = (e: (typeof ENGINES)[number], f: (d: Day) => number) =>
	Array.from({ length: nDays }, (_, i) => mean(e.runs.map((r) => f(r.days[i]))));

// ---------- terminal ----------
const f0 = (x: number) => x.toFixed(0);
const f1 = (x: number) => x.toFixed(1);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const range = (s: { mean: number; min: number; max: number }, f: (x: number) => string) =>
	`${f(s.mean)} (${f(s.min)}–${f(s.max)})`;
console.log(
	`\n${seeds.length} sementes · ${params.days} dias · ${params.notes} palavras · ${params.new} novas/dia · retenção desejada ${params.retention}\n`
);
console.table(
	Object.fromEntries(
		rows.map((r) => [
			r.label,
			{
				'minutos (total)': range(r.minutes, f0),
				respostas: range(r.answers, f0),
				'min/dia (última semana)': range(r.lastWeek, f1),
				'acerto nas revisões': range(r.retention, pct),
				'sabe no dia 30': range(r.knownEnd, f0),
				'sabe 30 dias depois, sem estudar': range(r.knownIn30, f0),
				'palavras por hora de estudo': range(r.perHour, f1)
			}
		])
	)
);

function sameAnswers(file: string) {
	const runs = load(file);
	return [1, 2, 3, 4].map((g) => {
		const all = runs.map((r) => r.sameAnswers!.byGrade.find((b) => b.grade === g)!);
		const n = sum(all.map((b) => b.n));
		const w = (k: 'anki' | 'linguetta') => sum(all.map((b) => (b[k] ?? 0) * b.n)) / Math.max(1, n);
		return { grade: g, n, anki: w('anki'), linguetta: w('linguetta') };
	});
}
const GRADE = ['', 'Errei', 'Difícil', 'Bom', 'Fácil'];
const same = {
	sm2: sameAnswers('linguetta-vs-sm2.json'),
	fsrs: sameAnswers('linguetta-vs-fsrs.json')
};
for (const [mode, list] of Object.entries(same)) {
	console.log(`\nMesmas respostas do Anki ${mode.toUpperCase()}, intervalo médio em dias:`);
	console.table(
		Object.fromEntries(
			list.map((g) => [
				GRADE[g.grade],
				{ respostas: g.n, Anki: f1(g.anki), Linguetta: f1(g.linguetta) }
			])
		)
	);
}

// ---------- HTML ----------
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const series = (f: (d: Day) => number) =>
	rows.map((r, i) => ({ label: r.label, slot: i + 1, values: daily(r, f) }));
const charts = [
	{ title: 'Minutos de estudo por dia', unit: 'min', fmt: 0, data: series((d) => d.seconds / 60) },
	{
		title: 'Palavras que o aluno lembra (de manhã, antes de estudar)',
		unit: 'palavras',
		fmt: 0,
		data: series((d) => d.known)
	}
];

const tableRows = rows
	.map(
		(r, i) => `<tr><th scope="row"><span class="key s${i + 1}"></span>${esc(r.label)}</th>
<td>${range(r.minutes, f0)}</td><td>${range(r.lastWeek, f1)}</td><td>${range(r.retention, pct)}</td>
<td>${range(r.knownEnd, f0)}</td><td>${range(r.knownIn30, f0)}</td><td>${range(r.perHour, f1)}</td></tr>`
	)
	.join('');
const sameRows = (list: (typeof same)['sm2']) =>
	list
		.map(
			(g) =>
				`<tr><th scope="row">${GRADE[g.grade]}</th><td>${g.n}</td><td>${f1(g.anki)} d</td><td>${f1(g.linguetta)} d</td></tr>`
		)
		.join('');

const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Anki × Linguetta: ${params.days} dias</title>
<style>
.viz-root{color-scheme:light;--surface-1:#fcfcfb;--text-primary:#0b0b0b;--text-secondary:#52514e;--text-muted:#8a8984;--grid:#e6e5e1;
--series-1:#2a78d6;--series-2:#eb6834;--series-3:#1baf7a;
font:14px/1.45 system-ui,sans-serif;background:var(--surface-1);color:var(--text-primary);margin:0;padding:28px 32px;max-width:1080px}
@media (prefers-color-scheme:dark){.viz-root{color-scheme:dark;--surface-1:#1a1a19;--text-primary:#f0efec;--text-secondary:#c3c2b7;--text-muted:#8f8e86;--grid:#2e2e2c;
--series-1:#3987e5;--series-2:#d95926;--series-3:#199e70}}
body{margin:0;background:var(--surface-1)}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:28px 0 8px}
p.sub{color:var(--text-secondary);margin:0 0 20px}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
th,td{text-align:right;padding:6px 10px;border-bottom:1px solid var(--grid)}
th:first-child{text-align:left}thead th{color:var(--text-secondary);font-weight:500;font-size:12px}
.key{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:8px;vertical-align:-1px}
.s1{background:var(--series-1)}.s2{background:var(--series-2)}.s3{background:var(--series-3)}
.legend{display:flex;gap:18px;color:var(--text-secondary);font-size:12px;margin:4px 0 8px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:28px}
.chart{position:relative}.chart svg{width:100%;height:auto;overflow:visible}
.tip{position:absolute;pointer-events:none;background:var(--surface-1);border:1px solid var(--grid);border-radius:6px;padding:6px 9px;font-size:12px;
box-shadow:0 2px 8px #0002;display:none;white-space:nowrap;font-variant-numeric:tabular-nums}
.tip b{display:block;color:var(--text-secondary);font-weight:500;margin-bottom:2px}
.note{color:var(--text-secondary);font-size:13px;max-width:780px}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:28px}
</style></head>
<body><main class="viz-root">
<h1>Anki × Linguetta: ${params.days} dias de estudo simulado</h1>
<p class="sub">${seeds.length} sementes · ${params.notes} palavras · ${params.new} novas por dia · retenção desejada ${params.retention} · mesmo aluno virtual nos três. Valores: média (mínimo–máximo entre sementes).</p>
<table><thead><tr><th></th><th>Minutos (total)</th><th>Min/dia na última semana</th><th>Acerto nas revisões</th><th>Lembra no dia ${params.days}</th><th>Lembra 30 dias depois, sem estudar</th><th>Palavras por hora</th></tr></thead>
<tbody>${tableRows}</tbody></table>
<div class="legend">${rows.map((r, i) => `<span><span class="key s${i + 1}"></span>${esc(r.label)}</span>`).join('')}</div>
<div class="grid2">${charts.map((_, i) => `<div class="chart" id="c${i}"></div>`).join('')}</div>
<h2>As mesmas respostas, intervalos diferentes</h2>
<p class="note">As respostas que o aluno deu no Anki, reaplicadas no FSRS do Linguetta (o que o import faz). Só revisões de cartões que já estavam em dias. Intervalo médio que cada um deu.</p>
<div class="pair">
<table><caption style="text-align:left;color:var(--text-secondary);padding-bottom:4px">Contra o Anki SM-2</caption><thead><tr><th>Nota</th><th>Respostas</th><th>Anki</th><th>Linguetta</th></tr></thead><tbody>${sameRows(same.sm2)}</tbody></table>
<table><caption style="text-align:left;color:var(--text-secondary);padding-bottom:4px">Contra o Anki FSRS</caption><thead><tr><th>Nota</th><th>Respostas</th><th>Anki</th><th>Linguetta</th></tr></thead><tbody>${sameRows(same.fsrs)}</tbody></table>
</div>
<h2>Como ler</h2>
<p class="note">O aluno virtual tem memória própria, que não é FSRS: esquecimento exponencial, cada palavra com uma dificuldade escondida e ganho maior quando a revisão vem perto de esquecer. Ele erra ou acerta por sorteio com essa probabilidade, e quando acerta escolhe Difícil 15%, Bom 75% e Fácil 10%. Os números dependem desse modelo; o que vale comparar é a diferença entre os agendadores com o mesmo aluno. "Lembra" é a soma das probabilidades de lembrar de cada palavra vista.</p>
</main>
<script>
const CHARTS = ${JSON.stringify(charts)};
const W = 500, H = 260, M = { t: 16, r: 12, b: 28, l: 44 };
function nice(max) { const p = 10 ** Math.floor(Math.log10(max)); const s = [1, 2, 2.5, 5, 10].find((k) => k * p * 5 >= max); return s * p; }
CHARTS.forEach((c, ci) => {
  const el = document.getElementById('c' + ci);
  const n = c.data[0].values.length;
  const step = nice(Math.max(...c.data.flatMap((s) => s.values)));
  const top = Math.ceil(Math.max(...c.data.flatMap((s) => s.values)) / step) * step;
  const x = (i) => M.l + (i / (n - 1)) * (W - M.l - M.r);
  const y = (v) => H - M.b - (v / top) * (H - M.t - M.b);
  let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + c.title + '">';
  svg += '<text x="0" y="0" dy="-2" fill="var(--text-primary)" font-size="13" font-weight="600">' + c.title + '</text>';
  for (let v = 0; v <= top; v += step) svg += '<line x1="' + M.l + '" x2="' + (W - M.r) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--grid)"/>' +
    '<text x="' + (M.l - 6) + '" y="' + y(v) + '" dy="4" text-anchor="end" fill="var(--text-muted)" font-size="11">' + v + '</text>';
  for (let i = 0; i < n; i += 5) svg += '<text x="' + x(i) + '" y="' + (H - 8) + '" text-anchor="middle" fill="var(--text-muted)" font-size="11">dia ' + (i + 1) + '</text>';
  c.data.forEach((s) => {
    svg += '<path d="' + s.values.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join('') + '" fill="none" stroke="var(--series-' + s.slot + ')" stroke-width="2" stroke-linejoin="round"/>';
  });
  svg += '<line class="xh" y1="' + M.t + '" y2="' + (H - M.b) + '" stroke="var(--text-muted)" stroke-dasharray="3 3" visibility="hidden"/>';
  c.data.forEach((s) => { svg += '<circle class="dot" r="4" fill="var(--series-' + s.slot + ')" stroke="var(--surface-1)" stroke-width="2" visibility="hidden"/>'; });
  svg += '<rect x="' + M.l + '" y="' + M.t + '" width="' + (W - M.l - M.r) + '" height="' + (H - M.t - M.b) + '" fill="transparent"/></svg>';
  el.innerHTML = svg + '<div class="tip"></div>';
  const root = el.querySelector('svg'), tip = el.querySelector('.tip'), xh = el.querySelector('.xh'), dots = el.querySelectorAll('.dot');
  root.addEventListener('pointermove', (ev) => {
    const r = root.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - M.l) / (W - M.l - M.r)) * (n - 1))));
    xh.setAttribute('x1', x(i)); xh.setAttribute('x2', x(i)); xh.setAttribute('visibility', 'visible');
    c.data.forEach((s, k) => { dots[k].setAttribute('cx', x(i)); dots[k].setAttribute('cy', y(s.values[i])); dots[k].setAttribute('visibility', 'visible'); });
    tip.innerHTML = '<b>dia ' + (i + 1) + '</b>' + c.data.map((s) => '<span class="key s' + s.slot + '"></span>' + s.label + ': ' + s.values[i].toFixed(c.fmt) + ' ' + c.unit).join('<br>');
    tip.style.display = 'block';
    const left = (x(i) / W) * r.width;
    tip.style.left = (left > r.width / 2 ? left - tip.offsetWidth - 12 : left + 12) + 'px';
    tip.style.top = '24px';
  });
  root.addEventListener('pointerleave', () => { tip.style.display = 'none'; xh.setAttribute('visibility', 'hidden'); dots.forEach((d) => d.setAttribute('visibility', 'hidden')); });
});
</script></body></html>`;
writeFileSync(join(out, 'report.html'), html);
console.log(`\nRelatório: ${join(out, 'report.html')}`);
