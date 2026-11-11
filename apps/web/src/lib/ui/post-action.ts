// POST de uma form action da página atual sem <form> (barra de seleção, popovers):
// mesma resposta do use:enhance, depois recarrega os dados da página e do shell.

import { deserialize } from '$app/forms';
import { invalidateAll } from '$app/navigation';

export type ActionReply =
	{ ok: true; data: Record<string, unknown> } | { ok: false; message: string };

export async function postAction(
	action: string,
	fields: Record<string, string | readonly string[] | null | undefined>,
	{ reload = true }: { reload?: boolean } = {}
): Promise<ActionReply> {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) {
		if (v === null || v === undefined) continue;
		if (typeof v === 'string') body.set(k, v);
		else for (const x of v) body.append(k, x);
	}
	const res = await fetch(`?/${action}`, {
		method: 'POST',
		body,
		headers: { 'x-sveltekit-action': 'true' }
	}).catch(() => null);
	if (!res) return { ok: false, message: 'Sem conexão. Tente de novo.' };
	const result = deserialize(await res.text());
	if (result.type === 'success') {
		if (reload) await invalidateAll();
		return { ok: true, data: (result.data ?? {}) as Record<string, unknown> };
	}
	if (result.type === 'failure') {
		const message = (result.data as { message?: string } | undefined)?.message;
		return { ok: false, message: message ?? 'Não deu para salvar agora.' };
	}
	return { ok: false, message: 'Não deu para salvar agora.' };
}
