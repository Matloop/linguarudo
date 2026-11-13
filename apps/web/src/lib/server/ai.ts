// IA grátis para preencher campos: Groq primeiro, Gemini se o Groq falhar. Os dois têm
// endpoint compatível com o Chat Completions da OpenAI, então basta um fetch e um JSON
// Schema (Structured Outputs). Sem SDK.

/** Groq: produção, Structured Outputs strict (https://console.groq.com/docs/structured-outputs). */
export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';
/** Gemini: Flash estável com camada gratuita (https://aistudio.google.com/docs/models). */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';

/** Depois de um 429 o provider fica de fora por este tempo. */
export const COOLDOWN_MS = 60_000;
/** Por provider: o diálogo espera, então falha logo e passa para o próximo. */
const TIMEOUT_MS = 15_000;

export type AiErrorKind = 'unavailable' | 'rate_limit' | 'upstream';

/**
 * unavailable: nenhuma chave configurada; rate_limit: todos os providers com chave
 * bateram no limite (429); upstream: qualquer outra falha.
 */
export class AiError extends Error {
	readonly kind: AiErrorKind;
	constructor(kind: AiErrorKind, message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = 'AiError';
		this.kind = kind;
	}
}

export interface Provider {
	/** 'groq', 'gemini': aparece no log. */
	name: string;
	baseURL: string;
	/** Vazio: o provider é pulado. */
	apiKey: string;
	model: string;
	/** Campo do teto de tokens: o Groq marcou max_tokens como obsoleto. */
	maxTokensParam: 'max_completion_tokens' | 'max_tokens';
	/** Campos extras do corpo (temperature, reasoning_effort...). */
	extra: Record<string, unknown>;
}

/**
 * gpt-oss é modelo de raciocínio: reasoning_effort 'low' gasta menos tempo e tokens, e
 * include_reasoning: false tira o raciocínio do corpo (https://console.groq.com/docs/reasoning).
 */
export function groqProvider(apiKey: string, model = ''): Provider {
	model ||= DEFAULT_GROQ_MODEL;
	return {
		name: 'groq',
		baseURL: GROQ_BASE_URL,
		apiKey,
		model,
		maxTokensParam: 'max_completion_tokens',
		extra: {
			temperature: 0.2,
			...(model.startsWith('openai/gpt-oss')
				? { reasoning_effort: 'low', include_reasoning: false }
				: {})
		}
	};
}

/**
 * Gemini pelo endpoint compatível (https://aistudio.google.com/docs/openai). O raciocínio
 * não desliga nos Gemini 3/4; 'low' é o nível mais barato. Sem temperature: o padrão do
 * modelo é o recomendado.
 */
export function geminiProvider(apiKey: string, model = ''): Provider {
	model ||= DEFAULT_GEMINI_MODEL;
	return {
		name: 'gemini',
		baseURL: GEMINI_BASE_URL,
		apiKey,
		model,
		maxTokensParam: 'max_tokens',
		extra: { reasoning_effort: 'low' }
	};
}

export interface JsonRequest<T> {
	system: string;
	user: string;
	/** JSON Schema strict: todo campo em required e additionalProperties: false. */
	schema: Record<string, unknown>;
	schemaName: string;
	/** Inclui os tokens de raciocínio. */
	maxTokens: number;
	/** Valida e normaliza a saída; null conta como resposta malformada. */
	parse: (data: unknown) => T | null;
}

type Fetch = typeof globalThis.fetch;

/** Falha de um provider; rateLimited deixa ele de fora por COOLDOWN_MS. */
class ProviderFailure extends Error {
	constructor(
		message: string,
		readonly rateLimited = false
	) {
		super(message);
	}
}

/** O corpo exato do POST /chat/completions. */
export function chatBody(provider: Provider, req: JsonRequest<unknown>): Record<string, unknown> {
	return {
		model: provider.model,
		messages: [
			{ role: 'system', content: req.system },
			{ role: 'user', content: req.user }
		],
		response_format: {
			type: 'json_schema',
			json_schema: { name: req.schemaName, schema: req.schema, strict: true }
		},
		[provider.maxTokensParam]: req.maxTokens,
		...provider.extra
	};
}

/** Tira cercas ```json ... ``` caso o modelo as ponha mesmo com response_format. */
function stripFences(text: string): string {
	const m = /^\s*```(?:json)?\s*\n?([\s\S]*?)\n?\s*```\s*$/i.exec(text);
	return m ? m[1] : text;
}

