import { apiClient } from '#lib/server/api.ts';
import {
	checkProtocol,
	SyncError,
	syncRoute,
	syncRpcFailure,
	syncToken
} from '#lib/server/sync.ts';
import { parseUiLanguage, parseStudyLanguages, parseLanguage } from '#lib/languages.ts';
import { dayStart, DEFAULT_NEW_PER_DAY, nextDayStart, REVIEW_TIME_ZONE } from '#lib/review.ts';
import {
	decodePageToken,
	encodeCursor,
	encodePageToken,
	endLine,
	headerLine,
	itemLine,
	parseLimit,
	type SnapshotItemRow
} from '#lib/sync.ts';
import type { RequestHandler } from './$types';

type SnapshotPage = {
	rateLimited?: number;
	account?: {
		ui_language: string | null;
		native_language: string | null;
		study_languages: string[] | null;
		new_cards_per_day: number;
	} | null;
	total?: number;
	newDoneToday?: number;
	items?: SnapshotItemRow[];
	more?: boolean;
};

/**
 * Uma página do snapshot em JSONL. Sempre completo (mode "full"): o since é aceito e
 * ignorado, como o contrato permite. Itens em ordem de id; o token de página guarda o
 * último id e o cursor da primeira página.
 */
export const GET: RequestHandler = (event) =>
	syncRoute(async () => {
		const q = event.url.searchParams;
		checkProtocol(q.get('protocol'));
		const token = syncToken(event);
		const language = parseLanguage(q.get('language'));
		if (!language)
			throw new SyncError('bad_request', 'Mande language com uma tag BCP 47 (it, pt-BR, ...).');
		const limit = parseLimit(q.get('limit'));
		const now = new Date();

		let after: string | null = null;
		let cursor = encodeCursor(now);
		const page = q.get('page');
		if (page) {
			const t = decodePageToken(page, { language, limit }, now);
			if (!t) throw new SyncError('page_expired');
			after = t.a;
			cursor = t.c;
		}

		const { data, error } = await apiClient().rpc('api_sync_snapshot', {
			p_token: token,
			p_language: language,
			p_after: after as string,
			p_limit: limit,
			p_day_start: dayStart(now).toISOString()
		});
		if (error) syncRpcFailure(error);
		const res = (data ?? {}) as SnapshotPage;
		if (res.rateLimited) throw new SyncError('rate_limited', undefined, res.rateLimited);

		const items = res.items ?? [];
		const lines = [
			headerLine({
				language,
				cursor,
				serverNow: now,
				total: res.total ?? items.length,
				// Sem padrões inventados (ADR 0004): o que a conta não tem vai como null/[].
				uiLanguage: parseUiLanguage(res.account?.ui_language),
				nativeLanguage: parseLanguage(res.account?.native_language),
				studyLanguages: parseStudyLanguages(res.account?.study_languages ?? []) ?? [],
				newCardsPerDay: res.account?.new_cards_per_day ?? DEFAULT_NEW_PER_DAY,
				timeZone: REVIEW_TIME_ZONE,
				dayStart: dayStart(now),
				nextDayStart: nextDayStart(now),
				newDoneToday: res.newDoneToday ?? 0
			}),
			...items.map(itemLine),
			endLine(
				items.length,
				res.more && items.length > 0
					? encodePageToken({ l: language, a: items[items.length - 1].id, c: cursor, n: limit })
					: null
			)
		];
		return new Response(lines.join('\n') + '\n', {
			headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' }
		});
	});
