import { describe, expect, test } from 'bun:test';
import {
	LIMITS,
	formatWorkSource,
	isDuplicateError,
	normalizeLemma,
	normalizeText,
	parseItemEdit,
	parseItemInput,
	parseSaveEntry,
	parseWorkRefs
} from './items';

describe('normalizeLemma', () => {
	test('tira espaços das pontas e junta espaços repetidos', () => {
		expect(normalizeLemma('  give   up \n')).toBe('give up');
	});

	test('mantém maiúsculas (a unicidade ignora caixa no banco)', () => {
		expect(normalizeLemma('London')).toBe('London');
	});

	test('normaliza acentos para NFC', () => {
		const decomposto = 'perché';
		expect(normalizeLemma(decomposto)).toBe('perché');
		expect(normalizeLemma(decomposto).length).toBe(6);
	});
});

describe('normalizeText', () => {
	test('tira espaços das pontas mas preserva quebras internas', () => {
		expect(normalizeText('  primeira linha\nsegunda  ')).toBe('primeira linha\nsegunda');
	});
});

describe('parseItemInput', () => {
	const study = ['en', 'it'] as const;

	test('entrada válida volta normalizada', () => {
		const r = parseItemInput(
			{ lemma: '  give up ', sense: ' desistir ', language: 'EN', sentence: '' },
			study
		);
		expect(r).toEqual({
			ok: true,
			value: {
				lemma: 'give up',
				reading: '',
				sense: 'desistir',
				language: 'en',
				sentence: '',
				translation: '',
				note: '',
				tags: [],
				deck: null
			}
		});
	});

	test('tradução da frase: só com frase e até o limite', () => {
		const r = parseItemInput(
			{ lemma: 'scheda', language: 'it', sentence: 'La scheda.', translation: ' A ficha. ' },
			study
		);
		expect(r.ok && r.value).toMatchObject({ sentence: 'La scheda.', translation: 'A ficha.' });
		const orphan = parseItemInput(
			{ lemma: 'scheda', language: 'it', translation: 'A ficha.' },
			study
		);
		expect(!orphan.ok && orphan.errors.translation).toBeString();
		const long = parseItemInput(
			{ lemma: 'a', language: 'it', sentence: 'b', translation: 'c'.repeat(1001) },
			study
		);
		expect(!long.ok && long.errors.translation).toBeString();
	});

	test('"Mais campos": nota, tags e deck são lidos e validados como na edição', () => {
		const deck = '0B4E1C1A-1111-4222-8333-444455556666';
		const r = parseItemInput(
			{ lemma: 'scherzo', language: 'it', note: ' piada ', tags: 'filme, gíria ,Filme', deck },
			study
		);
		expect(r.ok && r.value).toMatchObject({
			note: 'piada',
			tags: ['filme', 'gíria'],
			deck: deck.toLowerCase()
		});

		const bad = parseItemInput(
			{
				lemma: 'scherzo',
				language: 'it',
				note: 'n'.repeat(LIMITS.note + 1),
				tags: Array.from({ length: 51 }, (_, i) => `t${i}`).join(','),
				deck: 'Minhas palavras'
			},
			study
		);
		expect(bad.ok).toBe(false);
		if (!bad.ok) expect(Object.keys(bad.errors).sort()).toEqual(['deck', 'note', 'tags']);
	});

	test('idioma é canonizado e precisa ser de estudo; leitura é opcional', () => {
		const r = parseItemInput({ lemma: ' 猫 ', reading: ' ねこ ', language: 'JA' }, ['ja', 'pt-BR']);
		expect(r.ok && r.value).toMatchObject({ language: 'ja', lemma: '猫', reading: 'ねこ' });
		expect(parseItemInput({ lemma: 'casa', language: 'pt-br' }, ['pt-BR']).ok).toBe(true);
		const long = parseItemInput({ lemma: '猫', reading: 'ね'.repeat(101), language: 'ja' }, ['ja']);
		expect(!long.ok && long.errors.reading).toBeString();
	});

	test('sentido e frase são opcionais', () => {
		const r = parseItemInput({ lemma: 'allora', language: 'it' }, study);
		expect(r.ok).toBe(true);
	});

	test('lema vazio é erro', () => {
		const r = parseItemInput({ lemma: '   ', language: 'en' }, study);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.errors.lemma).toBeString();
	});

	test('só aceita os idiomas de estudo', () => {
		const r = parseItemInput({ lemma: 'hola', language: 'es' }, study);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.errors.language).toBeString();
		expect(parseItemInput({ lemma: 'hola', language: 'es' }, ['es']).ok).toBe(true);
	});

	test('limites batem com os checks do SQL, contando caracteres e não unidades UTF-16', () => {
		expect(parseItemInput({ lemma: 'é'.repeat(LIMITS.lemma), language: 'it' }, study).ok).toBe(
			true
		);
		const emoji = '🐸'.repeat(LIMITS.lemma);
		expect(emoji.length).toBe(LIMITS.lemma * 2);
		expect(parseItemInput({ lemma: emoji, language: 'en' }, study).ok).toBe(true);

		const r = parseItemInput(
			{
				lemma: 'a'.repeat(LIMITS.lemma + 1),
				sense: 'b'.repeat(LIMITS.sense + 1),
				sentence: 'c'.repeat(LIMITS.sentence + 1),
				language: 'en'
			},
			study
		);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['lemma', 'sense', 'sentence']);
	});

	test('erro devolve os valores digitados para o formulário', () => {
		const r = parseItemInput({ lemma: '', sense: 'oi', language: 'en', sentence: 'x' }, study);
		expect(r.ok).toBe(false);
		if (!r.ok)
			expect(r.values).toEqual({
				lemma: '',
				reading: '',
				sense: 'oi',
				language: 'en',
				sentence: 'x',
				translation: '',
				note: '',
				tags: '',
				deck: ''
			});
	});

	test('valores que não são texto (ex.: File) contam como vazios', () => {
		expect(parseItemInput({ lemma: new Blob(['x']), language: 'en' }, study).ok).toBe(false);
	});
});

