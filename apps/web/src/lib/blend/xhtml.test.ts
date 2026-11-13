import { describe, expect, test } from 'bun:test';
import { parseXhtml } from './xhtml.ts';

const doc = (body: string) =>
	`<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>T</title><style>p{}</style></head><body>${body}</body></html>`;

describe('xhtml do capítulo', () => {
	test('parágrafos, sem títulos nem nav', () => {
		const d = parseXhtml(
			doc('<h1>Capítulo I</h1><nav><a href="#">Sumário</a></nav><p>Era uma <em>vez</em> um rei.</p><div><p>Outro.</p></div>')
		);
		expect(d.heading).toBe('Capítulo I');
		expect(d.paragraphs.map((p) => p.text)).toEqual(['Era uma vez um rei.', 'Outro.']);
	});

	test('acha palavra inteira e troca preservando o resto byte a byte', () => {
		const xml = doc('<p class="x">A casa &amp; o casamento.<!-- c --></p><p>Fim &#8212; casa.</p>');
		const d = parseXhtml(xml);
		expect(d.paragraphs[0].text).toBe('A casa & o casamento.');
		const at = d.locate(0, 'casa', 'pt')!;
		expect(at).toEqual({ start: 2, end: 6 });
		expect(d.locate(0, 'casamento', 'pt')).toEqual({ start: 11, end: 20 });
		const out = d.render([{ para: 0, ...at, html: '<a href="#lb:casa|house">house</a>' }]);
		expect(out).toBe(
			doc('<p class="x">A <a href="#lb:casa|house">house</a> &amp; o casamento.<!-- c --></p><p>Fim &#8212; casa.</p>')
		);
		expect(d.render([])).toBe(xml);
	});

	test('não troca dentro de link, sup ou atravessando tags', () => {
		const d = parseXhtml(doc('<p>Ver <a href="n.xhtml">casa</a><sup>1</sup> bo<b>nita</b> casa.</p>'));
		expect(d.paragraphs[0].text).toBe('Ver casa1 bonita casa.');
		expect(d.locate(0, 'casa', 'pt')).toEqual({ start: 17, end: 21 });
		expect(d.locate(0, 'bonita', 'pt')).toBeNull();
	});

	test('respeita as faixas já usadas', () => {
		const d = parseXhtml(doc('<p>casa e casa</p>'));
		expect(d.locate(0, 'casa', 'pt', [{ start: 0, end: 4 }])).toEqual({ start: 7, end: 11 });
		expect(
			d.locate(0, 'casa', 'pt', [
				{ start: 0, end: 4 },
				{ start: 7, end: 11 }
			])
		).toBeNull();
	});

	test('o resultado continua XML bem formado', () => {
		const d = parseXhtml(doc('<p>Ele disse &lt;oi&gt; à casa.</p>'));
		const at = d.locate(0, 'casa', 'pt')!;
		const out = d.render([{ para: 0, ...at, html: '<a href="#lb:casa|&quot;h&quot;">casa</a>' }]);
		const parsed = new DOMParserLike(out);
		expect(parsed.ok).toBe(true);
	});
});

/** Checagem simples de aninhamento (o bun não tem DOMParser). */
class DOMParserLike {
	ok: boolean;
	constructor(xml: string) {
		const stack: string[] = [];
		let ok = true;
		const body = xml.replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->/g, '');
		for (const m of body.matchAll(/<(\/?)([a-zA-Z][\w:-]*)[^>]*?(\/?)>/g)) {
			if (m[3]) continue;
			if (m[1]) ok = ok && stack.pop() === m[2];
			else stack.push(m[2]);
		}
		ok = ok && stack.length === 0 && !/&(?!amp;|lt;|gt;|quot;|apos;|#)/.test(body);
		this.ok = ok;
	}
}
