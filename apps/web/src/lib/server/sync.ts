// Sync com o e-reader: a parte que fala com o banco e com o HTTP (docs/sync/CONTRACT.md).
// Erros saem como { message, code } (o formato do contrato), não pelo error() do SvelteKit.

import { createHash } from 'node:crypto';
import type { RequestEvent } from '@sveltejs/kit';
import type { Json } from '#lib/database.types.ts';
import { parseBearer } from '#lib/integrations.ts';
import type { Grade } from '#lib/review.ts';
import {
	scheduleReview,
	unlocksProduce,
	type FlashcardRow,
	type FlashcardSeed
} from '#lib/server/scheduler.ts';
import {
	flashcardState,
	parseOp,
	SYNC_LIMITS,
	SYNC_PROTOCOL,
	toOpResult,
	type FlashcardRowJson,
	type OpResult,
	type DeckImportOp,
	type ExtraNewOp,
	type ProgressOp,
	type ReviewOp,
	type SyncOp
} from '#lib/sync.ts';
import { apiClient } from './api.ts';

const MESSAGES = {
	bad_request: 'Requisição inválida.',
	invalid_token: 'Token inválido ou revogado.',
	page_expired: 'A página do snapshot expirou. Comece de novo.',
	payload_too_large: 'Corpo maior que 512 KB.',
	protocol_unsupported: 'Versão de protocolo não suportada.',
	rate_limited: 'Muitas tentativas. Espere um pouco.',
	server_error: 'Não deu para falar com o banco agora.'
} as const;

const STATUS = {
	bad_request: 400,
	invalid_token: 401,
	page_expired: 410,
	payload_too_large: 413,
	protocol_unsupported: 426,
	rate_limited: 429,
	server_error: 500
} as const;

export type SyncErrorCode = keyof typeof MESSAGES;

export class SyncError extends Error {
	constructor(
		readonly code: SyncErrorCode,
		message?: string,
		readonly retryAfter?: number
	) {
		super(message ?? MESSAGES[code]);
	}

	response(): Response {
		const body: Record<string, unknown> = { message: this.message, code: this.code };
		const headers = new Headers();
		if (this.code === 'protocol_unsupported') body.supported = [SYNC_PROTOCOL];
		if (this.code === 'rate_limited') {
			const seconds = Math.max(1, Math.ceil(this.retryAfter ?? 60));
			body.retryAfter = seconds;
			headers.set('Retry-After', String(seconds));
		}
		return Response.json(body, { status: STATUS[this.code], headers });
	}
}

/** Roda a rota e transforma qualquer falha no corpo de erro do contrato. */
export async function syncRoute(run: () => Promise<Response>): Promise<Response> {
	try {
		return await run();
	} catch (err) {
		if (err instanceof SyncError) return err.response();
		console.error('sync:', err);
		return new SyncError('server_error').response();
	}
}

export function syncJson(body: Record<string, unknown>, init?: ResponseInit): Response {
	return Response.json({ protocol: SYNC_PROTOCOL, ...body }, init);
}

export function syncToken(event: RequestEvent): string {
	const token = parseBearer(event.request.headers.get('authorization'));
	if (!token) throw new SyncError('invalid_token');
	return token;
}

/** Corpo JSON do POST, com o teto de 512 KB e a versão do protocolo conferidos. */
export async function readSyncBody(request: Request): Promise<Record<string, unknown>> {
	const declared = Number(request.headers.get('content-length'));
	if (declared > SYNC_LIMITS.bodyBytes) throw new SyncError('payload_too_large');
	const bytes = new Uint8Array(await request.arrayBuffer());
	if (bytes.byteLength > SYNC_LIMITS.bodyBytes) throw new SyncError('payload_too_large');
	let body: unknown;
	try {
		body = JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		throw new SyncError('bad_request', 'Corpo JSON inválido.');
	}
	if (typeof body !== 'object' || body === null || Array.isArray(body)) {
		throw new SyncError('bad_request', 'Corpo JSON inválido.');
	}
	checkProtocol((body as Record<string, unknown>).protocol);
	return body as Record<string, unknown>;
}

export function checkProtocol(v: unknown): void {
	const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
	if (n !== SYNC_PROTOCOL) throw new SyncError('protocol_unsupported');
}

/** Erro de uma função api_sync_*: token inválido vira 401, o resto 500. */
export function syncRpcFailure(err: { message?: string } | null): never {
	if (err?.message === 'invalid_token') throw new SyncError('invalid_token');
	throw new SyncError('server_error');
}

export function sha256(s: string): string {
	return createHash('sha256').update(s, 'utf8').digest('hex');
}

/** IP de quem chama, só como hash (limites por IP do pareamento). */
export function clientIpHash(event: RequestEvent): string | null {
	try {
		return sha256(`linguetta-pair:${event.getClientAddress()}`);
	} catch {
		return null;
	}
}

// ---------- Push ----------

type Stored = { prior?: boolean; result?: unknown };

function asStored(data: Json | null): Stored {
	return (data ?? {}) as Stored;
}

async function applySave(token: string, op: Extract<SyncOp, { type: 'save' }>): Promise<OpResult> {
	const { data, error } = await apiClient().rpc('api_sync_save', {
		p_token: token,
		p_client_id: op.clientId,
		p_at: op.at,
		p_entry: op.entry as unknown as Json
	});
	if (error) syncRpcFailure(error);
	return toOpResult(op.clientId, asStored(data));
}