describe('parseItemEdit', () => {
	test('normaliza lema, sentido e nota', () => {
		expect(parseItemEdit({ lemma: ' festa ', sense: ' festa ', note: ' f. ' })).toEqual({
			ok: true,
			value: { lemma: 'festa', reading: '', sense: 'festa', note: 'f.' }
		});
	});

	test('tags só mudam se vierem no formulário', () => {
		const r = parseItemEdit({ lemma: 'festa', tags: ' viagem, Viagem ,A2' });
		expect(r.ok && r.value.tags).toEqual(['viagem', 'A2']);
		const sem = parseItemEdit({ lemma: 'festa' });
		expect(sem.ok && 'tags' in sem.value).toBe(false);
	});

	test('lema vazio e nota longa são erro', () => {
		const r = parseItemEdit({ lemma: '', note: 'n'.repeat(LIMITS.note + 1) });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['lemma', 'note']);
	});
});

describe('isDuplicateError', () => {
	test('reconhece unique_violation do Postgres', () => {
		expect(isDuplicateError({ code: '23505', message: 'duplicate key' })).toBe(true);
	});

	test('outros erros não são duplicata', () => {
		expect(isDuplicateError({ code: '23514' })).toBe(false);
		expect(isDuplicateError(null)).toBe(false);
	});
});

