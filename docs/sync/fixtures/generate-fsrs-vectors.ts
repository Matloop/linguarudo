// Gera fsrs-vectors.json com o agendador real do servidor (apps/web/src/lib/server/scheduler.ts,
// ts-fsrs 6.0.0, FSRS-7, retenção 0,9, fuzz ligado). Rode da raiz do repo:
//   bun docs/sync/fixtures/generate-fsrs-vectors.ts > docs/sync/fixtures/fsrs-vectors.json
// Cada passo é o flashcard depois de aplicar a revisão, como o servidor grava em flashcards.

import { readFileSync } from 'node:fs';
import { replay, type LogEntry } from '../../../apps/web/src/lib/server/scheduler.ts';
import { DEFAULT_RETENTION } from '../../../apps/web/src/lib/review.ts';
import type { Grade } from '../../../apps/web/src/lib/review.ts';

type Step = [Grade, string];
interface Case {
	name: string;
	note: string;
	flashcardId: string;
	createdAt: string;
	reviews: Step[];
}

const cases: Case[] = [
	{
		name: 'bom-sempre',
		note: 'Novo, depois Bom em cada vencimento (aprendizado → revisão, fuzz nos intervalos longos).',
		flashcardId: '0b9f3c2e-6a51-4d7e-9c1a-3f2b8d4e5a01',
		createdAt: '2026-11-01T12:00:00.000Z',
		reviews: [
			[3, '2026-11-01T12:00:00.000Z'],
			[3, '2026-11-01T12:10:30.000Z'],
			[3, '2026-11-02T09:00:00.000Z'],
			[3, '2026-11-05T20:15:00.000Z'],
			[3, '2026-11-15T08:00:00.000Z'],
			[3, '2026-12-20T08:00:00.000Z'],
			[3, '2027-03-30T08:00:00.000Z']
		]
	},
	{
		name: 'erros-e-lapsos',
		note: 'Errei no aprendizado, depois um lapso em revisão (reaprendendo) e volta.',
		flashcardId: '5d2a7e10-0c43-4b8f-a6d9-71e0c4b2f902',
		createdAt: '2026-11-01T12:00:00.000Z',
		reviews: [
			[1, '2026-11-01T12:00:00.000Z'],
			[1, '2026-11-01T12:01:10.000Z'],
			[3, '2026-11-01T12:02:30.000Z'],
			[3, '2026-11-01T12:13:00.000Z'],
			[3, '2026-11-02T18:00:00.000Z'],
			[1, '2026-11-08T07:30:00.000Z'],
			[3, '2026-11-08T07:41:00.000Z'],
			[2, '2026-11-09T21:00:00.000Z'],
			[3, '2026-11-12T10:00:00.000Z']
		]
	},
	{
		name: 'facil-e-dificil',
		note: 'Fácil direto do novo, depois Difícil e Fácil em revisão.',
		flashcardId: 'a7c41f88-2e0b-4c55-8d13-9b6e2f7a0c03',
		createdAt: '2026-10-20T08:00:00.000Z',
		reviews: [
			[4, '2026-11-01T12:00:00.000Z'],
			[2, '2026-11-10T12:00:00.000Z'],
			[4, '2026-11-25T12:00:00.000Z'],
			[2, '2027-01-15T12:00:00.000Z']
		]
	},
	{
		name: 'atrasado-e-adiantado',
		note: 'Revisão muito atrasada (meses) e revisão antes do vencimento.',
		flashcardId: 'c3e85b21-9f7d-4a2c-b0e4-5d1f6a8c9b04',
		createdAt: '2026-06-01T00:00:00.000Z',
		reviews: [
			[3, '2026-06-01T10:00:00.000Z'],
			[3, '2026-06-01T10:10:00.000Z'],
			[3, '2026-06-02T10:00:00.000Z'],
			[3, '2026-11-11T10:00:00.000Z'],
			[3, '2026-11-12T10:00:00.000Z'],
			[1, '2026-11-12T10:05:00.000Z']
		]
	},
	{
		name: 'fora-de-ordem',
		note: 'O log chega fora de ordem (o aparelho estava offline). Os passos estão em ordem de reviewed_at, que é como o servidor reaplica; o campo arrivalOrder mostra a ordem em que chegaram.',
		flashcardId: 'e1f02d3c-7b6a-4958-8e2f-0a9c1b3d4e05',
		createdAt: '2026-11-01T09:00:00.000Z',
		reviews: [
			[3, '2026-11-01T09:00:00.000Z'],
			[3, '2026-11-01T09:12:00.000Z'],
			[2, '2026-11-03T22:00:00.000Z'],
			[3, '2026-11-04T07:00:00.000Z'],
			[4, '2026-11-09T07:00:00.000Z']
		]
	}
];

const arrivalOrder: Record<string, number[]> = { 'fora-de-ordem': [0, 1, 3, 2, 4] };

const tsFsrsVersion = JSON.parse(
	readFileSync(new URL('../../../apps/web/node_modules/ts-fsrs/package.json', import.meta.url), 'utf8')
).version as string;

const out = {
	generatedBy: 'docs/sync/fixtures/generate-fsrs-vectors.ts',
	tsFsrs: tsFsrsVersion,
	scheduler: {
		version: 'FSRS-7',
		desiredRetention: DEFAULT_RETENTION,
		enableFuzz: true,
		enableShortTerm: true,
		learningSteps: ['1m', '10m'],
		relearningSteps: ['10m'],
		allowModelOverride: false,
		maximumInterval: 36500,
		weights: 'default (FSRS7_DEFAULT_WEIGHTS)',
		fuzzSeed: 'flashcardId + String(reps after the review)'
	},
	tolerance: { float: 1e-6, dueAtMs: 1000 },
	cases: [] as unknown[]
};

for (const c of cases) {
	const steps = [];
	for (let i = 1; i <= c.reviews.length; i++) {
		const logs: LogEntry[] = c.reviews.slice(0, i).map(([rating, reviewed_at]) => ({ rating, reviewed_at }));
		const { card } = await replay({ id: c.flashcardId, created_at: c.createdAt }, logs);
		const [rating, reviewedAt] = c.reviews[i - 1];
		steps.push({ rating, reviewedAt, expected: card });
	}
	out.cases.push({
		name: c.name,
		note: c.note,
		flashcardId: c.flashcardId,
		createdAt: c.createdAt,
		...(arrivalOrder[c.name] ? { arrivalOrder: arrivalOrder[c.name] } : {}),
		steps
	});
}

console.log(JSON.stringify(out, null, '\t'));
