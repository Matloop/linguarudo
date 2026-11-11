import { describe, expect, test } from 'bun:test';
import {
	clozeCount,
	fichaHtmlToText,
	fichaPlainText,
	fichaTextToHtml,
	flashcardsFor,
	parseFichaInput,
	renderCloze,
	sanitizeFichaHtml
} from './fichas.ts';
import { parseTags } from './tags.ts';

describe('sanitizeFichaHtml', () => {
	test('mantém b, i e br; strong e em viram b e i', () => {
		expect(sanitizeFichaHtml('<b>a</b> <strong>b</strong> <i>c</i> <em>d</em><br/>e')).toBe(
			'<b>a</b> <b>b</b> <i>c</i> <i>d</i><br>e'
		);
	});

	test('tira atributos e tags desconhecidas, guardando o texto', () => {
		expect(sanitizeFichaHtml('<b onclick="x()">a</b><span style="color:red">b</span>')).toBe(
			'<b>a</b>b'
		);
		expect(sanitizeFichaHtml('<a href="javascript:alert(1)">link</a>')).toBe('link');
		expect(sanitizeFichaHtml('<img src=x onerror=alert(1)>oi')).toBe('oi');
		expect(sanitizeFichaHtml('<b title="a>b">x</b>')).toBe('<b>x</b>');
	});

	test('script e style somem com o conteúdo', () => {
		expect(sanitizeFichaHtml('a<script>alert(1)</script>b<style>p{}</style>c')).toBe('abc');
		expect(sanitizeFichaHtml('a<script>alert(1)')).toBe('a');
	});

	test('escapa < e & soltos, mas guarda entidades', () => {
		expect(sanitizeFichaHtml('a < b & c &amp; &nbsp; &#233;')).toBe(
			'a &lt; b &amp; c &amp; &nbsp; &#233;'
		);
		expect(sanitizeFichaHtml('x <= y > z')).toBe('x &lt;= y &gt; z');
		expect(sanitizeFichaHtml('<<b>x</b>')).toBe('&lt;<b>x</b>');
	});

	test('fecha tags abertas e ignora fechamentos soltos', () => {
		expect(sanitizeFichaHtml('<b>a<i>b')).toBe('<b>a<i>b</i></b>');
		expect(sanitizeFichaHtml('a</b>b</i>')).toBe('ab');
		expect(sanitizeFichaHtml('<b>a<i>b</b>c</i>')).toBe('<b>a<i>b</i></b><i>c</i>');
	});

	test('blocos viram quebra; comentários somem; pontas limpas', () => {
		expect(sanitizeFichaHtml('<div>um</div><div>dois</div>')).toBe('um<br>dois');
		expect(sanitizeFichaHtml('<!-- x -->oi<br><br>')).toBe('oi');
		expect(sanitizeFichaHtml('<b></b>oi')).toBe('oi');
	});

	test('é idempotente', () => {
		const once = sanitizeFichaHtml('<p>a & <b>b<i>c</p> <x>"d"</x> < e');
		expect(sanitizeFichaHtml(once)).toBe(once);
	});
});

test('texto do formulário vai e volta', () => {
	const html = fichaTextToHtml('Passato de <b>andare</b>\r\n(io)');
	expect(html).toBe('Passato de <b>andare</b><br>(io)');
	expect(fichaHtmlToText(html)).toBe('Passato de <b>andare</b>\n(io)');
	expect(fichaPlainText(html)).toBe('Passato de andare (io)');
	expect(fichaPlainText('a &lt; b &amp; c')).toBe('a < b & c');
});

describe('lacunas', () => {
	const html = 'Ieri {{c1::siamo}} andati {{c2::al mare::lugar}} {{c1::ieri}}';

	test('conta pelo maior número', () => {
		expect(clozeCount(html)).toBe(2);
		expect(clozeCount('sem lacuna')).toBe(0);
		expect(clozeCount('{{c3::x}}')).toBe(3);
	});

	test('esconde a lacuna pedida e mostra as outras', () => {
		expect(renderCloze(html, 1, false)).toBe(
			'Ieri <span class="cloze">[…]</span> andati al mare <span class="cloze">[…]</span>'
		);
		expect(renderCloze(html, 2, false)).toBe(
			'Ieri siamo andati <span class="cloze">[lugar]</span> ieri'
		);
		expect(renderCloze(html, 2, true)).toBe(
			'Ieri siamo andati <span class="cloze open">al mare</span> ieri'
		);
	});

	test('a ficha de lacunas gera um flashcard por lacuna', () => {
		expect(flashcardsFor({ front: html, reverse: false })).toBe(2);
		expect(flashcardsFor({ front: 'a', reverse: true })).toBe(2);
		expect(flashcardsFor({ front: 'a', reverse: false })).toBe(1);
	});
});

test('parseTags tira vazias e repetidas', () => {
	expect(parseTags(' verbos, gramática ,, Verbos , a  b ')).toEqual(['verbos', 'gramática', 'a b']);
	expect(parseTags(['x', 'x', ' '])).toEqual(['x']);
});

describe('parseFichaInput', () => {
	test('aceita uma ficha válida', () => {
		const r = parseFichaInput({
			language: 'it',
			front: 'oi',
			back: 'olá',
			reverse: 'on',
			tags: 'a, b'
		});
		expect(r).toEqual({
			ok: true,
			value: { language: 'it', front: 'oi', back: 'olá', reverse: true, tags: ['a', 'b'] }
		});
	});

	test('pede frente, idioma e verso para o inverso', () => {
		const r = parseFichaInput({ language: '', front: ' ', back: '', reverse: 'on' });
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(Object.keys(r.errors).sort()).toEqual(['back', 'front', 'language']);
	});

	test('limita tags', () => {
		const tags = Array.from({ length: 51 }, (_, i) => `t${i}`).join(',');
		const r = parseFichaInput({ language: 'it', front: 'a', tags });
		expect(r.ok ? null : r.errors.tags).toBe('Use no máximo 50 tags.');
	});
});
