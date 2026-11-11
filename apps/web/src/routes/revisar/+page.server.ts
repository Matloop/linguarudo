import { error, fail, redirect } from '@sveltejs/kit';
import { buildQueue, isGrade, newRemaining } from '#lib/review.ts';
import {
	fetchReviewSummary,
	loadLogs,
	loadReviewCard,
	reviewErrorMessage,
	reviewableCards,
	toReviewItem,
	type ReviewCardRow
} from '#lib/server/reviews.ts';
import { replay, scheduleReview, unlocksProduce } from '#lib/server/scheduler.ts';
import { nextDueText } from '#lib/server/summary.ts';
import type { Actions, PageServerLoad } from './$types';

/** Teto de segurança por carga; revisões vencidas não têm limite (a próxima carga traz o resto). */
const MAX_DUE_PER_LOAD = 500;

async function requireUser(locals: App.Locals) {
	const user = await locals.getUser();
	if (!user) error(401, 'Entre para revisar.');
	return user;
}

export const load: PageServerLoad = async ({ locals, parent }) => {
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
	const base = () => reviewableCards(locals.supabase, user.id, language);
	const remaining = newRemaining(summary.newLimit, summary.newDoneToday);
	const [due, fresh, nextDue] = await Promise.all([
		base().gt('state', 0).lte('due_at', now.toISOString()).order('due_at').limit(MAX_DUE_PER_LOAD),
		remaining > 0
			? base().eq('state', 0).order('created_at').order('id').limit(remaining)
			: Promise.resolve({ data: [], error: null }),
		nextDueText(locals.supabase, user.id, language, now).catch(() => null)
	]);
	if (due.error || fresh.error) error(500, 'Não deu para carregar a revisão agora.');

	const rows = [...due.data, ...fresh.data] as ReviewCardRow[];
	const queue = buildQueue(
		rows.map((r) => ({ ...r, dueAt: r.due_at, createdAt: r.created_at })),
		{ now, newLimit: summary.newLimit, newDoneToday: summary.newDoneToday }
	);
	return {
		queue: await Promise.all(queue.map((r) => toReviewItem(r, now))),
		language,
		uiLanguage: shell.uiLanguage,
		nativeLanguage: shell.nativeLanguage,
		nextDue
	};
};

export const actions: Actions = {
	rate: async ({ locals, request }) => {
		const user = await requireUser(locals);
		const form = await request.formData();
		const cardId = form.get('cardId')?.toString() ?? '';
		const reps = Number(form.get('reps'));
		const rating = Number(form.get('rating'));
		if (!cardId || !Number.isInteger(reps) || !isGrade(rating)) {
			return fail(400, { message: 'Nota inválida.' });
		}

		const row = await loadReviewCard(locals.supabase, user.id, cardId);
		if (!row) {
			const reason = 'card_not_found';
			return fail(404, { message: reviewErrorMessage(reason).text, cardId, reason });
		}
		if (row.reps !== reps) {
			const reason = 'card_stale';
			return fail(409, { message: reviewErrorMessage(reason).text, cardId, reason });
		}

		const now = new Date();
		const review = { rating, reviewed_at: now.toISOString() };
		const logs = await loadLogs(locals.supabase, row.id);
		const { next, intervalDays } = await scheduleReview(row, logs, review);
		const { data: logId, error: dbError } = await locals.supabase.rpc('record_review', {
			p_card_id: row.id,
			p_expected_reps: row.reps,
			p_rating: rating,
			p_reviewed_at: review.reviewed_at,
			p_next: { ...next },
			p_unlock_produce: unlocksProduce({ kind: row.kind, sense: row.items.sense, intervalDays })
		});
		if (dbError || !logId) {
			const { status, text } = reviewErrorMessage(dbError?.message);
			return fail(status, { message: text, cardId, reason: dbError?.message ?? 'unknown' });
		}

		return { logId, rating, item: await toReviewItem({ ...row, ...next }, now) };
	},

	undo: async ({ locals, request }) => {
		const user = await requireUser(locals);
		const logId = (await request.formData()).get('logId')?.toString() ?? '';
		if (!logId) return fail(400, { message: 'Nada para desfazer.' });

		const { data: log } = await locals.supabase
			.from('review_logs')
			.select('card_id')
			.eq('id', logId)
			.eq('user_id', user.id)
			.maybeSingle();
		const row = log ? await loadReviewCard(locals.supabase, user.id, log.card_id) : null;
		if (!row) return fail(404, { message: 'Cartão não encontrado.' });

		// O cronograma sem a revisão desfeita sai do log, como em qualquer outra mudança.
		const rest = (await loadLogs(locals.supabase, row.id)).filter((l) => l.id !== logId);
		const { card, maxIntervalDays } = await replay(row, rest);
		const { error: dbError } = await locals.supabase.rpc('undo_review', {
			p_log_id: logId,
			p_expected_reps: row.reps,
			p_next: { ...card },
			p_drop_produce: !unlocksProduce({
				kind: row.kind,
				sense: row.items.sense,
				intervalDays: maxIntervalDays
			})
		});
		if (dbError) {
			return fail(reviewErrorMessage(dbError.message).status, {
				message: 'Não deu para desfazer agora.'
			});
		}
		return { undone: await toReviewItem({ ...row, ...card }, new Date()) };
	}
};
