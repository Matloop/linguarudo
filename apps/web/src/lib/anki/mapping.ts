// Do Anki para o Linguetta: cada tipo de nota vira Vocabulário (item do banco),
// Ficha ou fica de fora. Gera as notas a importar com o deck do Anki (vira deck no
// Linguetta), mídia, tags e o histórico de revisões de cada flashcard.

import {
	clozeCount,
	FICHA_LIMITS,
	sanitizeFichaHtml,
	type FichaFlashcardKind
} from '#lib/fichas.ts';
import { LIMITS, type FlashcardKind } from '#lib/items.ts';
import type { Grade } from '#lib/review.ts';
import type { AnkiCollection, AnkiNote, AnkiNotetype } from './collection.ts';
import { answerOnly, extractMedia, plainText, renderTemplate, type Fields } from './template.ts';

export type NotetypeTarget = 'item' | 'ficha' | 'skip';

/** Índice do campo do Anki para cada parte do item; null = não usar. */
export interface ItemFieldMap {
	lemma: number;
	sense: number | null;
	sentence: number | null;
	reading: number | null;
}

export interface NotetypeMapping {
	target: NotetypeTarget;
	item: ItemFieldMap;
}

export interface NotetypeSummary {
	id: string;
	name: string;
	cloze: boolean;
	fields: string[];
	notes: number;
	cards: number;
	/** Texto dos campos da primeira nota, para a pessoa reconhecer o tipo. */
	sample: string[];
	suggestion: NotetypeMapping;
}

export interface ImportLog {
	rating: Grade;
	/** ISO */
	at: string;
}

export interface ImportCard {
	kind: FlashcardKind | FichaFlashcardKind;
	ord: number;
	suspended: boolean;
	logs: ImportLog[];
}

interface ImportBase {
	guid: string;
	/** Caminho do deck no Anki ("Pai::Filho"); '' ou "Default" = deck padrão. */
	deck: string;
	tags: string[];
	cards: ImportCard[];
}

export interface ImportItemNote extends ImportBase {
	type: 'item';
	lemma: string;
	reading: string;
	sense: string;
	sentence: string;
	/** Nome do arquivo no pacote (o upload troca pelo caminho no bucket). */
	image: string | null;
	audio: string | null;
}

export interface ImportFichaNote extends ImportBase {
	type: 'ficha';
	front: string;
	back: string;
	reverse: boolean;
	front_image: string | null;
	front_audio: string | null;
	back_image: string | null;
	back_audio: string | null;
}

export type ImportNote = ImportItemNote | ImportFichaNote;

// ---------- Sugestão ----------

const LEMMA_NAMES =
	/^(word|palavra|vocab|vocabulary|vocabulário|expression|expressão|lemma|target|termo|term|parola|palabra|mot|wort|kanji|hanzi|front|frente)$/i;
const SENSE_NAMES =
	/^(meaning|translation|tradução|traducao|sentido|significado|definition|definição|english|português|portugues|back|verso|gloss)$/i;
const SENTENCE_NAMES = /sentence|example|frase|exemplo|context|contexto/i;
const READING_NAMES = /^(reading|furigana|kana|pinyin|leitura|romaji)$/i;
/** Nome do tipo que indica vocabulário (ex.: "Japanese vocab", "Vocabulário"). */
const VOCAB_TYPE = /vocab|word|palavra|vocabul/i;

function find(fields: string[], re: RegExp, except: (number | null)[] = []): number | null {
	const i = fields.findIndex((f, i) => re.test(f.trim()) && !except.includes(i));
	return i >= 0 ? i : null;
}

export function suggestMapping(nt: AnkiNotetype): NotetypeMapping {
	const lemma = find(nt.fields, LEMMA_NAMES) ?? 0;
	const sense =
		find(nt.fields, SENSE_NAMES, [lemma]) ?? (nt.fields.length > 1 && lemma === 0 ? 1 : null);
	const sentence = find(nt.fields, SENTENCE_NAMES, [lemma, sense]);
	const reading = find(nt.fields, READING_NAMES, [lemma, sense, sentence]);
	const item = { lemma, sense, sentence, reading };
	if (nt.cloze) return { target: 'ficha', item };
	// Vocabulário só quando o tipo tem cara disso; no resto, Ficha guarda tudo.
	const vocab =
		VOCAB_TYPE.test(nt.name) ||
		(find(nt.fields, LEMMA_NAMES) !== null &&
			!/^(front|frente)$/i.test(nt.fields[lemma] ?? '') &&
			sense !== null);
	return { target: vocab ? 'item' : 'ficha', item };
}

