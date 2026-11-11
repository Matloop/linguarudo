import { apiClient } from '#lib/server/api.ts';
import { readSyncBody, syncRoute, syncRpcFailure, syncToken } from '#lib/server/sync.ts';
import type { RequestHandler } from './$types';

/** O aparelho se despareia: apaga o próprio token. */
export const POST: RequestHandler = (event) =>
	syncRoute(async () => {
		const token = syncToken(event);
		await readSyncBody(event.request);
		const { error } = await apiClient().rpc('api_sync_unpair', { p_token: token });
		if (error) syncRpcFailure(error);
		return new Response(null, { status: 204 });
	});
