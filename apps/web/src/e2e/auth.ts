import { expect, type Page } from '@playwright/test';

// Mailpit do `supabase start` (pega o e-mail do link mágico).
const MAILPIT = 'http://127.0.0.1:54324';
export const SUPABASE_URL = 'http://127.0.0.1:54321';

export function uniqueEmail() {
	return `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@linguarudo.test`;
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

export async function login(page: Page, email = uniqueEmail()) {
	await page.goto('/entrar');
	await page.getByLabel('E-mail').fill(email);
	await page.getByRole('button', { name: 'Mandar link' }).click();
	await expect(page.getByRole('status')).toContainText(`Link enviado para ${email}`);
	await page.goto(await magicLinkFor(email));
	await expect(page).toHaveURL(/\/inicio$/);
	await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
}

/** Abre o diálogo Guardar pelo atalho N e guarda a palavra no idioma ativo. */
export async function saveWord(page: Page, lemma: string, sense = '', sentence = '') {
	const dialog = page.getByRole('dialog', { name: /Guardar em/ });
	// Logo depois de navegar, a tecla pode chegar antes da hidratação: tenta de novo.
	await expect(async () => {
		if (!(await dialog.isVisible())) await page.keyboard.press('n');
		await expect(dialog).toBeVisible({ timeout: 1000 });
	}).toPass();
	await dialog.getByRole('textbox', { name: 'Palavra' }).fill(lemma);
	if (sense) await dialog.getByLabel('Tradução').fill(sense);
	if (sentence) await dialog.getByLabel('Contexto').fill(sentence);
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
