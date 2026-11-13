import { error, fail, redirect } from '@sveltejs/kit';
import {
	ORIGIN_LABELS,
	formatWorkSource,
	type FlashcardKind,
	type ItemStatus,
	type Origin
} from '#lib/items.ts';
import {
	formatDueShort,
	formatNextReview,
	isDueToday,
	isLeech,
	itemReviewState,
	itemStrength,
	STATE_NEW
} from '#lib/review.ts';
import { releaseMedia, signMedia } from '#lib/server/media.ts';
import { addItem } from '#lib/server/item-add.ts';
import { editItem } from '#lib/server/item-edit.ts';
import { deckTree } from '#lib/decks.ts';
import { listDecks } from '#lib/server/decks.ts';
import { extraAction, moveAction } from '#lib/server/deck-actions.ts';
import type { Actions, PageServerLoad } from './$types';

const PAGE_SIZE = 500;
/** Encontros mostrados por item; o mais recente primeiro. */
const ENCOUNTERS_SHOWN = 5;
/** Revisões mostradas no histórico do painel (gráfico e lista). */
const HISTORY_SHOWN = 20;

async function requireUser(locals: App.Locals) {
	const user = await locals.getUser();
	if (!user) error(401, 'Entre para ver suas palavras.');
	return user;
}

function formId(form: FormData): string | null {
	const id = form.get('id');
	return typeof id === 'string' && id !== '' ? id : null;
}

export const load: PageServerLoad = async ({ locals, url, parent }) => {
	const user = await requireUser(locals);
	const { shell } = await parent();
	if (!shell) error(401, 'Entre para ver suas palavras.');
	if (!shell.active) redirect(303, '/inicio');
	const language = shell.active;
	const now = new Date();

	const [{ data, error: dbError }, decks] = await Promise.all([
		locals.supabase
			.from('items')
			.select(
				'id, language, lemma, reading, sense, ipa, note, tags, image, audio, status, deck_id, seen_count, created_at, flashcards(id, kind, state, stability, due_at, lapses), encounters(id, sentence, highlight, sense, origin, position, seen_at, works(title, subtitle))'
			)
			.eq('user_id', user.id)
			.eq('language', language)
			.is('deleted_at', null)
			.is('encounters.deleted_at', null)
			.order('created_at', { ascending: false })
			.order('seen_at', { referencedTable: 'encounters', ascending: false })
			.limit(ENCOUNTERS_SHOWN, { referencedTable: 'encounters' })
			.limit(PAGE_SIZE),
		listDecks(locals.supabase, language).catch(() => [])
	]);
	if (dbError) error(500, 'Não deu para carregar suas palavras agora.');

	const items = data.map(({ flashcards, encounters, seen_count, created_at, deck_id, ...item }) => {
		const status = item.status as ItemStatus;
		const dueAts = status === 'ativo' ? flashcards.map((c) => c.due_at) : [];
		// A lista olha só o que já foi estudado: o flashcard novo nasce vencido.
		const studiedDue = flashcards
			.filter((c) => c.state !== STATE_NEW)
			.map((c) => Date.parse(c.due_at));
		const review = itemReviewState(flashcards, status === 'conhecido', now, shell.clock);
		return {
			...item,
			status,
			createdAt: created_at,
			deckId: deck_id,
			seenCount: seen_count,
			strength: itemStrength(flashcards),
			leech: isLeech(flashcards),
			lapses: Math.max(0, ...flashcards.map((c) => c.lapses)),
			hasProduce: flashcards.some((c) => c.kind === 'produzir'),
			dueToday: status === 'ativo' && isDueToday(dueAts, now, shell.clock),
			dueAt: dueAts.length ? Math.min(...dueAts.map(Date.parse)) : null,
			next: status === 'ativo' ? formatNextReview(dueAts, now, shell.clock) : '',
			review,
			/** Coluna da lista: "há 3 dias", "em 10 min", "amanhã"… (vazio se nova ou conhecida). */
			when:
				review === 'nova' || review === 'conhecida' || studiedDue.length === 0
					? ''
					: formatDueShort(new Date(Math.min(...studiedDue)), now, shell.clock),
			encounters: encounters.map((e) => ({
				id: e.id,
				sentence: e.sentence,
				highlight: e.highlight,
				sense: e.sense,
				origin: e.origin as Origin,
				originLabel: ORIGIN_LABELS[e.origin as Origin],
				source: formatWorkSource(e.works, e.position),
				seenAt: e.seen_at
			}))
		};
	});

	// O painel lateral (?item=) traz o histórico de revisões e os flashcards daquele item.
	const selectedId = url.searchParams.get('item');
	const selected = items.find((i) => i.id === selectedId) ?? null;
	let history: {
		rating: number;
		reviewedAt: string;
		kind: FlashcardKind;
		intervalDays: number | null;
	}[] = [];
	let historyTotal = 0;
	let historyLapses = 0;
	let selectedCards: {
		id: string;
		kind: FlashcardKind;
		isNew: boolean;
		dueAt: string;
		scheduledDays: number;
	}[] = [];
	// URLs assinadas só da mídia do item aberto (a lista não mostra mídia).
	let selectedMedia: { image: string | null; audio: string | null } = { image: null, audio: null };
	if (selected) {
		// Total e erros contam no banco; a lista traz só as últimas.
		const logsOf = (head = false) =>
			locals.supabase
				.from('review_logs')
				.select('rating, reviewed_at, interval_days, flashcards!inner(item_id, kind)', {
					count: 'exact',
					head
				})
				.eq('user_id', user.id)
				.eq('flashcards.item_id', selected.id);
		const [{ data: logs, count }, { count: lapses }, { data: cards }, urls] = await Promise.all([
			logsOf().order('reviewed_at', { ascending: false }).limit(HISTORY_SHOWN),
			logsOf(true).eq('rating', 1),
			locals.supabase
				.from('flashcards')
				.select('id, kind, state, due_at, scheduled_days')
				.eq('user_id', user.id)
				.eq('item_id', selected.id)
				.order('ord'),
			signMedia(locals.supabase, [selected.image, selected.audio]).catch(
				() => new Map<string, string>()
			)
		]);
		history = (logs ?? []).map((l) => ({
			rating: l.rating,
			reviewedAt: l.reviewed_at,
			kind: (l.flashcards as unknown as { kind: FlashcardKind }).kind,
			intervalDays: l.interval_days
		}));
		historyTotal = count ?? history.length;
		historyLapses = lapses ?? 0;
		selectedCards = (cards ?? []).map((c) => ({
			id: c.id,
			kind: c.kind as FlashcardKind,
			isNew: c.state === STATE_NEW,
			dueAt: c.due_at,
			scheduledDays: c.scheduled_days
		}));
		selectedMedia = {
			image: selected.image ? (urls.get(selected.image) ?? null) : null,
			audio: selected.audio ? (urls.get(selected.audio) ?? null) : null
		};
	}

	return {
		items,
		decks: deckTree(decks).map((d) => ({
			id: d.id,
			name: d.name,
			parentId: d.parentId,
			depth: d.parentId ? 1 : 0,
			isDefault: d.isDefault
		})),
		language,
		uiLanguage: shell.uiLanguage,
		selectedId: selected?.id ?? null,
		selectedMedia,
		selectedCards,
		history,
		historyTotal,
		historyLapses,
		now: now.toISOString()
	};
};

