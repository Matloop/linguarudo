// EPUB mínimo para os testes do blend.
import { strToU8, zipSync, type Zippable } from 'fflate';

export function chapterXhtml(title: string, body: string): string {
	return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="pt">
<head><title>${title}</title></head>
<body>
<h1>${title}</h1>
${body}
</body>
</html>`;
}

export function makeEpub(
	chapters: { title: string; body: string }[],
	meta = { title: 'O alienista', author: 'Machado de Assis', language: 'pt-BR' }
): Uint8Array {
	const items = chapters
		.map((_, i) => `<item id="c${i}" href="text/c${i}.xhtml" media-type="application/xhtml+xml"/>`)
		.join('\n');
	const refs = chapters.map((_, i) => `<itemref idref="c${i}"/>`).join('\n');
	const nav = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Sumário</title></head>
<body><nav epub:type="toc"><ol>${chapters
		.map((c, i) => `<li><a href="text/c${i}.xhtml">${c.title}</a></li>`)
		.join('')}</ol></nav></body></html>`;
	const files: Zippable = {
		mimetype: [strToU8('application/epub+zip'), { level: 0 }],
		'META-INF/container.xml': strToU8(
			`<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
		),
		'OEBPS/content.opf': strToU8(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="id">teste</dc:identifier>
<dc:title>${meta.title}</dc:title>
<dc:creator>${meta.author}</dc:creator>
<dc:language>${meta.language}</dc:language>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${items}
</manifest>
<spine>
<itemref idref="nav"/>
${refs}
</spine>
</package>`),
		'OEBPS/nav.xhtml': strToU8(nav)
	};
	chapters.forEach((c, i) => {
		files[`OEBPS/text/c${i}.xhtml`] = strToU8(chapterXhtml(c.title, c.body));
	});
	return zipSync(files);
}
