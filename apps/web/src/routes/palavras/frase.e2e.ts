import { expect, test, type Page } from '@playwright/test';
import { login, saveWord } from '../../e2e/auth.ts';

// Frase nos dois idiomas: editar no painel, ver a tradução no verso da revisão.
// Os testes com IA de verdade (Groq/Gemini, Wikimedia Commons) só rodam com E2E_REAL_AI=1.

const sheet = (page: Page, lemma: string) =>
	page.getByRole('region', { name: `Detalhes de “${lemma}”` });

async function openWord(page: Page, lemma: string) {
	await page.goto('/palavras');
	await page.getByRole('list', { name: 'Palavras' }).getByRole('link', { name: lemma }).click();
}

test('editar a frase e a tradução no painel; a tradução aparece só no verso', async ({ page }) => {
	await login(page);
	await page.goto('/palavras');
	const dialog = await saveWord(
		page,
		'scheda',
		'ficha, cartão',
		'Compila la scheda prima di partire.'
	);
	await expect(dialog).toBeHidden();

	await openWord(page, 'scheda');
	await expect(page.getByText('Sem tradução')).toBeVisible();
	await page.getByRole('button', { name: 'Editar frase e tradução' }).click();
	await page.getByLabel(/^Frase em /).fill('La scheda è già pronta.');
	await page.getByLabel(/^Tradução em /).fill('A ficha já está pronta.');
	await page.getByRole('button', { name: 'Salvar' }).click();

	const quote = page.locator('.quote').first();
	await expect(quote).toContainText('La scheda è già pronta.');
	await expect(quote.locator('mark')).toHaveText('scheda');
	await expect(quote.locator('b')).toHaveText('ficha');

	// Esc cancela sem salvar.
	await page.getByRole('button', { name: 'Editar frase e tradução' }).click();
	await page.getByLabel(/^Frase em /).fill('Non salvare questo.');
	await page.keyboard.press('Escape');
	await expect(quote).toContainText('La scheda è già pronta.');

	// Recarregar mantém (veio do banco).
	await page.reload();
	await expect(page.locator('.quote').first()).toContainText('A ficha já está pronta.');

	await page.goto('/flashcards/estudar');
	const front = page.locator('section[aria-label="Frente do flashcard"]');
	await expect(front).toBeVisible();
	// A tradução só existe no verso (que fica virado e inerte até mostrar a resposta).
	await expect(front.getByText('A ficha já está pronta.')).toHaveCount(0);
	const back = page.locator('section[aria-label="Verso do flashcard"]');
	await expect(back).toHaveAttribute('inert');
	await page.getByRole('button', { name: 'Mostrar resposta' }).click();
	await expect(back).not.toHaveAttribute('inert');
	await expect(back.locator('.ctx-tr')).toHaveText('A ficha já está pronta.');
	await expect(back.locator('.ctx-tr b')).toHaveText('ficha');
});

test.describe('com IA de verdade', () => {
	test.skip(!process.env.E2E_REAL_AI, 'E2E_REAL_AI não definido');

	test('Passar para o italiano reescreve a frase misturada', async ({ page }) => {
		test.setTimeout(60_000);
		await login(page);
		await page.goto('/palavras');
		const dialog = await saveWord(page, 'muscolo', 'músculo', 'Eu corro até meus muscoli arderem.');
		await expect(dialog).toBeHidden();
		await openWord(page, 'muscolo');
		await page.getByRole('button', { name: /traduzir/ }).click();
		const it = page.getByLabel(/^Frase em /);
		await expect(it).toBeVisible({ timeout: 20_000 });
		await expect(page.getByLabel(/^Tradução em /)).not.toHaveValue('', { timeout: 20_000 });
		console.log(
			'IA:',
			await it.inputValue(),
			'|',
			await page.getByLabel(/^Tradução em /).inputValue()
		);
		await page.getByRole('button', { name: 'Salvar' }).click();
		await expect(page.locator('.quote').first().locator('.tr')).toBeVisible();
	});

	test('Sugerir com IA põe uma foto do Commons na palavra', async ({ page }) => {
		test.setTimeout(90_000);
		await login(page);
		await page.goto('/palavras');
		const dialog = await saveWord(page, 'letto', 'cama');
		await expect(dialog).toBeHidden();
		await openWord(page, 'letto');
		await page.getByRole('button', { name: /Sugerir com IA/ }).click();
		const query = page.getByLabel('Busca de imagens (em inglês)');
		await expect(query).not.toHaveValue('', { timeout: 20_000 });
		console.log('busca:', await query.inputValue());
		const first = page.getByRole('button', { name: /^Usar / }).first();
		await expect(first).toBeVisible({ timeout: 20_000 });
		await first.click();
		const thumb = sheet(page, 'letto').locator('img.thumb');
		await expect(thumb).toBeVisible({ timeout: 30_000 });
		// Ficou no banco: abrir de novo mostra a imagem salva (URL assinada do Storage).
		await openWord(page, 'letto');
		await expect(sheet(page, 'letto').locator('img.thumb')).toHaveAttribute('src', /midia/);
	});
});
