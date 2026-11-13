// Leitura e escrita mínimas de um capítulo XHTML para o blend. Nada é reconstruído: o
// arquivo vira uma lista de pedaços (tags, texto, comentários) e só os nós de texto que
// ganham um link são reescritos; o resto sai byte a byte como entrou.
//
// Parágrafo = o bloco aberto mais interno (p, li, blockquote, div...) que tem texto. O texto
// dentro de links, títulos (h1–h6), sumário (nav), sup/sub, ruby, código e afins não é
// trocado; o de links, sup e afins entra no parágrafo só como contexto.

import { findWord } from '@linguetta/language';

type Token =
	| { kind: 'text'; raw: string }
	| { kind: 'open'; raw: string; name: string; selfClosing: boolean }
	| { kind: 'close'; raw: string; name: string }
	| { kind: 'other'; raw: string };

/** Elementos cujo conteúdo não é texto de leitura: nem contexto, nem troca. */
const HIDDEN = new Set(['head', 'script', 'style', 'svg', 'math', 'template', 'rt', 'rp']);
/** Blocos que não são parágrafo: o texto deles fica de fora. */
const NO_PARAGRAPH = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'nav', 'pre', 'title', 'header']);
/** Dentro do parágrafo, entram como contexto mas não são trocados. */
const FROZEN = new Set(['a', 'sup', 'sub', 'code', 'kbd', 'samp', 'var', 'ruby', 'abbr', 'button']);
const BLOCKS = new Set([
	'body',
	'p',
	'li',
	'dd',
	'dt',
	'blockquote',
	'div',
	'td',
	'th',
	'caption',
	'figcaption',
	'section',
	'article',
	'aside',
	'footer',
	'main',
	'figure',
	'center',
	...NO_PARAGRAPH
]);
const VOID = new Set(['br', 'img', 'hr', 'meta', 'link', 'input', 'col', 'area', 'wbr', 'source']);

const NAMED: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
	shy: '­',
	mdash: '—',
	ndash: '–',
	hellip: '…',
	lsquo: '‘',
	rsquo: '’',
	ldquo: '“',
	rdquo: '”',
	laquo: '«',
	raquo: '»'
};

function localName(raw: string): string {
	const m = /^<\/?\s*([^\s/>]+)/.exec(raw);
	const name = (m?.[1] ?? '').toLowerCase();
	const colon = name.indexOf(':');
	return colon >= 0 ? name.slice(colon + 1) : name;
}

/** Quebra o documento em tags, texto e o resto (comentário, CDATA, doctype, PI). */
export function tokenize(xml: string): Token[] {
	const out: Token[] = [];
	let i = 0;
	const n = xml.length;
	const until = (from: number, end: string) => {
		const at = xml.indexOf(end, from);
		return at < 0 ? n : at + end.length;
	};
	while (i < n) {
		const lt = xml.indexOf('<', i);
		if (lt < 0) {
			out.push({ kind: 'text', raw: xml.slice(i) });
			break;
		}
		if (lt > i) out.push({ kind: 'text', raw: xml.slice(i, lt) });
		let end: number;
		if (xml.startsWith('<!--', lt)) end = until(lt + 4, '-->');
		else if (xml.startsWith('<![CDATA[', lt)) end = until(lt + 9, ']]>');
		else if (xml.startsWith('<?', lt)) end = until(lt + 2, '?>');
		else if (xml.startsWith('<!', lt)) end = until(lt + 2, '>');
		else {
			// Tag: anda até o ">" fora de aspas.
			let j = lt + 1;
			let quote = '';
			while (j < n) {
				const c = xml[j];
				if (quote) {
					if (c === quote) quote = '';
				} else if (c === '"' || c === "'") quote = c;
				else if (c === '>') break;
				j++;
			}
			end = Math.min(n, j + 1);
			const raw = xml.slice(lt, end);
			if (raw.startsWith('</')) out.push({ kind: 'close', raw, name: localName(raw) });
			else {
				const name = localName(raw);
				out.push({ kind: 'open', raw, name, selfClosing: /\/\s*>$/.test(raw) || VOID.has(name) });
			}
			i = end;
			continue;
		}
		out.push({ kind: 'other', raw: xml.slice(lt, end) });
		i = end;
	}
	return out;
}

