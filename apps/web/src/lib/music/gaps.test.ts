import { describe, expect, test } from 'bun:test';
import { GAP_COUNTS, chooseGaps, isGapCandidate, spread, type GapLine } from './gaps.ts';
import { mulberry32 } from './rng.ts';
import { tokenize } from './tokenize.ts';

const line = (index: number, text: string, lang: 'en' | 'it' = 'en'): GapLine => ({
	index,
	tokens: tokenize(text, lang)
});

// 24 linhas inventadas, cada uma com uma palavra de conteúdo diferente.
const CONTENT = [
	'lantern',
	'meadow',
	'compass',
	'harbor',
	'blanket',
	'ribbon',
	'thunder',
	'orchard',
	'pillow',
	'mirror',
	'candle',
	'feather',
	'pocket',
	'saddle',
	'ticket',
	'window',
	'kettle',
	'basket',
	'puzzle',
	'tunnel',
	'anchor',
	'bottle',
	'castle',
	'engine'
];
const song = () => CONTENT.map((w, i) => line(i, `We keep the ${w} close`));

const opts = (difficulty: 'facil' | 'medio' | 'dificil', bank: string[] = []) => ({
	difficulty,
	lang: 'en' as const,
	bank: new Set(bank),
	rng: mulberry32(11)
});

describe('isGapCandidate', () => {
	test('exige palavra com 4+ letras que não seja palavra funcional', () => {
		expect(isGapCandidate('lantern', 'en')).toBe(true);
		expect(isGapCandidate('the', 'en')).toBe(false);
		expect(isGapCandidate('with', 'en')).toBe(false);
		expect(isGapCandidate('dell', 'it')).toBe(false);
		expect(isGapCandidate('acqua', 'it')).toBe(true);
	});
});

describe('spread', () => {
	test('escolhe k itens espalhados, mantendo a ordem', () => {
		expect(spread([0, 1, 2, 3, 4, 5, 6, 7], 4)).toEqual([1, 3, 5, 7]);
		expect(spread([1, 2, 3], 5)).toEqual([1, 2, 3]);
		expect(spread([1, 2, 3], 0)).toEqual([]);
	});
});

describe('chooseGaps', () => {
	test('o número de lacunas segue a dificuldade', () => {
		expect(GAP_COUNTS).toEqual({ facil: 4, medio: 6, dificil: 10 });
		for (const d of ['facil', 'medio', 'dificil'] as const) {
			expect(chooseGaps(song(), opts(d))).toHaveLength(GAP_COUNTS[d]);
		}
	});

	test('no máximo uma lacuna por linha, em ordem de linha', () => {
		const gaps = chooseGaps(song(), opts('dificil'));
		const lines = gaps.map((g) => g.line);
		expect(new Set(lines).size).toBe(lines.length);
		expect([...lines].sort((a, b) => a - b)).toEqual(lines);
	});

	test('a lacuna aponta para a palavra certa da linha', () => {
		const lines = song();
		for (const g of chooseGaps(lines, opts('medio'))) {
			const tok = lines[g.line].tokens[g.token];
			expect(tok.text).toBe(g.answer);
			expect(tok.key).toBe(g.key);
		}
	});

	test('sem palavras do banco, as lacunas ficam espalhadas pela música toda', () => {
		const lines = chooseGaps(song(), opts('facil')).map((g) => g.line);
		expect(Math.min(...lines)).toBeLessThan(6);
		expect(Math.max(...lines)).toBeGreaterThanOrEqual(18);
	});

	test('palavras que já estão no banco têm prioridade, mesmo no fim da música', () => {
		const gaps = chooseGaps(song(), opts('facil', ['engine', 'castle']));
		const answers = gaps.map((g) => g.key);
		expect(answers).toContain('engine');
		expect(answers).toContain('castle');
		expect(gaps.find((g) => g.key === 'engine')?.inBank).toBe(true);
		expect(gaps.filter((g) => !g.inBank)).toHaveLength(2);
	});

	test('com mais palavras do banco que lacunas, escolhe só n delas, espalhadas', () => {
		const gaps = chooseGaps(song(), opts('facil', CONTENT));
		expect(gaps).toHaveLength(4);
		expect(gaps.every((g) => g.inBank)).toBe(true);
		expect(Math.max(...gaps.map((g) => g.line))).toBeGreaterThanOrEqual(18);
	});

	test('numa linha com palavra do banco, a lacuna é essa palavra', () => {
		const lines = [line(0, 'Quiet lantern near the harbor'), ...song().slice(1)];
		const gaps = chooseGaps(lines, opts('facil', ['harbor']));
		expect(gaps.find((g) => g.line === 0)?.key).toBe('harbor');
	});

	test('linhas sem palavra elegível nunca viram lacuna', () => {
		const lines = [line(0, 'I am so in it'), line(1, 'Oh oh oh'), ...song().slice(2)];
		const gaps = chooseGaps(lines, opts('dificil'));
		expect(gaps.map((g) => g.line)).not.toContain(0);
		expect(gaps.map((g) => g.line)).not.toContain(1);
	});

	test('com poucas linhas elegíveis, devolve só as que existem', () => {
		const gaps = chooseGaps(song().slice(0, 3), opts('dificil'));
		expect(gaps).toHaveLength(3);
	});

	test('evita repetir a mesma resposta quando há alternativa', () => {
		const lines = CONTENT.slice(0, 6).map((w, i) => line(i, `Heart ${w} heart`));
		const keys = chooseGaps(lines, opts('medio')).map((g) => g.key);
		expect(new Set(keys).size).toBe(keys.length);
	});

	test('música vazia não quebra', () => {
		expect(chooseGaps([], opts('medio'))).toEqual([]);
	});
});