describe('parseSaveEntry', () => {
	const full = {
		language: 'IT',
		lemma: '  festa ',
		sense: 'festa',
		ipa: 'ˈfɛsta',
		partOfSpeech: 'substantivo',
		encounter: {
			form: 'feste',
			sentence: '  Una frase inventata con feste dentro. ',
			highlight: 'feste',
			sense: 'festas',
			position: { seconds: 2530.7, junk: 'x' },
			seenAt: '2026-11-11T10:00:00Z',
			clientId: 'A1B2C3D4-0000-4000-8000-000000000001'
		},
		work: {
			kind: 'episodio',
			title: 'Série de teste',
			subtitle: 'T1E2',
			refs: { imdbId: 'tt0000001', season: 1, episode: 2, other: 1 }
		}
	};

	test('mapeia para o formato de save_items', () => {
		expect(parseSaveEntry(full, 'stremio')).toEqual({
			ok: true,
			entry: {
				language: 'it',
				lemma: 'festa',
				lemma_key: 'festa',
				reading: '',
				sense: 'festa',
				note: '',
				ipa: 'ˈfɛsta',
				part_of_speech: 'substantivo',
				encounter: {
					form: 'feste',
					sentence: 'Una frase inventata con feste dentro.',
					highlight: 'feste',
					sense: 'festas',
					position: { seconds: 2530 },
					origin: 'stremio',
					seen_at: '2026-11-11T10:00:00.000Z',
					client_id: 'a1b2c3d4-0000-4000-8000-000000000001'
				},
				work: {
					kind: 'episodio',
					title: 'Série de teste',
					subtitle: 'T1E2',
					refs: { imdb_id: 'tt0000001', season: 1, episode: 2 },
					language: null
				}
			}
		});
	});

	test('encounter.translation: a frase na língua nativa, cortada no limite', () => {
		const entry = (translation: unknown) => {
			const r = parseSaveEntry(
				{
					language: 'it',
					lemma: 'fare finta di',
					encounter: { sentence: 'Facevo finta di dormire.', translation }
				},
				'stremio'
			);
			return r.ok ? r.entry.encounter : undefined;
		};
		expect(entry('  Eu fingia que dormia. ')?.translation).toBe('Eu fingia que dormia.');
		expect(entry('x'.repeat(1200))?.translation).toHaveLength(1000);
		expect(entry('')).not.toHaveProperty('translation');
		expect(entry(42)).not.toHaveProperty('translation');
	});

	test('só language e lemma são obrigatórios; item sem encontro vale', () => {
		expect(parseSaveEntry({ language: 'ja', lemma: '猫' }, 'stremio')).toEqual({
			ok: true,
			entry: {
				language: 'ja',
				lemma: '猫',
				lemma_key: '猫',
				reading: '',
				sense: '',
				note: '',
				ipa: '',
				part_of_speech: ''
			}
		});
	});

	test('japonês com leitura: a leitura vai junto do lema', () => {
		const r = parseSaveEntry({ language: 'ja', lemma: '猫', reading: ' ねこ ' }, 'stremio');
		expect(r.ok && r.entry).toMatchObject({ lemma: '猫', lemma_key: '猫', reading: 'ねこ' });
	});

	test('alemão: o lema fica como escrito; a chave é minúscula (Haus e haus são o mesmo item)', () => {
		const a = parseSaveEntry({ language: 'de', lemma: 'Haus' }, 'stremio');
		const b = parseSaveEntry({ language: 'DE', lemma: 'haus' }, 'stremio');
		expect(a.ok && a.entry.lemma).toBe('Haus');
		expect(a.ok && a.entry.lemma_key).toBe('haus');
		expect(b.ok && b.entry.lemma_key).toBe('haus');
	});

	test('qualquer tag BCP 47: tétum vale, lixo não; a tag sai canônica', () => {
		const tet = parseSaveEntry({ language: 'tet', lemma: 'uma' }, 'stremio');
		expect(tet.ok && tet.entry.language).toBe('tet');
		const br = parseSaveEntry({ language: 'pt-br', lemma: 'Casa' }, 'stremio');
		expect(br.ok && br.entry).toMatchObject({
			language: 'pt-BR',
			lemma: 'Casa',
			lemma_key: 'casa'
		});
		expect(parseSaveEntry({ language: 'xx!!', lemma: 'a' }, 'stremio')).toEqual({
			ok: false,
			error: 'language inválido'
		});
	});

	test('textos longos são cortados; destaque longo demais some', () => {
		const r = parseSaveEntry(
			{
				language: 'en',
				lemma: 'run',
				sense: 's'.repeat(LIMITS.sense + 10),
				encounter: { sentence: 'f'.repeat(LIMITS.sentence + 1), highlight: 'h'.repeat(81) }
			},
			'stremio'
		);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect([...r.entry.sense]).toHaveLength(LIMITS.sense);
		expect(r.entry.encounter?.sentence).toHaveLength(LIMITS.sentence);
		expect(r.entry.encounter?.highlight).toBe('');
	});

	test('recusa o item com o motivo, sem derrubar nada', () => {
		const err = (raw: unknown) => {
			const r = parseSaveEntry(raw, 'stremio');
			return r.ok ? null : r.error;
		};
		expect(err(null)).toBe('item inválido');
		expect(err({ language: 'xx!!', lemma: 'a' })).toBe('language inválido');
		expect(err({ language: 'en', lemma: ' ' })).toBe('lemma vazio');
		expect(err({ language: 'en', lemma: 'a'.repeat(81) })).toBe('lemma longo demais');
		expect(err({ language: 'en', lemma: 'a', encounter: { origin: 'tv' } })).toStartWith(
			'encounter.origin'
		);
		expect(err({ language: 'en', lemma: 'a', encounter: { clientId: 'x' } })).toStartWith(
			'encounter.clientId'
		);
		expect(err({ language: 'en', lemma: 'a', work: { kind: 'filme', title: 'X' } })).toBe(
			'work só vale junto de um encounter'
		);
		expect(err({ language: 'en', lemma: 'a', encounter: {}, work: { kind: 'tv' } })).toStartWith(
			'work.kind'
		);
		expect(err({ language: 'en', lemma: 'a', encounter: {}, work: { kind: 'filme' } })).toBe(
			'work.title vazio'
		);
		expect(
			err({ language: 'en', lemma: 'a', encounter: {}, work: { kind: 'musica', title: 'X' } })
		).toStartWith('música precisa');
	});

	test('obra existente pelo id', () => {
		const id = '7d1f0e2a-0000-4000-8000-000000000009';
		const r = parseSaveEntry({ language: 'en', lemma: 'a', encounter: {}, work: { id } }, 'musica');
		expect(r.ok && r.entry.work).toEqual({ id });
		expect(r.ok && r.entry.encounter?.origin).toBe('musica');
	});
});

