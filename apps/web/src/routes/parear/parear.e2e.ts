import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { login, uniqueEmail } from '../../e2e/auth.ts';

// Sync do e-reader (docs/sync/CONTRACT.md): pareamento por código pela página /parear,
// depois push, snapshot e revogação, chamados como o aparelho chama.

type Start = {
	protocol: number;
	deviceCode: string;
	userCode: string;
	verificationUri: string;
	verificationUriComplete: string;
	expiresIn: number;
	interval: number;
};

async function start(request: APIRequestContext, deviceName = 'X4 Pro'): Promise<Start> {
	const res = await request.post('/api/v1/sync/pair/start', {
		data: {
			protocol: 1,
			deviceName,
			deviceModel: 'xteink-x4-pro',
			firmware: 'crossnext-linguetta/1.5.0'
		}
	});
	expect(res.status()).toBe(200);
	return res.json();
}

async function poll(request: APIRequestContext, deviceCode: string) {
	const res = await request.post('/api/v1/sync/pair/poll', { data: { protocol: 1, deviceCode } });
	expect(res.status()).toBe(200);
	return res.json();
}

function pathOf(url: string) {
	const u = new URL(url);
	return u.pathname + u.search;
}

function device(request: APIRequestContext, token: string) {
	const headers = { authorization: `Bearer ${token}` };
	return {
		push: async (ops: unknown[]) => {
			const res = await request.post('/api/v1/sync/push', {
				headers,
				data: { protocol: 1, deviceNow: new Date().toISOString(), ops }
			});
			return { status: res.status(), body: await res.json() };
		},
		snapshot: (query: string) =>
			request.get(`/api/v1/sync/snapshot?protocol=1&${query}`, { headers }),
		unpair: () => request.post('/api/v1/sync/unpair', { headers, data: { protocol: 1 } })
	};
}

function save(lemma: string, at = new Date().toISOString()) {
	return {
		clientId: randomUUID(),
		type: 'save',
		at,
		language: 'it',
		lemma,
		sense: 'sentido',
		encounter: {
			form: lemma,
			sentence: `Una frase con ${lemma}.`,
			position: { chapter: 'Prólogo', spine: 2, percent: 12.5 }
		},
		work: {
			kind: 'livro',
			koHash: 'a3f1c9e2b7d4068f15e2c3b4a5d6e7f8',
			title: 'O nome da rosa',
			author: 'Umberto Eco'
		}
	};
}

function jsonl(body: string) {
	return body
		.trimEnd()
		.split('\n')
		.map((l) => JSON.parse(l));
}

async function approve(page: Page, s: Start) {
	await page.goto(pathOf(s.verificationUriComplete));
	await page.getByRole('button', { name: 'Aprovar' }).click();
	await expect(page.getByRole('heading', { name: 'Pronto, aparelho conectado' })).toBeVisible();
}

test('sem login, /parear manda para /entrar guardando o código', async ({ page }) => {
	await page.goto('/parear?code=K7Q4MP');
	await expect(page).toHaveURL(/\/entrar\?next=%2Fparear%3Fcode%3DK7Q4MP$/);
});

test('erros do contrato', async ({ request }) => {
	const old = await request.post('/api/v1/sync/pair/start', {
		data: { protocol: 2, deviceName: 'X' }
	});
	expect(old.status()).toBe(426);
	expect(await old.json()).toMatchObject({ code: 'protocol_unsupported', supported: [1] });

	const noName = await request.post('/api/v1/sync/pair/start', {
		data: { protocol: 1, deviceName: ' ' }
	});
	expect(noName.status()).toBe(400);
	expect((await noName.json()).code).toBe('bad_request');

	expect(await poll(request, 'Zk3pQ8vX1mN7cR2tY6wL0aB4dF9hJ5sE_uK8oP3iG7q')).toEqual({
		protocol: 1,
		status: 'expired'
	});

	const noToken = await request.post('/api/v1/sync/push', { data: { protocol: 1, ops: [] } });
	expect(noToken.status()).toBe(401);
	expect((await noToken.json()).code).toBe('invalid_token');
});

