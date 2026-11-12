import { describe, expect, test } from 'bun:test';
import {
	EMPTY_SYNC,
	EMPTY_TIMELINE,
	durationHint,
	formatOffset,
	lineAt,
	lineHash,
	lineTimings,
	lyricTimeAt,
	nudgeSegment,
	offsetAt,
	parseStoredSync,
	parseSyncUpdate,
	resolveSync,
	serializeSync,
	suggestRate,
	syncFromRefs,
	withAnchor,
	withoutAnchor,
	withRate,
	type StoredSync,
	type Timeline
} from './timeline.ts';

// 8 linhas de 3 s a partir de 1 s, como a letra dos testes de ponta a ponta.
const LINES = Array.from({ length: 8 }, (_, i) => ({
	start: 1 + 3 * i,
	end: 4 + 3 * i,
	text: `verso número ${i + 1}`
}));
const WORK = '0b7a3c1e-8f7d-4a51-9c3e-2d1f0a9b8c7d';

const tap = (tl: Timeline, line: number, video: number) => withAnchor(tl, LINES, { line, video });

describe('sem âncoras', () => {
	test('o vídeo segue a letra', () => {
		const t = lineTimings(EMPTY_TIMELINE, LINES);
		expect(t[0]).toEqual({ start: 1, end: 4, present: true });
		expect(t[7]).toEqual({ start: 22, end: 25, present: true });
	});
});

describe('uma âncora (intro mais longa)', () => {
	test('desloca todas as linhas, inclusive as de antes dela', () => {
		const tl = tap(EMPTY_TIMELINE, 2, 17); // linha 3 (7 s na letra) cai em 17 s
		const t = lineTimings(tl, LINES);
		expect(t[0].start).toBe(11);
		expect(t[2].start).toBe(17);
		expect(t[7].start).toBe(32);
		expect(offsetAt(tl, LINES, 0)).toBe(10);
	});
});

describe('bug: a letra sai do tempo no meio da música', () => {
	// O clipe tem a intro 10 s maior e uma pausa de 8 s inserida antes da linha 5.
	const truth = (i: number) => LINES[i].start + 10 + (i >= 4 ? 8 : 0);

	test('com um deslocamento só, metade da música fica errada', () => {
		const t = lineTimings(tap(EMPTY_TIMELINE, 0, truth(0)), LINES);
		expect(t[5].start).not.toBe(truth(5));
	});

	test('com uma âncora por trecho, todas as linhas batem', () => {
		let tl = tap(EMPTY_TIMELINE, 0, truth(0));
		tl = tap(tl, 4, truth(4));
		const t = lineTimings(tl, LINES);
		for (let i = 0; i < LINES.length; i++) expect(t[i].start).toBeCloseTo(truth(i), 5);
	});

	test('a linha que acaba na pausa termina antes do próximo trecho', () => {
		let tl = tap(EMPTY_TIMELINE, 0, 11);
		tl = tap(tl, 4, 29);
		const t = lineTimings(tl, LINES);
		expect(t[3].end).toBeLessThanOrEqual(29);
	});
});

describe('trecho cortado no clipe', () => {
	test('linhas que cairiam depois da próxima âncora ficam ausentes', () => {
		// O clipe pula as linhas 3 e 4: a linha 5 (13 s na letra) entra logo em 8 s.
		let tl = tap(EMPTY_TIMELINE, 0, 1);
		tl = tap(tl, 4, 8);
		const t = lineTimings(tl, LINES);
		expect(t.map((x) => x.present)).toEqual([true, true, true, false, true, true, true, true]);
		expect(lineAt(t, 7.5)).toBe(2);
		expect(lineAt(t, 8)).toBe(4);
	});
});

describe('lineAt', () => {
	test('antes da primeira linha é -1', () => {
		expect(lineAt(lineTimings(EMPTY_TIMELINE, LINES), 0.5)).toBe(-1);
		expect(lineAt(lineTimings(EMPTY_TIMELINE, LINES), 4)).toBe(1);
	});
});

