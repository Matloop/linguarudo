import { expect, test, type Page } from '@playwright/test';
import { login, SUPABASE_URL, switchLanguage } from '../../e2e/auth.ts';

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

	const me = await api(page.request, token).get('/api/v1/me');
	expect(me.status()).toBe(200);
	expect(await me.json()).toEqual({
		email: expect.stringMatching(/@linguetta\.test$/),
		uiLanguage: 'pt',
		nativeLanguage: 'pt',
		studyLanguages: ['en', 'it']
	});

	await page.reload();
	await expect(item).not.toContainText('Último uso: nunca');

	await item.getByRole('button', { name: /Revogar/ }).click();
	await expect(page.getByText('Nenhum token ainda.')).toBeVisible();
	expect((await api(page.request, token).get('/api/v1/me')).status()).toBe(401);
});

test('API v1: salvar com encontro e obra, repetir, listar com prefer, visto e CORS', async ({
	page
}) => {
	await login(page);
	const token = await newToken(page);
	const client = api(page.request, token);

	// Sem token / token errado.
	expect((await api(page.request, null).get('/api/v1/me')).status()).toBe(401);
	expect((await api(page.request, 'lr_' + 'x'.repeat(43)).get('/api/v1/me')).status()).toBe(401);

	// Rota que não existe (as de antes da v1 inclusive): 404 em JSON, com CORS.
	for (const path of ['/api/me', '/api/words', '/api/v1/nada']) {
		const missing = await client.get(path);
		expect(missing.status()).toBe(404);
		expect(await missing.json()).toEqual({ message: 'Rota não encontrada.' });
	}

	// CORS: preflight do fork passa; origem estranha não ganha cabeçalho.
	const pre = await page.request.fetch('/api/v1/items', {
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
	const evil = await api(page.request, token, 'https://evil.example').get('/api/v1/me');
	expect(evil.headers()['access-control-allow-origin']).toBeUndefined();
	const local = await api(page.request, token, 'http://localhost:8080').get('/api/v1/me');
	expect(local.headers()['access-control-allow-origin']).toBe('http://localhost:8080');

	const clientId = crypto.randomUUID();
	const festa = {
		language: 'it',
		lemma: 'festa',
		sense: 'festa, celebração',
		ipa: '/ˈfɛs.ta/',
		partOfSpeech: 'subst. fem.',
		encounter: {
			form: 'feste',
			sentence: 'Stasera ci sono tante feste nel quartiere.',
			highlight: 'feste',
			sense: 'festas',
			position: { seconds: 2530 },
			clientId
		},
		work: {
			kind: 'episodio',
			title: 'Kaguya',
			subtitle: 'T1E2',
			refs: { imdbId: 'tt1234567', season: 1, episode: 2 },
			language: 'ja'
		}
	};
	const save = await client.post('/api/v1/items', {
		items: [festa, { language: 'it', lemma: 'Festa' }, { language: 'it', lemma: '' }]
	});
	expect(save.status()).toBe(200);
	const { results } = await save.json();
	expect(results).toHaveLength(3);
	expect(results[0]).toMatchObject({
		ok: true,
		item: { language: 'it', lemma: 'festa', created: true, flashcard: { state: 0 } }
	});
	expect(results[0].item.encounterId).toEqual(expect.any(String));
	// Mesmo lema em outra caixa: o mesmo item, sem encontro novo.
	expect(results[1]).toMatchObject({
		ok: true,
		item: { id: results[0].item.id, created: false, encounterId: null }
	});
	expect(results[2]).toEqual({ ok: false, error: 'lemma vazio' });

	// Reenviar o mesmo clientId (retry offline) não duplica o encontro.
	const retry = await client.post('/api/v1/items', { items: [festa] });
	expect((await retry.json()).results[0].item).toMatchObject({
		created: false,
		encounterId: results[0].item.encounterId
	});

	// Em outro lote (Flashcards mostra as novas por ordem de criação: festa primeiro).
	await client.post('/api/v1/items', { items: [{ language: 'it', lemma: 'giorno' }] });

	expect((await client.post('/api/v1/items', { items: [] })).status()).toBe(400);
	expect((await client.post('/api/v1/items', 'não é json')).status()).toBe(400);

	const list = await client.get('/api/v1/items?language=it');
	const body = await list.json();
	expect(body.language).toBe('it');
	expect(body.items.map((i: { lemma: string }) => i.lemma).sort()).toEqual(['festa', 'giorno']);
	expect(body.items.find((i: { lemma: string }) => i.lemma === 'festa')).toMatchObject({
		sense: 'festa, celebração',
		status: 'ativo',
		mastered: false,
		prefer: false,
		flashcards: [{ kind: 'reconhecer', state: 0, stability: 0 }]
	});
	// Novos (state 0) não entram como preferidos.
	expect(body.preferWords).toEqual([]);
	expect((await client.get('/api/v1/items')).status()).toBe(400);
	expect((await client.get('/api/v1/items?language=en')).ok()).toBe(true);

	const seen = await client.post('/api/v1/items/seen', {
		language: 'it',
		lemmas: ['Festa', 'nada']
	});
	expect(await seen.json()).toEqual({ updated: 1 });
	// Visto não mexe no FSRS.
	const after = (await (await client.get('/api/v1/items?language=it')).json()).items;
	expect(after.find((i: { lemma: string }) => i.lemma === 'festa').flashcards[0]).toMatchObject({
		state: 0
	});

	// O item aparece em /palavras (italiano) com o encontro e em Flashcards com o destaque e a origem.
	await page.goto('/palavras');
	await switchLanguage(page, 'Italiano', 'IT');
	const row = page.getByRole('list', { name: 'Palavras' }).getByRole('link', { name: /festa/ });
	await expect(row).toContainText('festa, celebração');
	await row.click();
	const drawer = page.getByRole('region', { name: 'Detalhes de “festa”' });
	await expect(drawer).toContainText('Kaguya · T1E2, 42:10');
	await expect(drawer.locator('mark')).toHaveText('feste');

	await page.goto('/flashcards');
	const front = page.locator('section[aria-label="Frente do flashcard"]');
	await expect(front).toContainText('festa');
	await expect(front.locator('u')).toHaveText('feste');
	await expect(front).toContainText('Kaguya · T1E2, 42:10');
	await page.getByRole('button', { name: 'Mostrar resposta' }).click();
	await expect(page.locator('section[aria-label="Verso do flashcard"]')).toContainText(
		'festa, celebração'
	);
});
