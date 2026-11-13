// Link do blend: <a href="#lb:LEMA|TRADUÇÃO|NOTA">forma</a>
// (crossnext-blend/docs/blend-format.md). Campos em UTF-8 cru, "|" vira %7C e "%" vira %25
// dentro de um campo; o href inteiro tem no máximo 255 bytes. Limites do parser do aparelho
// (bytes): lema 47, tradução 63, nota 95.

export const HREF_MAX_BYTES = 255;
export const FIELD_MAX_BYTES = { lemma: 47, translation: 63, note: 95 } as const;

const encoder = new TextEncoder();
const bytes = (s: string) => encoder.encode(s).length;

/** Corta em `max` bytes UTF-8 sem partir um caractere. */
export function cutBytes(s: string, max: number): string {
	if (bytes(s) <= max) return s;
	let out = '';
	let n = 0;
	for (const ch of s) {
		const b = bytes(ch);
		if (n + b > max) break;
		out += ch;
		n += b;
	}
	return out.trimEnd();
}

/** Escapa um campo: "%" → %25 e "|" → %7C (nada mais). */
export function escapeField(s: string): string {
	return s.replace(/%/g, '%25').replace(/\|/g, '%7C');
}

/** Texto para dentro de XML: & < > e, em atributo, aspas. */
export function escapeXml(s: string, attribute = false): string {
	const out = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	return attribute ? out.replace(/"/g, '&quot;') : out;
}

const clean = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim();

/** Corta um campo já escapado sem deixar um %XX pela metade. */
function cutEscaped(s: string, max: number): string {
	const cut = cutBytes(s, max);
	return cut.replace(/%(?:[0-9A-F]?)$/, '');
}

/**
 * O href do link (sem escape de XML), ou null se lema ou tradução ficarem vazios. Cada
 * campo respeita o limite do parser; se o todo passar de 255 bytes, a nota sai primeiro,
 * depois a tradução é encurtada.
 */
export function blendHref(lemma: string, translation: string, note = ''): string | null {
	const l = cutEscaped(escapeField(clean(lemma)), FIELD_MAX_BYTES.lemma);
	let t = cutEscaped(escapeField(clean(translation)), FIELD_MAX_BYTES.translation);
	let n = cutEscaped(escapeField(clean(note)), FIELD_MAX_BYTES.note);
	if (!l || !t) return null;
	const build = () => `#lb:${l}|${t}${n ? `|${n}` : ''}`;
	if (bytes(build()) > HREF_MAX_BYTES) n = '';
	if (bytes(build()) > HREF_MAX_BYTES) t = cutEscaped(t, HREF_MAX_BYTES - bytes(`#lb:${l}|`));
	if (!t) return null;
	return build();
}

/** O elemento <a> pronto para entrar no XHTML. */
export function blendAnchor(
	target: string,
	lemma: string,
	translation: string,
	note = ''
): string | null {
	const href = blendHref(lemma, translation, note);
	const text = clean(target);
	if (!href || !text) return null;
	return `<a href="${escapeXml(href, true)}">${escapeXml(text)}</a>`;
}

/** Lê um href de volta (para testes e para o leitor web). */
export function parseBlendHref(
	href: string
): { lemma: string; translation: string; note: string } | null {
	if (!href.startsWith('#lb:') || bytes(href) > HREF_MAX_BYTES) return null;
	const parts = href.slice(4).split('|');
	if (parts.length < 2 || parts.length > 3) return null;
	const un = (s: string) => s.replace(/%7C/gi, '|').replace(/%25/g, '%');
	const [lemma, translation, note = ''] = parts.map(un);
	if (!lemma || !translation) return null;
	return { lemma, translation, note };
}
