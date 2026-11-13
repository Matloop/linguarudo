import { error, json } from '@sveltejs/kit';
import { loadReviewSettings } from '#lib/server/settings.ts';
import { parseLemma, parseWordSave } from '#lib/reader/word-input.ts';
import {
	bankStatus,
	loadReaderBook,
	saveWord,
	touchWord,
	undoSave
} from '#lib/reader/words.server.ts';
import type { RequestHandler } from './$types';

const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };

/**
 * Palavra do blend no leitor web.
 * - `tocar`: já no banco? soma um visto e devolve como ela está (`bank`), ou `bank: null`.
 * - `salvar`: cria (ou acha) o item no idioma do livro e grava o encontro desta página.
 * - `desfazer`: apaga o item que acabou de nascer desse salvar.
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const user = await locals.getUser();
	if (!user) error(401, 'Entre para salvar palavras.');

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		error(400, 'Corpo JSON inválido.');
	}
	const book = await loadReaderBook(locals.supabase, params.id);
	if (!book) error(404, 'Livro não encontrado.');
	const now = new Date();

	if (body.action === 'tocar') {
		const lemma = parseLemma(body.lemma);
		if (!lemma) error(400, 'Palavra inválida.');
		const { clock } = await loadReviewSettings(locals.supabase, user.id);
		const bank = await touchWord(locals.supabase, book, lemma, now, clock).catch(() => {
			error(500, 'Não deu para ver o banco agora.');
		});
		return json({ bank }, NO_STORE);
	}

	if (body.action === 'salvar') {
		const input = parseWordSave(body, now);
		if (!input) error(400, 'Palavra inválida.');
		const saved = await saveWord(locals.supabase, book, input).catch(() => {
			error(500, 'Não deu para salvar agora. Tente de novo.');
		});
		const { clock } = await loadReviewSettings(locals.supabase, user.id);
		const bank = await bankStatus(locals.supabase, saved.itemId, now, clock);
		return json({ created: saved.created, bank }, NO_STORE);
	}

	if (body.action === 'desfazer') {
		const clientId = typeof body.clientId === 'string' ? body.clientId : '';
		if (!/^[0-9a-f-]{36}$/i.test(clientId)) error(400, 'Pedido inválido.');
		const undone = await undoSave(locals.supabase, user.id, clientId);
		if (!undone) error(409, 'Essa palavra já tinha outras frases; ela fica no banco.');
		return json({ undone }, NO_STORE);
	}

	error(400, 'Ação desconhecida.');
};
