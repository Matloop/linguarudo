import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { formatWorkSource } from './items';
import { dayStart, DEFAULT_CLOCK, nextDayStart, REVIEW_TIME_ZONE } from './review';
import {
	flashcardState,
	decodeCursor,
	decodePageToken,
	encodeCursor,
	encodePageToken,
	endLine,
	fichaLine,
	formatUserCode,
	headerLine,
	itemLine,
	normalizeUserCode,
	parseDeviceText,
	parseLimit,
	parseOp,
	parsePushBody,
	toOpResult,
	USER_CODE_ALPHABET,
	userCodeFrom,
	utcOffsetMinutes,
	type FlashcardState,
	type HeaderInput,
	type SnapshotFichaRow,
	type SnapshotItemRow
} from './sync';

// Formato do contrato do e-reader (docs/sync/CONTRACT.md) conferido contra os fixtures.

const fixture = (name: string) =>
	readFileSync(new URL(`../../../../docs/sync/fixtures/${name}`, import.meta.url), 'utf8');
const json = (name: string) => JSON.parse(fixture(name));
const lines = (name: string) => fixture(name).trimEnd().split('\n');

type ItemFixture = {
	id: string;
	lemma: string;
	lemmaKey: string;
	reading?: string;
	language: string;
	sense?: string;
	note?: string;
	ipa?: string;
	pos?: string;
	status: string;
	deckId: string;
	queueRank: number | null;
	leechWaiting: boolean;
	seenCount: number;
	lastSeenAt?: string;
	createdAt: string;
	updatedAt: string;
	forms?: string[];
	encounters?: { form?: string; sentence?: string; sense?: string; work?: string; at: string }[];
	flashcard: FlashcardState;
};

/** Monta a linha do banco (como api_sync_snapshot devolve) a partir da linha do fixture. */
function rowFrom(item: ItemFixture): SnapshotItemRow {
	const pg = (iso: string) => iso.replace('T', ' ').replace('Z', '+00');
	return {
		id: item.id,
		lemma: item.lemma,
		lemma_key: item.lemmaKey,
		reading: item.reading ?? '',
		language: item.language,
		sense: item.sense ?? '',
		note: item.note ?? '',
		ipa: item.ipa ?? '',
		pos: item.pos ?? '',
		status: item.status,
		deck_id: item.deckId,
		leech_hold: item.leechWaiting ? 'wait' : null,
		seen_count: item.seenCount,
		last_seen_at: item.lastSeenAt ? pg(item.lastSeenAt) : null,
		created_at: pg(item.createdAt),
		updated_at: pg(item.updatedAt),
		// O banco pode mandar o próprio lema e formas repetidas; a linha não leva.
		forms: [...(item.forms ?? []), item.lemma.toUpperCase(), ...(item.forms ?? [])],
		// Fora de ordem: a linha ordena pelo mais recente.
		encounters: [...(item.encounters ?? [])].reverse().map((e) => ({
			form: e.form ?? '',
			sentence: e.sentence ?? '',
			sense: e.sense ?? '',
			work: e.work ?? null,
			at: pg(e.at)
		})),
		flashcard: {
			id: item.flashcard.id,
			created_at: pg(item.flashcard.createdAt),
			due_at: pg(item.flashcard.dueAt),
			stability: item.flashcard.stability,
			stability_fast: item.flashcard.stabilityFast,
			difficulty: item.flashcard.difficulty,
			state: item.flashcard.state,
			schedule_status: item.flashcard.scheduleStatus,
			last_review_at: item.flashcard.lastReviewAt ? pg(item.flashcard.lastReviewAt) : null,
			reps: item.flashcard.reps,
			lapses: item.flashcard.lapses,
			scheduled_days: item.flashcard.scheduledDays,
			learning_step: item.flashcard.learningStep
		}
	};
}