describe('marcar', () => {
	test('marcar a mesma linha de novo troca a âncora', () => {
		let tl = tap(EMPTY_TIMELINE, 2, 17);
		tl = tap(tl, 2, 18.25);
		expect(tl.anchors).toEqual([{ line: 2, video: 18.25 }]);
	});

	test('âncoras fora de ordem com a nova caem', () => {
		let tl = tap(EMPTY_TIMELINE, 1, 10);
		tl = tap(tl, 5, 30);
		tl = tap(tl, 3, 35); // depois da linha 6 no vídeo: a âncora da linha 6 sai
		expect(tl.anchors.map((a) => a.line)).toEqual([1, 3]);
	});

	test('marcar de novo a mesma linha troca a marca', () => {
		let tl = tap(EMPTY_TIMELINE, 3, 20);
		tl = tap(tl, 3, 21);
		expect(tl.anchors).toEqual([{ line: 3, video: 21 }]);
	});

	test('linha inexistente, tempo inválido ou longe demais é ignorado', () => {
		expect(tap(EMPTY_TIMELINE, 9, 10)).toBe(EMPTY_TIMELINE);
		expect(tap(EMPTY_TIMELINE, 0, Number.NaN)).toBe(EMPTY_TIMELINE);
		expect(tap(EMPTY_TIMELINE, 0, 900)).toBe(EMPTY_TIMELINE);
	});

	test('apagar uma âncora', () => {
		let tl = tap(EMPTY_TIMELINE, 0, 5);
		tl = tap(tl, 4, 20);
		expect(withoutAnchor(tl, 0).anchors).toEqual([{ line: 4, video: 20 }]);
	});
});

describe('ajuste fino', () => {
	test('sem âncoras cria uma na linha', () => {
		const tl = nudgeSegment(EMPTY_TIMELINE, LINES, 2, 0.1);
		expect(tl.anchors).toEqual([{ line: 2, video: 7.1 }]);
	});

	test('move só o trecho da linha e não passa da vizinha', () => {
		let tl = tap(EMPTY_TIMELINE, 0, 5);
		tl = tap(tl, 4, 20);
		const moved = nudgeSegment(tl, LINES, 2, 1);
		expect(moved.anchors.map((a) => a.video)).toEqual([6, 20]);
		const blocked = nudgeSegment(tl, LINES, 5, -30);
		expect(blocked.anchors[1].video).toBe(5.05);
	});
});

describe('sugestão de velocidade', () => {
	test('3 âncoras numa reta mais lenta sugerem o fator', () => {
		let tl = EMPTY_TIMELINE;
		for (const i of [0, 3, 7]) tl = tap(tl, i, 2 + LINES[i].start * 1.04);
		expect(suggestRate(tl, LINES)).toBeCloseTo(1.04, 3);
	});

	test('com 2 âncoras ou deslocamentos de trecho (pausa inserida) não sugere', () => {
		let two = tap(EMPTY_TIMELINE, 0, 3);
		two = tap(two, 7, 30);
		expect(suggestRate(two, LINES)).toBeNull();
		let steps = tap(EMPTY_TIMELINE, 0, 11);
		steps = tap(steps, 3, 20);
		steps = tap(steps, 4, 31);
		steps = tap(steps, 7, 40);
		expect(suggestRate(steps, LINES)).toBeNull();
	});

	test('aceitar fixa o fator e as linhas acompanham', () => {
		const tl = withRate(tap(EMPTY_TIMELINE, 0, 1), 1.05);
		expect(lineTimings(tl, LINES)[7].start).toBeCloseTo(1 + 21 * 1.05, 5);
		expect(withRate(EMPTY_TIMELINE, 2).rate).toBe(1.1);
	});
});

describe('palpite e formato', () => {
	test('durationHint', () => {
		expect(durationHint(220, 208)).toBe(12);
		expect(durationHint(209, 208)).toBeNull();
		expect(durationHint(0, 208)).toBeNull();
		expect(durationHint(220, null)).toBeNull();
	});

	test('formatOffset', () => {
		expect(formatOffset(12.46)).toBe('+12,5 s');
		expect(formatOffset(-0.4)).toBe('−0,4 s');
		expect(formatOffset(-0.01)).toBe('+0,0 s');
	});
});

