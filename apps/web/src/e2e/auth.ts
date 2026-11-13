import { expect, type Page } from '@playwright/test';

// Mailpit do `supabase start` (pega o e-mail do link mágico).
const MAILPIT = 'http://127.0.0.1:54324';
// E2E_SUPABASE_URL + E2E_SECRET_KEY: roda contra outra stack local (worktree) sem Mailpit,
// gerando o link mágico pela API admin.
export const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SECRET_KEY = process.env.E2E_SECRET_KEY;

async function adminMagicLink(email: string): Promise<string> {
	const headers = {
		apikey: SECRET_KEY!,
		authorization: `Bearer ${SECRET_KEY}`,
		'content-type': 'application/json'
	};
	await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
		method: 'POST',
		headers,
		body: JSON.stringify({ email, email_confirm: true })
	});
	const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
		method: 'POST',
		headers,
		body: JSON.stringify({ type: 'magiclink', email })
	});
	const link = (await res.json()) as {
		hashed_token?: string;
		properties?: { hashed_token?: string };
	};
	const hash = link.hashed_token ?? link.properties?.hashed_token;
	if (!hash) throw new Error(`sem link mágico para ${email}`);
	return `/auth/confirm?token_hash=${hash}&type=magiclink`;
}

export function uniqueEmail() {
	return `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@linguetta.test`;
}

async function magicLinkFor(email: string): Promise<string> {
	for (let i = 0; i < 40; i++) {
		const search = await fetch(
			`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`
		);
		const { messages } = (await search.json()) as { messages: { ID: string }[] };
		if (messages.length > 0) {
			const msg = await fetch(`${MAILPIT}/api/v1/message/${messages[0].ID}`);
			const { HTML } = (await msg.json()) as { HTML: string };
			const href = HTML.match(/href="([^"]*\/auth\/confirm[^"]*)"/)?.[1];
			if (!href) throw new Error('e-mail sem link /auth/confirm');
			const url = new URL(href.replaceAll('&amp;', '&'));
			// O template usa o site_url (5173); o teste roda no preview (4173).
			return url.pathname + url.search;
		}
		await new Promise((r) => setTimeout(r, 250));
	}
	throw new Error(`nenhum e-mail para ${email}`);
}

/**
 * Entra com uma conta nova. A conta nasce sem idioma de estudo (ADR 0004): o início pede
 * um, e `languages` escolhe o primeiro pelo seletor do início e acrescenta os outros.
 * O primeiro fica ativo. `[]` deixa a conta sem idioma.
 */
export async function login(page: Page, email = uniqueEmail(), languages = ['en', 'it']) {
	if (SECRET_KEY) {
		await page.goto(await adminMagicLink(email));
	} else {
		await page.goto('/entrar');
		await page.getByLabel('E-mail').fill(email);
		await page.getByRole('button', { name: 'Mandar link' }).click();
		await expect(page.getByRole('status')).toContainText(`Link enviado para ${email}`);
		await page.goto(await magicLinkFor(email));
	}
	await expect(page).toHaveURL(/\/inicio$/);
	if (languages.length > 0) await chooseLanguages(page, languages);
	await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
}

/** Escolhe o primeiro idioma no início e grava os demais pelo perfil, sem mudar o ativo. */
export async function chooseLanguages(page: Page, [first, ...rest]: string[]) {
	const picker = page.getByTestId('escolher-idioma');
	await picker.getByRole('searchbox').fill(first);
	await picker.locator(`button[value="${first}"]`).first().click();
	await expect(picker).toHaveCount(0);
	const origin = new URL(page.url()).origin;
	const post = async (action: string, form: Record<string, string>) => {
		const res = await page.request.post(`/perfil?/${action}`, { form, headers: { origin } });
		expect(res.ok(), `${action} ${JSON.stringify(form)}`).toBe(true);
	};
	for (const tag of rest) await post('adicionarIdioma', { idioma: tag, voltar: '/inicio' });
	if (rest.length > 0) {
		await post('idioma', { idioma: first, voltar: '/inicio' });
		await page.reload();
	}
}

/** Abre o diálogo Guardar pelo atalho N e guarda a palavra no idioma ativo. */
export async function saveWord(page: Page, lemma: string, sense = '', sentence = '') {
	const dialog = page.getByRole('dialog', { name: /Guardar palavra/ });
	// Logo depois de navegar, a tecla pode chegar antes da hidratação: tenta de novo.
	await expect(async () => {
		if (!(await dialog.isVisible())) await page.keyboard.press('n');
		await expect(dialog).toBeVisible({ timeout: 1000 });
	}).toPass();
	await dialog.getByRole('textbox', { name: 'Palavra' }).fill(lemma);
	if (sense) await dialog.getByLabel('Tradução').fill(sense);
	if (sentence) await dialog.getByLabel('Frase').fill(sentence);
	await dialog.getByRole('button', { name: 'Guardar' }).click();
	return dialog;
}

/** Troca o idioma ativo pelo seletor da barra lateral. */
export async function switchLanguage(page: Page, name: string, code: string) {
	const side = page.getByRole('complementary', { name: 'Navegação' });
	await side.getByLabel(/Trocar idioma/).click();
	await side.getByRole('menuitemradio', { name: new RegExp(name) }).click();
	await expect(side.getByTestId('idioma-ativo')).toHaveText(code);
}

/** GET no PostgREST como o usuário logado na página (RLS de verdade), lendo o cookie da sessão. */
export async function restAsUser<T = unknown>(page: Page, path: string): Promise<T> {
	const parts = (await page.context().cookies())
		.filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name))
		.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
	const raw = parts.map((c) => c.value).join('');
	const json = raw.startsWith('base64-')
		? Buffer.from(raw.slice(7), 'base64url').toString()
		: decodeURIComponent(raw);
	const { access_token } = JSON.parse(json) as { access_token: string };
	const key = process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
	const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
		headers: { apikey: key, authorization: `Bearer ${access_token}` }
	});
	expect(res.ok, path).toBe(true);
	return (await res.json()) as T;
}
