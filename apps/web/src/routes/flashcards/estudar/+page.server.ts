import { error, fail, redirect } from '@sveltejs/kit';
import { DECK_LIMITS, deckErrorMessage } from '#lib/decks.ts';
import { fichaHtmlToText } from '#lib/fichas.ts';
import { parseLanguage } from '#lib/languages.ts';
import { signMedia } from '#lib/server/media.ts';
import { fichaMediaUrls } from '#lib/server/fichas.ts';
import { isGrade, leechAlert } from '#lib/review.ts';
import { addExtraNew, itemsOfWork, loadQueueState } from '#lib/server/decks.ts';
import {
	attachMediaUrls,
	loadLogs,
	loadReviewFlashcard,
	reviewErrorMessage,
	rowSense,
	toReviewItem
} from '#lib/server/reviews.ts';
import { replay, scheduleReview, unlocksProduce } from '#lib/server/scheduler.ts';
import {
	loadSessionQueue,
	obraSessionSize,
	parseScope,
	planSession,
	tomorrowReviews
} from '#lib/server/session.ts';
import { loadReviewSettings } from '#lib/server/settings.ts';
import { loadTags, nextDueText } from '#lib/server/summary.ts';
import type { Actions, PageServerLoad } from './$types';

const FICHA_MEDIA = 'front_image, front_audio, back_image, back_audio' as const;

async function requireUser(locals: App.Locals) {
	const user = await locals.getUser();
	if (!user) error(401, 'Entre para revisar.');
	return user;
}

/** Obra ativa com novas esperando: o "Estudar 7 de <obra>" do fim de cota. */
async function activeWork(
	locals: App.Locals,
	workId: string | null,
	size: (ids: Set<string>) => number
) {
	if (!workId) return null;
	const [work, itemIds] = await Promise.all([
		locals.supabase.from('works').select('id, title, kind').eq('id', workId).maybeSingle(),
		itemsOfWork(locals.supabase, workId)
	]);
	if (!work.data) return null;
	const n = size(itemIds);
	return n > 0 ? { id: work.data.id, title: work.data.title, kind: work.data.kind, n } : null;
}

/**
 * A fila do dia é do servidor (ADR 0005): vencidas dos decks do escopo, mais as novas que
 * planNew escolhe (orçamento do idioma, ordem, teto de cada deck). Escopo: tudo (decks não
 * pausados), ?deck= (o deck e os subdecks; repetível) ou ?obra= (novas daquela obra, extra).
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
	const parsed = await parseScope(locals.supabase, url.searchParams, state);
	if (!parsed.ok) {
		error(
			parsed.status,
			parsed.status === 404
				? 'Deck ou obra não encontrado.'
				: 'Não deu para carregar a revisão agora.'
		);
	}
	const { scope } = parsed;
	const plan = planSession(state, scope);

	// Com ?tag=, só os flashcards (de item ou de ficha) que têm a tag.
	const tag = url.searchParams.get('tag')?.trim() || null;
	const [queue, tags, nextDue, tomorrow, work] = await Promise.all([
		loadSessionQueue(locals.supabase, plan, {
			userId: user.id,
			language,
			tag,
			now,
			clock,
			retention,
			// "Desta obra" é só de novas.
			withDue: scope.kind !== 'obra'
		}),
		loadTags(locals.supabase, user.id, language).catch(() => []),
		nextDueText(locals.supabase, user.id, language, now, clock).catch(() => null),
		tomorrowReviews(locals.supabase, user.id, language, now, clock).catch(() => null),
		scope.kind === 'obra'
			? null
			: activeWork(locals, state.activeWorkId, (ids) => obraSessionSize(state, ids)).catch(
					() => null
				)
	]);
	if (!queue) error(500, 'Não deu para carregar a revisão agora.');

	const deckNames =
		scope.kind === 'decks'
			? scope.deckIds.map((id) => state.decks.find((d) => d.id === id)?.name ?? '')
			: [];
	return {
		queue,
		autoplayAudio: shell.autoplayAudio,
		language,
		uiLanguage: shell.uiLanguage,
		nativeLanguage: shell.nativeLanguage,
		nextDue,
		tag,
		tags,
		/** Escopo da sessão: o player manda `obra` de volta no rate para contar como extra. */
		scope: {
			decks: scope.kind === 'decks' ? scope.deckIds : [],
			deckNames,
			obra: scope.kind === 'obra' ? scope.workId : null
		},
		/** Orçamento do idioma; `more` = novas que ficaram de fora (oferecer "+5 só hoje"). */
		budget: {
			newAllowance: plan.newAllowance,
			newDoneToday: plan.newDoneToday,
			perDay: state.settings.perDay,
			extraNew: state.extraNew,
			more: plan.more
		},
		/** Fim de cota: revisões de amanhã e a obra recente com novas. */
		tomorrow,
		work
	};
};

