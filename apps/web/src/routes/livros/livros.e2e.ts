import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { strToU8, unzipSync, strFromU8, zipSync } from 'fflate';
import { koHash } from '../../lib/blend/kohash.ts';
import { login, SUPABASE_URL } from '../../e2e/auth.ts';

// Envio de um EPUB pequeno pela tela, configuração e lista. Com LIVROS_E2E_IA=1 também gera
// o blend com a IA de verdade (Groq/Gemini do .env) e confere os links #lb: no EPUB baixado.

const PARAGRAPHS = [
	[
		'A casa ficava no alto do morro, perto de uma árvore muito velha. Todas as manhãs a menina abria a janela e olhava o campo verde lá embaixo.',
		'Ela gostava de ouvir os pássaros e de sentir o vento frio no rosto. Depois descia a escada devagar, porque a madeira fazia barulho.',
		'Na cozinha, a avó preparava o café e cortava o pão em fatias grossas. O cheiro enchia a casa inteira e chegava até a rua.'
	],
	[
		'À tarde o céu ficou escuro e começou a chover. A menina correu para dentro com os sapatos molhados e o cabelo cheio de água.',
		'A avó acendeu o fogo e contou uma história antiga sobre um barco que atravessou o mar durante uma noite de tempestade.',
		'Quando a chuva parou, as duas saíram para ver a lua. A estrada brilhava e o rio fazia um som tranquilo entre as pedras.'
	]
];

