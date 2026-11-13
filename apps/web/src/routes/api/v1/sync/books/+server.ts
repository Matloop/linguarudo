import { bookListEntries, type BookListRow } from '#lib/blend/books-list.ts';
import { apiClient } from '#lib/server/api.ts';
import {
	checkProtocol,
	SyncError,
	syncJson,
	syncRoute,
	syncRpcFailure,
	syncToken
} from '#lib/server/sync.ts';
import type { RequestHandler } from './$types';

/** Validade da URL de download (contrato, seção 13). */
const DOWNLOAD_SECONDS = 15 * 60;

/**
 * Lista completa dos livros "No aparelho" com versão pronta (CONTRACT §13). Conta no
 * limite de 60 pedidos por minuto. As rotas /api/v1 não têm service key: api_sync_books
 * libera por 2 minutos a leitura dos caminhos devolvidos (book_signing) e a assinatura
 * sai como anon nessa janela.
 */
export const GET: RequestHandler = (event) =>
	syncRoute(async () => {
		checkProtocol(event.url.searchParams.get('protocol'));
		const token = syncToken(event);
		const { data, error } = await apiClient().rpc('api_sync_books', { p_token: token });
		if (error) syncRpcFailure(error);
		const res = (data ?? {}) as { rateLimited?: number; books?: BookListRow[] };
		if (res.rateLimited) throw new SyncError('rate_limited', undefined, res.rateLimited);
		const rows = res.books ?? [];

		const urls = new Map<string, string>();
		if (rows.length > 0) {
			const { data: signed, error: signError } = await apiClient()
				.storage.from('books')
				.createSignedUrls(
					rows.map((r) => r.path),
					DOWNLOAD_SECONDS
				);
			if (signError) throw new SyncError('server_error');
			for (const s of signed ?? []) {
				if (s.path && s.signedUrl && !s.error) urls.set(s.path, s.signedUrl);
			}
		}
		return syncJson(
			{ serverNow: new Date().toISOString(), books: bookListEntries(rows, urls) },
			{ headers: { 'Cache-Control': 'no-store' } }
		);
	});
