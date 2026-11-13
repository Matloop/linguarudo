import { expect, test } from '@playwright/test';
import { login, saveWord } from '../../../e2e/auth.ts';

// O lápis da revisão abre o mesmo diálogo do Guardar, em modo edição, sem sair da sessão.

test('editar a palavra na revisão pelo diálogo do Guardar', async ({ page }) => {
	await login(page);
	await page.goto('/palavras');
	const saved = await saveWord(page, 'give up', 'desistir', 'I never give up.');
	await expect(saved).toBeHidden();

	await page.goto('/flashcards/estudar');
	await expect(page.locator('section[aria-label="Frente do flashcard"]')).toBeVisible();
	await page.getByRole('button', { name: 'Editar este flashcard' }).click();

	const dialog = page.getByRole('dialog', { name: 'Editar palavra' });
	await expect(dialog).toBeVisible();
	// Os mesmos campos do Guardar, já com os valores da palavra; sem "Guardar em".
	await expect(dialog.getByRole('textbox', { name: 'Palavra' })).toHaveValue('give up');
	await expect(dialog.getByLabel('Frase', { exact: true })).toHaveValue('I never give up.');
	await expect(dialog.getByRole('button', { name: /Preencher com IA/ })).toBeEnabled();
	await expect(dialog.getByTestId('guardar-idioma')).toHaveCount(0);

	await dialog.getByLabel('Tradução', { exact: true }).fill('desistir, largar');
	await dialog.getByLabel('Tradução da frase', { exact: true }).fill('Eu nunca desisto.');
	await dialog.getByRole('button', { name: 'Salvar' }).click();
	await expect(dialog).toBeHidden();

	// O flashcard da fila volta do servidor já com o texto novo.
	await page.getByRole('button', { name: 'Mostrar resposta' }).click();
	const back = page.locator('section[aria-label="Verso do flashcard"]');
	await expect(back).toContainText('desistir, largar');
	await expect(back.locator('.ctx-tr')).toHaveText('Eu nunca desisto.');

	// Reabrir traz o que foi salvo.
	await page.getByRole('button', { name: 'Editar este flashcard' }).click();
	await expect(dialog.getByLabel('Tradução', { exact: true })).toHaveValue('desistir, largar');
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
});