export const actions: Actions = {
	/** Dados para o modal de edição dentro da revisão (palavra ou ficha do flashcard atual). */
	editLoad: async ({ locals, request }) => {
		const user = await requireUser(locals);
		const form = await request.formData();
		const row = await loadReviewFlashcard(
			locals.supabase,
			user.id,
			form.get('flashcardId')?.toString() ?? ''
		);
		if (!row) return fail(404, { message: 'Flashcard não encontrado.' });
		if ('fichas' in row) {
			const { data: f } = await locals.supabase
				.from('fichas')
				.select(`id, language, front, back, reverse, cloze_count, tags, ${FICHA_MEDIA}`)
				.eq('id', row.fichas.id)
				.eq('user_id', user.id)
				.is('deleted_at', null)
				.maybeSingle();
			if (!f) return fail(404, { message: 'Ficha não encontrada.' });
			const media = {
				front_image: f.front_image,
				front_audio: f.front_audio,
				back_image: f.back_image,
				back_audio: f.back_audio
			};
			return {
				kind: 'ficha' as const,
				id: f.id,
				cloze: f.cloze_count > 0,
				values: {
					language: f.language,
					front: fichaHtmlToText(f.front),
					back: fichaHtmlToText(f.back),
					reverse: f.reverse,
					tags: f.tags.join(', '),
					media
				},
				mediaUrls: await fichaMediaUrls(locals.supabase, media)
			};
		}
		const { data: it } = await locals.supabase
			.from('items')
			.select('id, lemma, reading, sense, note, tags, image, audio')
			.eq('id', row.item_id)
			.eq('user_id', user.id)
			.is('deleted_at', null)
			.maybeSingle();
		if (!it) return fail(404, { message: 'Palavra não encontrada.' });
		const urls = await signMedia(locals.supabase, [it.image, it.audio]).catch(
			() => new Map<string, string>()
		);
		return {
			kind: 'item' as const,
			id: it.id,
			item: it,
			mediaUrls: {
				image: it.image ? (urls.get(it.image) ?? null) : null,
				audio: it.audio ? (urls.get(it.audio) ?? null) : null
			}
		};
	},

	/** O flashcard como a revisão o mostra, depois de uma edição. */
	refresh: async ({ locals, request }) => {
		const user = await requireUser(locals);
		const form = await request.formData();
		const row = await loadReviewFlashcard(
			locals.supabase,
			user.id,
			form.get('flashcardId')?.toString() ?? ''
		);
		if (!row) return fail(404, { message: 'Flashcard não encontrado.' });
		const { retention } = await loadReviewSettings(locals.supabase, user.id);
		const [item] = await attachMediaUrls(locals.supabase, [
			await toReviewItem(row, new Date(), retention)
		]);
		return { item };
	},

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

	/**
	 * "+5 só hoje": soma 5 ao extra do dia e devolve as novas que o mesmo escopo ganhou. O
	 * player acrescenta as que ainda não tem, sem recarregar.
	 */
	extra: async ({ locals, request }) => {
		const user = await requireUser(locals);
		const { clock, retention } = await loadReviewSettings(locals.supabase, user.id);
		const form = await request.formData();
		const language = parseLanguage(form.get('language'));
		if (!language) return fail(400, { message: 'Idioma inválido.' });
		const tag = form.get('tag')?.toString().trim() || null;
		const now = new Date();
		const added = await addExtraNew(locals.supabase, language, now, clock, DECK_LIMITS.extraStep);
		if (!added.ok) return fail(400, { message: added.message });

		const state = await loadQueueState(locals.supabase, language, now, clock).catch(() => null);
		if (!state) return fail(500, { message: deckErrorMessage(undefined) });
		// O escopo vem no formulário (a URL da ação perde a query da página).
		const params = new URLSearchParams();
		for (const deck of form.getAll('deck')) params.append('deck', deck.toString());
		const parsed = await parseScope(locals.supabase, params, state);
		if (!parsed.ok || parsed.scope.kind === 'obra')
			return fail(400, { message: 'Escopo inválido.' });
		const plan = planSession(state, parsed.scope);
		const queue = await loadSessionQueue(locals.supabase, plan, {
			userId: user.id,
			language,
			tag,
			now,
			clock,
			retention,
			withDue: false
		});
		if (!queue) return fail(500, { message: 'Não deu para carregar as novas agora.' });
		return {
			added: queue,
			budget: {
				newAllowance: plan.newAllowance,
				newDoneToday: plan.newDoneToday,
				perDay: state.settings.perDay,
				extraNew: state.extraNew,
				more: plan.more
			}
		};
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
