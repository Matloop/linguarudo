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
	const now = new Date('2026-11-10T15:00:00.000Z');
	const card = (state: number, due_at = '2026-11-10T12:00:00.000Z') => ({ state, due_at });
	const ativo = (...cards: ReturnType<typeof card>[]) => ({ status: 'ativo' as const, cards });

	test('aprendendo e reaprendendo entram sempre', () => {
		expect(isPreferred(ativo(card(1, '2026-12-01T00:00:00Z')), now)).toBe(true);
		expect(isPreferred(ativo(card(3, '2026-12-01T00:00:00Z')), now)).toBe(true);
	});

	test('em revisão só quando venceu', () => {
		expect(isPreferred(ativo(card(2)), now)).toBe(true);
		expect(isPreferred(ativo(card(2, '2026-11-11T00:00:00Z')), now)).toBe(false);
	});

	test('basta um cartão do item (Reconhecer ou Produzir)', () => {
		expect(isPreferred(ativo(card(0), card(2)), now)).toBe(true);
	});

	test('novos, sem cartão e conhecidos não entram', () => {
		expect(isPreferred(ativo(card(0)), now)).toBe(false);
		expect(isPreferred(ativo(), now)).toBe(false);
		expect(isPreferred({ status: 'conhecido', cards: [card(1)] }, now)).toBe(false);
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
	test('normaliza e tira duplicatas', () => {
		expect(parseSeenBody({ language: 'it', lemmas: [' Festa', 'festa', 'giorno', '', 3] })).toEqual(
			{ language: 'it', lemmas: ['festa', 'giorno'] }
		);
	});

	test('aceita qualquer idioma da lista', () => {
		expect(parseSeenBody({ language: 'ja', lemmas: ['猫'] })).toEqual({
			language: 'ja',
			lemmas: ['猫']
		});
	});

	test('recusa idioma desconhecido, lista ausente ou grande demais', () => {
		expect(parseSeenBody({ language: 'xx', lemmas: ['a'] })).toBeNull();
		expect(parseSeenBody({ language: 'it' })).toBeNull();
		const many = Array.from({ length: API_LIMITS.seenBatch + 1 }, (_, i) => `w${i}`);
		expect(parseSeenBody({ language: 'it', lemmas: many })).toBeNull();
	});
});

describe('apiItem', () => {
	const now = new Date('2026-11-11T12:00:00Z');
	const row = {
		id: 'i1',
		lemma: 'aspettare',
		sense: 'esperar',
		status: 'ativo',
		cards: [
			{ kind: 'reconhecer', state: 2, due_at: '2026-11-10T00:00:00Z', stability: 12.5 },
			{ kind: 'produzir', state: 0, due_at: '2026-11-11T00:00:00Z', stability: 0 }
		]
	};

	test('item com cartões em camelCase, prefer e dominado', () => {
		expect(apiItem(row, now)).toEqual({
			id: 'i1',
			lemma: 'aspettare',
			sense: 'esperar',
			status: 'ativo',
			mastered: false,
			prefer: true,
			cards: [
				{ kind: 'reconhecer', state: 2, dueAt: '2026-11-10T00:00:00Z', stability: 12.5 },
				{ kind: 'produzir', state: 0, dueAt: '2026-11-11T00:00:00Z', stability: 0 }
			]
		});
	});

	test('cards fora do formato viram lista vazia', () => {
		expect(apiItem({ ...row, cards: null }, now).cards).toEqual([]);
		expect(apiItem({ ...row, cards: [{ kind: 'x' }] }, now).cards).toEqual([]);
	});

	test('dominado quando todos os cartões estão estáveis', () => {
		const cards = [
			{ kind: 'reconhecer', state: 2, due_at: '2027-06-01T00:00:00Z', stability: 120 }
		];
		const out = apiItem({ ...row, cards }, now);
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
		card_state: 0,
		card_due_at: '2026-11-11T12:00:00Z'
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
					created: true,
					encounterId: 'e1',
					card: { state: 0, dueAt: '2026-11-11T12:00:00Z' }
				}
			},
			{ ok: false, error: 'language inválido' }
		]);
	});

	test('sem linha do banco para uma entrada válida, a resposta é erro', () => {
		const parsed = parseSaveBody({ items: [{ language: 'it', lemma: 'aspettare' }] });
		if (!parsed.ok) throw new Error('entrada de teste inválida');
		expect(apiSaveResults(parsed.items, [])).toEqual([{ ok: false, error: 'não deu para salvar' }]);
	});
});
