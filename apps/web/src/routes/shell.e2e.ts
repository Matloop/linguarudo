import { expect, test } from '@playwright/test';
import { login } from '../e2e/auth.ts';

test('N abre o diálogo Guardar e Esc fecha; N não dispara enquanto digita', async ({ page }) => {
	await login(page);
	const dialog = page.getByRole('dialog', { name: /Guardar palavra/ });
	await expect(dialog).toBeHidden();

	await page.keyboard.press('n');
	await expect(dialog).toBeVisible();
	await expect(dialog.getByRole('textbox', { name: 'Palavra' })).toBeFocused();
	// Dentro do campo, N é só uma letra.
	await page.keyboard.type('nano');
	await expect(dialog.getByRole('textbox', { name: 'Palavra' })).toHaveValue('nano');

	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();

	// O botão da barra também abre.
	await page.getByTestId('guardar').click();
	await expect(dialog).toBeVisible();
	await dialog.getByRole('button', { name: 'Cancelar' }).click();
	await expect(dialog).toBeHidden();
});

test('o botão ao lado do logo recolhe e o logo abre a barra lateral, e a escolha persiste', async ({
	page
}) => {
	await login(page);
	const logo = page.getByTestId('logo-barra');
	const app = page.locator('.app');

	await expect(logo).toHaveAttribute('aria-expanded', 'true');
	await expect(app).not.toHaveClass(/\bmini\b/);
	const wide = (await page.getByRole('complementary', { name: 'Navegação' }).boundingBox())!.width;

	await logo.click();
	await expect(logo).toHaveAttribute('aria-expanded', 'false');
	await expect(logo).toHaveAccessibleName('Abrir barra lateral');
	await expect(app).toHaveClass(/\bmini\b/);
	await expect
		.poll(
			async () =>
				(await page.getByRole('complementary', { name: 'Navegação' }).boundingBox())!.width
		)
		.toBeLessThan(wide / 2);

	await page.reload();
	await expect(app).toHaveClass(/\bmini\b/);

	await logo.click();
	await expect(logo).toHaveAttribute('aria-expanded', 'true');
	await expect(app).not.toHaveClass(/\bmini\b/);
});

test('tema escuro: alterna na barra, persiste e o perfil reflete', async ({ page }) => {
	await login(page);
	const html = page.locator('html');
	await expect(html).not.toHaveClass(/tema-escuro/);

	await page.getByRole('button', { name: 'Trocar tema' }).click();
	await expect(html).toHaveClass(/tema-escuro/);
	const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
	expect(bg).not.toBe('rgb(247, 241, 230)');

	await page.reload();
	await expect(html).toHaveClass(/tema-escuro/);

	await page.goto('/perfil');
	await expect(page.getByRole('button', { name: 'Escuro' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await page.getByRole('button', { name: 'Claro' }).click();
	await expect(html).toHaveClass(/tema-claro/);
	await expect(page.getByRole('button', { name: 'Claro' })).toHaveAttribute('aria-pressed', 'true');
});

test('celular: barra de abas no lugar da lateral', async ({ page }) => {
	await page.setViewportSize({ width: 400, height: 800 });
	await login(page);
	await expect(page.getByRole('complementary', { name: 'Navegação' })).toBeHidden();
	const tabs = page.getByRole('navigation', { name: 'Abas' });
	await expect(tabs).toBeVisible();
	await tabs.getByRole('link', { name: 'Palavras' }).click();
	await expect(page).toHaveURL(/\/palavras$/);
	await page.getByRole('link', { name: 'Guardar palavra' }).first().click();
	await expect(page.getByRole('dialog', { name: /Guardar palavra/ })).toBeVisible();
});