describe('linha item do snapshot', () => {
	for (const file of [
		'snapshot-full.page1.jsonl',
		'snapshot-full.page2.jsonl',
		'bank.jsonl',
		'snapshot-delta.jsonl'
	]) {
		test(`igual ao fixture ${file}`, () => {
			const items = lines(file).filter((l) => JSON.parse(l).t === 'item');
			expect(items.length).toBeGreaterThan(0);
			for (const line of items) {
				const item = JSON.parse(line) as ItemFixture;
				expect(itemLine(rowFrom(item), item.queueRank)).toBe(line);
			}
		});
	}

	test('corta a nota em 200 code points, formas em 10 e encontros em 2', () => {
		const base = rowFrom(JSON.parse(lines('snapshot-full.page2.jsonl')[1]));
		const line = JSON.parse(
			itemLine({
				...base,
				note: 'è'.repeat(250),
				forms: Array.from({ length: 15 }, (_, i) => `forma${String(i).padStart(2, '0')}`),
				encounters: [0, 1, 2].map((i) => ({
					form: `f${i}`,
					sentence: '',
					sense: '',
					work: null,
					at: `2026-11-0${i + 1}T10:00:00.000Z`
				}))
			})
		);
		expect([...line.note].length).toBe(200);
		expect(line.forms).toHaveLength(10);
		expect(line.encounters.map((e: { form: string }) => e.form)).toEqual(['f2', 'f1']);
		// Texto vazio e obra ausente não viram campo.
		expect(line.encounters[0]).toEqual({ form: 'f2', at: '2026-11-03T10:00:00.000Z' });
	});

	test('lema como escrito, lemmaKey do servidor, leitura e formas por chave', () => {
		const base = rowFrom(JSON.parse(lines('snapshot-full.page2.jsonl')[1]));
		const haus = JSON.parse(
			itemLine({
				...base,
				lemma: 'Haus',
				lemma_key: 'haus',
				language: 'de',
				forms: ['haus', 'Häuser', 'häuser', 'HAUS']
			})
		);
		expect(haus).toMatchObject({ lemma: 'Haus', lemmaKey: 'haus', forms: ['Häuser'] });
		expect(haus.reading).toBeUndefined();
		const neko = JSON.parse(
			itemLine({
				...base,
				lemma: '猫',
				lemma_key: '猫',
				reading: 'ねこ',
				language: 'ja',
				forms: []
			})
		);
		expect(neko).toMatchObject({ lemma: '猫', lemmaKey: '猫', reading: 'ねこ' });
	});

	test('nunca passa de 16384 bytes', () => {
		const base = rowFrom(JSON.parse(lines('snapshot-full.page2.jsonl')[1]));
		const big = 'ç'.repeat(5000);
		const line = itemLine({
			...base,
			encounters: [0, 1].map((i) => ({
				form: big,
				sentence: big,
				sense: big,
				work: big,
				at: base.created_at
			})),
			forms: Array.from({ length: 10 }, (_, i) => `${i}${'ã'.repeat(700)}`)
		});
		expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(16384);
		expect(JSON.parse(line).flashcard.id).toBe(base.flashcard.id);
	});
});

/** Cabeçalho dos fixtures: 5 itens, 1 ficha, 1 nova feita hoje, dois decks no leitor. */
function fixtureHeader(serverNow: Date): HeaderInput {
	const deck = (id: string, name: string, over: object) => ({
		id,
		language: 'it',
		name,
		parentId: null,
		isDefault: false,
		paused: false,
		newOrder: 'importance' as const,
		newPerDay: null,
		reviewsPerDay: null,
		newPerDayToday: null,
		reviewsPerDayToday: null,
		onReader: true,
		position: 0,
		createdAt: '2026-10-01T00:00:00.000Z',
		...over
	});
	return {
		language: 'it',
		cursor: 'v1.MjAyNi0xMS0xMVQyMTozMDowMi40MTdaOjg4MjEz',
		serverNow,
		total: 5,
		fichasTotal: 1,
		uiLanguage: 'pt',
		nativeLanguage: 'pt',
		studyLanguages: ['it', 'en'],
		newFlashcardsPerDay: 10,
		reviewsPerDay: 200,
		timeZone: REVIEW_TIME_ZONE,
		dayStartHour: DEFAULT_CLOCK.startHour,
		desiredRetention: 0.9,
		dayStart: dayStart(serverNow),
		nextDayStart: nextDayStart(serverNow),
		newDoneToday: 1,
		newOrder: 'importance',
		leech: { lapses: 8, action: 'wait' },
		extraNew: 0,
		newAllowance: 9,
		reviewAllowance: 200,
		decks: [
			deck('5d0c1a2b-3e4f-4a5b-8c6d-7e8f9a0b1c10', 'Minhas palavras', { isDefault: true }),
			deck('9e8d7c6b-5a4f-4e3d-9c2b-1a0f9e8d7c20', 'Gramática', {
				newOrder: 'deck',
				newPerDay: 5,
				position: 1
			})
		]
	};
}

