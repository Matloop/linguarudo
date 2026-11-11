// Regras puras das fichas (ADR 0003): HTML sanitizado, lacunas e tags.
// Os limites espelham os checks de supabase/migrations/*_flashcards.sql.

import { charLength } from './items.ts';
import { parseLanguage, type Language } from './languages.ts';
import { parseTags, tagsError } from './tags.ts';

export const FICHA_LIMITS = {
	face: 8000
} as const;

export type FichaFlashcardKind = 'frente' | 'inverso' | 'lacuna';

// ---------- HTML ----------

/** Tags que sobrevivem, já no nome final (strong vira b, em vira i). */
const ALLOWED: Record<string, 'b' | 'i' | 'br'> = {
	b: 'b',
	strong: 'b',
	i: 'i',
	em: 'i',
	br: 'br'
};

/** Tags cujo conteúdo some junto (não é texto para ler). */
const DROP_CONTENT = new Set(['script', 'style', 'template', 'noscript', 'iframe', 'object']);

/** Tags de bloco: viram quebra de linha para o texto não grudar. */
const BLOCK = new Set(['div', 'p', 'li', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

const TOKEN = /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/g;
const ENTITY = /^&(?:#\d{1,7}|#x[0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/;

function escapeText(text: string): string {
	let out = '';
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (c === '&') out += ENTITY.test(text.slice(i)) ? '&' : '&amp;';
		else if (c === '<') out += '&lt;';
		else if (c === '>') out += '&gt;';
		else out += c;
	}
	return out;
}

/**
 * Deixa só b, i e br, sem atributos, com as tags equilibradas. O resto vira texto
 * escapado (ou some, no caso de script/style). Seguro para {@html}.
 */
export function sanitizeFichaHtml(raw: string): string {
	const input = raw.normalize('NFC');
	const open: ('b' | 'i')[] = [];
	let out = '';
	let from = 0;
	let dropping: string | null = null;
	for (const m of input.matchAll(TOKEN)) {
		const at = m.index;
		if (!dropping) out += escapeText(input.slice(from, at));
		from = at + m[0].length;
		if (!m[2]) continue; // comentário
		const closing = m[1] === '/';
		const name = m[2].toLowerCase();
		if (dropping) {
			if (closing && name === dropping) dropping = null;
			continue;
		}
		if (DROP_CONTENT.has(name)) {
			if (!closing && !m[0].endsWith('/>')) dropping = name;
			continue;
		}
		if (BLOCK.has(name)) {
			if (closing && !out.endsWith('<br>') && out !== '') out += '<br>';
			continue;
		}
		const tag = ALLOWED[name];
		if (!tag) continue;
		if (tag === 'br') {
			if (!closing) out += '<br>';
		} else if (!closing) {
			open.push(tag);
			out += `<${tag}>`;
		} else if (open.includes(tag)) {
			// Fecha até a tag certa e reabre as de dentro, para não cruzar.
			const inner: ('b' | 'i')[] = [];
			while (open.length) {
				const top = open.pop()!;
				out += `</${top}>`;
				if (top === tag) break;
				inner.unshift(top);
			}
			for (const t of inner) {
				open.push(t);
				out += `<${t}>`;
			}
		}
	}
	if (!dropping) out += escapeText(input.slice(from));
	while (open.length) out += `</${open.pop()}>`;
	return out
		.replace(/<(b|i)><\/\1>/g, '')
		.replace(/^(?:<br>|\s)+|(?:<br>|\s)+$/g, '')
		.trim();
}

/** Texto do formulário (quebras de linha, <b> e <i> da barra) para o HTML guardado. */
export function fichaTextToHtml(text: string): string {
	return sanitizeFichaHtml(text.replace(/\r\n?/g, '\n').replace(/\n/g, '<br>'));
}

/** HTML guardado de volta para o textarea de edição. */
export function fichaHtmlToText(html: string): string {
	return html.replace(/<br>/g, '\n');
}

/** Texto puro, para listas e buscas. */
export function fichaPlainText(html: string): string {
	return html
		.replace(/<br>/g, ' ')
		.replace(/<[^>]*>/g, '')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/\s+/g, ' ')
		.trim();
}

// ---------- Lacunas ----------

/** {{c1::texto}} ou {{c1::texto::dica}}, como no Anki. */
const CLOZE = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;

/** Maior número de lacuna da ficha; 0 se não tem lacuna. */
export function clozeCount(html: string): number {
	let max = 0;
	for (const m of html.matchAll(CLOZE)) max = Math.max(max, Number(m[1]));
	return Math.min(max, 50);
}

/**
 * Mostra a lacuna `ord` escondida (com a dica, se houver) ou aberta; as outras
 * lacunas aparecem como texto. Recebe HTML já sanitizado.
 */
export function renderCloze(html: string, ord: number, reveal: boolean): string {
	return html.replace(CLOZE, (_, n: string, text: string, hint: string | undefined) => {
		if (Number(n) !== ord) return text;
		if (reveal) return `<span class="cloze open">${text}</span>`;
		return `<span class="cloze">${hint ? `[${hint}]` : '[…]'}</span>`;
	});
}

// ---------- Formulário ----------

export interface FichaInput {
	language: Language;
	front: string;
	back: string;
	reverse: boolean;
	tags: string[];
}

export type FichaField = keyof FichaInput;

export type FichaFormResult =
	{ ok: true; value: FichaInput } | { ok: false; errors: Partial<Record<FichaField, string>> };

function faceError(html: string, required: boolean): string | undefined {
	if (required && !html) return 'Escreva a frente.';
	if (charLength(html) > FICHA_LIMITS.face) return 'Texto longo demais.';
	return undefined;
}

export function parseFichaInput(raw: Record<string, unknown>): FichaFormResult {
	const str = (v: unknown) => (typeof v === 'string' ? v : '');
	const language = parseLanguage(str(raw.language));
	const front = fichaTextToHtml(str(raw.front));
	const back = fichaTextToHtml(str(raw.back));
	const tags = parseTags(str(raw.tags));
	const reverse = raw.reverse === 'on' || raw.reverse === 'true' || raw.reverse === true;
	const errors: Partial<Record<FichaField, string>> = {
		language: language ? undefined : 'Escolha o idioma.',
		front: faceError(front, true),
		back: faceError(back, false) ?? (reverse && !back ? 'O inverso precisa de verso.' : undefined),
		tags: tagsError(tags)
	};
	for (const k of Object.keys(errors) as FichaField[]) if (!errors[k]) delete errors[k];
	if (Object.keys(errors).length || !language) return { ok: false, errors };
	return { ok: true, value: { language, front, back, reverse, tags } };
}

/** Quantos flashcards a ficha gera (para o "Vai gerar N flashcards"). */
export function flashcardsFor(f: { front: string; reverse: boolean }): number {
	const cloze = clozeCount(f.front);
	return cloze > 0 ? cloze : f.reverse ? 2 : 1;
}

export const FICHA_KIND_LABELS: Record<FichaFlashcardKind, string> = {
	frente: 'Frente → verso',
	inverso: 'Verso → frente',
	lacuna: 'Lacuna'
};