export function summarize(col: AnkiCollection): NotetypeSummary[] {
	const notes = new Map<string, AnkiNote[]>();
	for (const n of col.notes) {
		const list = notes.get(n.notetypeId);
		if (list) list.push(n);
		else notes.set(n.notetypeId, [n]);
	}
	const noteType = new Map(col.notes.map((n) => [n.id, n.notetypeId]));
	const cards = new Map<string, number>();
	for (const c of col.cards) {
		const nt = noteType.get(c.noteId);
		if (nt) cards.set(nt, (cards.get(nt) ?? 0) + 1);
	}
	return [...col.notetypes.values()]
		.filter((nt) => notes.has(nt.id))
		.map((nt) => ({
			id: nt.id,
			name: nt.name,
			cloze: nt.cloze,
			fields: nt.fields,
			notes: notes.get(nt.id)!.length,
			cards: cards.get(nt.id) ?? 0,
			sample: notes.get(nt.id)![0].fields.map((f) => plainText(f).slice(0, 80)),
			suggestion: suggestMapping(nt)
		}))
		.sort((a, b) => b.notes - a.notes);
}

// ---------- Construção ----------

const MAX_TAGS = 50;
const MAX_TAG = 100;
const MAX_DECK_PATH = 400;

function cut(s: string, max: number): string {
	return [...s].slice(0, max).join('').trim();
}

function tagsFor(note: AnkiNote): string[] {
	const out = new Set<string>();
	for (const t of note.tags) {
		const tag = cut(t.trim(), MAX_TAG);
		if (tag) out.add(tag);
	}
	return [...out].slice(0, MAX_TAGS);
}

/** Deck da nota: o do primeiro flashcard (menor ord); notas espalhadas ficam num só. */
function deckFor(col: AnkiCollection, cards: AnkiCollection['cards']): string {
	const first = [...cards].sort((a, b) => a.ord - b.ord)[0];
	return cut(first ? (col.decks.get(first.deckId) ?? '') : '', MAX_DECK_PATH);
}

function isGrade(n: number): n is Grade {
	return n === 1 || n === 2 || n === 3 || n === 4;
}

/** Ficha: o texto não pode ficar vazio; se só há mídia, um marcador no lugar. */
function face(html: string, hasImage: boolean, hasAudio: boolean, required: boolean): string {
	const clean = sanitizeFichaHtml(html);
	if (clean || !required) return cut(clean, FICHA_LIMITS.face);
	return hasAudio ? '(áudio)' : hasImage ? '(imagem)' : '';
}

/** Arquivos que a nota usa (nome no pacote antes do upload, caminho depois). */
export function noteMedia(n: ImportNote): string[] {
	const all =
		n.type === 'item'
			? [n.image, n.audio]
			: [n.front_image, n.front_audio, n.back_image, n.back_audio];
	return all.filter((f): f is string => !!f);
}

const CLOZE_FIELD = /\{\{(?:[^}]*:)?cloze:([^}]+)\}\}/;

export interface BuiltImport {
	notes: ImportNote[];
	/** Arquivos do pacote citados pelas notas importadas. */
	media: Set<string>;
	/** Notas que não entraram (tipo fora ou sem conteúdo). */
	skipped: number;
}

