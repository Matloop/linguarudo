import { describe, expect, test } from 'bun:test';
import type { LyricLine } from './lrc.ts';
import { mulberry32 } from './rng.ts';
import { buildSession } from './session.ts';

// Versos inventados. Nenhuma letra real.
const VERSES = [
	'Lantern light on the quiet meadow',
	'Paper boats on the silver harbor',
	'Counting stars above the orchard',
	'Whispers travel through the tunnel',
	'Gentle thunder over the compass',
	'Pocket full of ribbon and feathers',
	'Blanket folded by the window',
	'Kettle singing in the morning',
	'Pillow dreams and puzzle pieces',
	'Anchor dropped beside the castle',
	'Mirror shining in the bottle',
	'Engine humming down the valley'
];
const lyrics: LyricLine[] = VERSES.map((text, i) => ({
	index: i,
	start: i * 4 + 1,
	end: i * 4 + 5,
	text
}));

const build = (over: Partial<Parameters<typeof buildSession>[0]> = {}) =>
	buildSession({
		lyrics,
		lang: 'en',
		difficulty: 'medio',
		bank: new Map(),
		rng: mulberry32(21),
		...over
	});

describe('buildSession', () => {
	test('cria uma lacuna por linha escolhida, com 4 opções únicas contendo a resposta', () => {
		const s = build();
		expect(s.gaps).toHaveLength(6);
		for (const g of s.gaps) {
			expect(g.options).toHaveLength(4);
			expect(new Set(g.options.map((o) => o.toLowerCase())).size).toBe(4);
			expect(g.options).toContain(g.answer);
		}
	});

	test('nenhuma opção errada é palavra da própria linha', () => {
		for (let seed = 1; seed <= 20; seed++) {
			const s = build({ rng: mulberry32(seed), difficulty: 'dificil' });
			for (const g of s.gaps) {
				const inLine = new Set(
					s.lines[g.line].tokens.map((t) => t.key).filter((k): k is string => k !== null)
				);
				for (const o of g.options.filter((x) => x !== g.answer)) {
					expect(inLine.has(o.toLowerCase())).toBe(false);
				}
			}
		}
	});

	test('a configuração do jogo reproduz os tempos das linhas e as lacunas', () => {
		const s = build();
		expect(s.config.lines).toEqual(lyrics.map((l) => ({ start: l.start, end: l.end })));
		expect(s.config.gaps.map((g) => g.line)).toEqual(s.gaps.map((g) => g.line));
		expect(s.config.gaps[0].answer).toBe(s.gaps[0].answer);
	});

	test('palavras do banco viram lacuna e trazem a tradução', () => {
		const s = build({
			difficulty: 'facil',
			bank: new Map([
				['harbor', 'porto'],
				['valley', 'vale']
			])
		});
		const harbor = s.gaps.find((g) => g.key === 'harbor');
		expect(harbor?.inBank).toBe(true);
		expect(harbor?.sense).toBe('porto');
		expect(s.gaps.find((g) => g.key === 'valley')?.inBank).toBe(true);
	});

	test('conta quantas lacunas vêm do banco (para a tela de início)', () => {
		const s = build({ difficulty: 'facil', bank: new Map([['harbor', 'porto']]) });
		expect(s.fromBank).toBe(1);
	});

	test('sem letra suficiente devolve sessão vazia, sem quebrar', () => {
		const s = build({ lyrics: [] });
		expect(s.gaps).toEqual([]);
		expect(s.lines).toEqual([]);
	});
});
