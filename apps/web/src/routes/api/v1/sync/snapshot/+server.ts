import { apiClient } from '#lib/server/api.ts';
import {
	checkProtocol,
	SyncError,
	syncRoute,
	syncRpcFailure,
	syncToken
} from '#lib/server/sync.ts';
import { parseUiLanguage, parseStudyLanguages, parseLanguage } from '#lib/languages.ts';
import { clockFrom, DEFAULT_RETENTION, nextDayStart } from '#lib/review.ts';
import {
	newDoneToday,
	parseQueueState,
	readerDecks,
	readerRanks,
	stateAllowance
} from '#lib/server/queue.ts';
import {
	decodePageToken,
	encodeCursor,
	encodePageToken,
	endLine,
	fichaLine,
	headerLine,
	itemLine,
	parseLimit,
	type PageToken,
	type SnapshotFichaRow,
	type SnapshotItemRow
} from '#lib/sync.ts';
import type { RequestHandler } from './$types';

type SnapshotPage = {
	rateLimited?: number;
	account?: {
		ui_language: string | null;
		native_language: string | null;
		study_languages: string[] | null;
		new_flashcards_per_day: number;
		new_order: string;
		leech_lapses: number;
		leech_action: string;
		time_zone: string | null;
		day_start_hour: number | null;
		desired_retention: number | null;
	} | null;
	dayStart?: string;
	total?: number;
	fichasTotal?: number;
	/** Estado da fila (queue_state_for): decks, orçamento e candidatas a nova. */
	queue?: unknown;
	rows?: (SnapshotItemRow | SnapshotFichaRow)[];
	more?: boolean;
};

/**
 * Uma página do snapshot em JSONL. Sempre completo (mode "full"): o since é aceito e
 * ignorado, como o contrato permite. Itens em ordem de id, depois fichas em ordem de id; o
 * token de página guarda o tipo, o último id e o cursor da primeira página. Toda página
 * traz o cabeçalho com a fila do dia (ADR 0005).
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

		let kind: PageToken['k'] = 'item';
		let after: string | null = null;
		let cursor = encodeCursor(now);
		const page = q.get('page');
		if (page) {
			const t = decodePageToken(page, { language, limit }, now);
			if (!t) throw new SyncError('page_expired');
			kind = t.k;
			after = t.a;
			cursor = t.c;
		}

		const { data, error } = await apiClient().rpc('api_sync_snapshot', {
			p_token: token,
			p_language: language,
			p_kind: kind,
			p_after: after as string,
			p_limit: limit
		});
		if (error) syncRpcFailure(error);
		const res = (data ?? {}) as SnapshotPage;
		if (res.rateLimited) throw new SyncError('rate_limited', undefined, res.rateLimited);

		const rows = res.rows ?? [];
		// O dia sai do relógio da conta; o banco devolve o início que usou na fila.
		const clock = clockFrom(res.account?.time_zone, res.account?.day_start_hour);
		const start = res.dayStart ? new Date(res.dayStart) : now;
		const queue = parseQueueState(res.queue, language);
		const ranks = readerRanks(queue);
		const rankOf = (r: { flashcard: { id: string } }) => ranks.get(r.flashcard.id) ?? null;

		// Acabaram os itens: a próxima página começa as fichas (se houver).
		let next: PageToken | null = null;
		if (res.more && rows.length > 0) {
			next = { l: language, k: kind, a: rows[rows.length - 1].id, c: cursor, n: limit };
		} else if (kind === 'item' && (res.fichasTotal ?? 0) > 0) {
			next = { l: language, k: 'ficha', a: null, c: cursor, n: limit };
		}

		const lines = [
			headerLine({
				language,
				cursor,
				serverNow: now,
				total: res.total ?? 0,
				fichasTotal: res.fichasTotal ?? 0,
				// Sem padrões inventados (ADR 0004): o que a conta não tem vai como null/[].
				uiLanguage: parseUiLanguage(res.account?.ui_language),
				nativeLanguage: parseLanguage(res.account?.native_language),
				studyLanguages: parseStudyLanguages(res.account?.study_languages ?? []) ?? [],
				newFlashcardsPerDay: queue.settings.perDay,
				timeZone: clock.timeZone,
				dayStartHour: clock.startHour,
				desiredRetention: res.account?.desired_retention ?? DEFAULT_RETENTION,
				dayStart: start,
				nextDayStart: nextDayStart(start, clock),
				newDoneToday: newDoneToday(queue),
				newOrder: queue.settings.newOrder,
				leech: { lapses: queue.settings.leechLapses, action: queue.settings.leechAction },
				extraNew: queue.extraNew,
				newAllowance: stateAllowance(queue),
				decks: readerDecks(queue)
			}),
			...(kind === 'item'
				? (rows as SnapshotItemRow[]).map((r) => itemLine(r, rankOf(r)))
				: (rows as SnapshotFichaRow[]).map((r) => fichaLine(r, rankOf(r)))),
			endLine(rows.length, next ? encodePageToken(next) : null)
		];
		return new Response(lines.join('\n') + '\n', {
			headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' }
		});
	});