describe('parseWorkRefs', () => {
	test('aceita só referências no formato dos checks', () => {
		expect(
			parseWorkRefs({ youtubeId: 'dQw4w9WgXcQ', imdbId: 'nm123', path: ' /livros/a.epub ' })
		).toEqual({
			youtube_id: 'dQw4w9WgXcQ',
			path: '/livros/a.epub'
		});
	});

	test('temporada e episódio só junto do imdb, e os dois juntos', () => {
		expect(parseWorkRefs({ imdbId: 'tt1', season: 2 })).toEqual({ imdb_id: 'tt1' });
		expect(parseWorkRefs({ season: 2, episode: 3 })).toEqual({});
	});
});

describe('formatWorkSource', () => {
	test('obra, subtítulo e minuto da cena', () => {
		expect(formatWorkSource({ title: 'Kaguya', subtitle: 'T1E2' }, { seconds: 2530 })).toBe(
			'Kaguya · T1E2, 42:10'
		);
	});

	test('passa de uma hora com h:mm:ss', () => {
		expect(formatWorkSource({ title: 'Filme', subtitle: '' }, { seconds: 3725 })).toBe(
			'Filme, 1:02:05'
		);
	});

	test('sem obra ou sem tempo', () => {
		expect(formatWorkSource(null, { seconds: 61 })).toBe('1:01');
		expect(formatWorkSource({ title: 'Volare', subtitle: 'Artista' }, {})).toBe('Volare · Artista');
		expect(formatWorkSource(null, null)).toBe('');
	});
});
