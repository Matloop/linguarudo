// Sequências aleatórias de ações da pessoa, com manias aleatórias do player: as regras
// de invariants.ts valem em todo passo. Quando quebra, o fast-check encolhe a
// sequência até o menor caso e o erro mostra a regra.

import { expect, test } from 'bun:test';
import fc from 'fast-check';
import type { MusicEvent } from '../controller.ts';
import { checkAll } from './invariants.ts';
import { SIM_LYRICS, Simulator } from './simulator.ts';

type Action =
	| { kind: 'wait'; ms: number }
	| { kind: 'answer'; pick: number }
	| { kind: 'event'; event: MusicEvent };

const LINES = SIM_LYRICS.length;
const line = fc.integer({ min: -1, max: LINES });

const action: fc.Arbitrary<Action> = fc.oneof(
	{
		weight: 6,
		arbitrary: fc.integer({ min: 16, max: 6_000 }).map((ms) => ({ kind: 'wait' as const, ms }))
	},
	{
		weight: 4,
		arbitrary: fc.integer({ min: 0, max: 4 }).map((pick) => ({ kind: 'answer' as const, pick }))
	},
	{
		weight: 8,
		arbitrary: fc
			.oneof(
				fc.constant<MusicEvent>({ type: 'togglePause' }),
				fc.constant<MusicEvent>({ type: 'repeat' }),
				fc.constant<MusicEvent>({ type: 'toggleSpeed' }),
				fc.constant<MusicEvent>({ type: 'retry' }),
				fc.constant<MusicEvent>({ type: 'continue' }),
				fc.constant<MusicEvent>({ type: 'leave' }),
				fc.constant<MusicEvent>({ type: 'backToStart' }),
				fc.record({
					type: fc.constant('openCard' as const),
					line,
					token: fc.integer({ min: 0, max: 12 })
				}),
				fc.constant<MusicEvent>({ type: 'closeCard' }),
				fc.constant<MusicEvent>({ type: 'openSync' }),
				fc.boolean().map((conclude): MusicEvent => ({ type: 'closeSync', conclude })),
				line.map((l): MusicEvent => ({ type: 'selectLine', line: l })),
				fc.constantFrom(-1, 1).map((delta): MusicEvent => ({ type: 'moveSelection', delta })),
				fc.constant<MusicEvent>({ type: 'mark' }),
				fc
					.record({ delta: fc.constantFrom(-5, -1, -0.1, 0.1, 1, 5), merge: fc.boolean() })
					.map((n): MusicEvent => ({ type: 'nudge', ...n })),
				fc
					.record({ offset: fc.double({ min: -40, max: 40, noNaN: true }), merge: fc.boolean() })
					.map((o): MusicEvent => ({ type: 'setOffset', ...o })),
				fc.constant<MusicEvent>({ type: 'zero' }),
				fc.constant<MusicEvent>({ type: 'undo' }),
				fc
					.integer({ min: 0, max: 4 })
					.map((index): MusicEvent => ({ type: 'deleteAnchor', index })),
				fc.constant<MusicEvent>({ type: 'acceptRate' }),
				fc.constant<MusicEvent>({ type: 'syncTogglePlay' }),
				fc
					.record({ to: fc.double({ min: -5, max: 45, noNaN: true }), play: fc.boolean() })
					.map((s): MusicEvent => ({ type: 'syncSeek', ...s })),
				fc.constant<MusicEvent>({ type: 'hidden' })
			)
			.map((event) => ({ kind: 'event' as const, event }))
	}
);

const quirks = fc.record({
	seekLagMs: fc.constantFrom(0, 150, 600),
	keyframeS: fc.constantFrom(0, 1, 2.5),
	seekPlays: fc.boolean(),
	bufferMs: fc.constantFrom(0, 200, 900),
	stateLagMs: fc.constantFrom(0, 40, 300),
	autoplayBlocked: fc.boolean(),
	metadataDelayMs: fc.constantFrom(0, 800),
	jitterS: fc.constantFrom(0, 0.08, 0.25)
});

test('as regras valem em qualquer sequência de ações e manias do player', () => {
	fc.assert(
		fc.property(quirks, fc.array(action, { maxLength: 40 }), (player, actions) => {
			const sim = new Simulator({ player: { ...player, duration: 30 }, frameMs: 33 });
			sim.start();
			for (const a of actions) {
				if (a.kind === 'wait') sim.run(a.ms);
				else if (a.kind === 'answer') {
					const options = sim.view.answerable?.options ?? [];
					sim.send({ type: 'answer', option: options[a.pick] ?? 'nada' });
				} else if (a.event.type === 'backToStart') {
					sim.send(a.event);
					sim.start();
				} else sim.send(a.event);
			}
			sim.run(500);
			const violations = checkAll(sim.steps, sim.session);
			if (violations.length > 0) throw new Error(violations.slice(0, 5).join('\n'));
		}),
		{ numRuns: 300, seed: Number(process.env.FC_SEED ?? 20261111) }
	);
	expect(true).toBe(true);
}, 30_000);