describe('guardar e reencontrar', () => {
	test('o hash ignora acento, caixa e pontuação', () => {
		expect(lineHash('Perché, AMORE!')).toBe(lineHash('perche amore'));
		expect(lineHash('perche amore')).toMatch(/^[0-9a-f]{8}$/);
		expect(lineHash('outra')).not.toBe(lineHash('perche amore'));
	});

	test('ida e volta pela forma guardada', () => {
		let tl = tap(EMPTY_TIMELINE, 0, 5);
		tl = tap(tl, 4, 22.5);
		const stored = serializeSync(tl, LINES, { hintDismissed: true, lrclibId: 42 });
		expect(parseStoredSync(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
		expect(resolveSync(stored, LINES)).toEqual({ timeline: tl, dropped: 0 });
	});

	test('letra deslocada uns segundos: acha a linha pelo texto e mantém o deslocamento', () => {
		const stored = serializeSync(tap(EMPTY_TIMELINE, 2, 17), LINES, {
			hintDismissed: false,
			lrclibId: null
		});
		const shifted = LINES.map((l) => ({ ...l, start: l.start + 2, end: l.end + 2 }));
		const { timeline, dropped } = resolveSync(stored, shifted);
		expect(dropped).toBe(0);
		expect(timeline.anchors).toEqual([{ line: 2, video: 19 }]);
	});

	test('linha que sumiu da letra: a âncora cai e conta', () => {
		const stored = serializeSync(tap(EMPTY_TIMELINE, 2, 17), LINES, {
			hintDismissed: false,
			lrclibId: null
		});
		const other = LINES.map((l) => ({ ...l, text: `${l.text} (ao vivo)` }));
		expect(resolveSync(stored, other).dropped).toBe(1);
	});

	test('refs sem sincronia ou inválida viram vazia', () => {
		expect(syncFromRefs(null)).toEqual(EMPTY_SYNC);
		expect(syncFromRefs({ lyrics_sync: { v: 2 } })).toEqual(EMPTY_SYNC);
	});

	test('validação do corpo do POST', () => {
		const sync: StoredSync = {
			...EMPTY_SYNC,
			anchors: [{ lyric: 7, video: 17, hash: 'abcdef01' }]
		};
		expect(parseSyncUpdate({ workId: WORK, sync })).toEqual({ workId: WORK, sync });
		expect(parseSyncUpdate({ workId: 'x', sync })).toBeNull();
		const bad = (patch: object) => parseSyncUpdate({ workId: WORK, sync: { ...sync, ...patch } });
		expect(bad({ rate: 1.5 })).toBeNull();
		expect(bad({ hintDismissed: 'sim' })).toBeNull();
		expect(bad({ lrclibId: -3 })).toBeNull();
		expect(bad({ anchors: [{ lyric: 7, video: 400, hash: 'abcdef01' }] })).toBeNull();
		expect(bad({ anchors: [{ lyric: 7, video: 17, hash: 'xyz' }] })).toBeNull();
		expect(bad({ anchors: Array(65).fill(sync.anchors[0]) })).toBeNull();
	});
});

describe('inverso: vídeo → letra', () => {
	test('sem âncoras, só a velocidade', () => {
		expect(lyricTimeAt(EMPTY_TIMELINE, LINES, 10)).toBe(10);
	});

	test('cada trecho volta pela sua âncora', () => {
		const tl = tap(tap(EMPTY_TIMELINE, 0, 11), 4, 31);
		expect(lyricTimeAt(tl, LINES, 5)).toBeCloseTo(-5);
		expect(lyricTimeAt(tl, LINES, 14)).toBeCloseTo(4);
		expect(lyricTimeAt(tl, LINES, 32)).toBeCloseTo(14);
	});

	test('ida e volta dá a mesma linha', () => {
		const tl = withRate(tap(tap(EMPTY_TIMELINE, 1, 9), 5, 30), 1.05);
		const t = lineTimings(tl, LINES);
		for (let i = 0; i < LINES.length; i++) {
			if (t[i].present) expect(lyricTimeAt(tl, LINES, t[i].start)).toBeCloseTo(LINES[i].start);
		}
	});
});
