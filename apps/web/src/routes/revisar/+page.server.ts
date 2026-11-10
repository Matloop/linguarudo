import { error, fail } from '@sveltejs/kit';
import { buildQueue, dayStart, isGrade, newRemaining } from '#lib/review.ts';
import {
	CARD_WITH_WORD,
	fetchReviewSummary,
	reviewErrorMessage,
	toReviewItem
} from '#lib/server/reviews.ts';
import { applyRating } from '#lib/server/scheduler.ts';
import type { Json } from '#lib/database.types.ts';
import type { Actions, PageServerLoad } from './$types';

/** Teto de segurança por carga; revisões vencidas não têm limite (a próxima carga traz o resto). */
const MAX_DUE_PER_LOAD = 500;

async function requireUser(locals: App.Locals) {
	const user = await locals.getUser();
	if (!user) error(401, 'Entre para revisar.');
	return user;
}

export const load: PageServerLoad = async ({ locals }) => {
	const user = await requireUser(locals);
	const now = new Date();
	const summary = await fetchReviewSummary(locals.supabase, now).catch(() => null);
	if (!summary) error(500, 'Não deu para carregar a revisão agora.');

	const base = () =>
		locals.supabase.from('cards').select(CARD_WITH_WORD).eq('user_id', user.id).eq('paused', false);

	const remaining = newRemaining(summary.newLimit, summary.newDoneToday);
	const [due, fresh] = await Promise.all([
		base().gt('state', 0).lte('due_at', now.toISOString()).order('due_at').limit(MAX_DUE_PER_LOAD),
		remaining > 0
			? base().eq('state', 0).order('created_at').order('id').limit(remaining)
			: Promise.resolve({ data: [], error: null })
	]);
	if (due.error || fresh.error) error(500, 'Não deu para carregar a revisão agora.');

	const rows = [...due.data, ...fresh.data];
	const queue = buildQueue(
		rows.map((r) => ({ ...r, dueAt: r.due_at, createdAt: r.created_at })),
		{ now, newLimit: summary.newLimit, newDoneToday: summary.newDoneToday }
	);
	return { queue: await Promise.all(queue.map((r) => toReviewItem(r, now))) };
};

async function loadCard(locals: App.Locals, userId: string, cardId: string) {
	const { data } = await locals.supabase
		.from('cards')
		.select(CARD_WITH_WORD)
		.eq('id', cardId)
		.eq('user_id', userId)
		.maybeSingle();
	return data;
}

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

		const row = await loadCard(locals, user.id, cardId);
		if (!row) {
			const reason = 'card_not_found';
			return fail(404, { message: reviewErrorMessage(reason).text, cardId, reason });
		}
		if (row.reps !== reps) {
			const reason = 'card_stale';
			return fail(409, { message: reviewErrorMessage(reason).text, cardId, reason });
		}

		const now = new Date();
		const { next, revlog } = await applyRating(row, rating, now);
		const { data: logId, error: dbError } = await locals.supabase.rpc('review_card', {
			p_card_id: row.id,
			p_expected_reps: row.reps,
			p_rating: rating,
			p_day_start: dayStart(now).toISOString(),
			p_next: { ...next },
			p_revlog: revlog as Json
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

		const { data: cardId, error: dbError } = await locals.supabase.rpc('undo_review', {
			p_log_id: logId
		});
		if (dbError || !cardId) {
			return fail(reviewErrorMessage(dbError?.message).status, {
				message: 'Não deu para desfazer agora.'
			});
		}

		const row = await loadCard(locals, user.id, cardId);
		if (!row) return fail(404, { message: 'Cartão não encontrado.' });
		return { undone: await toReviewItem(row, new Date()) };
	}
};
