// Tags de itens e fichas (ADR 0003). Os limites espelham public.valid_tags().

export const TAG_LIMITS = {
	count: 50,
	length: 100
} as const;

/** "verbos, gramática ,verbos" → ["verbos", "gramática"]: sem vazias e sem repetir (caixa não importa). */
export function parseTags(raw: string | readonly string[]): string[] {
	const parts = typeof raw === 'string' ? raw.split(',') : raw;
	const seen = new Set<string>();
	const tags: string[] = [];
	for (const part of parts) {
		const tag = part.normalize('NFC').trim().replace(/\s+/g, ' ');
		const key = tag.toLocaleLowerCase('pt-BR');
		if (!tag || seen.has(key)) continue;
		seen.add(key);
		tags.push(tag);
	}
	return tags;
}

export function tagsError(tags: readonly string[]): string | undefined {
	if (tags.length > TAG_LIMITS.count) return `Use no máximo ${TAG_LIMITS.count} tags.`;
	// Code points, como o char_length do Postgres.
	if (tags.some((t) => [...t].length > TAG_LIMITS.length)) {
		return `Cada tag tem no máximo ${TAG_LIMITS.length} caracteres.`;
	}
	return undefined;
}