describe('linha ficha do snapshot', () => {
	const expected = lines('snapshot-full.page3.jsonl')[1];
	const row: SnapshotFichaRow = {
		id: 'c3b2a1f0-9e8d-4c7b-a6f5-e4d3c2b1a030',
		language: 'it',
		deck_id: '9e8d7c6b-5a4f-4e3d-9c2b-1a0f9e8d7c20',
		leech_hold: null,
		front: 'Ieri {{c1::sono andato::andare}} al mare.<br>Passato prossimo',
		back: 'Verbo de movimento: auxiliar <b>essere</b>.',
		status: 'ativo',
		created_at: '2026-11-05 10:00:00+00',
		updated_at: '2026-11-05 10:00:00+00',
		flashcard: {
			id: 'd4c3b2a1-0f9e-4d8c-b7a6-f5e4d3c2b140',
			kind: 'lacuna',
			ord: 1,
			created_at: '2026-11-05 10:00:00+00',
			due_at: '2026-11-05 10:00:00+00',
			stability: 0,
			stability_fast: 0,
			difficulty: 0,
			state: 0,
			schedule_status: 'new',
			last_review_at: null,
			reps: 0,
			lapses: 0,
			scheduled_days: 0,
			learning_step: 0
		}
	};

	test('lacuna em texto puro, igual ao fixture (também no bank.jsonl)', () => {
		expect(fichaLine(row, 2)).toBe(expected);
		expect(lines('bank.jsonl').at(-1)).toBe(expected);
		const f = JSON.parse(expected);
		expect(f.front).toBe('Ieri [andare] al mare. Passato prossimo');
		expect(f.flashcard).not.toHaveProperty('kind');
	});

	test('frente: texto sem HTML, cortado em 2000 code points, em espera vira leechWaiting', () => {
		const f = JSON.parse(
			fichaLine({
				...row,
				front: `<b>casa</b> &amp; ${'è'.repeat(2500)}`,
				back: 'house<br>home',
				leech_hold: 'wait',
				flashcard: { ...row.flashcard, kind: 'frente', ord: 0 }
			})
		);
		expect(f.kind).toBe('frente');
		expect([...f.front]).toHaveLength(2000);
		expect(f.front.startsWith('casa & è')).toBe(true);
		expect(f.back).toBe('house home');
		expect(f.queueRank).toBeNull();
		expect(f.leechWaiting).toBe(true);
	});
});

