import { describe, expect, test } from 'bun:test';
import {
	API_LIMITS,
	apiItem,
	apiSaveResults,
	isAllowedOrigin,
	isPreferred,
	parseBearer,
	parseSaveBody,
	parseSeenBody
} from './integrations';

describe('isAllowedOrigin', () => {
	test('aceita o fork rodando local (localhost, 127.0.0.1, *.localhost, qualquer porta)', () => {
		expect(isAllowedOrigin('http://localhost:8080')).toBe(true);
		expect(isAllowedOrigin('http://127.0.0.1:11470')).toBe(true);
		expect(isAllowedOrigin('http://lingoblend.peario.xyz.localhost:8080')).toBe(true);
		expect(isAllowedOrigin('http://localhost')).toBe(true);
	});

	test('recusa qualquer outra origem', () => {
		expect(isAllowedOrigin(null)).toBe(false);
		expect(isAllowedOrigin('')).toBe(false);
		expect(isAllowedOrigin('https://evil.example')).toBe(false);
		expect(isAllowedOrigin('http://localhost.evil.example')).toBe(false);
		expect(isAllowedOrigin('http://evillocalhost:8080')).toBe(false);
		expect(isAllowedOrigin('file://')).toBe(false);
		expect(isAllowedOrigin('null')).toBe(false);
	});

	test('aceita origens extras exatas', () => {
		const extra = ['https://web.stremio.example'];
		expect(isAllowedOrigin('https://web.stremio.example', extra)).toBe(true);
		expect(isAllowedOrigin('https://web.stremio.example:444', extra)).toBe(false);
	});
});

describe('parseBearer', () => {
	test('lê o token do cabeçalho', () => {
		expect(parseBearer('Bearer lr_abc')).toBe('lr_abc');
		expect(parseBearer('bearer   lr_abc  ')).toBe('lr_abc');
	});

	test('null sem cabeçalho, com outro esquema ou vazio', () => {
		expect(parseBearer(null)).toBeNull();
		expect(parseBearer('Basic abc')).toBeNull();
		expect(parseBearer('Bearer ')).toBeNull();
		expect(parseBearer('Bearer a b')).toBeNull();
	});
});

describe('isPreferred', () => {
	// Fim do dia de estudo: 04:00 de São Paulo.
	const dayEnd = new Date('2026-11-11T07:00:00.000Z');
	const card = (state: number, due_at = '2026-11-10T12:00:00.000Z') => ({ state, due_at });
	const ativo = (...flashcards: ReturnType<typeof card>[]) => ({
		status: 'ativo' as const,
		flashcards
	});

	test('aprendendo e reaprendendo entram sempre', () => {
		expect(isPreferred(ativo(card(1, '2026-12-01T00:00:00Z')), dayEnd)).toBe(true);
		expect(isPreferred(ativo(card(3, '2026-12-01T00:00:00Z')), dayEnd)).toBe(true);
	});

	test('em revisão quando vence até o fim do dia de estudo, como na fila', () => {
		expect(isPreferred(ativo(card(2)), dayEnd)).toBe(true);
		expect(isPreferred(ativo(card(2, '2026-11-10T20:00:00Z')), dayEnd)).toBe(true);
		expect(isPreferred(ativo(card(2, '2026-11-11T07:00:00Z')), dayEnd)).toBe(false);
	});

	test('basta um flashcard do item (Reconhecer ou Produzir)', () => {
		expect(isPreferred(ativo(card(0), card(2)), dayEnd)).toBe(true);
	});

	test('novos, sem flashcard e conhecidos não entram', () => {
		expect(isPreferred(ativo(card(0)), dayEnd)).toBe(false);
		expect(isPreferred(ativo(), dayEnd)).toBe(false);
		expect(isPreferred({ status: 'conhecido', flashcards: [card(1)] }, dayEnd)).toBe(false);
	});
});

