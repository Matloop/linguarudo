import { expect, test } from '@playwright/test';
import { login, SUPABASE_URL } from '../../e2e/auth.ts';

test('sem login, /palavras manda para /entrar', async ({ page }) => {
	await page.goto('/palavras?lang=it');
	await expect(page).toHaveURL(/\/entrar\?next=%2Fpalavras%3Flang%3Dit$/);
	await expect(page.getByRole('button', { name: 'Entrar com Google' })).toBeVisible();
});

test('anon não lê a tabela words direto pela API', async () => {
	const key = process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;
	test.skip(!key, 'PUBLIC_SUPABASE_PUBLISHABLE_KEY não definido');
	const res = await fetch(`${SUPABASE_URL}/rest/v1/words?select=id`, {
		headers: { apikey: key!, authorization: `Bearer ${key}` }
	});
	expect(res.ok).toBe(false);
});

test('fluxo de palavras: entrar, adicionar, duplicata, filtrar, apagar, sair', async ({ page }) => {
	await login(page);
	await expect(page.getByText('Seu banco está vazio')).toBeVisible();

	const form = page.getByRole('form', { name: 'Guardar palavra' });
	await form.getByLabel('Palavra ou expressão').fill('  give   up ');
	await form.getByLabel('Tradução').fill('desistir');
	await form.getByLabel('Contexto').fill("Don't give up on me.");
	await form.getByRole('button', { name: 'Guardar' }).click();
	await expect(form.getByRole('status')).toHaveText('“give up” guardada.');
	await expect(form.getByLabel('Palavra ou expressão')).toHaveValue('');

	await form.getByLabel('Palavra ou expressão').fill('allora');
	await form.getByRole('radio', { name: 'IT' }).check();
	await form.getByRole('button', { name: 'Guardar' }).click();
	await expect(form.getByRole('status')).toHaveText('“allora” guardada.');

	const items = page.getByRole('listitem');
	await expect(items).toHaveCount(2);
	await expect(items.first()).toContainText('allora'); // mais recente primeiro
	await expect(items.nth(1)).toContainText('desistir');

	// Duplicata (outra caixa) mostra mensagem amigável e mantém o que foi digitado.
	await form.getByLabel('Palavra ou expressão').fill('Give Up');
	await form.getByRole('radio', { name: 'EN' }).check();
	await form.getByRole('button', { name: 'Guardar' }).click();
	await expect(form.getByRole('alert')).toHaveText('“Give Up” já está no seu banco.');
	await expect(form.getByLabel('Palavra ou expressão')).toHaveValue('Give Up');
	await expect(items).toHaveCount(2);

	const filtros = page.getByRole('navigation', { name: 'Filtrar por idioma' });
	await filtros.getByRole('link', { name: 'Italiano' }).click();
	await expect(page).toHaveURL(/\?lang=it$/);
	await expect(items).toHaveCount(1);
	await expect(items.first()).toContainText('allora');

	await filtros.getByRole('link', { name: 'Todas' }).click();
	await expect(items).toHaveCount(2);

	await page.getByRole('button', { name: 'Apagar “allora”' }).click();
	await expect(items).toHaveCount(1);
	await expect(items.first()).toContainText('give up');

	await page.reload();
	await expect(items).toHaveCount(1);

	await page.getByRole('button', { name: 'Sair' }).click();
	await expect(page).toHaveURL(/\/$/);
	await page.goto('/palavras');
	await expect(page).toHaveURL(/\/entrar/);
});

test.describe('sem JavaScript', () => {
	test.use({ javaScriptEnabled: false });

	test('adiciona, filtra e apaga com formulário comum', async ({ page }) => {
		await login(page);
		await page.getByRole('link', { name: 'Italiano' }).click();

		const form = page.getByRole('form', { name: 'Guardar palavra' });
		await form.getByLabel('Palavra ou expressão').fill('magari');
		await form.getByLabel('Tradução').fill('quem dera');
		await expect(form.getByRole('radio', { name: 'IT' })).toBeChecked();
		await form.getByRole('button', { name: 'Guardar' }).click();

		await expect(form.getByRole('status')).toHaveText('“magari” guardada.');
		await expect(page.getByRole('link', { name: 'Italiano' })).toHaveAttribute(
			'aria-current',
			'page'
		);
		await expect(page.getByRole('listitem')).toHaveCount(1);

		await page.getByRole('button', { name: 'Apagar “magari”' }).click();
		await expect(page.getByText('Nenhuma palavra em italiano ainda.')).toBeVisible();
	});
});