describe('cabeçalho e fim da página', () => {
	test('header igual ao fixture', () => {
		const expected = lines('snapshot-full.page1.jsonl')[0];
		const serverNow = new Date('2026-11-11T21:30:02.417Z');
		const line = headerLine(fixtureHeader(serverNow));
		expect(line).toBe(expected);
		for (const f of ['snapshot-full.page2.jsonl', 'snapshot-full.page3.jsonl', 'bank.jsonl']) {
			expect(lines(f)[0]).toBe(expected);
		}
	});

	test('conta sem preferências: nada de padrão em português', () => {
		const serverNow = new Date('2026-11-11T21:30:02.417Z');
		const header = JSON.parse(
			headerLine({
				language: 'de',
				cursor: 'v1.x',
				serverNow,
				total: 0,
				uiLanguage: null,
				nativeLanguage: null,
				studyLanguages: [],
				newFlashcardsPerDay: 10,
				reviewsPerDay: 200,
				timeZone: REVIEW_TIME_ZONE,
				dayStartHour: DEFAULT_CLOCK.startHour,
				desiredRetention: 0.9,
				dayStart: dayStart(serverNow),
				nextDayStart: nextDayStart(serverNow),
				newDoneToday: 0,
				fichasTotal: 0,
				newOrder: 'importance',
				leech: { lapses: 8, action: 'wait' },
				extraNew: 0,
				newAllowance: 10,
				reviewAllowance: 200,
				decks: []
			})
		);
		expect(header.settings).toMatchObject({
			uiLanguage: null,
			nativeLanguage: null,
			studyLanguages: []
		});
		expect(header.deckName).toBe('Linguetta · Deutsch');
	});

	test('end', () => {
		expect(endLine(1, null)).toBe(lines('snapshot-full.page3.jsonl').at(-1)!);
		const page1End = JSON.parse(lines('snapshot-full.page1.jsonl').at(-1)!);
		expect(Object.keys(JSON.parse(endLine(3, 'p1.x')))).toEqual(Object.keys(page1End));
	});

	test('fuso de São Paulo', () => {
		expect(utcOffsetMinutes('America/Sao_Paulo', new Date('2026-11-11T21:30:02.417Z'))).toBe(-180);
		expect(utcOffsetMinutes('UTC', new Date('2026-11-11T21:30:02.417Z'))).toBe(0);
	});
});

describe('cursor e token de página', () => {
	const now = new Date('2026-11-11T21:30:02.417Z');

	test('cursor ida e volta, e o do fixture', () => {
		expect(decodeCursor(encodeCursor(now))?.toISOString()).toBe(now.toISOString());
		expect(decodeCursor(json('state.json').cursor)?.toISOString()).toBe(now.toISOString());
		expect(encodeCursor(now).length).toBeLessThanOrEqual(200);
		expect(decodeCursor('v1.lixo')).toBeNull();
		expect(decodeCursor(null)).toBeNull();
	});

	test('página vale para o mesmo pedido por 15 minutos', () => {
		const id = '6a7b8c9d-1e2f-4a3b-9c4d-5e6f7a8b9c04';
		const token = encodePageToken({ l: 'it', k: 'item', a: id, c: encodeCursor(now), n: 500 });
		expect(token.startsWith('p1.')).toBe(true);
		expect(
			decodePageToken(token, { language: 'it', limit: 500 }, new Date(now.getTime() + 60_000))?.a
		).toBe(id);
		expect(decodePageToken(token, { language: 'en', limit: 500 }, now)).toBeNull();
		expect(decodePageToken(token, { language: 'it', limit: 100 }, now)).toBeNull();
		expect(
			decodePageToken(token, { language: 'it', limit: 500 }, new Date(now.getTime() + 16 * 60_000))
		).toBeNull();
		expect(decodePageToken('p1.!!!', { language: 'it', limit: 500 }, now)).toBeNull();
		expect(decodePageToken('qualquer', { language: 'it', limit: 500 }, now)).toBeNull();
	});

	test('depois dos itens, as fichas começam do zero', () => {
		const c = encodeCursor(now);
		const fichas = encodePageToken({ l: 'it', k: 'ficha', a: null, c, n: 500 });
		expect(decodePageToken(fichas, { language: 'it', limit: 500 }, now)).toMatchObject({
			k: 'ficha',
			a: null
		});
		// Itens sem último id não existem; tipo desconhecido também não.
		const bad = encodePageToken({ l: 'it', k: 'item', a: null, c, n: 500 });
		expect(decodePageToken(bad, { language: 'it', limit: 500 }, now)).toBeNull();
		const page2 = JSON.parse(lines('snapshot-full.page2.jsonl').at(-1)!);
		expect(
			decodePageToken(page2.next, { language: 'it', limit: 500 }, new Date(now.getTime() + 1000))?.k
		).toBe('ficha');
	});

	test('limit: 100–1000, padrão 500', () => {
		expect(parseLimit(null)).toBe(500);
		expect(parseLimit('3')).toBe(100);
		expect(parseLimit('5000')).toBe(1000);
		expect(parseLimit('250')).toBe(250);
		expect(parseLimit('abc')).toBe(500);
	});
});

