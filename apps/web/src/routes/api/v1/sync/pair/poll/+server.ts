import { apiClient } from '#lib/server/api.ts';
import { generateToken } from '#lib/server/tokens.ts';
import { readSyncBody, sha256, SyncError, syncJson, syncRoute } from '#lib/server/sync.ts';
import type { RequestHandler } from './$types';

/**
 * Poll do aparelho. Sempre 200 com status; no approved o token sai uma vez só (o banco
 * guarda o hash e marca o pareamento como usado).
 */
export const POST: RequestHandler = (event) =>
	syncRoute(async () => {
		const body = await readSyncBody(event.request);
		const deviceCode = body.deviceCode;
		if (typeof deviceCode !== 'string' || !/^[A-Za-z0-9_-]{20,100}$/.test(deviceCode)) {
			throw new SyncError('bad_request', 'Mande o deviceCode recebido em pair/start.');
		}
		const token = generateToken();
		const { data, error } = await apiClient().rpc('sync_pair_poll', {
			p_device_code_hash: sha256(deviceCode),
			p_token_hash: token.hash,
			p_token_hint: token.hint
		});
		if (error) throw new SyncError('server_error');
		const row = data[0];
		switch (row?.status) {
			case 'pending':
			case 'slow_down':
				return syncJson({ status: row.status, interval: row.poll_interval });
			case 'denied':
				return syncJson({ status: 'denied' });
			case 'approved':
				return syncJson({
					status: 'approved',
					token: token.token,
					tokenHint: token.hint,
					deviceName: row.device_name,
					account: row.account
				});
			default:
				return syncJson({ status: 'expired' });
		}
	});
