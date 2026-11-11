import { describe, expect, test } from 'bun:test';
import { MAX_LINE_SECONDS, parseLrc, parseSyncedLyrics, toLyricLines } from './lrc.ts';

// Versos inventados para os testes. Nenhuma letra real entra no repositório.
const SRC = `[ar:Banda Inventada]
[ti:Canção de Teste]
[00:01.50] First invented verse
[00:05.00]Second invented verse
[00:09.25]
[00:12.000] Third invented verse
`;

describe('parseLrc', () => {
	test('lê tempos e textos, ignora tags de metadados e mantém linhas vazias', () => {
		expect(parseLrc(SRC)).toEqual([
			{ time: 1.5, text: 'First invented verse' },
			{ time: 5, text: 'Second invented verse' },
			{ time: 9.25, text: '' },
			{ time: 12, text: 'Third invented verse' }
		]);
	});

	test('vários tempos na mesma linha repetem o texto, em ordem de tempo', () => {
		const out = parseLrc('[00:40.00][00:20.00] Chorus line\n[00:30.00] Middle line');
		expect(out.map((e) => [e.time, e.text])).toEqual([
			[20, 'Chorus line'],
			[30, 'Middle line'],
			[40, 'Chorus line']
		]);
	});

	test('aceita minutos > 59, tempo sem fração e CRLF', () => {
		const out = parseLrc('[01:02] A\r\n[61:00.5] B\r\n');
		expect(out).toEqual([
			{ time: 62, text: 'A' },
			{ time: 3660.5, text: 'B' }
		]);
	});

	test('[offset:+500] adianta a letra em meio segundo', () => {
		const out = parseLrc('[offset:+500]\n[00:10.00] Early verse');
		expect(out[0].time).toBeCloseTo(9.5, 5);
		const late = parseLrc('[offset:-250]\n[00:10.00] Late verse');
		expect(late[0].time).toBeCloseTo(10.25, 5);
	});

	test('tira marcas de palavra <mm:ss.xx> e espaços sobrando', () => {
		const out = parseLrc('[00:03.00] <00:03.00>Hello <00:03.40>there   friend ');
		expect(out[0].text).toBe('Hello there friend');
	});

	test('linhas só com símbolos viram vazias (pausa instrumental)', () => {
		expect(parseLrc('[00:03.00] ♪\n[00:04.00] ...')).toEqual([
			{ time: 3, text: '' },
			{ time: 4, text: '' }
		]);
	});

	test('texto sem formato LRC devolve lista vazia', () => {
		expect(parseLrc('')).toEqual([]);
		expect(parseLrc('just some text\nwithout stamps')).toEqual([]);
	});

	test('nunca devolve tempo negativo', () => {
		expect(parseLrc('[offset:+5000]\n[00:01.00] Verse')[0].time).toBe(0);
	});
});

describe('toLyricLines', () => {
	test('o fim de cada linha é o início da próxima entrada, mesmo vazia', () => {
		const lines = toLyricLines(parseLrc(SRC));
		expect(lines).toEqual([
			{ index: 0, start: 1.5, end: 5, text: 'First invented verse' },
			{ index: 1, start: 5, end: 9.25, text: 'Second invented verse' },
			{ index: 2, start: 12, end: 17, text: 'Third invented verse' }
		]);
	});

	test('limita a duração de uma linha antes de um trecho instrumental longo', () => {
		const lines = toLyricLines(parseLrc('[00:10.00] Verse\n[01:10.00] Next'));
		expect(lines[0].end).toBe(10 + MAX_LINE_SECONDS);
	});

	test('parseSyncedLyrics junta as duas etapas', () => {
		expect(parseSyncedLyrics(SRC)).toHaveLength(3);
		expect(parseSyncedLyrics('nada')).toEqual([]);
	});
});
