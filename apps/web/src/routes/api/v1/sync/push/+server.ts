import { apiClient } from '#lib/server/api.ts';
import {
	processOps,
	readSyncBody,
	SyncError,
	syncJson,
	syncRoute,
	syncRpcFailure,
	syncToken
} from '#lib/server/sync.ts';
import { parsePushBody } from '#lib/sync.ts';
import type { RequestHandler } from './$types';

/** Operações do outbox do aparelho, na ordem, com um resultado por operação. */
export const POST: RequestHandler = (event) =>
	syncRoute(async () => {
		const token = syncToken(event);
		const body = parsePushBody(await readSyncBody(event.request));
		if (!body) {
			throw new SyncError(
				'bad_request',
				'Mande { protocol, deviceNow, ops: [...] } com até 200 operações.'
			);
		}
		const { data: retryAfter, error } = await apiClient().rpc('api_sync_begin', { p_token: token });
		if (error) syncRpcFailure(error);
		if (retryAfter > 0) throw new SyncError('rate_limited', undefined, retryAfter);

		const results = await processOps(token, body.ops);
		return syncJson({ serverNow: new Date().toISOString(), results });
	});