describe('operações do push', () => {
	const request = json('push.request.json');
	const response = json('push.response.json');

	test('envelope: 1 a 200 operações', () => {
		expect(parsePushBody(request)?.ops).toHaveLength(9);
		expect(parsePushBody({ protocol: 1, ops: [] })).toBeNull();
		expect(parsePushBody({ protocol: 1, ops: Array(201).fill({}) })).toBeNull();
		expect(parsePushBody({ protocol: 1 })).toBeNull();
	});

	test('save vira a entrada de save_items_for com origem ereader e obra kosync', () => {
		const parsed = parseOp(request.ops[0]);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok || parsed.op.type !== 'save') throw new Error('save');
		expect(parsed.op.entry).toEqual({
			language: 'it',
			lemma: 'bello',
			lemma_key: 'bello',
			reading: '',
			sense: 'bonito',
			note: 'adjetivo',
			ipa: '',
			part_of_speech: '',
			encounter: {
				form: 'bella',
				sentence: 'Era uma bella manhã do fim de novembro.',
				highlight: 'bella',
				sense: 'bonita',
				position: { chapter: 'Prólogo', spine: 2, percent: 0.8 },
				origin: 'ereader',
				seen_at: '2026-11-09T20:12:00.000Z',
				client_id: 'd4b3a2c1-0f9e-4d8c-b7a6-958473625100'
			},
			work: {
				kind: 'livro',
				title: 'O nome da rosa',
				subtitle: 'Umberto Eco',
				refs: { ko_hash: 'a3f1c9e2b7d4068f15e2c3b4a5d6e7f8' },
				language: null
			}
		});
	});

	test('review por flashcardId e por saveClientId, seen', () => {
		const byCard = parseOp(request.ops[1]);
		expect(byCard.ok && byCard.op).toMatchObject({
			type: 'review',
			flashcardId: '5d2a7e10-0c43-4b8f-a6d9-71e0c4b2f902',
			saveClientId: null,
			rating: 3,
			durationMs: 6400
		});
		const bySave = parseOp(request.ops[4]);
		expect(bySave.ok && bySave.op).toMatchObject({
			flashcardId: null,
			saveClientId: 'd4b3a2c1-0f9e-4d8c-b7a6-958473625103',
			rating: 1
		});
		const seen = parseOp(request.ops[5]);
		expect(seen.ok && seen.op).toMatchObject({
			type: 'seen',
			lemma: 'bello',
			lemmaKey: 'bello',
			at: '2026-11-11T08:20:00.000Z'
		});
	});

	test('lema vazio é rejected/invalid, igual ao fixture, e fica guardado', () => {
		const parsed = parseOp(request.ops[6]);
		expect(parsed.ok).toBe(false);
		if (parsed.ok) return;
		expect(parsed.result).toEqual(response.results[6]);
		expect(parsed.store).toBe('save');
	});

	test('outras operações inválidas', () => {
		const base = request.ops[1];
		const errorsOf = (op: unknown) => {
			const p = parseOp(op);
			return p.ok ? null : p.result;
		};
		expect(errorsOf({ ...base, saveClientId: request.ops[3].clientId })).toMatchObject({
			status: 'rejected',
			reason: 'invalid',
			errors: { flashcardId: expect.any(String) }
		});
		expect(errorsOf({ ...base, flashcardId: undefined })).toMatchObject({
			errors: { flashcardId: expect.any(String) }
		});
		expect(errorsOf({ ...base, rating: 5 })).toMatchObject({
			errors: { rating: expect.any(String) }
		});
		expect(errorsOf({ ...base, at: 'ontem' })).toMatchObject({
			errors: { at: expect.any(String) }
		});
		expect(errorsOf({ ...base, language: 'xx!!' })).toMatchObject({
			errors: { language: expect.any(String) }
		});
		expect(errorsOf({ ...base, type: 'delete' })).toEqual({
			clientId: base.clientId,
			status: 'rejected',
			reason: 'unknown_type'
		});
		expect(errorsOf({ ...base, clientId: 'abc' })).toMatchObject({
			errors: { clientId: expect.any(String) }
		});
		expect(errorsOf({ ...request.ops[5], lemma: 'a'.repeat(81) })).toMatchObject({
			errors: { lemma: 'lema longo demais' }
		});
		expect(
			errorsOf({ ...request.ops[0], work: { ...request.ops[0].work, koHash: 'xyz' } })
		).toMatchObject({
			errors: { 'work.koHash': expect.any(String) }
		});
		expect(errorsOf({ ...request.ops[0], encounter: undefined })).toMatchObject({
			errors: { encounter: expect.any(String) }
		});
	});

	test('textos longos são cortados, duração fora da faixa some', () => {
		const p = parseOp({
			...request.ops[0],
			sense: 'x'.repeat(300),
			encounter: {
				...request.ops[0].encounter,
				position: { chapter: 'c'.repeat(300), spine: -1, percent: 12.345 }
			}
		});
		if (!p.ok || p.op.type !== 'save') throw new Error('save');
		expect(p.op.entry.sense).toHaveLength(200);
		expect(p.op.entry.encounter?.position).toEqual({ chapter: 'c'.repeat(200), percent: 12.3 });
		const r = parseOp({ ...request.ops[1], durationMs: 9_999_999 });
		expect(r.ok && r.op.type === 'review' && r.op.durationMs).toBeNull();
	});

	test('o resultado guardado vira duplicate no reenvio', () => {
		const first = toOpResult('c1', {
			prior: false,
			result: { status: 'applied', itemId: 'i', flashcardId: 'k', created: false, encounterId: 'e' }
		});
		expect(first).toEqual({
			clientId: 'c1',
			status: 'applied',
			itemId: 'i',
			flashcardId: 'k',
			created: false,
			encounterId: 'e'
		});
		const again = toOpResult(response.results[0].clientId, {
			prior: true,
			result: { ...response.results[0], clientId: undefined, status: 'applied' }
		});
		expect(JSON.parse(JSON.stringify(again))).toEqual(response.results[0]);
		expect(
			toOpResult('c2', { prior: true, result: { status: 'dropped', reason: 'item_deleted' } })
		).toEqual({
			clientId: 'c2',
			status: 'dropped',
			reason: 'item_deleted'
		});
		expect(
			toOpResult('c3', {
				prior: true,
				result: { status: 'rejected', reason: 'client_id_conflict' }
			}).status
		).toBe('rejected');
	});

	test('extraNew: n inteiro de 1 a 1000', () => {
		const parsed = parseOp(request.ops[7]);
		expect(parsed).toMatchObject({ ok: true, op: { type: 'extraNew', n: 5, language: 'it' } });
		for (const n of [0, 1.5, 1001, '5']) {
			const bad = parseOp({ ...request.ops[7], n });
			expect(bad.ok).toBe(false);
			if (!bad.ok) expect(bad.store).toBe('extraNew');
		}
	});

	test('deckImport: nome, hash e linhas viram HTML seguro', () => {
		const parsed = parseOp(request.ops[8]);
		if (!parsed.ok || parsed.op.type !== 'deckImport') throw new Error('deckImport');
		expect(parsed.op.name).toBe('Verbi irregolari');
		expect(parsed.op.hash).toBe('sha256:9f2c4e1a7b3d');
		expect(parsed.op.rows).toEqual([
			{ front: 'andare', back: 'ir<br>vado, vai, va' },
			{ front: 'essere', back: 'ser, estar' }
		]);
		const html = parseOp({ ...request.ops[8], rows: [{ front: '<script>x</script>a<b>b</b>' }] });
		if (!html.ok || html.op.type !== 'deckImport') throw new Error('deckImport');
		expect(html.op.rows[0].front).not.toContain('<script');
		expect(html.op.rows[0].back).toBe('');
		const errorsOf = (over: object) => {
			const r = parseOp({ ...request.ops[8], ...over });
			return r.ok ? null : (r.result as { errors?: Record<string, string> }).errors;
		};
		expect(errorsOf({ name: '  ' })).toHaveProperty('name');
		expect(errorsOf({ hash: 'a b' })).toHaveProperty('hash');
		expect(errorsOf({ rows: [] })).toHaveProperty('rows');
		expect(errorsOf({ rows: Array(501).fill({ front: 'a' }) })).toHaveProperty('rows');
		expect(errorsOf({ rows: [{ front: 'a' }, { back: 'b' }] })).toHaveProperty(['rows.1.front']);
	});

	test('resultados dos fixtures de extraNew e deckImport', () => {
		expect(response.results.slice(7).map((r: { status: string }) => r.status)).toEqual([
			'applied',
			'applied'
		]);
	});

	test('FlashcardState do fixture', () => {
		const expected = response.results[1].flashcard;
		const state = flashcardState({
			id: expected.id,
			created_at: '2026-11-03 10:00:00+00',
			due_at: '2026-12-08T22:40:00+00:00',
			stability: expected.stability,
			stability_fast: expected.stabilityFast,
			difficulty: expected.difficulty,
			state: 2,
			schedule_status: 'review',
			last_review_at: '2026-11-10T22:40:00+00:00',
			reps: 2,
			lapses: 0,
			scheduled_days: 28,
			learning_step: 0
		});
		expect(JSON.stringify(state)).toBe(JSON.stringify(expected));
	});
});

