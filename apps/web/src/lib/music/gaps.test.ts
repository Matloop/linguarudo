import { describe, expect, test } from 'bun:test';
import {
	DIFFICULTIES,
	chooseGaps,
	countWords,
	gapCount,
	isGapCandidate,
	spread,
	type Difficulty,
	type GapLine
} from './gaps.ts';
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

const opts = (difficulty: Difficulty, bank: string[] = []) => ({
	difficulty,
	lang: 'en' as const,
	bank: new Set(bank)
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

describe('gapCount', () => {
	test('15%, 30%, metade e todas as palavras', () => {
		expect(gapCount('iniciante', 200)).toBe(30);
		expect(gapCount('intermediario', 200)).toBe(60);
		expect(gapCount('avancado', 200)).toBe(100);
		expect(gapCount('especialista', 200)).toBe(200);
	});

	test('arredonda para o mais perto', () => {
		expect(gapCount('iniciante', 294)).toBe(44);
		expect(gapCount('intermediario', 294)).toBe(88);
		expect(gapCount('avancado', 43)).toBe(22);
	});

	test('letra curta tem pelo menos uma lacuna e nunca passa das palavras', () => {
		expect(gapCount('iniciante', 3)).toBe(1);
		expect(gapCount('avancado', 1)).toBe(1);
		expect(gapCount('especialista', 0)).toBe(0);
	});
});

describe('countWords', () => {
	test('conta todas as palavras, funcionais também', () => {
		expect(countWords([line(0, 'Oh oh, oh!'), line(1, 'We keep the lantern close')])).toBe(8);
	});
});

describe('chooseGaps', () => {
	// 24 linhas × 5 palavras = 120: 18, 36, 60, 120.
	test('o número de lacunas segue a dificuldade', () => {
		const counts = DIFFICULTIES.map((d) => chooseGaps(song(), opts(d)).length);
		expect(counts).toEqual([18, 36, 60, 120]);
	});

	test('Especialista esconde todas as palavras', () => {
		const lines = song();
		const gaps = chooseGaps(lines, opts('especialista'));
		expect(gaps.filter((g) => g.line === 0).map((g) => g.answer)).toEqual([
			'We',
			'keep',
			'the',
			lines[0].tokens[6].text,
			'close'
		]);
	});

	test('em ordem de linha e de palavra, sem repetir posição', () => {
		const gaps = chooseGaps(song(), opts('avancado'));
		const pos = gaps.map((g) => g.line * 100 + g.token);
		expect([...pos].sort((a, b) => a - b)).toEqual(pos);
		expect(new Set(pos).size).toBe(pos.length);
	});

	test('a lacuna aponta para a palavra certa da linha', () => {
		const lines = song();
		for (const g of chooseGaps(lines, opts('avancado'))) {
			const tok = lines[g.line].tokens[g.token];
			expect(tok.text).toBe(g.answer);
			expect(tok.key).toBe(g.key);
		}
	});

	test('palavras de conteúdo vêm antes das funcionais, espalhadas pela música', () => {
		const gaps = chooseGaps(song(), opts('iniciante'));
		expect(gaps.every((g) => isGapCandidate(g.key, 'en'))).toBe(true);
		const lines = gaps.map((g) => g.line);
		expect(Math.min(...lines)).toBeLessThan(3);
		expect(Math.max(...lines)).toBeGreaterThanOrEqual(21);
	});

	test('palavras do banco têm prioridade, mesmo no fim da música', () => {
		const gaps = chooseGaps(song(), opts('iniciante', ['engine', 'castle']));
		const keys = gaps.map((g) => g.key);
		expect(keys).toContain('engine');
		expect(keys).toContain('castle');
		expect(gaps.filter((g) => g.inBank)).toHaveLength(2);
	});

	test('com mais palavras do banco que lacunas, escolhe só n delas, espalhadas', () => {
		const gaps = chooseGaps(song(), opts('iniciante', CONTENT));
		expect(gaps).toHaveLength(18);
		expect(gaps.every((g) => g.inBank)).toBe(true);
		expect(Math.max(...gaps.map((g) => g.line))).toBeGreaterThanOrEqual(21);
	});

	test('acabando as de conteúdo, completa com as funcionais', () => {
		// 3 de conteúdo (keep, lantern, close) e 2 funcionais por linha: 72 + 48.
		const gaps = chooseGaps(song(), { ...opts('especialista'), difficulty: 'especialista' });
		const content = chooseGaps(song(), opts('avancado'));
		expect(content.every((g) => isGapCandidate(g.key, 'en'))).toBe(true);
		expect(gaps.filter((g) => !isGapCandidate(g.key, 'en'))).toHaveLength(48);
		const few = song().slice(0, 2);
		// 10 palavras, 6 de conteúdo: Avançado dá 5 lacunas (metade), todas de conteúdo;
		// numa linha só com funcionais, as funcionais completam.
		expect(chooseGaps(few, opts('avancado')).every((g) => isGapCandidate(g.key, 'en'))).toBe(true);
		const plain = [line(0, 'I am in it'), line(1, 'We keep the lantern close')];
		const mixed = chooseGaps(plain, opts('especialista'));
		expect(mixed.filter((g) => g.line === 0)).toHaveLength(4);
	});

	test('música vazia não quebra', () => {
		expect(chooseGaps([], opts('intermediario'))).toEqual([]);
	});
});
