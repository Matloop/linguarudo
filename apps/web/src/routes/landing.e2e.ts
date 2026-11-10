import { expect, test, type Page } from '@playwright/test';

// A prévia só responde depois da hidratação; esperar a rede assentar evita clique perdido.
async function abrirLanding(page: Page) {
	await page.goto('/');
	await page.waitForLoadState('networkidle');
}

const banco = (page: Page) => page.getByRole('complementary', { name: 'Seu banco de palavras' });

test('a landing carrega sem erro de console', async ({ page }) => {
	const erros: string[] = [];
	page.on('console', (m) => {
		if (m.type() === 'error') erros.push(m.text());
	});
	page.on('pageerror', (e) => erros.push(e.message));

	await abrirLanding(page);
	await expect(
		page.getByRole('heading', { level: 1, name: /Aprenda com o que você já/ })
	).toBeVisible();
	expect(erros).toEqual([]);
});

test('tocar numa palavra abre o cartão e Salvar leva para o banco', async ({ page }) => {
	await abrirLanding(page);
	await expect(banco(page)).toContainText('0 palavras');

	await page.getByRole('button', { name: 'key', exact: true }).click();
	const cartao = page.getByRole('dialog');
	await expect(cartao).toBeVisible();
	await expect(cartao).toContainText('chave');

	await cartao.getByRole('button', { name: 'Salvar' }).click();
	await expect(banco(page)).toContainText('1 palavra');
	await expect(banco(page)).toContainText('key');
});

test('troca para a aba Música e para italiano', async ({ page }) => {
	await abrirLanding(page);

	const musica = page.getByRole('tab', { name: 'Música' });
	await musica.click();
	await expect(musica).toHaveAttribute('aria-selected', 'true');
	await expect(page.getByRole('tabpanel')).toContainText('Rain on the Roof');

	const it = page.getByRole('button', { name: /^IT/ });
	await it.click();
	await expect(it).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByRole('tabpanel')).toContainText('Pioggia sul tetto');
});

test('o CTA leva para /entrar', async ({ page }) => {
	await abrirLanding(page);
	await page.getByRole('link', { name: 'Começar grátis' }).first().click();
	await expect(page).toHaveURL(/\/entrar$/);
});
