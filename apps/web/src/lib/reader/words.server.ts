// Palavras tocadas no leitor web: visto, salvar e desfazer. Salvar passa pelo save_items
// (o mesmo núcleo do diálogo Guardar e do `save` do sync).

import { lemmaKey } from '@linguetta/language';
import { findHighlight } from '#lib/sentence.ts';
import { parseLanguage, type Language } from '#lib/languages.ts';
import { formatNextReview, STATE_NEW, type DayClock } from '#lib/review.ts';
import type { EncounterEntry, SaveEntry } from '#lib/items.ts';
import type { WordSave } from './word-input.ts';

type Supabase = App.Locals['supabase'];

export type ReaderBook = {
	id: string;
	title: string;
	language: Language;
	workId: string | null;
};

/** O que o cartão mostra de uma palavra que já está no banco. */
export type BankStatus = {
	itemId: string;
	/** "Nova", "Revisão hoje", "Revisão em 3 dias", "Conhecida". */
	label: string;
};

/** Desfazer um salvar só vale logo depois dele. */
const UNDO_WINDOW_MS = 10 * 60_000;

export async function loadReaderBook(supabase: Supabase, id: string): Promise<ReaderBook | null> {
	const { data } = await supabase
		.from('books')
		.select('id, title, language, work_id')
		.eq('id', id)
		.maybeSingle();
	const language = parseLanguage(data?.language);
	if (!data || !language) return null;
	return { id: data.id, title: data.title, language, workId: data.work_id };
}

/** Como está o item no banco (pelo Reconhecer). */
export async function bankStatus(
	supabase: Supabase,
	itemId: string,
	now: Date,
	clock: DayClock
): Promise<BankStatus | null> {
	const { data } = await supabase
		.from('items')
		.select('id, status, flashcards(kind, state, due_at)')
		.eq('id', itemId)
		.is('deleted_at', null)
		.maybeSingle();
	if (!data) return null;
	if (data.status === 'conhecido') return { itemId, label: 'Conhecida' };
	const rec = data.flashcards.find((f) => f.kind === 'reconhecer');
	if (!rec || rec.state === STATE_NEW) return { itemId, label: 'Nova, ainda sem revisão' };
	return { itemId, label: `Revisão ${formatNextReview([rec.due_at], now, clock)}` };
}

/**
 * Toque numa palavra do blend. Se ela já está no banco, soma um visto (como o `seen` do
 * sync) e devolve como ela está; senão, null.
 */
export async function touchWord(
	supabase: Supabase,
	book: ReaderBook,
	lemma: string,
	now: Date,
	clock: DayClock
): Promise<BankStatus | null> {
	const { data, error } = await supabase.rpc('mark_seen', {
		p_language: book.language,
		p_lemma_key: lemmaKey(lemma, book.language)
	});
	if (error) throw error;
	const hit = data?.[0];
	return hit ? bankStatus(supabase, hit.item_id, now, clock) : null;
}

/** Salva o item (idioma do livro) com o encontro desta página. */
export async function saveWord(
	supabase: Supabase,
	book: ReaderBook,
	input: WordSave
): Promise<{ itemId: string; created: boolean }> {
	const position: EncounterEntry['position'] = {};
	if (input.chapter) position.chapter = input.chapter;
	if (input.spine !== null) position.spine = input.spine;
	if (input.percent !== null) position.percent = input.percent;
	const highlight = input.sentence
		? findHighlight(input.sentence, [input.form, input.lemma], book.language)
		: '';
	const entry: SaveEntry = {
		language: book.language,
		lemma: input.lemma,
		lemma_key: lemmaKey(input.lemma, book.language),
		reading: '',
		sense: input.translation,
		note: input.note,
		ipa: '',
		part_of_speech: '',
		encounter: {
			form: input.form || input.lemma,
			sentence: input.sentence,
			highlight,
			sense: input.translation,
			position,
			origin: 'leitor',
			seen_at: input.at.toISOString(),
			client_id: input.clientId
		}
	};
	if (book.workId) entry.work = { id: book.workId };
	const { data, error } = await supabase.rpc('save_items', { p_items: [entry] });
	const saved = data?.[0];
	if (error || !saved) throw error ?? new Error('save_items sem resultado');
	return { itemId: saved.item_id, created: saved.created };
}

/**
 * Desfaz um salvar do leitor: apaga o item se ele nasceu desse salvar (há pouco tempo e
 * sem outros encontros). Item que já existia fica. Devolve se apagou.
 */
export async function undoSave(supabase: Supabase, userId: string, clientId: string) {
	const { data: enc } = await supabase
		.from('encounters')
		.select('item_id, created_at, items!inner(id, created_at, deleted_at)')
		.eq('client_id', clientId)
		.eq('user_id', userId)
		.maybeSingle();
	if (!enc) return false;
	const item = enc.items as unknown as { id: string; created_at: string; deleted_at: string | null };
	if (item.deleted_at) return true;
	const born = Date.parse(item.created_at);
	if (Math.abs(Date.parse(enc.created_at) - born) > 5_000) return false;
	if (Date.now() - born > UNDO_WINDOW_MS) return false;
	const { count } = await supabase
		.from('encounters')
		.select('id', { count: 'exact', head: true })
		.eq('item_id', item.id)
		.is('deleted_at', null);
	if ((count ?? 0) > 1) return false;
	// Apagar marca deleted_at, como em Minhas palavras: a exclusão chega aos aparelhos.
	const { data, error } = await supabase
		.from('items')
		.update({ deleted_at: new Date().toISOString() })
		.eq('id', item.id)
		.eq('user_id', userId)
		.is('deleted_at', null)
		.select('id');
	return !error && (data?.length ?? 0) > 0;
}
