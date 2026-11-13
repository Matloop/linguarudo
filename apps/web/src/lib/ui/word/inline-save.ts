// Edição no lugar: cada campo salva sozinho ao sair dele. Os envios entram numa fila
// para o segundo ler o item já recarregado pelo primeiro (o ?/edit regrava lema,
// leitura, tradução e nota juntos; ver itemEditFields).

import { postAction } from '../post-action.ts';

export type SaveResult = { ok: true } | { ok: false; error: string };

let chain: Promise<unknown> = Promise.resolve();

/**
 * POST na action (`fields` é lido na vez do envio) e devolve o erro do campo, se houver:
 * errors[field] do ?/edit, errors.form, ou a mensagem genérica (ex.: ?/move).
 */
export function saveField(
	action: string,
	fields: () => Record<string, string>,
	field: string
): Promise<SaveResult> {
	const run = chain.then(async (): Promise<SaveResult> => {
		const r = await postAction(action, fields());
		if (r.ok) return { ok: true };
		const errors = (r.data?.errors ?? {}) as Record<string, string | undefined>;
		return { ok: false, error: errors[field] ?? errors.form ?? r.message };
	});
	chain = run.catch(() => {});
	return run;
}

/** Action padrão da edição de palavra e da troca de deck. */
export const EDIT_ACTION = '/palavras?/edit';
export const MOVE_ACTION = '/palavras?/move';