describe('código de pareamento', () => {
	test('formato e digitação', () => {
		expect(formatUserCode('K7Q4MP')).toBe('K7Q-4MP');
		expect(normalizeUserCode(' k7q-4mp ')).toBe('K7Q4MP');
		expect(normalizeUserCode('K7Q 4MP')).toBe('K7Q4MP');
		expect(normalizeUserCode('K7Q4M0')).toBeNull();
		expect(normalizeUserCode('K7Q4MPX')).toBeNull();
		expect(normalizeUserCode(null)).toBeNull();
		const res = json('pair-start.response.json');
		expect(res.verificationUriComplete.endsWith(`?code=${normalizeUserCode(res.userCode)}`)).toBe(
			true
		);
	});

	test('só letras do alfabeto', () => {
		let i = 0;
		const code = userCodeFrom((max) => i++ % max);
		expect(code).toBe('234567');
		const last = userCodeFrom((max) => max - 1);
		expect(last).toBe('ZZZZZZ');
		for (const ch of 'O0I1') expect(USER_CODE_ALPHABET.includes(ch)).toBe(false);
	});

	test('nome do aparelho', () => {
		expect(parseDeviceText('  X4   Pro ', 60)).toBe('X4 Pro');
		expect(parseDeviceText('a'.repeat(80), 60)).toHaveLength(60);
		expect(parseDeviceText(42, 60)).toBe('');
	});
});

describe('origem de livro', () => {
	test('título · capítulo · N%', () => {
		const work = { title: 'O nome da rosa', subtitle: 'Umberto Eco' };
		expect(formatWorkSource(work, { chapter: 'Primeiro dia', spine: 4, percent: 12.5 })).toBe(
			'O nome da rosa · Primeiro dia · 12%'
		);
		expect(formatWorkSource(work, { spine: 4, percent: 13.1 })).toBe('O nome da rosa · 13%');
		expect(formatWorkSource(work, {})).toBe('O nome da rosa · Umberto Eco');
	});
});