export function buildImport(
	col: AnkiCollection,
	mappings: Readonly<Record<string, NotetypeMapping>>,
	available: ReadonlySet<string> | ReadonlyMap<string, unknown>
): BuiltImport {
	const cardsByNote = new Map<string, AnkiCollection['cards']>();
	for (const c of col.cards) {
		const list = cardsByNote.get(c.noteId);
		if (list) list.push(c);
		else cardsByNote.set(c.noteId, [c]);
	}
	const logsByCard = new Map<string, ImportLog[]>();
	for (const r of col.reviews) {
		// Reagendamento manual (type 4) e nota 0 não são revisões.
		if (r.type === 4 || !isGrade(r.ease)) continue;
		const log = { rating: r.ease, at: new Date(r.at).toISOString() };
		const list = logsByCard.get(r.cardId);
		if (list) list.push(log);
		else logsByCard.set(r.cardId, [log]);
	}

	const notes: ImportNote[] = [];
	const media = new Set<string>();
	let skipped = 0;
	const use = (name: string | undefined): string | null =>
		name && available.has(name) ? name : null;
	const push = (n: ImportNote) => {
		notes.push(n);
		for (const f of noteMedia(n)) media.add(f);
	};
	for (const note of col.notes) {
		const nt = col.notetypes.get(note.notetypeId);
		const mapping = nt ? mappings[nt.id] : undefined;
		if (!nt || !mapping || mapping.target === 'skip') {
			skipped++;
			continue;
		}
		const ankiCards = cardsByNote.get(note.id) ?? [];
		const tags = tagsFor(note);
		const deck = deckFor(col, ankiCards);
		const fields: Fields = Object.fromEntries(
			nt.fields.map((name, i) => [name, note.fields[i] ?? ''])
		);
		const card = (kind: ImportCard['kind'], ord: number, c: (typeof ankiCards)[number]) => ({
			kind,
			ord,
			suspended: c.queue === -1,
			logs: logsByCard.get(c.id) ?? []
		});

		if (mapping.target === 'item') {
			const m = mapping.item;
			const text = (i: number | null, max: number) =>
				i === null ? '' : cut(plainText(note.fields[i] ?? ''), max);
			const lemma = text(m.lemma, LIMITS.lemma);
			if (!lemma) {
				skipped++;
				continue;
			}
			const all = extractMedia(note.fields.join('\n'));
			const cards = ankiCards
				.filter((c) => c.ord === 0 || c.ord === 1)
				.map((c) => card(c.ord === 0 ? 'reconhecer' : 'produzir', 0, c));
			push({
				type: 'item',
				guid: note.guid,
				deck,
				tags,
				lemma,
				reading: text(m.reading, LIMITS.reading),
				sense: text(m.sense, LIMITS.sense),
				sentence: text(m.sentence, LIMITS.sentence),
				image: use(all.images[0]),
				audio: use(all.sounds[0]),
				cards
			});
			continue;
		}

		const template = nt.templates[0];
		if (!template) {
			skipped++;
			continue;
		}
		let frontHtml: string;
		let backHtml: string;
		let cards: ImportCard[];
		let reverse = false;
		if (nt.cloze) {
			const clozeField = CLOZE_FIELD.exec(template.qfmt)?.[1]?.trim() ?? nt.fields[0];
			frontHtml = fields[clozeField] ?? '';
			backHtml = renderTemplate(template.afmt, { ...fields, [clozeField]: '' });
			cards = ankiCards.map((c) => card('lacuna', c.ord + 1, c));
		} else {
			frontHtml = renderTemplate(template.qfmt, fields);
			backHtml = answerOnly(renderTemplate(template.afmt, fields, { frontSide: frontHtml }));
			reverse = nt.templates.length > 1 && ankiCards.some((c) => c.ord === 1);
			cards = ankiCards
				.filter((c) => c.ord === 0 || (reverse && c.ord === 1))
				.map((c) => card(c.ord === 0 ? 'frente' : 'inverso', 0, c));
		}
		const f = extractMedia(frontHtml);
		const b = extractMedia(backHtml);
		const frontImage = use(f.images[0]);
		const frontAudio = use(f.sounds[0]);
		const front = face(f.html, !!frontImage, !!frontAudio, true);
		if (!front || (nt.cloze && clozeCount(front) === 0)) {
			skipped++;
			continue;
		}
		push({
			type: 'ficha',
			guid: note.guid,
			deck,
			tags,
			front,
			back: face(b.html, false, false, false),
			reverse,
			front_image: frontImage,
			front_audio: frontAudio,
			back_image: use(b.images.find((i) => i !== f.images[0])),
			back_audio: use(b.sounds.find((s) => s !== f.sounds[0])),
			cards
		});
	}
	return { notes, media, skipped };
}