describe('parseSaveBody', () => {
	test('cada item vira ok ou erro, sem derrubar o lote; origem padrão é stremio', () => {
		const r = parseSaveBody({
			items: [
				{ language: 'it', lemma: 'festa', encounter: {} },
				{ language: 'it', lemma: '' }
			]
		});
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.items[0].ok && r.items[0].entry.encounter?.origin).toBe('stremio');
		expect(r.items[1]).toEqual({ ok: false, error: 'lemma vazio' });
	});

	test('corpo inválido, vazio ou lote grande demais', () => {
		expect(parseSaveBody(null).ok).toBe(false);
		expect(parseSaveBody({ items: [] }).ok).toBe(false);
		expect(parseSaveBody({ words: [{}] }).ok).toBe(false);
		const many = Array.from({ length: API_LIMITS.saveBatch + 1 }, (_, i) => ({
			language: 'en',
			lemma: `w${i}`
		}));
		expect(parseSaveBody({ items: many }).ok).toBe(false);
	});
});

describe('parseSeenBody', () => {
	test('o servidor calcula as chaves (lemmaKey) e tira duplicatas', () => {
		expect(parseSeenBody({ language: 'it', lemmas: [' Festa', 'festa', 'giorno', '', 3] })).toEqual(
			{ language: 'it', lemmaKeys: ['festa', 'giorno'] }
		);
		expect(parseSeenBody({ language: 'DE', lemmas: ['Haus', 'haus'] })).toEqual({
			language: 'de',
			lemmaKeys: ['haus']
		});
	});

	test('aceita qualquer tag BCP 47', () => {
		expect(parseSeenBody({ language: 'ja', lemmas: ['猫'] })).toEqual({
			language: 'ja',
			lemmaKeys: ['猫']
		});
		expect(parseSeenBody({ language: 'tet', lemmas: ['uma'] })?.language).toBe('tet');
	});

	test('recusa idioma inválido, lista ausente ou grande demais', () => {
		expect(parseSeenBody({ language: 'xx!!', lemmas: ['a'] })).toBeNull();
		expect(parseSeenBody({ language: 'it' })).toBeNull();
		const many = Array.from({ length: API_LIMITS.seenBatch + 1 }, (_, i) => `w${i}`);
		expect(parseSeenBody({ language: 'it', lemmas: many })).toBeNull();
	});
});

