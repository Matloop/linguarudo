import { randomBytes, randomInt } from 'node:crypto';
import { SYNC_PAIR_LIMITS } from '$app/env/private';
import { apiClient } from '#lib/server/api.ts';
import {
	clientIpHash,
	readSyncBody,
	sha256,
	SyncError,
	syncJson,
	syncRoute
} from '#lib/server/sync.ts';
import { formatUserCode, parseDeviceText, SYNC_LIMITS, userCodeFrom } from '#lib/sync.ts';
import type { RequestHandler } from './$types';

/** Começa o pareamento: o aparelho recebe o deviceCode (segredo) e o código da tela. */
export const POST: RequestHandler = (event) =>
	syncRoute(async () => {
		const body = await readSyncBody(event.request);
		const deviceName = parseDeviceText(body.deviceName, SYNC_LIMITS.deviceName);
		if (!deviceName) throw new SyncError('bad_request', 'Mande deviceName (1 a 60 caracteres).');
		const deviceModel = parseDeviceText(body.deviceModel, SYNC_LIMITS.deviceModel);
		const firmware = parseDeviceText(body.firmware, SYNC_LIMITS.firmware);

		const deviceCode = randomBytes(32).toString('base64url');
		const ipHash = clientIpHash(event);
		for (let attempt = 0; attempt < 5; attempt++) {
			const userCode = userCodeFrom((max) => randomInt(max));
			const { data, error } = await apiClient().rpc('sync_pair_start', {
				p_device_code_hash: sha256(deviceCode),
				p_user_code: userCode,
				p_device_name: deviceName,
				p_device_model: deviceModel,
				p_firmware: firmware,
				p_ip_hash: ipHash as string,
				p_enforce_limits: SYNC_PAIR_LIMITS !== 'off'
			});
			if (error) throw new SyncError('server_error');
			const row = data[0];
			if (row?.status === 'rate_limited')
				throw new SyncError('rate_limited', undefined, row.retry_after);
			if (row?.status !== 'ok') continue;

			const verificationUri = `${event.url.origin}/parear`;
			return syncJson({
				deviceCode,
				userCode: formatUserCode(userCode),
				verificationUri,
				verificationUriComplete: `${verificationUri}?code=${userCode}`,
				expiresIn: SYNC_LIMITS.pairExpiresIn,
				interval: SYNC_LIMITS.pairInterval
			});
		}
		throw new SyncError('server_error');
	});