test('aprovar em /parear, push, snapshot e revogar', async ({ page }) => {
	const request = page.request;

	const s = await start(request);
	expect(s).toMatchObject({ protocol: 1, expiresIn: 600, interval: 5 });
	expect(s.deviceCode).toMatch(/^[A-Za-z0-9_-]{43}$/);
	expect(s.userCode).toMatch(/^[2-9A-HJ-NP-Z]{3}-[2-9A-HJ-NP-Z]{3}$/);
	expect(s.verificationUriComplete).toBe(
		`${s.verificationUri}?code=${s.userCode.replace('-', '')}`
	);

	// Antes de aprovar: pending; poll cedo demais: slow_down com intervalo maior.
	expect(await poll(request, s.deviceCode)).toEqual({
		protocol: 1,
		status: 'pending',
		interval: 5
	});
	expect(await poll(request, s.deviceCode)).toEqual({
		protocol: 1,
		status: 'slow_down',
		interval: 10
	});

	const email = uniqueEmail();
	await login(page, email);

	// Código digitado à mão, em minúsculas.
	await page.goto('/parear');
	await page.getByRole('textbox', { name: 'Código' }).fill(s.userCode.toLowerCase());
	await page.getByRole('button', { name: 'Continuar' }).click();
	await expect(page.getByRole('heading', { name: 'Conectar X4 Pro à sua conta?' })).toBeVisible();
	await expect(page.getByText('xteink-x4-pro')).toBeVisible();
	await expect(page.getByText(s.userCode)).toBeVisible();
	await page.getByRole('button', { name: 'Aprovar' }).click();
	await expect(page.getByRole('heading', { name: 'Pronto, aparelho conectado' })).toBeVisible();

	// O token sai uma vez só; o poll seguinte dá expired.
	const approved = await poll(request, s.deviceCode);
	expect(approved).toMatchObject({ protocol: 1, status: 'approved', deviceName: 'X4 Pro' });
	expect(approved.token).toMatch(/^lr_/);
	expect(approved.token.endsWith(approved.tokenHint)).toBe(true);
	expect(approved.account).toMatchObject({ email });
	expect(await poll(request, s.deviceCode)).toEqual({ protocol: 1, status: 'expired' });

	// O código usado não vale mais.
	await page.goto(`/parear?code=${s.userCode}`);
	await expect(page.getByText('Código inválido ou vencido. Gere outro no aparelho.')).toBeVisible();

	const x4 = device(request, approved.token);

	// Push: save, revisão pelo saveClientId, visto, e os casos recusados e descartados.
	const saveBello = save('bello', '2026-11-09T20:12:00.000Z');
	const review = {
		clientId: randomUUID(),
		type: 'review',
		at: new Date().toISOString(),
		language: 'it',
		saveClientId: saveBello.clientId,
		rating: 3,
		durationMs: 6400
	};
	const seen = {
		clientId: randomUUID(),
		type: 'seen',
		at: new Date().toISOString(),
		language: 'it',
		lemma: 'bello'
	};
	const ops = [
		saveBello,
		review,
		seen,
		{ ...save('x'), lemma: '' },
		{ ...review, clientId: randomUUID(), saveClientId: undefined, cardId: randomUUID() },
		{ ...seen, clientId: randomUUID(), lemma: 'inesistente' }
	];
	const first = await x4.push(ops);
	expect(first.status).toBe(200);
	expect(first.body.protocol).toBe(1);
	const r = first.body.results;
	expect(r.map((x: { clientId: string }) => x.clientId)).toEqual(ops.map((o) => o.clientId));
	expect(r[0]).toMatchObject({ status: 'applied', created: true });
	expect(r[1]).toMatchObject({ status: 'applied', cardId: r[0].cardId });
	expect(r[1].card).toMatchObject({ id: r[0].cardId, reps: 1 });
	expect(r[2]).toMatchObject({ status: 'applied', itemId: r[0].itemId });
	expect(r[3]).toMatchObject({ status: 'rejected', reason: 'invalid' });
	expect(r[4]).toMatchObject({ status: 'dropped', reason: 'unknown_target' });
	expect(r[5]).toMatchObject({ status: 'dropped', reason: 'not_found' });

	// Reenvio idêntico: applied vira duplicate com o mesmo resto; o resto se repete.
	const again = (await x4.push(ops)).body.results;
	for (const i of [0, 1, 2]) expect(again[i]).toEqual({ ...r[i], status: 'duplicate' });
	for (const i of [3, 4, 5]) expect(again[i]).toEqual(r[i]);

	// Mesmo clientId com outro tipo.
	const conflict = (await x4.push([{ ...seen, clientId: saveBello.clientId }])).body.results;
	expect(conflict[0]).toMatchObject({ status: 'rejected', reason: 'client_id_conflict' });

	// Exclusão vence: save mais antigo que a exclusão é descartado; um novo recria.
	const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
	const doomed = (await x4.push([save('cancellare', hourAgo)])).body.results[0];
	expect(doomed).toMatchObject({ status: 'applied', created: true });
	const del = await request.post('/palavras?/delete', {
		form: { id: doomed.itemId },
		headers: { origin: 'http://localhost:4173' }
	});
	expect(del.ok()).toBe(true);
	const late = (
		await x4.push([
			save('cancellare', new Date(Date.now() - 1_800_000).toISOString()),
			{ ...review, clientId: randomUUID(), saveClientId: undefined, cardId: doomed.cardId }
		])
	).body.results;
	expect(late[0]).toMatchObject({ status: 'dropped', reason: 'item_deleted' });
	expect(late[1]).toMatchObject({ status: 'dropped', reason: 'item_deleted' });
	const reborn = (await x4.push([save('cancellare')])).body.results[0];
	expect(reborn).toMatchObject({ status: 'applied', created: true });
	expect(reborn.itemId).not.toBe(doomed.itemId);

	// 100 itens a mais: o snapshot com limit=100 vem em duas páginas.
	const many = Array.from({ length: 100 }, (_, i) => save(`parola${String(i).padStart(3, '0')}`));
	const manyRes = (await x4.push(many)).body.results;
	expect(manyRes.every((x: { status: string }) => x.status === 'applied')).toBe(true);

	const p1 = await x4.snapshot('language=it&limit=100');
	expect(p1.status()).toBe(200);
	expect(p1.headers()['content-type']).toContain('application/x-ndjson');
	const [header, ...rest1] = jsonl(await p1.text());
	expect(header).toMatchObject({
		t: 'header',
		protocol: 1,
		language: 'it',
		mode: 'full',
		total: 102
	});
	const end1 = rest1.pop();
	expect(end1).toMatchObject({ t: 'end', count: 100 });
	expect(rest1).toHaveLength(100);

	const p2 = await x4.snapshot(`language=it&limit=100&page=${encodeURIComponent(end1.next)}`);
	expect(p2.status()).toBe(200);
	const [header2, ...rest2] = jsonl(await p2.text());
	expect(header2.cursor).toBe(header.cursor);
	expect(rest2.pop()).toEqual({ t: 'end', count: 2, next: null });

	const items = [...rest1, ...rest2];
	const ids = items.map((i) => i.id);
	expect(new Set(ids).size).toBe(102);
	expect(ids).toEqual([...ids].sort());
	expect(items.some((i) => i.id === doomed.itemId)).toBe(false);
	const bello = items.find((i) => i.lemma === 'bello');
	expect(bello).toMatchObject({ id: r[0].itemId, seenCount: 1 });
	expect(bello.card).toEqual(r[1].card);

	// Token de página de outro pedido: 410.
	const other = await x4.snapshot(`language=it&limit=200&page=${encodeURIComponent(end1.next)}`);
	expect(other.status()).toBe(410);
	expect((await other.json()).code).toBe('page_expired');

	// Integrações mostra o aparelho; revogar derruba o token.
	await page.goto('/integracoes');
	await expect(page.getByText('Nenhum token ainda.')).toBeVisible();
	await expect(page.getByText(/Última sincronização/)).toBeVisible();
	await page
		.getByRole('button', { name: `Revogar aparelho X4 Pro …${approved.tokenHint}` })
		.click();
	await expect(page.getByText('Nenhum aparelho pareado.')).toBeVisible();
	const revoked = await x4.push([seen]);
	expect(revoked.status).toBe(401);
	expect(revoked.body.code).toBe('invalid_token');
});

