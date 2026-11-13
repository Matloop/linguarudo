import { expect, test, type Page } from '@playwright/test';
import { login } from '../../../e2e/auth.ts';

// Nova ficha e editar ficha: o mesmo diálogo, com a cara do Guardar palavra.

const list = (page: Page) => page.locator('ul.list');

async function openNew(page: Page) {
	const dialog = page.getByRole('dialog', { name: 'Nova ficha' });
	// Logo depois de navegar, o clique pode chegar antes da hidratação: tenta de novo.
	await expect(async () => {
		if (!(await dialog.isVisible()))
			await page
				.getByRole('link', { name: /Nova ficha|Criar ficha/ })
				.first()
				.click();
		await expect(dialog).toBeVisible({ timeout: 1000 });
	}).toPass();
	return dialog;
}

test('criar, editar e apagar uma ficha pelo diálogo', async ({ page }) => {
	await login(page);
	await page.goto('/flashcards/fichas');

	const dialog = await openNew(page);
	// Mesma casca do Guardar: chip de idioma, "Mais campos" com as fichinhas, rodapé.
	await expect(dialog.getByTestId('guardar-idioma')).toHaveText('EN');
	await expect(dialog.getByText('Mais campos')).toBeVisible();
	await expect(dialog.getByRole('button', { name: 'Cancelar' })).toBeVisible();

	// Frente vazia não envia.
	await dialog
		.getByRole('button', { name: /^Guardar/ })
		.last()
		.click();
	await expect(dialog.getByRole('alert')).toContainText('Escreva a frente.');

	// B embrulha a seleção (a frente inteira, aqui) e a prévia mostra em negrito.
	const front = dialog.getByRole('textbox', { name: 'Frente' });
	await front.fill('to be');
	await front.selectText();
	await dialog.getByRole('button', { name: 'Negrito' }).first().click();
	await expect(front).toHaveValue('<b>to be</b>');
	await expect(dialog.locator('.pf b')).toHaveText('to be');
	await dialog.getByLabel('Verso', { exact: true }).fill('ser, estar');

	await dialog.getByText('Mais campos').click();
	await dialog.getByLabel('Tags', { exact: true }).fill('verbos');
	await dialog.getByLabel('Criar também o inverso').check();
	await expect(dialog.getByText('Vai gerar 2 flashcards')).toBeVisible();
	await expect(dialog.getByRole('button', { name: /^Baralho: / })).toBeEnabled();
	await dialog
		.getByRole('button', { name: /^Guardar/ })
		.last()
		.click();
	await expect(dialog).toBeHidden();
	await expect(page.getByRole('status')).toHaveText('Ficha criada');

	const row = list(page).getByRole('link', { name: /to be/ });
	await expect(row).toContainText('ser, estar');
	await expect(row).toContainText('Frente → verso · Verso → frente');
	await expect(row).toContainText('verbos');

	// Editar: o mesmo diálogo por cima da lista, com a URL da ficha.
	await row.click();
	const edit = page.getByRole('dialog', { name: 'Editar ficha' });
	await expect(edit).toBeVisible();
	await expect(page).toHaveURL(/\/flashcards\/fichas\/[0-9a-f-]{36}$/);
	await expect(edit.getByRole('textbox', { name: 'Frente' })).toHaveValue('<b>to be</b>');
	await expect(edit.getByTestId('guardar-idioma')).toHaveCount(0);
	// Com tags, "Mais campos" já abre.
	await expect(edit.getByLabel('Criar também o inverso')).toBeChecked();
	await edit.getByLabel('Criar também o inverso').uncheck();
	await edit.getByLabel('Verso', { exact: true }).fill('ser');
	await edit
		.getByRole('button', { name: /^Salvar/ })
		.last()
		.click();
	await expect(edit).toBeHidden();
	await expect(page).toHaveURL(/\/flashcards\/fichas$/);
	await expect(row).toContainText('ser');
	await expect(row).not.toContainText('Verso → frente');

	// O link direto da ficha abre o mesmo diálogo; fechar volta para a lista.
	await row.click();
	await expect(edit).toBeVisible();
	await page.reload();
	await expect(edit).toBeVisible();
	// Vem aberto do servidor; o Esc só fecha depois de hidratar (aí vira modal).
	await expect.poll(() => edit.evaluate((d) => d.matches(':modal'))).toBe(true);
	await page.keyboard.press('Escape');
	await expect(page).toHaveURL(/\/flashcards\/fichas$/);

	// Apagar, pelo diálogo de edição.
	await row.click();
	page.once('dialog', (d) => d.accept());
	await edit.getByRole('button', { name: 'Apagar ficha' }).click();
	await expect(edit).toBeHidden();
	await expect(page.getByRole('heading', { name: 'Nenhuma ficha ainda' })).toBeVisible();
});
