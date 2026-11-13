import { describe, expect, test } from 'bun:test';
import type { AiChain, JsonRequest } from './ai';
import {
	completeSentence,
	parseSentenceRequest,
	parseSentenceResult,
	sentenceRequest
} from './sentence-ai';

const study = ['it', 'ja'];

describe('parseSentenceRequest', () => {
	test('normaliza; sentido, frase e tradução opcionais', () => {
		expect(
			parseSentenceRequest(
				{ language: 'IT', lemma: ' muscolo ', sentence: ' Eu corro  até meus\nmuscoli ' },
				study
			)
		).toEqual({
			language: 'it',
			lemma: 'muscolo',
			sense: '',
			sentence: 'Eu corro até meus muscoli',
			translation: ''
		});
	});

	test('rejeita idioma fora dos de estudo, sem palavra, tipos errados e textos longos', () => {
		expect(parseSentenceRequest(null, study)).toHaveProperty('error');
		expect(parseSentenceRequest({ language: 'de', lemma: 'Haus' }, study)).toHaveProperty('error');
		expect(parseSentenceRequest({ language: 'it', lemma: ' ' }, study)).toHaveProperty('error');
		expect(parseSentenceRequest({ language: 'it', lemma: 'a', sentence: 3 }, study)).toHaveProperty(
			'error'
		);
		expect(
			parseSentenceRequest({ language: 'it', lemma: 'a', sentence: 'x'.repeat(501) }, study)
		).toHaveProperty('error');
		expect(
			parseSentenceRequest({ language: 'it', lemma: 'a', translation: 'x'.repeat(1001) }, study)
		).toHaveProperty('error');
	});
});

describe('sentenceRequest', () => {
	test('frase misturada: pede reescrita no idioma de estudo e tradução na nativa', () => {
		const r = sentenceRequest(
			{
				language: 'it',
				lemma: 'muscolo',
				sense: 'músculo',
				sentence: 'Eu corro até meus muscoli bruciano',
				translation: ''
			},
			'pt-BR'
		);
		expect(r.user).toContain('Language: Italian (it)');
		expect(r.user).toContain('(pt-BR)');
		expect(r.user).toContain('Word: muscolo');
		expect(r.user).toContain('Meaning: músculo');
		expect(r.user).toContain('Sentence: Eu corro até meus muscoli bruciano');
		expect(r.user).not.toContain('Current translation');
		expect(r.system).toContain('rewrite the whole sentence in Italian');
		expect(r.system).toContain('return it unchanged');
		expect(r.system).toContain('translation of your sentence');
		expect(r.schema).toMatchObject({
			additionalProperties: false,
			required: ['sentence', 'translation']
		});
	});

	test('sem frase: pede um exemplo; tradução atual vai como contexto', () => {
		const empty = sentenceRequest(
			{ language: 'it', lemma: 'scheda', sense: '', sentence: '', translation: '' },
			'pt'
		);
		expect(empty.system).toContain('example sentence');
		expect(empty.system).toContain('most common meaning');
		expect(empty.user).not.toContain('Sentence:');

		const withTr = sentenceRequest(
			{
				language: 'it',
				lemma: 'scheda',
				sense: 'ficha',
				sentence: 'La scheda.',
				translation: 'A ficha.'
			},
			'pt'
		);
		expect(withTr.user).toContain('Current translation: A ficha.');
	});
});

describe('parseSentenceResult', () => {
	test('apara e corta; sem frase é malformada', () => {
		expect(parseSentenceResult({ sentence: ' Ciao. ', translation: ' Oi. ' })).toEqual({
			sentence: 'Ciao.',
			translation: 'Oi.'
		});
		const long = parseSentenceResult({ sentence: 'a'.repeat(600), translation: 'b'.repeat(1200) });
		expect(long?.sentence).toHaveLength(500);
		expect(long?.translation).toHaveLength(1000);
		expect(parseSentenceResult({ sentence: '', translation: 'x' })).toBeNull();
		expect(parseSentenceResult('x')).toBeNull();
	});
});

describe('completeSentence', () => {
	test('usa a cadeia com o pedido montado e devolve o par', async () => {
		let seen: JsonRequest<unknown> | null = null;
		const fake: AiChain = {
			async json<T>(req: JsonRequest<T>): Promise<T> {
				seen = req as JsonRequest<unknown>;
				const out = req.parse({
					sentence: 'Corro finché i miei muscoli bruciano.',
					translation: 'Corro até meus músculos arderem.'
				});
				if (out === null) throw new Error('malformada');
				return out;
			}
		};
		const out = await completeSentence(
			fake,
			{
				language: 'it',
				lemma: 'muscolo',
				sense: '',
				sentence: 'Eu corro muscoli',
				translation: ''
			},
			'pt'
		);
		expect(out).toEqual({
			sentence: 'Corro finché i miei muscoli bruciano.',
			translation: 'Corro até meus músculos arderem.'
		});
		expect(seen!.schemaName).toBe('sentence_pair');
	});
});
