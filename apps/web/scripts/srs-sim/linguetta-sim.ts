// Lado Linguetta: lê o .apkg que o anki_sim.py gerou e
// 1. estuda o mesmo baralho, com o mesmo aluno virtual e os mesmos parâmetros, usando o
//    agendador de verdade (scheduler.ts) e a fila de verdade (buildQueue);
// 2. reaplica as respostas que o aluno deu no Anki no FSRS do Linguetta (o que o import
//    faz) e compara, resposta a resposta, o intervalo que cada um daria.
//
// Uso: bun scripts/srs-sim/linguetta-sim.ts <anki-xxx.json> <saida.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { unzipSync } from 'fflate';
import { decompress } from 'fzstd';
import initSqlJs from 'sql.js';
import { readPackage } from '#lib/anki/package.ts';
import {
	LEARN_AHEAD_MS,
	STATE_NEW,
	STATE_REVIEW,
	buildQueue,
	nextDayStart,
	type Grade
} from '#lib/review.ts';
import { applyRating, replaySteps, type FlashcardRow } from '#lib/server/scheduler.ts';
import { Student } from './student.ts';

const DAY = 86400;
const [ankiJsonPath, outPath] = process.argv.slice(2);
if (!ankiJsonPath || !outPath)
	throw new Error('uso: linguetta-sim.ts <anki-xxx.json> <saida.json>');
const anki = JSON.parse(readFileSync(ankiJsonPath, 'utf8'));
const p = anki.params as {
	mode: string;
	days: number;
	new: number;
	retention: number;
	seed: string;
	start: string;
};
const apkgPath = join(dirname(ankiJsonPath), `anki-${p.mode}.apkg`);
const apkg = new Uint8Array(readFileSync(apkgPath));
const SQL = await initSqlJs();
const col = readPackage(apkg, SQL).collection;

const guidByNote = new Map(col.notes.map((n) => [n.id, n.guid]));
const start = Date.parse(p.start.replace(' ', 'T') + 'Z') / 1000;
const iso = (s: number) => new Date(s * 1000).toISOString();
const createdAt = iso(start - DAY);

// ---------- 1. Estudo no Linguetta ----------

type SimCard = FlashcardRow & { key: string; createdAt: string };
const cards: SimCard[] = [...col.cards]
	.sort((a, b) => Number(a.id) - Number(b.id))
	.map((c, i) => ({
		id: `c${String(i).padStart(5, '0')}`,
		key: guidByNote.get(c.noteId)!,
		createdAt,
		due_at: createdAt,
		stability: 0,
		stability_fast: 0,
		difficulty: 0,
		state: STATE_NEW,
		schedule_status: 'new',
		last_review_at: null,
		reps: 0,
		lapses: 0,
		scheduled_days: 0,
		learning_step: 0
	}));

// Dia de estudo do aluno: vira às 04:00 UTC, antes da sessão das 08:00.
const SIM_CLOCK = { timeZone: 'UTC', startHour: 4 };
const isLearning = (c: SimCard) => c.state === 1 || c.state === 3;
const student = new Student(p.seed);
const days = [];
const delays: number[] = [];
for (let day = 0; day < p.days; day++) {
	let now = start + day * DAY;
	const dayEnd = nextDayStart(new Date(now * 1000), SIM_CLOCK);
	const stats = {
		day,
		known: student.known(now),
		reviews: 0,
		new: 0,
		seconds: 0,
		dueReviews: 0,
		dueOk: 0,
		/** Respostas por estado antes: 0 novo, 1 aprendendo, 2 revisão, 3 reaprendendo. */
		byType: [0, 0, 0, 0]
	};
	for (;;) {
		const queue = buildQueue(
			cards.map((c) => ({ ...c, itemId: null, dueAt: c.due_at })),
			{ now: new Date(now * 1000), dayEnd, newLimit: p.new, newDoneToday: stats.new }
		);
		let next: SimCard | undefined = queue[0] && cards.find((c) => c.id === queue[0].id);
		if (!next) {
			// Fila vazia: o errado que vence em até LEARN_AHEAD volta na mesma sessão.
			next = cards
				.filter((c) => isLearning(c) && Date.parse(c.due_at) <= now * 1000 + LEARN_AHEAD_MS)
				.sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at))[0];
		}
		if (!next) break;
		const before = next.state;
		if (before === STATE_REVIEW && next.last_review_at)
			delays.push(
				(now * 1000 - Date.parse(next.last_review_at)) / 86_400_000 - next.scheduled_days
			);
		stats.byType[before]++;
		const [grade, spent] = student.answer(next.key, now);
		now += spent;
		const { next: fields } = await applyRating(next, grade, new Date(now * 1000), p.retention);
		Object.assign(next, fields);
		stats.reviews++;
		stats.seconds += spent;
		if (before === STATE_NEW) stats.new++;
		if (before === STATE_REVIEW) {
			stats.dueReviews++;
			if (grade > 1) stats.dueOk++;
		}
	}
	days.push(stats);
}
const end = start + p.days * DAY;

