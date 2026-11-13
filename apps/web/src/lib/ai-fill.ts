// "Preencher com IA" no diálogo Guardar: o que a sugestão pode sobrescrever.

export type FillFields = {
	lemma: string;
	reading: string;
	sense: string;
	sentence: string;
	/** Tradução da frase, na língua nativa. */
	translation: string;
};

/**
 * Lê a resposta 200 de /palavras/sugerir. Campos ausentes ou de outro tipo viram ''.
 */
export function parseSuggestion(raw: unknown): FillFields | null {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;
	const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
	const s = {
		lemma: str(r.lemma),
		reading: str(r.reading),
		sense: str(r.sense),
		sentence: str(r.sentence),
		translation: str(r.translation)
	};
	return s.lemma || s.reading || s.sense || s.sentence || s.translation ? s : null;
}

/**
 * A palavra vira a forma de dicionário da IA ("voglio" → "volere"); leitura,
 * tradução, contexto e tradução do contexto só entram onde o usuário ainda não escreveu nada.
 */
export function mergeSuggestion(current: FillFields, suggestion: FillFields): FillFields {
	const empty = (v: string) => !v.trim();
	const sentence =
		empty(current.sentence) && suggestion.sentence ? suggestion.sentence : current.sentence;
	// A tradução da IA é da frase dela (ou da do usuário): sem frase, não há o que traduzir.
	const translation =
		empty(current.translation) && suggestion.translation && !empty(sentence)
			? suggestion.translation
			: current.translation;
	return {
		lemma: suggestion.lemma || current.lemma,
		reading: empty(current.reading) && suggestion.reading ? suggestion.reading : current.reading,
		sense: empty(current.sense) && suggestion.sense ? suggestion.sense : current.sense,
		sentence,
		translation
	};
}
