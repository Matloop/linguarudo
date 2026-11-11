import { apiClient, json, requireToken, rpcFailure } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

/** Dono do token e seus idiomas, para o menu do fork ("Conectado como ..."). */
export const GET: RequestHandler = async (event) => {
	const { data, error } = await apiClient().rpc('api_me', { p_token: requireToken(event) });
	if (error) rpcFailure(error);
	const me = data[0];
	return json({
		email: me?.email ?? null,
		uiLanguage: me?.ui_language ?? null,
		nativeLanguage: me?.native_language ?? null,
		studyLanguages: me?.study_languages ?? []
	});
};
