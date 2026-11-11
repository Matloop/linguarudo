import { error, fail, redirect } from '@sveltejs/kit';
import { buildQueue, dayStart, isGrade, leechAlert } from '#lib/review.ts';
import { addExtraNew, itemsOfWork, loadQueueState } from '#lib/server/decks.ts';
import { planNew, type QueueScope } from '#lib/server/queue.ts';
import {
	attachMediaUrls,
	loadLogs,
	loadReviewFlashcard,
	reviewErrorMessage,
	reviewableFichaFlashcards,
	reviewableItemFlashcards,
	rowSense,
	toReviewItem,
	type ReviewFlashcardRow
} from '#lib/server/reviews.ts';
import { replay, scheduleReview, unlocksProduce } from '#lib/server/scheduler.ts';
import { loadReviewSettings } from '#lib/server/settings.ts';
import { loadTags, nextDueText } from '#lib/server/summary.ts';
import type { Actions, PageServerLoad } from './$types';

/** Teto de segurança por carga; revisões vencidas não têm limite (a próxima carga traz o resto). */
const MAX_DUE_PER_LOAD = 500;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireUser(locals: App.Locals) {
	const user = await locals.getUser();
	if (!user) error(401, 'Entre para revisar.');
	return user;
}

/**
 * A fila do dia é do servidor (ADR 0005): vencidas dos decks do escopo, mais as novas que
 * planNew escolhe (orçamento do idioma, ordem, teto de cada deck). Escopo: tudo (decks não
 * pausados), ?deck= (o deck e os subdecks) ou ?obra= (novas daquela obra, como extra).
 */
export const load: PageServerLoad = async ({ locals, parent, url }) => {
	const user = await requireUser(locals);
	const { shell } = await parent();
	if (!shell) error(401, 'Entre para revisar.');
	if (!shell.active) redirect(303, '/inicio');
	const language = shell.active;
	const { clock, retention } = shell;
	const now = new Date();

	const state = await loadQueueState(locals.supabase, language, now, clock).catch(() => null);
	if (!state) error(500, 'Não deu para carregar a revisão agora.');

	const deckParam = url.searchParams.get('deck');
	const obraParam = url.searchParams.get('obra');
	let scope: QueueScope = { kind: 'all' };
	if (deckParam) {
		if (!state.decks.some((d) => d.id === deckParam)) error(404, 'Deck não encontrado.');
		scope = { kind: 'deck', deckId: deckParam };
	} else if (obraParam) {
		if (!UUID.test(obraParam)) error(404, 'Obra não encontrada.');
		const itemIds = await itemsOfWork(locals.supabase, obraParam).catch(() => null);
		if (!itemIds) error(500, 'Não deu para carregar a revisão agora.');
		scope = { kind: 'obra', workId: obraParam, itemIds };
	}
	const plan = planNew(state, scope);

	// Com ?tag=, só os flashcards (de item ou de ficha) que têm a tag.
	const tag = url.searchParams.get('tag')?.trim() || null;
	const filter = { language, tag, deckIds: [...plan.deckIds], queued: true };
	const nowIso = now.toISOString();
	const sources = [
		() => reviewableItemFlashcards(locals.supabase, user.id, filter),
		() => reviewableFichaFlashcards(locals.supabase, user.id, filter)
	];
	const none = Promise.resolve({ data: [], error: null });
	const [results, reviewedToday, tags, nextDue] = await Promise.all([
		Promise.all(
			sources.flatMap((base) => [
				// "Desta obra" é só de novas.
				scope.kind === 'obra'
					? none
					: base().gt('state', 0).lte('due_at', nowIso).order('due_at').limit(MAX_DUE_PER_LOAD),
				plan.ids.length > 0 ? base().eq('state', 0).in('id', plan.ids) : none
			])
		),
		locals.supabase
			.from('flashcards')
			.select('id, item_id')
			.eq('user_id', user.id)
			.gte('last_review_at', dayStart(now, clock).toISOString()),
		loadTags(locals.supabase, user.id, language).catch(() => []),
		nextDueText(locals.supabase, user.id, language, now, clock).catch(() => null)
	]);
	if (results.some((r) => r.error) || reviewedToday.error)
		error(500, 'Não deu para carregar a revisão agora.');

	const rank = new Map(plan.ids.map((id, i) => [id, i]));
	const rows = results
		.flatMap((r) => (r.data ?? []) as ReviewFlashcardRow[])
		.sort((a, b) => (rank.get(a.id) ?? -1) - (rank.get(b.id) ?? -1));
	const queue = buildQueue(
		rows.map((r) => ({
			...r,
			itemId: 'items' in r ? r.item_id : null,
			dueAt: r.due_at,
			createdAt: r.created_at
		})),
		{
			now,
			newLimit: plan.ids.length,
			newDoneToday: 0,
			plannedNew: true,
			reviewedToday: reviewedToday.data.map((c) => ({ id: c.id, itemId: c.item_id }))
		}
	);
	return {
		queue: await attachMediaUrls(
			locals.supabase,
			await Promise.all(queue.map((r) => toReviewItem(r, now, retention)))
		),
		autoplayAudio: shell.autoplayAudio,
		language,
		uiLanguage: shell.uiLanguage,
		nativeLanguage: shell.nativeLanguage,
		nextDue,
		tag,
		tags,
		/** Escopo da sessão: o player manda `obra` de volta no rate para contar como extra. */
		scope:
			scope.kind === 'deck'
				? { deck: scope.deckId, obra: null }
				: scope.kind === 'obra'
					? { deck: null, obra: scope.workId }
					: { deck: null, obra: null },
		/** Orçamento do idioma; `more` = novas que ficaram de fora (oferecer "+5 hoje"). */
		budget: {
			newAllowance: plan.newAllowance,
			newDoneToday: plan.newDoneToday,
			perDay: state.settings.perDay,
			extraNew: state.extraNew,
			more: plan.more
		},
		activeWorkId: state.activeWorkId
	};
};

