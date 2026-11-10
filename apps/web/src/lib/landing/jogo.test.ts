import { describe, expect, test } from 'bun:test';
import { adicionar, jogoNovo, nPalavras, partes, responder, temNoBanco } from './jogo.ts';

describe('partes', () => {
	test('troca {n} pela palavra da lista, na ordem do índice', () => {
		expect(partes('Deixei na {1}, perto da {0}.', ['janela', 'cozinha'])).toEqual([
			{ texto: 'Deixei na ' },
			{ palavra: 'cozinha' },
			{ texto: ', perto da ' },
			{ palavra: 'janela' },
			{ texto: '.' }
		]);
	});

	test('aceita {palavra} nomeada (linha de música)', () => {
		expect(partes('The {rain} is here', [])).toEqual([
			{ texto: 'The ' },
			{ palavra: 'rain' },
			{ texto: ' is here' }
		]);
	});

	test('texto sem marcação vira uma parte só', () => {
		expect(partes('— Sobrou algum?', [])).toEqual([{ texto: '— Sobrou algum?' }]);
	});
});

describe('responder', () => {
	const linhas = [{ r: 'rain' }, { r: 'hear' }, { r: 'walking' }];

	test('acerto de primeira soma 100 × combo e sobe o combo', () => {
		const { jogo, ganho, certo } = responder(jogoNovo(), linhas, 'rain');
		expect(certo).toBe(true);
		expect(ganho).toBe(100);
		expect(jogo).toEqual({ i: 1, tentativas: 0, combo: 2, pontos: 100, feitas: ['ok'] });
	});

	test('erro zera o combo e conta tentativa, sem avançar', () => {
		const a = responder(jogoNovo(), linhas, 'rain').jogo;
		const { jogo, certo, ganho } = responder(a, linhas, 'here');
		expect(certo).toBe(false);
		expect(ganho).toBe(0);
		expect(jogo).toMatchObject({ i: 1, tentativas: 1, combo: 1, pontos: 100 });
	});

	test('acerto depois de erro vale pontos mas marca "quase" e não sobe combo', () => {
		let j = responder(jogoNovo(), linhas, 'rail').jogo;
		const r = responder(j, linhas, 'rain');
		j = r.jogo;
		expect(r.ganho).toBe(100);
		expect(j).toEqual({ i: 1, tentativas: 0, combo: 1, pontos: 100, feitas: ['quase'] });
	});

	test('combo para em ×3', () => {
		let j = jogoNovo();
		for (const l of linhas) j = responder(j, linhas, l.r).jogo;
		expect(j.combo).toBe(3);
		expect(j.pontos).toBe(100 + 200 + 300);
	});

	test('depois da última lacuna não faz nada', () => {
		let j = jogoNovo();
		for (const l of linhas) j = responder(j, linhas, l.r).jogo;
		const r = responder(j, linhas, 'rain');
		expect(r.jogo).toBe(j);
		expect(r.certo).toBe(false);
	});
});

describe('banco da prévia', () => {
	const item = { w: 'rain', l: 'en' as const, tr: 'chuva', o: 'musica' as const };

	test('adiciona no topo', () => {
		const b = adicionar([{ ...item, w: 'key' }], item);
		expect(b.map((x) => x.w)).toEqual(['rain', 'key']);
	});

	test('não duplica a mesma palavra na mesma língua', () => {
		const b = adicionar([item], { ...item, o: 'filme' });
		expect(b).toHaveLength(1);
	});

	test('mesma grafia em outra língua conta como outra palavra', () => {
		expect(temNoBanco([item], 'rain', 'it')).toBe(false);
		expect(temNoBanco([item], 'rain', 'en')).toBe(true);
	});

	test('nPalavras', () => {
		expect(nPalavras(0)).toBe('0 palavras');
		expect(nPalavras(1)).toBe('1 palavra');
		expect(nPalavras(5)).toBe('5 palavras');
	});
});
