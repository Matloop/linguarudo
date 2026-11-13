import { describe, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { buildBlend, chapterInfos, chapterParts, partWords, type Candidate } from './book.ts';
import { openEpub } from './epub.ts';
import { makeEpub } from './test-epub.ts';

const c = (para: number, form: string, target: string, lemma = target): Candidate => ({
	para,
	form,
	target,
	lemma,
	translation: form,
	note: ''
});

describe('livro', () => {
	const bytes = makeEpub([
		{ title: 'Capítulo I', body: '<p>A casa era grande e o rio passava perto.</p><p>Então Simão Bacamarte olhou a <a href="n.xhtml">casa</a>.</p>' },
		{ title: 'Capítulo II', body: '<p>No dia seguinte a casa amanheceu fria.</p>' }
	]);

	test('abre metadados, spine e títulos', () => {
		const epub = openEpub(bytes);
		expect(epub.title).toBe('O alienista');
		expect(epub.author).toBe('Machado de Assis');
		expect(epub.language).toBe('pt-BR');
		expect(epub.spine.map((s) => s.nav)).toEqual([true, false, false]);
		const infos = chapterInfos(epub, 'pt');
		expect(infos.map((i) => i.title)).toEqual(['Sumário', 'Capítulo I', 'Capítulo II']);
		expect(infos[0].words).toBe(0);
		expect(infos[1].words).toBeGreaterThan(10);
	});

	test('pedaços cabem no tamanho', () => {
		expect(chapterParts([100, 100, 100, 500, 10], 250)).toEqual([
			[0, 2],
			[2, 3],
			[3, 4],
			[4, 5]
		]);
		expect(chapterParts([], 250)).toEqual([]);
		expect(partWords(0.1)).toBe(267);
		expect(partWords(0.5)).toBe(100);
		expect(partWords(0.01)).toBe(600);
	});

	test('gera EPUB válido só com os links escolhidos', () => {
		const epub = openEpub(bytes);
		const { bytes: out, links } = buildBlend(
			epub,
			[
				{
					spine: 1,
					candidates: [
						c(0, 'casa', 'casa'),
						c(0, 'rio', 'fiume'),
						c(1, 'Simão', 'Simone'), // nome próprio: fica
						c(1, 'casa', 'casa'), // só dentro do link: fica
						c(0, 'inexistente', 'x')
					]
				}
			],
			{ bookLanguage: 'pt', language: 'it', coverage: 0.5 }
		);
		expect(links).toBe(1);
		const files = unzipSync(out);
		expect(Object.keys(files)[0]).toBe('mimetype');
		const ch1 = strFromU8(files['OEBPS/text/c0.xhtml']);
		expect(ch1).toContain('<a href="#lb:fiume|rio">fiume</a>');
		expect(ch1).not.toContain('Simone');
		expect(ch1).toContain('<h1>Capítulo I</h1>');
		// Fora do intervalo: os bytes não mudam.
		expect(strFromU8(files['OEBPS/text/c1.xhtml'])).toBe(strFromU8(epub.files['OEBPS/text/c1.xhtml']));
		// Reabre o resultado.
		expect(openEpub(out).spine).toHaveLength(3);
	});
});
