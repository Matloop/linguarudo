import { describe, expect, test } from 'bun:test';
import { zipSync } from 'fflate';
import initSqlJs from 'sql.js';
import { ankiEncounterId, parseImportBatch } from './batch.ts';
import type { AnkiCollection, AnkiNotetype } from './collection.ts';
import { buildImport, suggestMapping, summarize, type NotetypeMapping } from './mapping.ts';
import { AnkiPackageError, readPackage } from './package.ts';
import { protoMessages, protoNumber, protoString, readMessage } from './protobuf.ts';
import { answerOnly, extractMedia, plainText, renderTemplate, templateFields } from './template.ts';

describe('modelos do Anki', () => {
	const fields = { Front: 'cane', Back: 'cachorro', Extra: '' };

	test('campos, seções e comentários', () => {
		expect(renderTemplate('{{Front}} — {{Back}}', fields)).toBe('cane — cachorro');
		expect(renderTemplate('{{#Extra}}x{{/Extra}}{{^Extra}}vazio{{/Extra}}', fields)).toBe('vazio');
		expect(renderTemplate('{{#Back}}<i>{{Back}}</i>{{/Back}}', fields)).toBe('<i>cachorro</i>');
		expect(renderTemplate('a{{! nota }}b', fields)).toBe('ab');
		expect(renderTemplate('{{Nope}}', fields)).toBe('');
	});

	test('filtros e FrontSide', () => {
		expect(renderTemplate('{{text:Front}}', { Front: '<b>cane</b>' })).toBe('cane');
		expect(renderTemplate('{{type:Back}}', fields)).toBe('');
		expect(renderTemplate('{{tts it_IT:Front}}', fields)).toBe('');
		expect(renderTemplate('{{FrontSide}}<hr id=answer>{{Back}}', fields, { frontSide: 'F' })).toBe(
			'F<hr id=answer>cachorro'
		);
		expect(templateFields('{{Front}} {{#Back}}{{text:Extra}}{{/Back}}')).toEqual([
			'Front',
			'Extra'
		]);
	});

	test('answerOnly corta a frente', () => {
		expect(answerOnly('frente<hr id=answer>verso').trim()).toBe('verso');
		expect(answerOnly('<hr id="answer">\nverso').trim()).toBe('verso');
		expect(answerOnly('só verso')).toBe('só verso');
	});

	test('extrai imagem e som', () => {
		const m = extractMedia(
			'<img src="gatto%20nero.jpg"> oi [sound:gatto.mp3] <img src="https://x.com/a.png">'
		);
		expect(m.images).toEqual(['gatto nero.jpg']);
		expect(m.sounds).toEqual(['gatto.mp3']);
		expect(m.html).not.toContain('sound:');
		expect(m.html).not.toContain('gatto nero.jpg');
	});

	test('texto puro', () => {
		expect(plainText('<div>cane&nbsp;&amp; gatto</div><br>')).toBe('cane & gatto');
	});
});

/** Escreve um protobuf mínimo (varint e bytes) para os testes. */
function proto(fields: [number, number | Uint8Array | string][]): Uint8Array {
	const out: number[] = [];
	const varint = (n: number) => {
		while (n > 0x7f) {
			out.push((n & 0x7f) | 0x80);
			n = Math.floor(n / 128);
		}
		out.push(n);
	};
	for (const [f, v] of fields) {
		if (typeof v === 'number') {
			varint(f * 8);
			varint(v);
		} else {
			const b = typeof v === 'string' ? new TextEncoder().encode(v) : v;
			varint(f * 8 + 2);
			varint(b.length);
			out.push(...b);
		}
	}
	return new Uint8Array(out);
}

describe('protobuf', () => {
	test('lê varint, string e mensagens aninhadas', () => {
		const inner = proto([[1, 'oi']]);
		const msg = readMessage(
			proto([
				[1, 300],
				[2, 'olá'],
				[3, inner],
				[3, inner],
				[255, 7]
			])
		);
		expect(protoNumber(msg, 1)).toBe(300);
		expect(protoString(msg, 2)).toBe('olá');
		expect(protoMessages(msg, 3).map((m) => protoString(m, 1))).toEqual(['oi', 'oi']);
		expect(protoNumber(msg, 255)).toBe(7);
		expect(protoNumber(msg, 9)).toBe(0);
	});
});

