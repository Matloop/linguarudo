// "✦ Completar com IA" da frase de um encontro, do lado do navegador: POST em
// /palavras/frase e o par já mesclado com o que está no editor (mergeSentencePair).

import { mergeSentencePair, parseSentencePair, type SentencePair } from '#lib/sentence.ts';
import type { Language } from '#lib/languages.ts';

export type SentenceAiReply = { ok: true; pair: SentencePair } | { ok: false; message: string };

export async function completeSentenceWithAi(
	input: { language: Language; lemma: string; sense: string },
	current: SentencePair,
	signal?: AbortSignal
): Promise<SentenceAiReply> {
	let res: Response;
	try {
		res = await fetch('/palavras/frase', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ ...input, ...current }),
			signal
		});
	} catch {
		return { ok: false, message: 'Sem conexão. Tente de novo.' };
	}
	const body: unknown = await res.json().catch(() => null);
	if (!res.ok) {
		const message = (body as { message?: unknown } | null)?.message;
		return {
			ok: false,
			message:
				typeof message === 'string' && message
					? message
					: 'A IA não respondeu agora, tente de novo.'
		};
	}
	const pair = parseSentencePair(body);
	if (!pair) return { ok: false, message: 'A IA não devolveu uma frase.' };
	return { ok: true, pair: mergeSentencePair(current, pair) };
}
