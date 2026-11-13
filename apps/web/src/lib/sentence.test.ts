import { describe, expect, test } from 'bun:test';
import {
	findHighlight,
	isMixedSentence,
	mergeSentencePair,
	parseEncounterEdit,
	parseSentencePair,
	senseParts,
	senseTerms
} from './sentence';

const ID = '0b6c2a52-3f1e-4f43-9a55-5d1e2f3a4b5c';

describe('parseEncounterEdit', () => {
	test('apara, junta espaços e quebras; tradução opcional', () => {
		expect(
			parseEncounterEdit({ id: ID, sentence: '  Compila la\n scheda. ', translation: ' ' })
		).toEqual({ ok: true, value: { id: ID, sentence: 'Compila la scheda.', translation: '' } });
	});

	test('id inválido, frase vazia ou longa, tradução longa', () => {
		expect(parseEncounterEdit({ id: 'x', sentence: 'a' })).toEqual({
			ok: false,
			errors: { form: 'Frase não encontrada.' }
		});
		const empty = parseEncounterEdit({ id: ID, sentence: '  ', translation: 'oi' });
		expect(empty.ok).toBe(false);
		if (!empty.ok) expect(empty.errors.sentence).toBeDefined();
		const long = parseEncounterEdit({
			id: ID,
			sentence: 'a'.repeat(501),
			translation: 'b'.repeat(1001)
		});
		expect(long.ok).toBe(false);
		if (!long.ok) expect(Object.keys(long.errors).sort()).toEqual(['sentence', 'translation']);
		// 500 code points com emoji (fora do BMP) ainda cabem.
		expect(parseEncounterEdit({ id: ID, sentence: '😀'.repeat(500) }).ok).toBe(true);
	});
});

describe('findHighlight', () => {
	test('acha o primeiro candidato como palavra inteira, com a grafia da frase', () => {
		expect(
			findHighlight('Corro finché i miei Muscoli bruciano.', ['muscoli', 'muscolo'], 'it')
		).toBe('Muscoli');
		expect(findHighlight('Compila la scheda prima.', ['', 'schede', 'scheda'], 'it')).toBe(
			'scheda'
		);
	});

	test('não acha: vazio (a tela cai no lema)', () => {
		expect(findHighlight('Compila il modulo.', ['scheda'], 'it')).toBe('');
		expect(findHighlight('schedario', ['scheda'], 'it')).toBe('');
	});

	test('expressão de várias palavras', () => {
		expect(findHighlight('Ha fatto finta di niente.', ['fatto finta di'], 'it')).toBe(
			'fatto finta di'
		);
	});
});

describe('isMixedSentence', () => {
	test('só Blend sem tradução e com frase', () => {
		expect(
			isMixedSentence({ origin: 'blend', sentence: 'Eu corro muscoli', translation: '' })
		).toBe(true);
		expect(isMixedSentence({ origin: 'blend', sentence: 'x', translation: 'y' })).toBe(false);
		expect(isMixedSentence({ origin: 'stremio', sentence: 'x', translation: '' })).toBe(false);
		expect(isMixedSentence({ origin: 'blend', sentence: '', translation: '' })).toBe(false);
	});
});

describe('senseParts', () => {
	const bold = (translation: string, sense: string) =>
		senseParts(translation, sense)
			.filter((p) => p.hit)
			.map((p) => p.text);

	test('termos separados por vírgula ou ponto e vírgula; sem parênteses', () => {
		expect(senseTerms('ficha, cartão; (de papel) formulário / x')).toEqual([
			'formulário',
			'cartão',
			'ficha'
		]);
	});

	test('negrita a palavra do sentido, sem ligar para caixa e acento', () => {
		expect(senseParts('Preencha a ficha antes de partir.', 'ficha, cartão')).toEqual([
			{ text: 'Preencha a ', hit: false },
			{ text: 'ficha', hit: true },
			{ text: ' antes de partir.', hit: false }
		]);
		expect(bold('Cartao e CARTÃO.', 'cartão')).toEqual(['Cartao', 'CARTÃO']);
		expect(bold('Ele é médico.', 'medico')).toEqual(['médico']);
	});

	test('só palavra inteira; o termo mais longo ganha', () => {
		expect(bold('As fichas e a ficha.', 'ficha')).toEqual(['ficha']);
		expect(bold('Ele desistiu de tudo.', 'desistir, desistiu de')).toEqual(['desistiu de']);
	});

	test('sem sentido ou sem achado: tudo comum', () => {
		expect(senseParts('Olá.', '')).toEqual([{ text: 'Olá.', hit: false }]);
		expect(senseParts('Olá.', 'tchau')).toEqual([{ text: 'Olá.', hit: false }]);
	});

	test('texto em NFD mantém o acento dentro do negrito', () => {
		const nfd = 'o café quente';
		expect(bold(nfd, 'café')).toEqual(['café']);
	});
});

describe('Completar com IA', () => {
	test('parseSentencePair: sem frase é nulo', () => {
		expect(parseSentencePair({ sentence: ' Ciao. ', translation: ' Oi. ' })).toEqual({
			sentence: 'Ciao.',
			translation: 'Oi.'
		});
		expect(parseSentencePair({ sentence: '', translation: 'x' })).toBeNull();
		expect(parseSentencePair(null)).toBeNull();
	});

	test('frase misturada: vira a da IA, com a tradução da IA', () => {
		expect(
			mergeSentencePair(
				{ sentence: 'Eu corro até meus muscoli', translation: '' },
				{ sentence: 'Corro finché i miei muscoli', translation: 'Corro até meus músculos' }
			)
		).toEqual({ sentence: 'Corro finché i miei muscoli', translation: 'Corro até meus músculos' });
	});

	test('a tradução do usuário fica se a frase não mudou; sai se a frase mudou', () => {
		const current = { sentence: 'Ciao a tutti.', translation: 'Oi, pessoal.' };
		expect(
			mergeSentencePair(current, { sentence: 'Ciao a tutti.', translation: 'Olá a todos.' })
		).toEqual(current);
		expect(
			mergeSentencePair(current, { sentence: 'Ciao a tutte.', translation: 'Olá a todas.' })
		).toEqual({ sentence: 'Ciao a tutte.', translation: 'Olá a todas.' });
	});
});