const basic: AnkiNotetype = {
	id: '1',
	name: 'Basic (and reversed card)',
	cloze: false,
	fields: ['Front', 'Back'],
	templates: [
		{ name: 'Card 1', ord: 0, qfmt: '{{Front}}', afmt: '{{FrontSide}}<hr id=answer>{{Back}}' },
		{ name: 'Card 2', ord: 1, qfmt: '{{Back}}', afmt: '{{FrontSide}}<hr id=answer>{{Front}}' }
	]
};
const vocab: AnkiNotetype = {
	id: '2',
	name: 'Italian vocab',
	cloze: false,
	fields: ['Word', 'Meaning', 'Example', 'Audio'],
	templates: [
		{ name: 'Rec', ord: 0, qfmt: '{{Word}}', afmt: '{{Meaning}}' },
		{ name: 'Prod', ord: 1, qfmt: '{{Meaning}}', afmt: '{{Word}}' }
	]
};
const cloze: AnkiNotetype = {
	id: '3',
	name: 'Cloze',
	cloze: true,
	fields: ['Text', 'Back Extra'],
	templates: [
		{ name: 'Cloze', ord: 0, qfmt: '{{cloze:Text}}', afmt: '{{cloze:Text}}<br>{{Back Extra}}' }
	]
};

function collection(): AnkiCollection {
	return {
		notetypes: new Map([basic, vocab, cloze].map((n) => [n.id, n])),
		decks: new Map([
			['1', 'Default'],
			['10', 'Italiano::Vocab']
		]),
		notes: [
			{ id: 'n1', guid: 'g1', notetypeId: '1', tags: ['casa'], fields: ['porta', 'door'] },
			{
				id: 'n2',
				guid: 'g2',
				notetypeId: '2',
				tags: ['animali'],
				fields: ['cane', 'cachorro', 'Il <b>cane</b> abbaia.', '[sound:cane.mp3]']
			},
			{
				id: 'n3',
				guid: 'g3',
				notetypeId: '3',
				tags: [],
				fields: ['{{c1::Roma}} è in {{c2::Italia}} <img src="roma.jpg">', 'capitale']
			},
			{ id: 'n4', guid: 'g4', notetypeId: '2', tags: [], fields: ['', 'nada', '', ''] }
		],
		cards: [
			{ id: 'c1', noteId: 'n1', deckId: '1', ord: 0, queue: 2 },
			{ id: 'c2', noteId: 'n1', deckId: '1', ord: 1, queue: -1 },
			{ id: 'c3', noteId: 'n2', deckId: '10', ord: 0, queue: 2 },
			{ id: 'c4', noteId: 'n2', deckId: '10', ord: 1, queue: 0 },
			{ id: 'c5', noteId: 'n3', deckId: '10', ord: 0, queue: 2 },
			{ id: 'c6', noteId: 'n3', deckId: '10', ord: 1, queue: 2 },
			{ id: 'c7', noteId: 'n4', deckId: '10', ord: 0, queue: 0 }
		],
		reviews: [
			{ cardId: 'c3', at: Date.UTC(2026, 0, 1), ease: 3, type: 0 },
			{ cardId: 'c3', at: Date.UTC(2026, 0, 3), ease: 0, type: 4 },
			{ cardId: 'c3', at: Date.UTC(2026, 0, 5), ease: 1, type: 1 },
			{ cardId: 'c5', at: Date.UTC(2026, 0, 2), ease: 4, type: 0 }
		]
	};
}

const mappingsFor = (col: AnkiCollection): Record<string, NotetypeMapping> =>
	Object.fromEntries(summarize(col).map((t) => [t.id, t.suggestion]));

