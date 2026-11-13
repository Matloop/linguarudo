import { expect, test, type Frame, type Page } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';
import { blendHref } from '../../../../lib/blend/link.ts';
import { login, restAsUser, SUPABASE_URL } from '../../../../e2e/auth.ts';

// Livro de verdade no Supabase local: EPUB pequeno gerado aqui, enviado ao Storage e
// registrado como versão atual. O leitor abre, a pessoa toca no link do blend e salva.

const lb = (lemma: string, translation: string, note = '') => {
	const href = blendHref(lemma, translation, note);
	if (!href) throw new Error(`href inválido: ${lemma}`);
	return href;
};

const CHAPTERS = [
	{
		title: 'Capítulo 1',
		body: `<p>Era uma manhã clara. Ela olhou para o <a href="${lb('mare', 'mar', 'substantivo masculino')}">mare</a> por muito tempo. Depois voltou para casa.</p>
<p>No caminho comprou <a href="${lb('pane', 'pão')}">pane</a> e leite.</p>`
	},
	{
		title: 'Capítulo 2',
		body: `<p>À noite a <a href="${lb('luna', 'lua')}">luna</a> apareceu sobre o telhado.</p>`
	}
];

function makeEpub(): Uint8Array {
	const xhtml = (title: string, body: string) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="pt" lang="pt">
<head><title>${title}</title></head>
<body><h1>${title}</h1>
${body}
</body></html>`;
	const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
		mimetype: [strToU8('application/epub+zip'), { level: 0 }],
		'META-INF/container.xml': strToU8(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`),
		'OEBPS/content.opf': strToU8(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">urn:uuid:7c0f6b1e-1111-4a2b-9c3d-000000000001</dc:identifier>
<dc:title>O mar de manhã</dc:title>
<dc:language>pt</dc:language>
<meta property="dcterms:modified">2026-11-13T00:00:00Z</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
<item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/>
</manifest>
<spine><itemref idref="c1"/><itemref idref="c2"/></spine>
</package>`),
		'OEBPS/nav.xhtml': strToU8(`<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Sumário</title></head>
<body><nav epub:type="toc"><ol>
<li><a href="c1.xhtml">Capítulo 1</a></li>
<li><a href="c2.xhtml">Capítulo 2</a></li>
</ol></nav></body></html>`),
		'OEBPS/c1.xhtml': strToU8(xhtml(CHAPTERS[0].title, CHAPTERS[0].body)),
		'OEBPS/c2.xhtml': strToU8(xhtml(CHAPTERS[1].title, CHAPTERS[1].body))
	};
	// mimetype primeiro e sem compressão, como o EPUB pede.
	return zipSync(files, { level: 6, mtime: new Date('2026-11-13') }) as Uint8Array;
}

/** Token da sessão da página, para semear como a própria pessoa (RLS de verdade). */
async function sessionOf(page: Page) {
	const parts = (await page.context().cookies())
		.filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name))
		.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
	const raw = parts.map((c) => c.value).join('');
	const json = raw.startsWith('base64-')
		? Buffer.from(raw.slice(7), 'base64url').toString()
		: decodeURIComponent(raw);
	const { access_token, user } = JSON.parse(json) as {
		access_token: string;
		user: { id: string };
	};
	return { token: access_token, userId: user.id };
}

async function seedBook(page: Page): Promise<string> {
	const { token, userId } = await sessionOf(page);
	const headers = {
		apikey: process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
		authorization: `Bearer ${token}`
	};
	const json = { ...headers, 'content-type': 'application/json' };
	const epub = makeEpub();
	const id = crypto.randomUUID();

	const created = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_book`, {
		method: 'POST',
		headers: json,
		body: JSON.stringify({
			p_id: id,
			p_title: 'O mar de manhã',
			p_author: 'Autora de Teste',
			p_book_language: 'pt',
			p_language: 'it',
			p_original_size: epub.byteLength,
			p_chapters: CHAPTERS.map((c, spine) => ({ spine, title: c.title, words: 30 }))
		})
	});
	expect(created.ok, await created.clone().text()).toBe(true);

	const path = `${userId}/${id}/v1.epub`;
	const up = await fetch(`${SUPABASE_URL}/storage/v1/object/books/${path}`, {
		method: 'POST',
		headers: { ...headers, 'content-type': 'application/epub+zip' },
		body: new Blob([epub as Uint8Array<ArrayBuffer>])
	});
	expect(up.ok, await up.clone().text()).toBe(true);

	const version = await fetch(`${SUPABASE_URL}/rest/v1/book_versions`, {
		method: 'POST',
		headers: json,
		body: JSON.stringify({
			book_id: id,
			user_id: userId,
			version: 1,
			path,
			ko_hash: '0123456789abcdef0123456789abcdef',
			size: epub.byteLength
		})
	});
	expect(version.ok, await version.clone().text()).toBe(true);

	const current = await fetch(`${SUPABASE_URL}/rest/v1/books?id=eq.${id}`, {
		method: 'PATCH',
		headers: json,
		body: JSON.stringify({ current_version: 1 })
	});
	expect(current.ok, await current.clone().text()).toBe(true);
	return id;
}