function makeEpub(): Uint8Array {
	const titles = ['A casa no morro', 'A chuva'];
	const chapter = (i: number) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="pt" lang="pt">
<head><title>${titles[i]}</title></head>
<body><h1>${titles[i]}</h1>
${PARAGRAPHS[i].map((p) => `<p>${p}</p>`).join('\n')}
</body></html>`;
	return zipSync(
		{
			mimetype: [strToU8('application/epub+zip'), { level: 0 }],
			'META-INF/container.xml': strToU8(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`),
			'OEBPS/content.opf': strToU8(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">urn:uuid:5b1d0c2e-2222-4a2b-9c3d-000000000002</dc:identifier>
<dc:title>Manhãs no morro</dc:title>
<dc:creator>Autora de Teste</dc:creator>
<dc:language>pt-BR</dc:language>
<meta property="dcterms:modified">2026-11-13T00:00:00Z</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
<item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/>
</manifest>
<spine><itemref idref="nav"/><itemref idref="c1"/><itemref idref="c2"/></spine>
</package>`),
			'OEBPS/nav.xhtml': strToU8(`<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Sumário</title></head>
<body><nav epub:type="toc"><ol>
<li><a href="c1.xhtml">${titles[0]}</a></li>
<li><a href="c2.xhtml">${titles[1]}</a></li>
</ol></nav></body></html>`),
			'OEBPS/c1.xhtml': strToU8(chapter(0)),
			'OEBPS/c2.xhtml': strToU8(chapter(1))
		},
		{ level: 6, mtime: new Date('2026-11-13') }
	);
}

test('envia um EPUB, configura o blend e vê o livro na lista', async ({ page }) => {
	test.setTimeout(process.env.LIVROS_E2E_IA ? 240_000 : 60_000);
	await login(page, undefined, ['it']);
	await page.goto('/livros');
	await expect(page.getByRole('heading', { name: 'Nenhum livro ainda' })).toBeVisible();

	await page.getByTestId('enviar-epub').click();
	await page.getByTestId('arquivo-epub').setInputFiles({
		name: 'manhas.epub',
		mimeType: 'application/epub+zip',
		buffer: Buffer.from(makeEpub())
	});
	await expect(page).toHaveURL(/\/livros\/[0-9a-f-]{36}$/, { timeout: 15_000 });
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Manhãs no morro');
	// O sumário (nav) não conta como capítulo.
	await expect(page.getByTestId('resumo')).toHaveText(/^2 capítulos, \d+ palavras$/);
	await expect(page.getByLabel('Língua do livro')).toHaveValue('pt-BR');

	// Intervalo: só o segundo capítulo.
	await page.getByRole('button', { name: 'Intervalo de capítulos' }).click();
	await page.getByRole('combobox', { name: 'Do capítulo' }).click();
	await page.getByRole('option', { name: 'A chuva' }).click();
	await expect(page.getByTestId('resumo')).toHaveText(/^1 capítulo, \d+ palavras$/);

	if (process.env.LIVROS_E2E_IA) {
		await page.getByTestId('gerar').click();
		await expect(page.getByRole('link', { name: 'Ler' })).toBeVisible({ timeout: 200_000 });
		await expect(page.getByTestId('estado')).toHaveText('1 capítulo pronto');
		const href = await page.getByRole('link', { name: 'Baixar EPUB' }).getAttribute('href');
		const res = await page.request.get(href!);
		expect(res.ok()).toBe(true);
		expect(res.headers()['content-disposition'] ?? '').toContain('.epub');
		const files = unzipSync(new Uint8Array(await res.body()));
		const c1 = strFromU8(files['OEBPS/c1.xhtml']);
		const c2 = strFromU8(files['OEBPS/c2.xhtml']);
		// Fora do intervalo fica igual; dentro ganha links #lb:.
		expect(c1).not.toContain('#lb:');
		const links = [...c2.matchAll(/<a href="#lb:([^"]*)">([^<]*)<\/a>/g)];
		console.log(`blend: ${links.length} links`, links.map((m) => `${m[2]} ← ${m[1]}`));
		expect(links.length).toBeGreaterThan(0);
		expect(c2).toContain('<h1>A chuva</h1>');
	} else {
		await page.getByTestId('gerar').waitFor();
	}

	await page.goto('/livros');
	const book = page.getByTestId('livro');
	await expect(book).toHaveCount(1);
	await expect(book).toContainText('Manhãs no morro');
	await expect(book).toContainText('Autora de Teste');
	await expect(book).toContainText('PT-IT');
	await expect(book.getByRole('checkbox', { name: 'No aparelho' })).toBeChecked();

	await book.getByRole('checkbox', { name: 'No aparelho' }).click();
	await expect(page.getByText('Sai do aparelho no próximo sync')).toBeVisible();
	await page.reload();
	await expect(page.getByTestId('livro').getByRole('checkbox', { name: 'No aparelho' })).not.toBeChecked();

	page.once('dialog', (d) => d.accept());
	await page.getByRole('button', { name: 'Apagar Manhãs no morro' }).click();
	await expect(page.getByRole('heading', { name: 'Nenhum livro ainda' })).toBeVisible();
});

/** Token e id da sessão da página, para semear como a própria pessoa (RLS de verdade). */
async function sessionOf(page: Page) {
	const parts = (await page.context().cookies())
		.filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name))
		.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
	const raw = parts.map((c) => c.value).join('');
	const json = raw.startsWith('base64-')
		? Buffer.from(raw.slice(7), 'base64url').toString()
		: decodeURIComponent(raw);
	const { access_token, user } = JSON.parse(json) as { access_token: string; user: { id: string } };
	return { token: access_token, userId: user.id };
}

test('aparelho lista o livro, baixa pela URL assinada e manda a posição', async ({ page }) => {
	const request = page.request;
	const started = await request.post('/api/v1/sync/pair/start', {
		data: { protocol: 1, deviceName: 'X4 Pro', deviceModel: 'xteink-x4-pro', firmware: 'linguetta/1.0' }
	});
	const { deviceCode, userCode } = await started.json();
	await login(page, undefined, ['it']);
	await page.goto(`/parear?code=${userCode}`);
	await page.getByRole('button', { name: 'Aprovar' }).click();
	await expect(page.getByRole('heading', { name: 'Pronto, aparelho conectado' })).toBeVisible();
	const { token } = await (
		await request.post('/api/v1/sync/pair/poll', { data: { protocol: 1, deviceCode } })
	).json();
	const headers = { authorization: `Bearer ${token}` };

	// Livro enviado pela tela; a versão 1 é semeada como a pessoa (sem IA).
	await page.goto('/livros');
	await page.getByTestId('enviar-epub').click();
	const epub = makeEpub();
	await page.getByTestId('arquivo-epub').setInputFiles({
		name: 'manhas.epub',
		mimeType: 'application/epub+zip',
		buffer: Buffer.from(epub)
	});
	await expect(page).toHaveURL(/\/livros\/[0-9a-f-]{36}$/, { timeout: 15_000 });
	const bookId = page.url().split('/').at(-1)!;
	const s = await sessionOf(page);
	const user = { apikey: process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY!, authorization: `Bearer ${s.token}` };
	const path = `${s.userId}/${bookId}/v1.epub`;
	const hash = koHash(epub);
	const up = await fetch(`${SUPABASE_URL}/storage/v1/object/books/${path}`, {
		method: 'POST',
		headers: { ...user, 'content-type': 'application/epub+zip' },
		body: Buffer.from(epub)
	});
	expect(up.ok, await up.clone().text()).toBe(true);
	const json = { ...user, 'content-type': 'application/json' };
	const ver = await fetch(`${SUPABASE_URL}/rest/v1/book_versions`, {
		method: 'POST',
		headers: json,
		body: JSON.stringify({ book_id: bookId, user_id: s.userId, version: 1, path, ko_hash: hash, size: epub.byteLength })
	});
	expect(ver.ok, await ver.clone().text()).toBe(true);
	const cur = await fetch(`${SUPABASE_URL}/rest/v1/books?id=eq.${bookId}`, {
		method: 'PATCH',
		headers: json,
		body: JSON.stringify({ current_version: 1 })
	});
	expect(cur.ok).toBe(true);

	const list = await request.get('/api/v1/sync/books?protocol=1', { headers });
	expect(list.status()).toBe(200);
	const body = await list.json();
	expect(body.books).toHaveLength(1);
	expect(body.books[0]).toMatchObject({
		id: bookId,
		title: 'Manhãs no morro',
		author: 'Autora de Teste',
		bookLanguage: 'pt-BR',
		language: 'it',
		file: 'Manhãs no morro.PT-IT.epub',
		version: 1,
		size: epub.byteLength,
		koHash: hash,
		progress: null
	});
	// URL assinada sem sessão nenhuma: baixa o mesmo arquivo.
	const file = await fetch(body.books[0].downloadUrl);
	expect(file.status).toBe(200);
	expect(new Uint8Array(await file.arrayBuffer())).toEqual(epub);

	const push = async (ops: unknown[]) =>
		(
			await request.post('/api/v1/sync/push', {
				headers,
				data: { protocol: 1, deviceNow: new Date().toISOString(), ops }
			})
		).json();
	const op = (at: string, spine: number, h = hash) => ({
		clientId: randomUUID(),
		type: 'progress',
		at,
		language: 'it',
		koHash: h,
		spine,
		chapterPercent: 40,
		percent: 55.5
	});
	const now = Date.now();
	const { results } = await push([
		op(new Date(now - 60_000).toISOString(), 2),
		op(new Date(now - 120_000).toISOString(), 1),
		op(new Date(now).toISOString(), 1, 'f'.repeat(32))
	]);
	expect(results[0]).toMatchObject({ status: 'applied', bookId, current: true });
	expect(results[1]).toMatchObject({ status: 'applied', bookId, current: false });
	expect(results[2]).toMatchObject({ status: 'dropped', reason: 'unknown_book' });

	const after = await (await request.get('/api/v1/sync/books?protocol=1', { headers })).json();
	expect(after.books[0].progress).toMatchObject({ spine: 2, chapterPercent: 40, percent: 55.5, source: 'device' });

	// Fora do aparelho: some da lista.
	await page.goto('/livros');
	await page.getByTestId('livro').getByRole('checkbox', { name: 'No aparelho' }).click();
	await expect(page.getByText('Sai do aparelho no próximo sync')).toBeVisible();
	const off = await (await request.get('/api/v1/sync/books?protocol=1', { headers })).json();
	expect(off.books).toHaveLength(0);
});