/** Um caractere (ou entidade) do texto: o que ele vale e como estava escrito. */
interface Unit {
	text: string;
	raw: string;
}

const ENTITY = /^&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{0,31});/;

/** Texto de um trecho XML com as entidades resolvidas. */
export function decodeText(raw: string): string {
	return decodeUnits(raw)
		.map((u) => u.text)
		.join('');
}

function decodeUnits(raw: string): Unit[] {
	const units: Unit[] = [];
	let i = 0;
	while (i < raw.length) {
		if (raw[i] === '&') {
			const m = ENTITY.exec(raw.slice(i, i + 40));
			if (m) {
				const body = m[1];
				let text: string | undefined;
				if (body[0] === '#') {
					const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
					try {
						text = String.fromCodePoint(code);
					} catch {
						text = undefined;
					}
				} else text = NAMED[body];
				// Entidade desconhecida: fica opaca (o texto é ela mesma, nunca é trocada).
				units.push({ text: text ?? m[0], raw: m[0] });
				i += m[0].length;
				continue;
			}
		}
		const cp = raw.codePointAt(i)!;
		const ch = String.fromCodePoint(cp);
		units.push({ text: ch, raw: ch });
		i += ch.length;
	}
	return units;
}

/** Trecho do texto do parágrafo vindo de um nó de texto. */
interface Segment {
	token: number;
	start: number;
	end: number;
	units: Unit[];
	/** Início de cada unidade no texto do parágrafo. */
	offsets: number[];
	editable: boolean;
}

export interface Paragraph {
	text: string;
	segments: Segment[];
}

export interface Replacement {
	para: number;
	/** Posições no texto do parágrafo (unidades UTF-16). */
	start: number;
	end: number;
	/** XHTML pronto (o <a> do blend). */
	html: string;
}

export interface XhtmlDoc {
	/** Parágrafos com texto, na ordem do documento. */
	paragraphs: Paragraph[];
	/** Texto do primeiro título (h1–h6) ou do <title>, se houver. */
	heading: string;
	/**
	 * Acha `form` no parágrafo, numa palavra inteira, dentro de um só nó de texto editável e
	 * fora das faixas já usadas. null se não dá para trocar.
	 */
	locate(para: number, form: string, lang: string, taken?: { start: number; end: number }[]): { start: number; end: number } | null;
	/** O documento com as trocas; o resto sai como entrou. */
	render(replacements: readonly Replacement[]): string;
}