/** O capítulo aberto (iframe dentro do shadow fechado do foliate). */
async function chapterWith(page: Page, text: string): Promise<Frame> {
	let found: Frame | undefined;
	await expect(async () => {
		for (const f of page.frames()) {
			if (f === page.mainFrame()) continue;
			if (await f.getByText(text).count().catch(() => 0)) {
				found = f;
				return;
			}
		}
		throw new Error(`capítulo com "${text}" não abriu`);
	}).toPass({ timeout: 15_000 });
	return found!;
}

type Item = {
	id: string;
	lemma: string;
	sense: string;
	note: string;
	language: string;
	seen_count: number;
	encounters: {
		form: string;
		sentence: string;
		origin: string;
		work_id: string | null;
		position: { chapter?: string; spine?: number; percent?: number } | null;
	}[];
};

test('toca no link do blend, salva a palavra e ela entra no banco com a frase', async ({
	page
}) => {
	await login(page);
	const bookId = await seedBook(page);
	const [book] = await restAsUser<{ work_id: string }[]>(
		page,
		`books?id=eq.${bookId}&select=work_id`
	);

	await page.goto(`/livros/${bookId}/ler`);
	await expect(page.getByRole('heading', { name: 'O mar de manhã' })).toBeVisible();
	const chapter = await chapterWith(page, 'Era uma manhã clara');
	await expect(page.getByText('Abrindo o livro…')).toHaveCount(0);

	// Tocar no link não navega: abre o cartão.
	await chapter.locator('a', { hasText: 'mare' }).click();
	const card = page.getByTestId('cartao-palavra');
	await expect(card).toBeVisible();
	await expect(card).toContainText('mare');
	await expect(card).toContainText('mar');
	await expect(card).toContainText('substantivo masculino');
	await expect(page).toHaveURL(new RegExp(`/livros/${bookId}/ler$`));

	await card.getByRole('button', { name: 'Salvar' }).click();
	await expect(card.getByText('Salvo')).toBeVisible();
	await expect(card.getByRole('button', { name: 'Desfazer' })).toBeVisible();

	const items = await restAsUser<Item[]>(
		page,
		'items?lemma=eq.mare&deleted_at=is.null&select=id,lemma,sense,note,language,seen_count,encounters(form,sentence,origin,work_id,position)'
	);
	expect(items).toHaveLength(1);
	const [item] = items;
	expect(item).toMatchObject({
		lemma: 'mare',
		sense: 'mar',
		note: 'substantivo masculino',
		language: 'it'
	});
	expect(item.encounters).toHaveLength(1);
	expect(item.encounters[0]).toMatchObject({
		form: 'mare',
		sentence: 'Ela olhou para o mare por muito tempo.',
		origin: 'leitor',
		work_id: book.work_id
	});
	expect(item.encounters[0].position).toMatchObject({ chapter: 'Capítulo 1', spine: 0 });

	// Tocar de novo numa palavra que já está no banco: "No banco" e conta mais uma vista.
	const seenBefore = item.seen_count;
	await page.keyboard.press('Escape');
	await expect(card).toHaveCount(0);
	await chapter.locator('a', { hasText: 'mare' }).click();
	await expect(card.getByText('No banco')).toBeVisible();
	await expect(card).toContainText('Nova, ainda sem revisão');
	await expect(card.getByRole('button', { name: 'Salvar' })).toHaveCount(0);
	await expect(async () => {
		const [seen] = await restAsUser<Item[]>(page, `items?id=eq.${item.id}&select=seen_count`);
		expect(seen.seen_count).toBe(seenBefore + 1);
	}).toPass();

	// Desfazer só vale logo depois de salvar: outra palavra, salva e desfeita.
	await card.getByRole('button', { name: 'Fechar' }).click();
	await chapter.locator('a', { hasText: 'pane' }).click();
	await card.getByRole('button', { name: 'Salvar' }).click();
	await card.getByRole('button', { name: 'Desfazer' }).click();
	await expect(card.getByRole('button', { name: 'Salvar' })).toBeVisible();
	expect(
		await restAsUser<Item[]>(page, 'items?lemma=eq.pane&deleted_at=is.null&select=id')
	).toHaveLength(0);
});

test('a posição vai para o servidor e o livro reabre nela', async ({ page }) => {
	await login(page);
	const bookId = await seedBook(page);

	await page.goto(`/livros/${bookId}/ler`);
	await chapterWith(page, 'Era uma manhã clara');
	await expect(page.getByText('Abrindo o livro…')).toHaveCount(0);

	// Pelo sumário até o capítulo 2: trocar de capítulo grava na hora.
	await page.getByRole('button', { name: 'Sumário' }).click();
	await page.getByRole('button', { name: 'Capítulo 2' }).click();
	await chapterWith(page, 'apareceu sobre o telhado');
	await expect(async () => {
		const [p] = await restAsUser<{ spine: number; source: string }[]>(
			page,
			`book_progress?book_id=eq.${bookId}&select=spine,source`
		);
		expect(p).toMatchObject({ spine: 1, source: 'web' });
	}).toPass();

	// Uma posição mais antiga que a guardada não vence.
	const old = await page.request.post(`/livros/${bookId}/ler/posicao`, {
		data: { spine: 0, chapterPercent: 0, percent: 0, at: '2020-01-01T00:00:00Z' }
	});
	expect(await old.json()).toEqual({ current: false });

	await page.reload();
	await chapterWith(page, 'apareceu sobre o telhado');
	await expect(page.getByText('Capítulo 2').first()).toBeVisible();
});
