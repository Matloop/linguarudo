import { error } from '@sveltejs/kit';
import { apiClient, json, readJson, requireToken, rpcFailure } from '#lib/server/api.ts';
import { isPreferred, parseStremioWords } from '#lib/stremio.ts';
import { parseLangFilter } from '#lib/words.ts';
import type { RequestHandler } from './$types';

/**
 * Palavras do banco numa língua. `prefer` marca as que a legenda deve trocar
 * primeiro (aprendendo, reaprendendo ou revisão vencida).
 */
export const GET: RequestHandler = async (event) => {
	const token = requireToken(event);
	const lang = parseLangFilter(event.url.searchParams.get('lang'));
	if (!lang) error(400, 'Use ?lang=en ou ?lang=it.');

	const { data, error: dbError } = await apiClient().rpc('api_list_words', {
		p_token: token,
		p_lang: lang
	});
	if (dbError) rpcFailure(dbError);

	const now = new Date();
	const words = data.map((w) => ({
		term: w.term,
		translation: w.translation,
		state: w.state,
		dueAt: w.due_at,
		paused: w.paused,
		prefer: isPreferred(w, now)
	}));
	return json({ lang, words });
};

type SaveResult =
	| { term: string; lang: string; status: 'created' | 'duplicate'; state: number; dueAt: string }
	| { term: string | null; status: 'invalid'; error: string };

/**
 * Salva um lote vindo do fork. Uma resposta por item, na mesma ordem:
 * created, duplicate (já estava no banco ou repetida no lote) ou invalid.
 */
export const POST: RequestHandler = async (event) => {
	const token = requireToken(event);
	const parsed = parseStremioWords(await readJson(event.request));
	if (!parsed.ok) error(400, parsed.error);

	const key = (lang: string, term: string) => `${lang}\u0000${term.toLowerCase()}`;
	const firstIndex = new Map<string, number>();
	const rows = [];
	for (const [i, item] of parsed.items.entries()) {
		if (!item.ok) continue;
		const k = key(item.row.lang, item.row.term);
		if (firstIndex.has(k)) continue;
		firstIndex.set(k, i);
		rows.push(item.row);
	}

	const saved = new Map<string, { created: boolean; state: number; due_at: string }>();
	if (rows.length > 0) {
		const { data, error: dbError } = await apiClient().rpc('api_save_words', {
			p_token: token,
			p_words: rows
		});
		if (dbError) rpcFailure(dbError);
		for (const r of data) saved.set(key(r.lang, r.term), r);
	}

	const results: SaveResult[] = parsed.items.map((item, i) => {
		if (!item.ok) return { term: null, status: 'invalid', error: item.error };
		const { term, lang } = item.row;
		const k = key(lang, term);
		const r = saved.get(k);
		if (!r) return { term, status: 'invalid', error: 'não deu para salvar' };
		const created = r.created && firstIndex.get(k) === i;
		return {
			term,
			lang,
			status: created ? 'created' : 'duplicate',
			state: r.state,
			dueAt: r.due_at
		};
	});
	return json({ results });
};
