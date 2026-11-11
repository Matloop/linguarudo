import { error, fail, redirect } from '@sveltejs/kit';
import { buildQueue, isGrade, newRemaining } from '#lib/review.ts';
import {
	attachMediaUrls,
	fetchReviewSummary,
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
import { loadTags, nextDueText } from '#lib/server/summary.ts';
import type { Actions, PageServerLoad } from './$types';

/** Teto de segurança por carga; revisões vencidas não têm limite (a próxima carga traz o resto). */
const MAX_DUE_PER_LOAD = 500;

async function requireUser(locals: App.Locals) {
	const user = await locals.getUser();
	if (!user) error(401, 'Entre para revisar.');
	return user;
}

export const load: PageServerLoad = async ({ locals, parent, url }) => {
	const user = await requireUser(locals);
	const { shell } = await parent();
	if (!shell) error(401, 'Entre para revisar.');
	if (!shell.active) redirect(303, '/inicio');
	const language = shell.active;
	const now = new Date();
	// O shell já contou o limite de novas do dia; só busca de novo se ele falhou.
	const summary =
		shell.summary ?? (await fetchReviewSummary(locals.supabase, now).catch(() => null));
	if (!summary) error(500, 'Não deu para carregar a revisão agora.');

	// A revisão é do idioma ativo; o limite de novas do dia é um só para todos.
	// Com ?tag=, só os flashcards (de item ou de ficha) que têm a tag.
	const tag = url.searchParams.get('tag')?.trim() || null;
	const filter = { language, tag };
	const remaining = newRemaining(summary.newLimit, summary.newDoneToday);
	const nowIso = now.toISOString();
	const sources = [
		() => reviewableItemFlashcards(locals.supabase, user.id, filter),
		() => reviewableFichaFlashcards(locals.supabase, user.id, filter)
	];
	const none = Promise.resolve({ data: [], error: null });
	const [results, tags, nextDue] = await Promise.all([
		Promise.all(
			sources.flatMap((base) => [
				base().gt('state', 0).lte('due_at', nowIso).order('due_at').limit(MAX_DUE_PER_LOAD),
				remaining > 0
					? base().eq('state', 0).order('created_at').order('id').limit(remaining)
					: none
			])
		),
		loadTags(locals.supabase, user.id, language).catch(() => []),
		nextDueText(locals.supabase, user.id, language, now).catch(() => null)
	]);
	if (results.some((r) => r.error)) error(500, 'Não deu para carregar a revisão agora.');

	const rows = results.flatMap((r) => (r.data ?? []) as ReviewFlashcardRow[]);
	const queue = buildQueue(
		rows.map((r) => ({ ...r, dueAt: r.due_at, createdAt: r.created_at })),
		{ now, newLimit: summary.newLimit, newDoneToday: summary.newDoneToday }
	);
	return {
		queue: await attachMediaUrls(
			locals.supabase,
			await Promise.all(queue.map((r) => toReviewItem(r, now)))
		),
		autoplayAudio: shell.autoplayAudio,
		language,
		uiLanguage: shell.uiLanguage,
		nativeLanguage: shell.nativeLanguage,
		nextDue,
		tag,
		tags
	};
};

export const actions: Actions = {
	rate: async ({ locals, request }) => {
		const user = await requireUser(locals);
		const form = await request.formData();
		const flashcardId = form.get('flashcardId')?.toString() ?? '';
		const reps = Number(form.get('reps'));
		const rating = Number(form.get('rating'));
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
		const logs = await loadLogs(locals.supabase, row.id);
		const { next, intervalDays } = await scheduleReview(row, logs, review);
		const { data: logId, error: dbError } = await locals.supabase.rpc('record_review', {
			p_flashcard_id: row.id,
			p_expected_reps: row.reps,
			p_rating: rating,
			p_reviewed_at: review.reviewed_at,
			p_next: { ...next },
			p_unlock_produce: unlocksProduce({ kind: row.kind, sense: rowSense(row), intervalDays })
		});
		if (dbError || !logId) {
			const { status, text } = reviewErrorMessage(dbError?.message);
			return fail(status, { message: text, flashcardId, reason: dbError?.message ?? 'unknown' });
		}

		const [item] = await attachMediaUrls(locals.supabase, [
			await toReviewItem({ ...row, ...next }, now)
		]);
		return { logId, rating, item };
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
		const rest = (await loadLogs(locals.supabase, row.id)).filter((l) => l.id !== logId);
		const { card, maxIntervalDays } = await replay(row, rest);
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
			await toReviewItem({ ...row, ...card }, new Date())
		]);
		return { undone };
	}
};