describe('mapeamento', () => {
	test('sugere vocabulário, ficha e lacunas', () => {
		expect(suggestMapping(vocab)).toEqual({
			target: 'item',
			item: { lemma: 0, sense: 1, sentence: 2, reading: null }
		});
		expect(suggestMapping(basic).target).toBe('ficha');
		expect(suggestMapping(cloze).target).toBe('ficha');
	});

	test('resumo por tipo de nota', () => {
		const s = summarize(collection());
		const v = s.find((t) => t.id === '2')!;
		expect(v.notes).toBe(2);
		expect(v.cards).toBe(3);
		expect(v.sample[2]).toBe('Il cane abbaia.');
	});

	const media = new Set(['cane.mp3', 'roma.jpg']);

	test('vocabulário vira item com mídia, tags e revisões', () => {
		const col = collection();
		const built = buildImport(col, mappingsFor(col), media);
		const item = built.notes.find((n) => n.guid === 'g2');
		expect(item).toMatchObject({
			type: 'item',
			lemma: 'cane',
			sense: 'cachorro',
			sentence: 'Il cane abbaia.',
			audio: 'cane.mp3',
			image: null,
			// O deck do Anki vira deck (não tag).
			deck: 'Italiano::Vocab',
			tags: ['animali']
		});
		if (item?.type !== 'item') throw new Error();
		expect(item.cards.map((c) => c.kind)).toEqual(['reconhecer', 'produzir']);
		// O reagendamento manual (type 4) fica de fora.
		expect(item.cards[0].logs.map((l) => l.rating)).toEqual([3, 1]);
		// Sem palavra, a nota não entra.
		expect(built.notes.some((n) => n.guid === 'g4')).toBe(false);
		expect(built.skipped).toBe(1);
	});

	test('básico com inverso vira ficha', () => {
		const col = collection();
		const ficha = buildImport(col, mappingsFor(col), media).notes.find((n) => n.guid === 'g1');
		expect(ficha).toMatchObject({ type: 'ficha', front: 'porta', reverse: true, tags: ['casa'] });
		if (ficha?.type !== 'ficha') throw new Error();
		expect(ficha.back.trim()).toBe('door');
		expect(ficha.cards.map((c) => [c.kind, c.suspended])).toEqual([
			['frente', false],
			['inverso', true]
		]);
	});

	test('lacunas guardam o texto e a ordem', () => {
		const col = collection();
		const built = buildImport(col, mappingsFor(col), media);
		const ficha = built.notes.find((n) => n.guid === 'g3');
		if (ficha?.type !== 'ficha') throw new Error();
		expect(ficha.front).toContain('{{c1::Roma}}');
		expect(ficha.front_image).toBe('roma.jpg');
		expect(ficha.back).toContain('capitale');
		expect(ficha.reverse).toBe(false);
		expect(ficha.cards.map((c) => [c.kind, c.ord, c.logs.length])).toEqual([
			['lacuna', 1, 1],
			['lacuna', 2, 0]
		]);
		expect([...built.media].sort()).toEqual(['cane.mp3', 'roma.jpg']);
	});

	test('tipo fora não entra nem leva mídia', () => {
		const col = collection();
		const m = mappingsFor(col);
		m['3'] = { ...m['3'], target: 'skip' };
		const built = buildImport(col, m, media);
		expect(built.notes.some((n) => n.guid === 'g3')).toBe(false);
		expect(built.media.has('roma.jpg')).toBe(false);
	});
});