export const actions: Actions = {
	move: moveAction,
	extra: extraAction,
	add: async ({ locals, request }) => {
		const user = await requireUser(locals);
		return addItem(locals, user.id, await request.formData());
	},

	edit: async ({ locals, request }) => {
		const user = await requireUser(locals);
		return editItem(locals, user.id, await request.formData());
	},

	known: async ({ locals, request }) => {
		const user = await requireUser(locals);
		const form = await request.formData();
		const id = formId(form);
		const status: ItemStatus = form.get('known') === 'true' ? 'conhecido' : 'ativo';
		if (!id) return fail(400, { action: 'known' as const, message: 'Palavra não encontrada.' });

		const { data, error: dbError } = await locals.supabase
			.from('items')
			.update({ status })
			.eq('id', id)
			.eq('user_id', user.id)
			.is('deleted_at', null)
			.select('id');
		if (dbError || data.length === 0) {
			return fail(dbError ? 500 : 404, {
				action: 'known' as const,
				message: 'Não deu para mudar agora. Tente de novo.'
			});
		}
		return { action: 'known' as const, id, status };
	},

	delete: async ({ locals, request }) => {
		const user = await requireUser(locals);
		const id = formId(await request.formData());
		if (!id) return fail(400, { action: 'delete' as const, message: 'Palavra não encontrada.' });

		// Apagar marca deleted_at: a exclusão precisa chegar aos outros aparelhos (sync).
		const { data: gone, error: dbError } = await locals.supabase
			.from('items')
			.update({ deleted_at: new Date().toISOString() })
			.eq('id', id)
			.eq('user_id', user.id)
			.is('deleted_at', null)
			.select('image, audio');
		if (dbError) {
			return fail(500, { action: 'delete' as const, message: 'Não deu para apagar agora.' });
		}
		// Arquivos que só esse item usava saem do Storage.
		await releaseMedia(
			locals.supabase,
			(gone ?? []).flatMap((g) => [g.image, g.audio]).filter((p): p is string => !!p)
		);
		return { action: 'delete' as const, deleted: id };
	}
};