export const actions: Actions = {
	rate: async ({ locals, request }) => {
		const user = await requireUser(locals);
		const form = await request.formData();
		const flashcardId = form.get('flashcardId')?.toString() ?? '';
		const reps = Number(form.get('reps'));
		const rating = Number(form.get('rating'));
		const durationMs = Number(form.get('durationMs'));
		if (!flashcardId || !Number.isInteger(reps) || !isGrade(rating)) {
			return fail(400, { message: 'Nota inválida.' });
		}

		const row = await loadReviewFlashcard(locals.supabase, user.id, flashcardId);
		if (!row) {
			const reason = 'flashcard_not_found';
			return fail(404, { message: reviewErrorMessage(reason).text, flashcardId, reason });
		}
		if (row.reps !== reps) {
			const reason = 'flashcard_stale';
			return fail(409, { message: reviewErrorMessage(reason).text, flashcardId, reason });
		}

		const now = new Date();
		const review = { rating, reviewed_at: now.toISOString() };
		const [logs, { retention, clock, leech: leechRule }] = await Promise.all([
			loadLogs(locals.supabase, row.id),
			loadReviewSettings(locals.supabase, user.id)
		]);
		const { next, intervalDays } = await scheduleReview(row, logs, review, retention);
		const { data: logId, error: dbError } = await locals.supabase.rpc('record_review', {
			p_flashcard_id: row.id,
			p_expected_reps: row.reps,
			p_rating: rating,
			p_reviewed_at: review.reviewed_at,
			p_next: { ...next },
			p_unlock_produce: unlocksProduce({ kind: row.kind, sense: rowSense(row), intervalDays }),
			p_duration_ms:
				Number.isFinite(durationMs) && durationMs > 0 ? Math.round(durationMs) : undefined
		});
		if (dbError || !logId) {
			const { status, text } = reviewErrorMessage(dbError?.message);
			return fail(status, { message: text, flashcardId, reason: dbError?.message ?? 'unknown' });
		}

		// Teimosa: avisa no limite da conta e a cada metade dele depois, como o Anki. O banco
		// já pôs o item/ficha em espera ou suspendeu, conforme a ação escolhida.
		const leech =
			next.lapses > row.lapses && leechAlert(next.lapses, leechRule.lapses)
				? {
						itemId: 'items' in row ? row.item_id : null,
						fichaId: 'fichas' in row ? row.fichas.id : null,
						lemma: 'items' in row ? row.items.lemma : null,
						lapses: next.lapses,
						action: leechRule.action
					}
				: null;
		// "Desta obra": nova começada fora do orçamento conta como extra do dia.
		if (row.state === 0 && form.get('obra')) {
			const language = 'items' in row ? row.items.language : row.fichas.language;
			await addExtraNew(locals.supabase, language, now, clock, 1);
		}
		const [item] = await attachMediaUrls(locals.supabase, [
			await toReviewItem({ ...row, ...next }, now, retention)
		]);
		return { logId, rating, leech, item };
	},

	undo: async ({ locals, request }) => {
		const user = await requireUser(locals);
		const logId = (await request.formData()).get('logId')?.toString() ?? '';
		if (!logId) return fail(400, { message: 'Nada para desfazer.' });

		const { data: log } = await locals.supabase
			.from('review_logs')
			.select('flashcard_id')
			.eq('id', logId)
			.eq('user_id', user.id)
			.maybeSingle();
		const row = log ? await loadReviewFlashcard(locals.supabase, user.id, log.flashcard_id) : null;
		if (!row) return fail(404, { message: 'Flashcard não encontrado.' });

		// O cronograma sem a revisão desfeita sai do log, como em qualquer outra mudança.
		const [logs, { retention }] = await Promise.all([
			loadLogs(locals.supabase, row.id),
			loadReviewSettings(locals.supabase, user.id)
		]);
		const rest = logs.filter((l) => l.id !== logId);
		const { card, maxIntervalDays } = await replay(row, rest, retention);
		const { error: dbError } = await locals.supabase.rpc('undo_review', {
			p_log_id: logId,
			p_expected_reps: row.reps,
			p_next: { ...card },
			p_drop_produce: !unlocksProduce({
				kind: row.kind,
				sense: rowSense(row),
				intervalDays: maxIntervalDays
			})
		});
		if (dbError) {
			return fail(reviewErrorMessage(dbError.message).status, {
				message: 'Não deu para desfazer agora.'
			});
		}
		const [undone] = await attachMediaUrls(locals.supabase, [
			await toReviewItem({ ...row, ...card }, new Date(), retention)
		]);
		return { undone };
	}
};