describe('lote do import', () => {
	const user = '11111111-1111-4111-8111-111111111111';
	const audio = `${user}/${'a'.repeat(64)}.mp3`;
	const item = {
		type: 'item',
		guid: 'g2',
		deck: 'Italiano::Vocab',
		tags: ['animali'],
		lemma: 'cane',
		reading: '',
		sense: 'cachorro',
		sentence: '',
		image: null,
		audio,
		cards: [
			{
				kind: 'reconhecer',
				ord: 0,
				suspended: false,
				logs: [{ rating: 3, at: '2026-01-01T00:00:00Z' }]
			}
		]
	};
	const ficha = {
		type: 'ficha',
		guid: 'g3',
		tags: [],
		front: '{{c1::Roma}} <script>x</script>',
		back: '',
		reverse: true,
		front_image: null,
		front_audio: null,
		back_image: null,
		back_audio: null,
		cards: [{ kind: 'lacuna', ord: 1, suspended: false, logs: [] }]
	};

	test('aceita e limpa um lote válido', () => {
		const r = parseImportBatch([item, ficha], user);
		if (!r.ok) throw new Error(r.error);
		const f = r.notes[1];
		if (f.type !== 'ficha') throw new Error();
		expect(f.front).not.toContain('script');
		expect(f.reverse).toBe(false);
		// Sem deck: o padrão.
		expect(r.notes[0].deck).toBe('Italiano::Vocab');
		expect(f.deck).toBe('');
		expect(parseImportBatch([{ ...item, deck: 42 }], user).ok).toBe(false);
		expect(r.notes[0].cards[0].logs[0].at).toBe('2026-01-01T00:00:00.000Z');
	});

	test.each([
		['mídia de outra pessoa', { ...item, audio: `outro/${'a'.repeat(64)}.mp3` }],
		['sem palavra', { ...item, lemma: ' ' }],
		[
			'nota fora da escala',
			{ ...item, cards: [{ ...item.cards[0], logs: [{ rating: 5, at: '2026-01-01T00:00:00Z' }] }] }
		],
		[
			'revisão no futuro',
			{ ...item, cards: [{ ...item.cards[0], logs: [{ rating: 3, at: '2999-01-01T00:00:00Z' }] }] }
		],
		[
			'flashcard de ficha em item',
			{ ...item, cards: [{ kind: 'frente', ord: 0, suspended: false, logs: [] }] }
		],
		[
			'lacuna sem ordem',
			{ ...ficha, cards: [{ kind: 'lacuna', ord: 0, suspended: false, logs: [] }] }
		],
		[
			'frente sem lacuna',
			{ ...ficha, front: 'Roma', cards: [{ kind: 'lacuna', ord: 1, suspended: false, logs: [] }] }
		],
		['tipo estranho', { ...item, type: 'deck' }]
	])('recusa %s', (_, note) => {
		expect(parseImportBatch([note], user).ok).toBe(false);
	});

	test('recusa guid repetido e lote vazio', () => {
		expect(parseImportBatch([item, item], user).ok).toBe(false);
		expect(parseImportBatch([], user).ok).toBe(false);
	});

	test('id do encontro é um UUID fixo por guid', async () => {
		const a = await ankiEncounterId('g1');
		expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		expect(await ankiEncounterId('g1')).toBe(a);
		expect(await ankiEncounterId('g2')).not.toBe(a);
	});
});