test('recusar, código inválido e desparear', async ({ page }) => {
	const request = page.request;
	await login(page);

	const s = await start(request, 'Kindle da sala');
	await page.goto(pathOf(s.verificationUriComplete));
	await expect(
		page.getByRole('heading', { name: 'Conectar Kindle da sala à sua conta?' })
	).toBeVisible();
	await page.getByRole('button', { name: 'Recusar' }).click();
	await expect(page.getByRole('heading', { name: 'Pedido recusado' })).toBeVisible();
	expect(await poll(request, s.deviceCode)).toEqual({ protocol: 1, status: 'denied' });

	await page.goto('/parear?code=ZZZ-ZZZ');
	await expect(page.getByText('Código inválido ou vencido. Gere outro no aparelho.')).toBeVisible();

	const s2 = await start(request, 'Segundo X4');
	await approve(page, s2);
	const { token } = await poll(request, s2.deviceCode);
	const x4 = device(request, token);
	const snap = await x4.snapshot('language=it');
	expect(jsonl(await snap.text())).toEqual([
		expect.objectContaining({ t: 'header', total: 0 }),
		{ t: 'end', count: 0, next: null }
	]);
	const unpair = await x4.unpair();
	expect(unpair.status()).toBe(204);
	expect((await x4.snapshot('language=it')).status()).toBe(401);
});
