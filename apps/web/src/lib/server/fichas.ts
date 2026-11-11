// Formulário de ficha no servidor: o que volta para a tela quando a validação falha.

import type { FichaField } from '#lib/fichas.ts';

export type FichaErrors = Partial<Record<FichaField | 'form', string>>;

/** O que a pessoa digitou, como veio, para repreencher o formulário. */
export function fichaFormValues(raw: Record<string, unknown>) {
	const str = (v: unknown) => (typeof v === 'string' ? v : '');
	return {
		language: str(raw.language),
		front: str(raw.front),
		back: str(raw.back),
		reverse: raw.reverse === 'on',
		tags: str(raw.tags)
	};
}
