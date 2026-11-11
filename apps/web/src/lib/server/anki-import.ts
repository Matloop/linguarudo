// Grava um lote do import do Anki: notas (import_anki_notes) e, para cada flashcard
// ainda sem revisão aqui, o histórico do Anki com o cronograma reaplicado pelo FSRS
// (import_anki_reviews). O lote já chega conferido por parseImportBatch.

import type { SupabaseClient } from '@supabase/supabase-js';
import { lemmaKey } from '@linguetta/language';
import { ankiEncounterId } from '#lib/anki/batch.ts';
import type { ImportCard, ImportNote } from '#lib/anki/mapping.ts';
import type { Database, Json } from '#lib/database.types.ts';
import { clozeCount } from '#lib/fichas.ts';
import type { Language } from '#lib/languages.ts';
import { replay } from './scheduler.ts';

type Client = SupabaseClient<Database>;

export interface ImportBatchResult {
	items: number;
	fichas: number;
	/** Flashcards que levaram o histórico do Anki. */
	scheduled: number;
}

const REVIEWS_PER_CALL = 200;

function allSuspended(cards: ImportCard[]): boolean {
	return cards.length > 0 && cards.every((c) => c.suspended);
}

async function toPayload(note: ImportNote, language: Language) {
	const base = {
		guid: note.guid,
		deck: note.deck,
		tags: note.tags,
		suspended: allSuspended(note.cards)
	};
	if (note.type === 'ficha') {
		return {
			...base,
			type: 'ficha',
			front: note.front,
			back: note.back,
			reverse: note.reverse,
			cloze_count: clozeCount(note.front),
			front_image: note.front_image,
			front_audio: note.front_audio,
			back_image: note.back_image,
			back_audio: note.back_audio
		};
	}
	return {
		...base,
		type: 'item',
		produce: note.cards.some((c) => c.kind === 'produzir'),
		image: note.image,
		audio: note.audio,
		entry: {
			language,
			lemma: note.lemma,
			lemma_key: lemmaKey(note.lemma, language),
			reading: note.reading,
			sense: note.sense,
			note: '',
			ipa: '',
			part_of_speech: '',
			// O encontro marca a origem (Anki); o id fixo pelo GUID evita duplicar no reimport.
			encounter: {
				form: '',
				sentence: note.sentence,
				highlight: '',
				sense: note.sense,
				position: {},
				origin: 'anki',
				seen_at: null,
				client_id: await ankiEncounterId(note.guid)
			}
		}
	};
}

export async function importAnkiBatch(
	supabase: Client,
	language: Language,
	notes: ImportNote[]
): Promise<ImportBatchResult> {
	const payload = await Promise.all(notes.map((n) => toPayload(n, language)));
	const { data: rows, error } = await supabase.rpc('import_anki_notes', {
		p_language: language,
		p_notes: payload as unknown as Json
	});
	if (error) throw new Error(`import_anki_notes: ${error.message}`);

	const byGuid = new Map(notes.map((n) => [n.guid, n]));
	const toSchedule: { flashcard_id: string; logs: unknown[]; next: unknown }[] = [];
	for (const row of rows ?? []) {
		if (!row.fresh) continue;
		const card = byGuid.get(row.guid)?.cards.find((c) => c.kind === row.kind && c.ord === row.ord);
		if (!card || card.logs.length === 0) continue;
		const logs = card.logs.map((l) => ({ rating: l.rating, reviewed_at: l.at }));
		const { card: next } = await replay({ id: row.flashcard_id, created_at: row.created_at }, logs);
		toSchedule.push({ flashcard_id: row.flashcard_id, logs, next });
	}
	let scheduled = 0;
	for (let i = 0; i < toSchedule.length; i += REVIEWS_PER_CALL) {
		const { data, error: reviewError } = await supabase.rpc('import_anki_reviews', {
			p_flashcards: toSchedule.slice(i, i + REVIEWS_PER_CALL) as unknown as Json
		});
		if (reviewError) throw new Error(`import_anki_reviews: ${reviewError.message}`);
		scheduled += data ?? 0;
	}
	return {
		items: notes.filter((n) => n.type === 'item').length,
		fichas: notes.filter((n) => n.type === 'ficha').length,
		scheduled
	};
}
