// Modelos de cartão do Anki ({{Campo}}, {{#Campo}}…{{/Campo}}, filtros) e a mídia
// embutida nos campos (<img src> e [sound:]). Puro: roda no navegador e nos testes.

export type Fields = Readonly<Record<string, string>>;

export interface RenderContext {
	/** HTML da frente, para {{FrontSide}} no verso. */
	frontSide?: string;
	tags?: string;
	deck?: string;
	card?: string;
	type?: string;
}

type Node =
	| { t: 'text'; v: string }
	| { t: 'field'; name: string; filters: string[] }
	| { t: 'section'; name: string; inverted: boolean; body: Node[] };

const TAG = /\{\{([\s\S]*?)\}\}/g;

function parse(template: string): Node[] {
	const root: Node[] = [];
	const stack: { name: string; body: Node[] }[] = [{ name: '', body: root }];
	let from = 0;
	for (const m of template.matchAll(TAG)) {
		const top = stack[stack.length - 1];
		if (m.index > from) top.body.push({ t: 'text', v: template.slice(from, m.index) });
		from = m.index + m[0].length;
		const inner = m[1].trim();
		if (inner.startsWith('#') || inner.startsWith('^')) {
			const node: Node = {
				t: 'section',
				name: inner.slice(1).trim(),
				inverted: inner.startsWith('^'),
				body: []
			};
			top.body.push(node);
			stack.push({ name: node.name, body: node.body });
		} else if (inner.startsWith('/')) {
			const name = inner.slice(1).trim();
			// Fecha a seção certa; fechamento solto vira nada (o Anki daria erro).
			const at = stack.findLastIndex((s, i) => i > 0 && s.name === name);
			if (at > 0) stack.length = at;
		} else if (inner.startsWith('!')) {
			// comentário
		} else {
			const parts = inner.split(':');
			const name = parts.pop()!.trim();
			top.body.push({ t: 'field', name, filters: parts.map((p) => p.trim()) });
		}
	}
	if (from < template.length)
		stack[stack.length - 1].body.push({ t: 'text', v: template.slice(from) });
	return root;
}

/** Kanji[leitura] (furigana do Anki). */
const FURIGANA = / ?([^ >[\]]+?)\[([^\]]*)\]/g;

function applyFilter(filter: string, value: string): string {
	switch (filter.split(' ')[0].toLowerCase()) {
		case 'text':
			return plainText(value);
		case 'kanji':
		case 'furigana':
			return value.replace(FURIGANA, '$1');
		case 'kana':
			return value.replace(FURIGANA, '$2');
		case 'type':
		case 'tts':
			return '';
		// hint, cloze e filtros desconhecidos: o conteúdo como está.
		default:
			return value;
	}
}

function special(name: string, ctx: RenderContext): string | undefined {
	switch (name) {
		case 'FrontSide':
			return ctx.frontSide ?? '';
		case 'Tags':
			return ctx.tags ?? '';
		case 'Deck':
			return ctx.deck ?? '';
		case 'Subdeck':
			return (ctx.deck ?? '').split('::').pop() ?? '';
		case 'Card':
			return ctx.card ?? '';
		case 'Type':
			return ctx.type ?? '';
	}
	return undefined;
}

function nonEmpty(value: string | undefined): boolean {
	if (!value) return false;
	return plainText(value) !== '' || /<img|\[sound:/i.test(value);
}

function renderNodes(nodes: Node[], fields: Fields, ctx: RenderContext): string {
	let out = '';
	for (const n of nodes) {
		if (n.t === 'text') out += n.v;
		else if (n.t === 'section') {
			const has = nonEmpty(fields[n.name] ?? special(n.name, ctx));
			if (has !== n.inverted) out += renderNodes(n.body, fields, ctx);
		} else {
			// type:Campo vira caixa de digitar no Anki; aqui não aparece.
			if (n.filters.some((f) => f.toLowerCase() === 'type')) continue;
			let value = special(n.name, ctx) ?? fields[n.name] ?? '';
			for (const f of [...n.filters].reverse()) value = applyFilter(f, value);
			out += value;
		}
	}
	return out;
}

export function renderTemplate(template: string, fields: Fields, ctx: RenderContext = {}): string {
	return renderNodes(parse(template), fields, ctx);
}

/** Campos citados no modelo (para saber o que a frente mostra). */
export function templateFields(template: string): string[] {
	const names = new Set<string>();
	const walk = (nodes: Node[]) => {
		for (const n of nodes) {
			if (n.t === 'field') names.add(n.name);
			else if (n.t === 'section') walk(n.body);
		}
	};
	walk(parse(template));
	return [...names];
}

/**
 * Verso sem a repetição da frente: o Anki costuma montar o verso como
 * "{{FrontSide}}<hr id=answer>…". Fica só o que vem depois da linha.
 */
export function answerOnly(answerHtml: string): string {
	const hr = /<hr[^>]*id\s*=\s*["']?answer["']?[^>]*>/i.exec(answerHtml);
	return hr ? answerHtml.slice(hr.index + hr[0].length) : answerHtml;
}

// ---------- Mídia e texto ----------

const IMG = /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi;
const SOUND = /\[sound:([^\]]+)\]/g;

export interface ExtractedMedia {
	html: string;
	images: string[];
	sounds: string[];
}

/** Tira <img> e [sound:] do HTML e devolve os nomes dos arquivos, na ordem. */
export function extractMedia(html: string): ExtractedMedia {
	const images: string[] = [];
	const sounds: string[] = [];
	const without = html
		.replace(IMG, (_, a?: string, b?: string, c?: string) => {
			const src = decodeEntities((a ?? b ?? c ?? '').trim());
			// Imagem de fora (http) não vem no pacote.
			if (src && !/^[a-z]+:/i.test(src)) images.push(safeDecodeUri(src));
			return '';
		})
		.replace(SOUND, (_, name: string) => {
			sounds.push(name.trim());
			return '';
		});
	return { html: without, images, sounds };
}

function safeDecodeUri(s: string): string {
	try {
		return decodeURIComponent(s);
	} catch {
		return s;
	}
}

const NAMED: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
	ndash: '–',
	mdash: '—',
	hellip: '…',
	laquo: '«',
	raquo: '»'
};

export function decodeEntities(s: string): string {
	return s.replace(/&(#\d{1,7}|#x[0-9a-fA-F]{1,6}|[a-zA-Z]{2,8});/g, (all, e: string) => {
		if (e[0] === '#') {
			const code =
				e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
			return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
		}
		return NAMED[e.toLowerCase()] ?? all;
	});
}

/** Texto puro de um campo: sem HTML, sem [sound:], espaços colapsados. */
export function plainText(html: string): string {
	return decodeEntities(
		html
			.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
			.replace(/<br\s*\/?>|<\/(div|p|li)>/gi, ' ')
			.replace(/<[^>]*>/g, '')
			.replace(SOUND, '')
	)
		.replace(/\s+/g, ' ')
		.trim();
}