export function parseXhtml(xml: string): XhtmlDoc {
	const tokens = tokenize(xml);
	const paragraphs: Paragraph[] = [];
	// Pilha de elementos abertos; cada bloco guarda o índice do parágrafo dele (ou -1).
	const stack: { name: string; para: number | null }[] = [];
	let hidden = 0;
	let frozen = 0;
	let inBody = false;
	let heading = '';
	let title = '';
	let headingDepth = -1;
	let titleOpen = false;

	const currentBlock = () => {
		for (let k = stack.length - 1; k >= 0; k--) if (BLOCKS.has(stack[k].name)) return stack[k];
		return null;
	};

	const addText = (tokenIndex: number, units: Unit[], editable: boolean) => {
		const block = currentBlock();
		if (!block || NO_PARAGRAPH.has(block.name)) return;
		if (stack.some((s) => NO_PARAGRAPH.has(s.name))) return;
		if (block.para === null) {
			if (!units.some((u) => /\S/.test(u.text))) return;
			block.para = paragraphs.length;
			paragraphs.push({ text: '', segments: [] });
		}
		const p = paragraphs[block.para];
		const offsets: number[] = [];
		let at = p.text.length;
		const start = at;
		let text = '';
		for (const u of units) {
			offsets.push(at);
			at += u.text.length;
			text += u.text;
		}
		p.segments.push({ token: tokenIndex, start, end: at, units, offsets, editable });
		p.text += text;
	};

	tokens.forEach((t, idx) => {
		if (t.kind === 'open') {
			if (t.name === 'body') inBody = true;
			if (t.selfClosing) {
				// <br/> separa palavras: vira um espaço de contexto.
				if (t.name === 'br' && inBody && hidden === 0) addText(-1, [{ text: '\n', raw: '' }], false);
				return;
			}
			stack.push({ name: t.name, para: null });
			if (HIDDEN.has(t.name)) hidden++;
			if (FROZEN.has(t.name)) frozen++;
			if (/^h[1-6]$/.test(t.name) && !heading && headingDepth < 0) headingDepth = stack.length;
			if (t.name === 'title') titleOpen = true;
			return;
		}
		if (t.kind === 'close') {
			let k = stack.length - 1;
			while (k >= 0 && stack[k].name !== t.name) k--;
			if (k < 0) return;
			for (const s of stack.splice(k)) {
				if (HIDDEN.has(s.name)) hidden--;
				if (FROZEN.has(s.name)) frozen--;
			}
			if (headingDepth > stack.length) headingDepth = heading ? -2 : -1;
			if (t.name === 'title') titleOpen = false;
			if (t.name === 'body') inBody = false;
			return;
		}
		if (t.kind !== 'text') return;
		if (titleOpen) title += t.raw;
		if (!inBody) return;
		if (headingDepth > 0) heading += decodeUnits(t.raw).map((u) => u.text).join('');
		if (hidden > 0) return;
		addText(idx, decodeUnits(t.raw), frozen === 0);
	});

	const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

	return {
		paragraphs,
		heading: squash(heading) || squash(decodeUnits(title).map((u) => u.text).join('')),
		locate(para, form, lang, taken = []) {
			const p = paragraphs[para];
			if (!p || !form.trim()) return null;
			let from = 0;
			while (from < p.text.length) {
				const hit = findWord(p.text.slice(from), form, lang);
				if (!hit) return null;
				const start = from + hit.index;
				const end = start + hit.length;
				const seg = p.segments.find((s) => s.editable && s.start <= start && end <= s.end);
				const aligned =
					seg &&
					seg.offsets.includes(start) &&
					(end === seg.end || seg.offsets.includes(end));
				const free = taken.every((r) => end <= r.start || start >= r.end);
				if (aligned && free) return { start, end };
				from = start + Math.max(1, hit.length);
			}
			return null;
		},
		render(replacements) {
			const byToken = new Map<number, { seg: Segment; r: Replacement }[]>();
			for (const r of replacements) {
				const seg = paragraphs[r.para]?.segments.find(
					(s) => s.editable && s.start <= r.start && r.end <= s.end
				);
				if (!seg) continue;
				const list = byToken.get(seg.token) ?? [];
				list.push({ seg, r });
				byToken.set(seg.token, list);
			}
			return tokens
				.map((t, idx) => {
					const list = byToken.get(idx);
					if (!list) return t.raw;
					const { seg } = list[0];
					const sorted = list.map((x) => x.r).sort((a, b) => a.start - b.start);
					let out = '';
					let k = 0;
					for (const r of sorted) {
						// Pula troca que se sobrepõe à anterior.
						if (seg.offsets[k] !== undefined && seg.offsets[k] > r.start) continue;
						while (k < seg.units.length && seg.offsets[k] < r.start) out += seg.units[k++].raw;
						out += r.html;
						while (k < seg.units.length && seg.offsets[k] < r.end) k++;
					}
					while (k < seg.units.length) out += seg.units[k++].raw;
					return out;
				})
				.join('');
		}
	};
}
