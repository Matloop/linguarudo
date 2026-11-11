import { expect, test } from '@playwright/test';
import { login } from '../e2e/auth.ts';

test('a landing carrega sem erro de console e com a marca Linguetta', async ({ page }) => {
	const erros: string[] = [];
	page.on('console', (m) => {
		if (m.type() === 'error') erros.push(m.text());
	});
	page.on('pageerror', (e) => erros.push(e.message));

	await page.goto('/');
	await page.waitForLoadState('networkidle');
	await expect(
		page.getByRole('heading', { level: 1, name: /Aprenda com o que você já/ })
	).toBeVisible();
	await expect(page).toHaveTitle(/^Linguetta/);
	await expect(page.getByText('Linguarudo')).toHaveCount(0);
	expect(erros).toEqual([]);
});

test('integrações dizem a verdade: Stremio disponível, Anki e E-reader em breve', async ({
	page
}) => {
	await page.goto('/');
	const ints = page.getByRole('region', { name: 'Onde o Linguetta funciona' });
	await expect(ints.getByRole('article').filter({ hasText: 'Stremio' })).toContainText(
		'Disponível'
	);
	await expect(ints.getByRole('article').filter({ hasText: 'Anki' })).toContainText('Em breve');
	await expect(ints.getByRole('article').filter({ hasText: 'E-reader' })).toContainText('Em breve');
});

test('o CTA leva para /entrar', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('link', { name: 'Começar grátis' }).first().click();
	await expect(page).toHaveURL(/\/entrar$/);
	await expect(page).toHaveTitle('Entrar · Linguetta');
});

test('com login, o CTA vira Abrir o app e leva ao início', async ({ page }) => {
	await login(page);
	await page.goto('/');
	await page.getByRole('link', { name: 'Abrir o app' }).first().click();
	await expect(page).toHaveURL(/\/inicio$/);
});