// ---------- 2. Mesmas respostas do Anki, intervalos do Linguetta ----------

// O revlog do Anki guarda o intervalo que ele deu (ivl: dias se > 0, segundos se < 0).
function ankiIntervals(): Map<string, number> {
	const files = unzipSync(apkg);
	const raw =
		files['collection.anki21b'] ?? files['collection.anki21'] ?? files['collection.anki2'];
	const db = new SQL.Database(raw[0] === 0x28 ? decompress(raw) : raw);
	const out = new Map<string, number>();
	for (const [id, cid, ivl] of db.exec('select id, cid, ivl from revlog')[0]?.values ?? [])
		out.set(`${cid}:${id}`, Number(ivl) > 0 ? Number(ivl) : -Number(ivl) / DAY);
	db.close();
	return out;
}
const ankiIvl = ankiIntervals();
const logsByCard = new Map<
	string,
	{ rating: Grade; reviewed_at: string; at: number; type: number }[]
>();
for (const r of col.reviews) {
	if (r.ease < 1 || r.ease > 4) continue;
	const list = logsByCard.get(r.cardId) ?? [];
	list.push({
		rating: r.ease as Grade,
		reviewed_at: new Date(r.at).toISOString(),
		at: r.at,
		type: r.type
	});
	logsByCard.set(r.cardId, list);
}
type Pair = { grade: Grade; anki: number; linguetta: number };
const pairs: Pair[] = [];
for (const [cardId, logs] of logsByCard) {
	const { steps } = await replaySteps({ id: cardId, created_at: createdAt }, logs, p.retention);
	for (const s of steps) {
		// Só revisões de verdade (o cartão já estava em dias nos dois): passos de minutos não interessam.
		if (s.log.type !== 1 || s.stateBefore !== STATE_REVIEW) continue;
		const a = ankiIvl.get(`${cardId}:${s.log.at}`);
		if (a === undefined) continue;
		pairs.push({ grade: s.log.rating, anki: a, linguetta: s.intervalMs / 86_400_000 });
	}
}
const byGrade = ([1, 2, 3, 4] as const).map((g) => {
	const ps = pairs.filter((x) => x.grade === g);
	const mean = (f: (x: Pair) => number) =>
		ps.length ? ps.reduce((s, x) => s + f(x), 0) / ps.length : null;
	return { grade: g, n: ps.length, anki: mean((x) => x.anki), linguetta: mean((x) => x.linguetta) };
});

const result = {
	engine: 'linguetta',
	against: `anki-${p.mode}`,
	params: p,
	days,
	knownEnd: student.known(end),
	knownIn30: student.known(end + 30 * DAY),
	seen: student.mem.size,
	delays,
	sameAnswers: { reviews: pairs.length, byGrade }
};
writeFileSync(outPath, JSON.stringify(result, null, 1));
const total = (k: 'reviews' | 'seconds') => days.reduce((s, d) => s + d[k], 0);
console.log(
	`linguetta (vs anki-${p.mode}): ${total('reviews')} respostas, ${(total('seconds') / 60).toFixed(0)} min, ` +
		`sabe ${result.knownEnd.toFixed(0)}/${result.seen}`
);