/** Mensagem de erro do corpo: {error:{message}} (OpenAI/Groq) ou [{error:{...}}] (Gemini). */
async function upstreamMessage(res: Response): Promise<string> {
	try {
		const body: unknown = await res.json();
		const e = (Array.isArray(body) ? body[0] : body)?.error;
		const message = typeof e === 'string' ? e : e?.message;
		return typeof message === 'string' ? `: ${message.slice(0, 300)}` : '';
	} catch {
		return '';
	}
}

/** Uma chamada a um provider; qualquer falha vira ProviderFailure. */
async function callProvider<T>(provider: Provider, req: JsonRequest<T>, fetch: Fetch): Promise<T> {
	let res: Response;
	try {
		res = await fetch(`${provider.baseURL}/chat/completions`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${provider.apiKey}`
			},
			body: JSON.stringify(chatBody(provider, req)),
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
	} catch (e) {
		const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
		throw new ProviderFailure(
			timeout ? `sem resposta em ${TIMEOUT_MS / 1000}s` : `falha de conexão: ${String(e)}`
		);
	}
	if (!res.ok) {
		// Groq devolve 400 json_validate_failed quando a saída foge do schema: também cai no próximo.
		throw new ProviderFailure(
			`HTTP ${res.status}${await upstreamMessage(res)}`,
			res.status === 429
		);
	}

	let data: unknown;
	try {
		data = await res.json();
	} catch {
		throw new ProviderFailure('resposta HTTP não é JSON');
	}
	const choice = (
		data as { choices?: { message?: { content?: unknown }; finish_reason?: string }[] }
	)?.choices?.[0];
	if (!choice) throw new ProviderFailure('resposta sem choices');
	if (choice.finish_reason === 'length')
		throw new ProviderFailure('resposta cortada no limite de tokens');
	const content = choice.message?.content;
	if (typeof content !== 'string') throw new ProviderFailure('resposta sem texto');

	let parsed: unknown;
	try {
		parsed = JSON.parse(stripFences(content));
	} catch {
		throw new ProviderFailure('resposta não é JSON válido');
	}
	const out = req.parse(parsed);
	if (out === null) throw new ProviderFailure('resposta fora do formato');
	return out;
}

export interface AiChain {
	json<T>(req: JsonRequest<T>): Promise<T>;
}

export interface ChainOptions {
	fetch?: Fetch;
	now?: () => number;
	cooldownMs?: number;
	log?: Pick<Console, 'warn'>;
}

/**
 * Tenta os providers na ordem. Sem chave, o provider é pulado; depois de um 429, fica de
 * fora por cooldownMs. Qualquer falha passa para o próximo; se todos falham, AiError.
 */
export function createAiChain(providers: Provider[], options: ChainOptions = {}): AiChain {
	const {
		fetch = globalThis.fetch,
		now = Date.now,
		cooldownMs = COOLDOWN_MS,
		log = console
	} = options;
	const coolUntil = new Map<string, number>();

	return {
		async json<T>(req: JsonRequest<T>): Promise<T> {
			const keyed = providers.filter((p) => p.apiKey);
			if (keyed.length === 0) throw new AiError('unavailable', 'nenhuma chave de IA configurada');

			const t = now();
			const ready = keyed.filter((p) => (coolUntil.get(p.name) ?? 0) <= t);
			if (ready.length === 0) throw new AiError('rate_limit', 'todos os providers no limite');

			const failures: string[] = [];
			let allRateLimited = true;
			for (const p of ready) {
				try {
					const out = await callProvider(p, req, fetch);
					coolUntil.delete(p.name);
					return out;
				} catch (e) {
					const failure = e instanceof ProviderFailure ? e : new ProviderFailure(String(e));
					if (failure.rateLimited) coolUntil.set(p.name, now() + cooldownMs);
					else allRateLimited = false;
					failures.push(`${p.name}: ${failure.message}`);
					log.warn(`IA: ${p.name} (${p.model}) falhou: ${failure.message}`);
				}
			}
			// Quem ficou de fora estava em cooldown por 429: não muda o diagnóstico.
			throw new AiError(allRateLimited ? 'rate_limit' : 'upstream', failures.join('; '));
		}
	};
}
