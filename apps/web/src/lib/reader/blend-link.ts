// Link do blend tocado no leitor: o parser é o de lib/blend/link.ts (o mesmo que gera os
// links); aqui só se limpa o que vai para o cartão e para o banco.

import { parseBlendHref } from '#lib/blend/link.ts';

export type BlendLink = {
	lemma: string;
	translation: string;
	note: string;
};

const clean = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim();

/** O link do blend em `href`, com os campos limpos; null se não for um (ou ficar vazio). */
export function readBlendLink(href: string | null | undefined): BlendLink | null {
	const parsed = href ? parseBlendHref(href) : null;
	if (!parsed) return null;
	const link = {
		lemma: clean(parsed.lemma),
		translation: clean(parsed.translation),
		note: clean(parsed.note)
	};
	return link.lemma && link.translation ? link : null;
}