async function applySeen(token: string, op: Extract<SyncOp, { type: 'seen' }>): Promise<OpResult> {
	const { data, error } = await apiClient().rpc('api_sync_seen', {
		p_token: token,
		p_client_id: op.clientId,
		p_language: op.language,
		p_lemma_key: op.lemmaKey,
		p_at: op.at
	});
	if (error) syncRpcFailure(error);
	return toOpResult(op.clientId, asStored(data));
}

type ReviewTarget = {
	flashcard: FlashcardRowJson & { item_id: string | null; kind: string };
	sense: string | null;
	/** Retenção desejada da conta (user_settings). */
	desired_retention?: number | null;
	logs: { rating: Grade; reviewed_at: string }[];
};

/**
 * Revisão: lê o flashcard e o log, calcula como o app (scheduleReview, com replay da revisão
 * atrasada) e grava com a checagem de reps. Se outra revisão entrar no meio, refaz.
 */
async function applyReview(token: string, op: ReviewOp, now: Date): Promise<OpResult> {
	const reviewedAt = new Date(Math.min(Date.parse(op.at), now.getTime())).toISOString();
	for (let attempt = 0; attempt < 3; attempt++) {
		const target = await apiClient().rpc('api_sync_review_target', {
			p_token: token,
			p_client_id: op.clientId,
			p_flashcard_id: op.flashcardId as string,
			p_save_client_id: op.saveClientId as string
		});
		if (target.error) syncRpcFailure(target.error);
		const data = (target.data ?? {}) as Stored & Partial<ReviewTarget>;
		if (!data.flashcard) return toOpResult(op.clientId, data);

		const flashcard = data.flashcard;
		const row: FlashcardRow & FlashcardSeed = {
			...flashcard,
			id: flashcard.id,
			created_at: flashcard.created_at
		};
		const { next, intervalDays } = await scheduleReview(
			row,
			data.logs ?? [],
			{ rating: op.rating, reviewed_at: reviewedAt },
			data.desired_retention ?? undefined
		);
		// Ficha nunca libera Produzir; a função do banco também confere o tipo.
		const unlock =
			flashcard.kind === 'reconhecer' &&
			unlocksProduce({ kind: 'reconhecer', sense: data.sense ?? '', intervalDays });
		const result = {
			status: 'applied',
			flashcardId: flashcard.id,
			flashcard: flashcardState({ ...flashcard, ...next })
		};
		const { data: saved, error } = await apiClient().rpc('api_sync_review', {
			p_token: token,
			p_client_id: op.clientId,
			p_flashcard_id: flashcard.id,
			p_expected_reps: flashcard.reps,
			p_rating: op.rating,
			p_reviewed_at: reviewedAt,
			p_duration_ms: op.durationMs as number,
			p_next: next as unknown as Json,
			p_unlock_produce: unlock,
			p_result: result as unknown as Json
		});
		if (error?.message === 'flashcard_stale') continue;
		if (error) syncRpcFailure(error);
		return toOpResult(op.clientId, asStored(saved));
	}
	throw new SyncError('server_error');
}

async function applyExtraNew(token: string, op: ExtraNewOp): Promise<OpResult> {
	const { data, error } = await apiClient().rpc('api_sync_extra_new', {
		p_token: token,
		p_client_id: op.clientId,
		p_language: op.language,
		p_n: op.n,
		p_at: op.at
	});
	if (error) syncRpcFailure(error);
	return toOpResult(op.clientId, asStored(data));
}

async function applyDeckImport(token: string, op: DeckImportOp): Promise<OpResult> {
	const { data, error } = await apiClient().rpc('api_sync_deck_import', {
		p_token: token,
		p_client_id: op.clientId,
		p_language: op.language,
		p_name: op.name,
		p_hash: op.hash,
		p_rows: op.rows as unknown as Json
	});
	if (error) syncRpcFailure(error);
	return toOpResult(op.clientId, asStored(data));
}

/** Posição de leitura: o banco acha o livro pelo koHash e fica com a de maior `at`. */
async function applyProgress(token: string, op: ProgressOp): Promise<OpResult> {
	const { data, error } = await apiClient().rpc('api_sync_progress', {
		p_token: token,
		p_client_id: op.clientId,
		p_at: op.at,
		p_ko_hash: op.koHash,
		p_spine: op.spine,
		p_chapter_percent: op.chapterPercent,
		p_percent: op.percent
	});
	if (error) syncRpcFailure(error);
	return toOpResult(op.clientId, asStored(data));
}

async function storeRejection(
	token: string,
	result: OpResult,
	type: SyncOp['type']
): Promise<OpResult> {
	const { clientId, ...rest } = result;
	const { data, error } = await apiClient().rpc('api_sync_reject', {
		p_token: token,
		p_client_id: clientId,
		p_type: type,
		p_result: rest as unknown as Json
	});
	if (error) syncRpcFailure(error);
	return toOpResult(clientId, asStored(data));
}

/** Processa as operações na ordem do array, uma por uma (cada uma atômica sozinha). */
export async function processOps(token: string, ops: readonly unknown[], now = () => new Date()) {
	const results: OpResult[] = [];
	for (const raw of ops) {
		const parsed = parseOp(raw);
		if (!parsed.ok) {
			results.push(
				parsed.store ? await storeRejection(token, parsed.result, parsed.store) : parsed.result
			);
			continue;
		}
		const op = parsed.op;
		if (op.type === 'save') results.push(await applySave(token, op));
		else if (op.type === 'seen') results.push(await applySeen(token, op));
		else if (op.type === 'extraNew') results.push(await applyExtraNew(token, op));
		else if (op.type === 'deckImport') results.push(await applyDeckImport(token, op));
		else if (op.type === 'progress') results.push(await applyProgress(token, op));
		else results.push(await applyReview(token, op, now()));
	}
	return results;
}