describe('apiItem', () => {
	const dayEnd = new Date('2026-11-11T12:00:00Z');
	const row = {
		id: 'i1',
		lemma: 'aspettare',
		lemma_key: 'aspettare',
		reading: '',
		sense: 'esperar',
		status: 'ativo',
		leech_hold: null,
		flashcards: [
			{ kind: 'reconhecer', state: 2, due_at: '2026-11-10T00:00:00Z', stability: 12.5 },
			{ kind: 'produzir', state: 0, due_at: '2026-11-11T00:00:00Z', stability: 0 }
		]
	};

	test('item com flashcards em camelCase, prefer e dominado', () => {
		expect(apiItem(row, 'it', dayEnd)).toEqual({
			id: 'i1',
			lemma: 'aspettare',
			lemmaKey: 'aspettare',
			reading: '',
			sense: 'esperar',
			status: 'ativo',
			mastered: false,
			prefer: true,
			flashcards: [
				{ kind: 'reconhecer', state: 2, dueAt: '2026-11-10T00:00:00Z', stability: 12.5 },
				{ kind: 'produzir', state: 0, dueAt: '2026-11-11T00:00:00Z', stability: 0 }
			],
			forms: [],
			leechWaiting: false
		});
	});

	test('leechWaiting: só a teimosa em espera (suspensa não volta com encontro)', () => {
		expect(apiItem({ ...row, leech_hold: 'wait' }, 'it', dayEnd).leechWaiting).toBe(true);
		expect(apiItem({ ...row, leech_hold: 'suspend' }, 'it', dayEnd).leechWaiting).toBe(false);
	});

	test('forms: grafias vistas, só strings', () => {
		expect(apiItem({ ...row, forms: ['aspetto', 'aspettavo'] }, 'it', dayEnd).forms).toEqual([
			'aspetto',
			'aspettavo'
		]);
		expect(apiItem({ ...row, forms: ['ok', 3, null] }, 'it', dayEnd).forms).toEqual(['ok']);
		expect(apiItem({ ...row, forms: null }, 'it', dayEnd).forms).toEqual([]);
	});

	test('forms: como escritas, uma por chave, sem a do próprio lema', () => {
		const haus = { ...row, lemma: 'Haus', lemma_key: 'haus' };
		expect(
			apiItem({ ...haus, forms: ['haus', 'Häuser', 'häuser', 'HAUS'] }, 'de', dayEnd).forms
		).toEqual(['Häuser']);
	});

	test('leitura volta junto (japonês)', () => {
		const neko = { ...row, lemma: '猫', lemma_key: '猫', reading: 'ねこ' };
		expect(apiItem(neko, 'ja', dayEnd)).toMatchObject({
			lemma: '猫',
			lemmaKey: '猫',
			reading: 'ねこ'
		});
		expect(apiItem({ ...neko, reading: null }, 'ja', dayEnd).reading).toBe('');
	});

	test('flashcards fora do formato viram lista vazia', () => {
		expect(apiItem({ ...row, flashcards: null }, 'it', dayEnd).flashcards).toEqual([]);
		expect(apiItem({ ...row, flashcards: [{ kind: 'x' }] }, 'it', dayEnd).flashcards).toEqual([]);
	});

	test('dominado quando todos os flashcards estão estáveis', () => {
		const flashcards = [
			{ kind: 'reconhecer', state: 2, due_at: '2027-06-01T00:00:00Z', stability: 120 }
		];
		const out = apiItem({ ...row, flashcards }, 'it', dayEnd);
		expect(out.mastered).toBe(true);
		expect(out.prefer).toBe(false);
	});
});

describe('apiSaveResults', () => {
	const saved = {
		item_id: 'i1',
		language: 'it',
		lemma: 'aspettare',
		created: true,
		encounter_id: 'e1',
		flashcard_state: 0,
		flashcard_due_at: '2026-11-11T12:00:00Z',
		released: false
	};

	test('uma resposta por entrada, na ordem; inválidas ficam no lugar', () => {
		const parsed = parseSaveBody({
			items: [{ language: 'it', lemma: 'aspettare' }, { lemma: '' }]
		});
		if (!parsed.ok) throw new Error('entrada de teste inválida');
		expect(apiSaveResults(parsed.items, [saved])).toEqual([
			{
				ok: true,
				item: {
					id: 'i1',
					language: 'it',
					lemma: 'aspettare',
					lemmaKey: 'aspettare',
					created: true,
					encounterId: 'e1',
					flashcard: { state: 0, dueAt: '2026-11-11T12:00:00Z' },
					released: false
				}
			},
			{ ok: false, error: 'language inválido' }
		]);
	});

	test('released: a teimosa em espera voltou para a fila com este encontro', () => {
		const parsed = parseSaveBody({ items: [{ language: 'it', lemma: 'aspettare' }] });
		if (!parsed.ok) throw new Error('entrada de teste inválida');
		const [result] = apiSaveResults(parsed.items, [{ ...saved, created: false, released: true }]);
		expect(result).toMatchObject({ ok: true, item: { created: false, released: true } });
	});

	test('sem linha do banco para uma entrada válida, a resposta é erro', () => {
		const parsed = parseSaveBody({ items: [{ language: 'it', lemma: 'aspettare' }] });
		if (!parsed.ok) throw new Error('entrada de teste inválida');
		expect(apiSaveResults(parsed.items, [])).toEqual([{ ok: false, error: 'não deu para salvar' }]);
	});
});
