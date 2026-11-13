// Campos de uma palavra (Item), os mesmos no diálogo Guardar e no painel (decisão
// "Edição (i)"). Regras puras: rótulos, limites, o que a edição no lugar precisa mandar
// para o ?/edit e os atalhos do diálogo. Os componentes ficam em lib/ui/word/.

import { LIMITS } from './items.ts';
import { TAG_LIMITS } from './tags.ts';

/** Campos de texto. A frase só existe ao guardar (no painel ela é um encontro). */
export type WordTextField = 'lemma' | 'sense' | 'sentence' | 'reading' | 'note' | 'tags';

/** Campos que editam no lugar pelo ?/edit (a frase não). */
export type InlineTextField = Exclude<WordTextField, 'sentence'>;

/** Ícones da sprite usados pelos campos (subconjunto de IconName). */
export type FieldIcon = 'globe' | 'quote' | 'sound' | 'note' | 'tag';

export interface FieldMeta {
	label: string;
	/** Sem ícone: o lema, que é o campo grande do topo. */
	icon: FieldIcon | null;
	placeholder: string;
	max: number;
	multiline: boolean;
	/** O texto está no idioma de estudo (lang/dir do campo seguem o idioma). */
	inTargetLanguage: boolean;
}

export const WORD_FIELDS: Record<WordTextField, FieldMeta> = {
	lemma: {
		label: 'Palavra',
		icon: null,
		placeholder: 'Palavra ou expressão',
		max: LIMITS.lemma,
		multiline: false,
		inTargetLanguage: true
	},
	sense: {
		label: 'Tradução',
		icon: 'globe',
		placeholder: 'O que ela quer dizer',
		max: LIMITS.sense,
		multiline: false,
		inTargetLanguage: false
	},
	sentence: {
		label: 'Frase',
		icon: 'quote',
		placeholder: 'Onde você encontrou (opcional)',
		max: LIMITS.sentence,
		multiline: true,
		inTargetLanguage: true
	},
	reading: {
		label: 'Leitura',
		icon: 'sound',
		placeholder: 'IPA, furigana, pinyin…',
		max: LIMITS.reading,
		multiline: false,
		inTargetLanguage: true
	},
	note: {
		label: 'Nota',
		icon: 'note',
		placeholder: 'Dica, regra, mnemônico',
		max: LIMITS.note,
		multiline: true,
		inTargetLanguage: false
	},
	tags: {
		label: 'Tags',
		icon: 'tag',
		placeholder: 'filme, gíria…',
		max: TAG_LIMITS.length,
		multiline: false,
		inTargetLanguage: false
	}
};

/** O que a edição no lugar sabe do item. Mesmos nomes da linha de /palavras. */
export interface EditableItem {
	id: string;
	lemma: string;
	reading: string;
	sense: string;
	note: string;
	tags: readonly string[];
	image?: string | null;
	audio?: string | null;
	deckId?: string | null;
}

/** Opção do campo Deck (e do DeckPicker). */
export interface DeckOption {
	id: string;
	name: string;
	depth: number;
	isDefault?: boolean;
}

export function formatTags(tags: readonly string[]): string {
	return tags.join(', ');
}

/**
 * Corpo do POST ?/edit para salvar um campo só. O parseItemEdit regrava lema, leitura,
 * tradução e nota juntos (ausente = vazio), então os valores atuais vão junto; tags e
 * mídia só mudam quando vêm no formulário, então só vão quando são o campo editado.
 */
export function itemEditFields(
	item: EditableItem,
	field: InlineTextField | 'image' | 'audio',
	value: string
): Record<string, string> {
	const fields: Record<string, string> = {
		id: item.id,
		lemma: item.lemma,
		reading: item.reading,
		sense: item.sense,
		note: item.note
	};
	fields[field] = value;
	return fields;
}

/** Valor atual do campo no item, como texto (tags separadas por vírgula). */
export function itemFieldValue(item: EditableItem, field: InlineTextField): string {
	return field === 'tags' ? formatTags(item.tags) : item[field];
}

export interface KeyLike {
	code: string;
	altKey?: boolean;
	ctrlKey?: boolean;
	metaKey?: boolean;
	shiftKey?: boolean;
}

export type SaveDialogKey = { type: 'idiomas' } | { type: 'idioma'; index: number };

/**
 * Atalhos do diálogo Guardar: ⌥L abre "Guardar em", ⌥1…⌥9 escolhem o idioma direto.
 * Pelo `code` (tecla física): no Mac, ⌥L digita "¬" e ⌥1 digita "¡".
 */
export function saveDialogKey(e: KeyLike): SaveDialogKey | null {
	if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
	if (e.code === 'KeyL') return { type: 'idiomas' };
	const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
	return digit ? { type: 'idioma', index: Number(digit[1]) - 1 } : null;
}
