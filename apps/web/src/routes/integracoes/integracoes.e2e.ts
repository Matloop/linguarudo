import { expect, test, type Page } from '@playwright/test';
import { login, SUPABASE_URL } from '../../e2e/auth.ts';

const FORK_ORIGIN = 'http://lingoblend.peario.xyz.localhost:8080';

async function newToken(page: Page, label?: string): Promise<string> {
	await page.goto('/integracoes');
	if (label) await page.getByLabel('Nome').fill(label);
	await page.getByRole('button', { name: 'Gerar token' }).click();
	const field = page.getByRole('textbox', { name: 'Token gerado' });
	await expect(field).toHaveValue(/^lr_/);
	return field.inputValue();
}

function api(request: Page['request'], token: string | null, origin = FORK_ORIGIN) {
	const headers: Record<string, string> = { origin };
	if (token) headers.authorization = `Bearer ${token}`;
	return {
		get: (path: string) => request.get(path, { headers }),
		post: (path: string, data: unknown) => request.post(path, { headers, data })
	};
}

test('sem login, /integracoes manda para /entrar', async ({ page }) => {
	await page.goto('/integracoes');
	await expect(page).toHaveURL(/\/entrar\?next=%2Fintegracoes$/);
});

test('anon não lê api_tokens nem chama a função interna', async () => {
	const key = process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;
	test.skip(!key, 'PUBLIC_SUPABASE_PUBLISHABLE_KEY não definido');
	const headers = {
		apikey: key!,
		authorization: `Bearer ${key}`,
		'content-type': 'application/json'
	};
	const read = await fetch(`${SUPABASE_URL}/rest/v1/api_tokens?select=*`, { headers });
	expect(read.ok).toBe(false);
	const owner = await fetch(`${SUPABASE_URL}/rest/v1/rpc/api_token_owner`, {
		method: 'POST',
		headers,
		body: JSON.stringify({ p_token: 'lr_' + 'x'.repeat(43) })
	});
	expect(owner.ok).toBe(false);
});

test('gerar token, mostrar uma vez, listar e revogar', async ({ page }) => {
	await login(page);
	await page
		.getByRole('navigation', { name: 'Principal' })
		.getByRole('link', { name: 'Integrações' })
		.click();
	await expect(page.getByRole('heading', { name: 'Integrações' })).toBeVisible();
	await expect(page.getByText('Nenhum token ainda.')).toBeVisible();

	const token = await newToken(page, 'Notebook');
	await expect(page.getByText('Este token não aparece de novo.')).toBeVisible();
	const item = page.getByRole('listitem').filter({ hasText: 'Notebook' });
	await expect(item).toContainText(`…${token.slice(-4)}`);
	await expect(item).toContainText('Último uso: nunca');

	// Recarregou: o token some, fica só a dica.
	await page.reload();
	await expect(page.getByRole('textbox', { name: 'Token gerado' })).toHaveCount(0);
	await expect(page.getByText(token)).toHaveCount(0);

	const me = await api(page.request, token).get('/api/me');
	expect(me.status()).toBe(200);
	expect((await me.json()).email).toMatch(/@linguarudo\.test$/);

	await page.reload();
	await expect(item).not.toContainText('Último uso: nunca');

	await item.getByRole('button', { name: /Revogar/ }).click();
	await expect(page.getByText('Nenhum token ainda.')).toBeVisible();
	expect((await api(page.request, token).get('/api/me')).status()).toBe(401);
});

test('API com token: salvar, pular duplicata, listar com prefer, visto e CORS', async ({
	page
}) => {
	await login(page);
	const token = await newToken(page);
	const client = api(page.request, token);

	// Sem token / token errado.
	expect((await api(page.request, null).get('/api/me')).status()).toBe(401);
	expect((await api(page.request, 'lr_' + 'x'.repeat(43)).get('/api/me')).status()).toBe(401);

	// CORS: preflight do fork passa; origem estranha não ganha cabeçalho.
	const pre = await page.request.fetch('/api/words', {
		method: 'OPTIONS',
		headers: {
			origin: FORK_ORIGIN,
			'access-control-request-method': 'POST',
			'access-control-request-headers': 'authorization, content-type'
		}
	});
	expect(pre.status()).toBe(204);
	expect(pre.headers()['access-control-allow-origin']).toBe(FORK_ORIGIN);
	expect(pre.headers()['access-control-allow-headers']).toMatch(/Authorization/);
	const evil = await api(page.request, token, 'https://evil.example').get('/api/me');
	expect(evil.headers()['access-control-allow-origin']).toBeUndefined();
	const local = await api(page.request, token, 'http://localhost:8080').get('/api/me');
	expect(local.headers()['access-control-allow-origin']).toBe('http://localhost:8080');

	const save = await client.post('/api/words', {
		words: [
			{
				term: 'festa',
				lang: 'it',
				translation: 'festas',
				context: 'Eu não quero só ir às feste.',
				contextHighlight: 'feste',
				meaning: 'festas, celebrações',
				ipa: '/ˈfɛs.ta/',
				pos: 'subst. fem.',
				example: 'Andiamo alla festa.',
				sourceTitle: 'Kaguya',
				sourceTimeS: 2530
			},
			{ term: 'Festa', lang: 'it' },
			{ term: '', lang: 'it' }
		]
	});
	expect(save.status()).toBe(200);
	const { results } = await save.json();
	expect(results.map((r: { status: string }) => r.status)).toEqual([
		'created',
		'duplicate',
		'invalid'
	]);
	expect(results[0]).toMatchObject({ term: 'festa', lang: 'it', state: 0 });

	// Em outro lote (o Revisar mostra as novas por ordem de criação: festa primeiro).
	await client.post('/api/words', { words: [{ term: 'giorno', lang: 'it' }] });

	// De novo: duplicada.
	const again = await client.post('/api/words', { words: [{ term: 'FESTA', lang: 'it' }] });
	expect((await again.json()).results[0].status).toBe('duplicate');

	expect((await client.post('/api/words', { words: [] })).status()).toBe(400);
	expect((await client.post('/api/words', 'não é json')).status()).toBe(400);

	const list = await client.get('/api/words?lang=it');
	const { words } = await list.json();
	expect(words.map((w: { term: string }) => w.term).sort()).toEqual(['festa', 'giorno']);
	// Novas (state 0) não entram como preferidas.
	expect(words.every((w: { prefer: boolean }) => w.prefer === false)).toBe(true);
	expect((await client.get('/api/words')).status()).toBe(400);
	expect((await client.get('/api/words?lang=en')).ok()).toBe(true);

	const seen = await client.post('/api/words/seen', { lang: 'it', terms: ['Festa', 'nada'] });
	expect(await seen.json()).toEqual({ updated: 1 });
	// Visto não mexe no FSRS.
	const after = (await (await client.get('/api/words?lang=it')).json()).words;
	expect(after.find((w: { term: string }) => w.term === 'festa')).toMatchObject({ state: 0 });

	// A palavra aparece em /palavras e no Revisar com o destaque da forma vista e a origem.
	await page.goto('/palavras');
	await expect(page.getByRole('listitem').filter({ hasText: 'festa' })).toContainText('festas');
	await page.goto('/revisar');
	await expect(page.getByRole('button', { name: /festa/ })).toBeVisible();
	await page.getByRole('button', { name: 'Mostrar resposta' }).click();
	const cartao = page.getByRole('region', { name: 'Cartão' });
	await expect(cartao.locator('mark')).toHaveText('feste');
	await expect(cartao).toContainText('Kaguya, 42:10');
	await expect(cartao.getByText('Origem: Stremio')).toBeAttached();
});
