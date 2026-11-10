import { apiClient, json, requireToken, rpcFailure } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

/** Dono do token, para o menu do fork mostrar "Conectado como ...". */
export const GET: RequestHandler = async (event) => {
	const { data, error } = await apiClient().rpc('api_me', { p_token: requireToken(event) });
	if (error) rpcFailure(error);
	return json({ email: data[0]?.email ?? null });
};