describe('pacote .apkg', () => {
	async function legacyPackage(): Promise<Uint8Array> {
		const SQL = await initSqlJs();
		const db = new SQL.Database();
		db.run(`
			create table col (models text, decks text);
			create table notes (id integer, guid text, mid integer, tags text, flds text);
			create table cards (id integer, nid integer, did integer, ord integer, queue integer);
			create table revlog (id integer, cid integer, ease integer, type integer);
		`);
		const models = {
			'1700000000000': {
				name: 'Basic',
				type: 0,
				flds: [
					{ name: 'Back', ord: 1 },
					{ name: 'Front', ord: 0 }
				],
				tmpls: [
					{ name: 'Card 1', ord: 0, qfmt: '{{Front}}', afmt: '{{FrontSide}}<hr id=answer>{{Back}}' }
				]
			}
		};
		db.run('insert into col values (?, ?)', [
			JSON.stringify(models),
			JSON.stringify({ '1': { name: 'Default' } })
		]);
		db.run('insert into notes values (?, ?, ?, ?, ?)', [
			1700000000001,
			'abc',
			1700000000000,
			' casa ',
			'porta <img src="porta.jpg">\x1fdoor'
		]);
		db.run('insert into cards values (1700000000002, 1700000000001, 1, 0, 2)');
		db.run('insert into revlog values (1767225600000, 1700000000002, 3, 0)');
		const sqlite = db.export();
		db.close();
		return zipSync({
			'collection.anki2': sqlite,
			media: new TextEncoder().encode(JSON.stringify({ '0': 'porta.jpg' })),
			'0': new Uint8Array([1, 2, 3])
		});
	}

	test('lê coleção antiga e mídia', async () => {
		const SQL = await initSqlJs();
		const pkg = readPackage(await legacyPackage(), SQL);
		const col = pkg.collection;
		expect(col.notetypes.get('1700000000000')?.fields).toEqual(['Front', 'Back']);
		expect(col.notes[0]).toMatchObject({ guid: 'abc', tags: ['casa'] });
		expect(col.cards[0]).toMatchObject({ noteId: '1700000000001', ord: 0 });
		expect(col.reviews[0]).toMatchObject({ cardId: '1700000000002', ease: 3 });
		expect(pkg.media.get('porta.jpg')?.()).toEqual(new Uint8Array([1, 2, 3]));

		const built = buildImport(col, mappingsFor(col), pkg.media);
		expect(built.notes[0]).toMatchObject({
			type: 'ficha',
			front: 'porta',
			front_image: 'porta.jpg'
		});
		expect(built.notes[0].cards[0].logs).toEqual([{ rating: 3, at: '2026-01-01T00:00:00.000Z' }]);
	});

	test('lê coleção do Anki atual (collate unicase em tabela without rowid)', async () => {
		// O Anki cria fields/templates como WITHOUT ROWID com COLLATE unicase, uma
		// collation dele. O SQLite do sql.js não tem a collation e não consulta a tabela.
		const SQL = await initSqlJs();
		const db = new SQL.Database();
		db.run(`
			create table notetypes (id integer not null primary key, name text not null collate nocase, config blob not null);
			create table fields (ntid integer not null, ord integer not null, name text not null collate nocase,
				config blob not null, primary key (ntid, ord)) without rowid;
			create table templates (ntid integer not null, ord integer not null, name text not null collate nocase,
				config blob not null, primary key (ntid, ord)) without rowid;
			create table decks (id integer, name text collate nocase);
			create table notes (id integer, guid text, mid integer, tags text, flds text);
			create table cards (id integer, nid integer, did integer, ord integer, queue integer);
			create table revlog (id integer, cid integer, ease integer, type integer);
		`);
		db.run('insert into notetypes values (5, ?, ?)', ['Basic', proto([[1, 0]])]);
		db.run("insert into fields values (5, 0, 'Front', x''), (5, 1, 'Back', x'')");
		db.run("insert into templates values (5, 0, 'Card 1', ?)", [
			proto([
				[1, '{{Front}}'],
				[2, '{{Back}}']
			])
		]);
		db.run("insert into decks values (1, 'Default')");
		db.exec(`
			pragma writable_schema = on;
			update sqlite_master set sql = replace(sql, 'collate nocase', 'COLLATE unicase');
			pragma writable_schema = off;
		`);
		const data = zipSync({ 'collection.anki21': db.export() });
		db.close();

		const col = readPackage(data, SQL).collection;
		expect(col.notetypes.get('5')).toMatchObject({ fields: ['Front', 'Back'] });
		expect(col.notetypes.get('5')?.templates).toHaveLength(1);
	});

	test('lê coleção nova (notetypes com protobuf)', async () => {
		const SQL = await initSqlJs();
		const db = new SQL.Database();
		db.run(`
			create table notetypes (id integer, name text, config blob);
			create table fields (ntid integer, ord integer, name text);
			create table templates (ntid integer, ord integer, name text, config blob);
			create table decks (id integer, name text);
			create table notes (id integer, guid text, mid integer, tags text, flds text);
			create table cards (id integer, nid integer, did integer, ord integer, queue integer);
			create table revlog (id integer, cid integer, ease integer, type integer);
		`);
		db.run('insert into notetypes values (5, ?, ?)', ['Cloze', proto([[1, 1]])]);
		db.run("insert into fields values (5, 0, 'Text'), (5, 1, 'Extra')");
		db.run("insert into templates values (5, 0, 'Cloze', ?)", [
			proto([
				[1, '{{cloze:Text}}'],
				[2, '{{cloze:Text}} {{Extra}}']
			])
		]);
		db.run('insert into decks values (9, ?)', ['Italiano\x1fGeografia']);
		db.run("insert into notes values (6, 'g', 5, '', ?)", ['{{c1::Roma}}\x1fcapitale']);
		db.run('insert into cards values (7, 6, 9, 0, 0)');
		const data = zipSync({ 'collection.anki21': db.export() });
		db.close();

		const col = readPackage(data, SQL).collection;
		expect(col.notetypes.get('5')).toMatchObject({
			cloze: true,
			fields: ['Text', 'Extra'],
			templates: [{ qfmt: '{{cloze:Text}}', afmt: '{{cloze:Text}} {{Extra}}' }]
		});
		expect(col.decks.get('9')).toBe('Italiano::Geografia');
		const built = buildImport(col, mappingsFor(col), new Set());
		expect(built.notes[0]).toMatchObject({ type: 'ficha', deck: 'Italiano::Geografia', tags: [] });
	});

	test('arquivo que não é pacote', async () => {
		const SQL = await initSqlJs();
		expect(() => readPackage(new Uint8Array([1, 2, 3]), SQL)).toThrow(AnkiPackageError);
		expect(() => readPackage(zipSync({ 'x.txt': new Uint8Array([1]) }), SQL)).toThrow(
			AnkiPackageError
		);
	});
});
