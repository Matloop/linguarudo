import { describe, expect, test } from 'bun:test';
import {
	API_LIMITS,
	formatSource,
	isAllowedOrigin,
	isPreferred,
	parseBearer,
	parseSeenBody,
	parseStremioWords
} from './stremio';

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

describe('formatSource', () => {
	test('título e minuto da cena', () => {
		expect(formatSource('Kaguya', 42 * 60 + 10)).toBe('Kaguya, 42:10');
		expect(formatSource('Kaguya', 5)).toBe('Kaguya, 0:05');
	});

	test('passa de uma hora com h:mm:ss', () => {
		expect(formatSource('Filme', 3600 + 2 * 60 + 3)).toBe('Filme, 1:02:03');
	});

	test('sem tempo ou sem título', () => {
		expect(formatSource('Kaguya', null)).toBe('Kaguya');
		expect(formatSource('', 70)).toBe('1:10');
		expect(formatSource('', null)).toBe('');
	});
});

describe('isPreferred', () => {
	const now = new Date('2026-11-10T12:00:00Z');
	const past = '2026-11-10T11:00:00Z';
	const future = '2026-11-12T11:00:00Z';

	test('aprendendo e reaprendendo entram sempre', () => {
		expect(isPreferred({ state: 1, due_at: future, paused: false }, now)).toBe(true);
		expect(isPreferred({ state: 3, due_at: future, paused: false }, now)).toBe(true);
	});

	test('em revisão só quando venceu', () => {
		expect(isPreferred({ state: 2, due_at: past, paused: false }, now)).toBe(true);
		expect(isPreferred({ state: 2, due_at: future, paused: false }, now)).toBe(false);
	});

	test('novas e pausadas não entram', () => {
		expect(isPreferred({ state: 0, due_at: past, paused: false }, now)).toBe(false);
		expect(isPreferred({ state: 1, due_at: past, paused: true }, now)).toBe(false);
	});
});

describe('parseStremioWords', () => {
	const full = {
		term: '  Festa ',
		lang: 'it',
		translation: 'festas',
		context: 'Eu não quero só ir às feste.',
		contextHighlight: 'feste',
		ipa: '/ˈfɛs.ta/',
		pos: 'subst. fem.',
		meaning: 'festas, celebrações',
		example: 'Andiamo alla festa.',
		sourceTitle: 'Kaguya',
		sourceTimeS: 2530.7,
		savedAt: '2026-11-01T10:00:00.000Z'
	};

	test('mapeia para as colunas do banco', () => {
		const out = parseStremioWords({ words: [full] });
		expect(out.ok).toBe(true);
		if (!out.ok) return;
		expect(out.items).toEqual([
			{
				ok: true,
				row: {
					term: 'Festa',
					lang: 'it',
					translation: 'festas',
					context: 'Eu não quero só ir às feste.',
					context_highlight: 'feste',
					ipa: '/ˈfɛs.ta/',
					pos: 'subst. fem.',
					meaning: 'festas, celebrações',
					example: 'Andiamo alla festa.',
					source_title: 'Kaguya',
					source_time_s: 2530,
					saved_at: '2026-11-01T10:00:00.000Z'
				}
			}
		]);
	});

	test('só term e lang são obrigatórios', () => {
		const out = parseStremioWords({ words: [{ term: 'giorno', lang: 'IT' }] });
		expect(out.ok && out.items[0]).toEqual({
			ok: true,
			row: {
				term: 'giorno',
				lang: 'it',
				translation: '',
				context: '',
				context_highlight: '',
				ipa: '',
				pos: '',
				meaning: '',
				example: '',
				source_title: '',
				source_time_s: null,
				saved_at: null
			}
		});
	});

	test('item inválido não derruba o lote', () => {
		const out = parseStremioWords({
			words: [
				{ term: '', lang: 'it' },
				{ term: 'x'.repeat(81), lang: 'it' },
				{ term: 'ok', lang: 'fr' },
				7,
				full
			]
		});
		expect(out.ok).toBe(true);
		if (!out.ok) return;
		expect(out.items.map((i) => i.ok)).toEqual([false, false, false, false, true]);
	});

	test('textos longos são cortados; destaque longo demais some', () => {
		const out = parseStremioWords({
			words: [
				{
					...full,
					context: 'a'.repeat(600),
					meaning: 'b'.repeat(250),
					contextHighlight: 'c'.repeat(81)
				}
			]
		});
		if (!out.ok || !out.items[0].ok) throw new Error('esperava ok');
		const row = out.items[0].row;
		expect([...row.context].length).toBe(500);
		expect([...row.meaning].length).toBe(200);
		expect(row.context_highlight).toBe('');
	});

	test('tempo e data fora do formato viram null', () => {
		const out = parseStremioWords({
			words: [{ term: 'a', lang: 'it', sourceTimeS: -3, savedAt: 'ontem' }]
		});
		if (!out.ok || !out.items[0].ok) throw new Error('esperava ok');
		expect(out.items[0].row.source_time_s).toBeNull();
		expect(out.items[0].row.saved_at).toBeNull();
	});

	test('corpo inválido ou lote grande demais', () => {
		expect(parseStremioWords(null).ok).toBe(false);
		expect(parseStremioWords({ words: 'a' }).ok).toBe(false);
		expect(parseStremioWords({ words: [] }).ok).toBe(false);
		const many = Array.from({ length: API_LIMITS.saveBatch + 1 }, (_, i) => ({
			term: `w${i}`,
			lang: 'it'
		}));
		expect(parseStremioWords({ words: many }).ok).toBe(false);
	});
});

describe('parseSeenBody', () => {
	test('normaliza e tira duplicatas', () => {
		expect(parseSeenBody({ lang: 'it', terms: [' Festa', 'festa', 'giorno', '', 3] })).toEqual({
			lang: 'it',
			terms: ['festa', 'giorno']
		});
	});

	test('recusa língua errada, lista ausente ou grande demais', () => {
		expect(parseSeenBody({ lang: 'fr', terms: ['a'] })).toBeNull();
		expect(parseSeenBody({ lang: 'it' })).toBeNull();
		const many = Array.from({ length: API_LIMITS.seenBatch + 1 }, (_, i) => `w${i}`);
		expect(parseSeenBody({ lang: 'it', terms: many })).toBeNull();
	});
});
