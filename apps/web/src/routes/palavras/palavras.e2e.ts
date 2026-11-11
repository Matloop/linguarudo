import { expect, test, type Page } from '@playwright/test';
import { login, saveWord, SUPABASE_URL } from '../../e2e/auth.ts';

/** As linhas da lista (cada uma abre o painel da palavra). */
function rows(page: Page) {
	return page.getByRole('list', { name: 'Palavras' }).getByRole('link');
}

function toast(page: Page) {
	return page.locator('.toast[role="status"]');
}

test('sem login, /palavras manda para /entrar', async ({ page }) => {
	await page.goto('/palavras?f=hoje');
	await expect(page).toHaveURL(/\/entrar\?next=%2Fpalavras%3Ff%3Dhoje$/);
	await expect(page.getByRole('button', { name: 'Entrar com Google' })).toBeVisible();
});

test('anon não lê items nem encounters direto pela API', async () => {
	const key = process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;
	test.skip(!key, 'PUBLIC_SUPABASE_PUBLISHABLE_KEY não definido');
	for (const table of ['items', 'encounters', 'works', 'flashcards']) {
		const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=id`, {
			headers: { apikey: key!, authorization: `Bearer ${key}` }
		});
		expect(res.ok, table).toBe(false);
	}
});

test('fluxo de palavras: guardar, encontro, duplicata, editar, já sei, buscar, apagar', async ({
	page
}) => {
	await login(page);
	await page.goto('/palavras');
	await expect(page.getByText('Seu banco está vazio')).toBeVisible();

	await saveWord(page, '  give   up ', 'desistir', 'Never give up on the small boat.');
	await expect(toast(page)).toHaveText('“give up” guardada.');
	await saveWord(page, 'allora');
	await expect(toast(page)).toHaveText('“allora” guardada.');

	await expect(rows(page)).toHaveCount(2);
	await expect(rows(page).first()).toContainText('allora'); // mais recente primeiro
	await expect(rows(page).filter({ hasText: 'give up' })).toContainText('desistir');

	// Mesmo lema (outra caixa) sem frase: nada a acrescentar, o diálogo avisa.
	const dialog = await saveWord(page, 'Give Up');
	await expect(dialog.getByRole('alert')).toHaveText('“give up” já está no seu banco.');
	await expect(dialog.getByRole('textbox', { name: 'Palavra' })).toHaveValue('Give Up');
	// Com frase, vira um novo encontro do mesmo item.
	await dialog.getByLabel('Contexto').fill('They never give up at night.');
	await dialog.getByRole('button', { name: 'Guardar' }).click();
	await expect(toast(page)).toHaveText(
		'“give up” já estava no banco. A frase entrou como novo encontro.'
	);
	await expect(dialog).toBeHidden();
	await expect(rows(page)).toHaveCount(2);

	// O painel mostra os dois contextos.
	await rows(page).filter({ hasText: 'give up' }).click();
	const drawer = page.getByRole('region', { name: 'Detalhes de “give up”' });
	await expect(drawer).toBeVisible();
	await expect(page).toHaveURL(/\?item=/);
	await expect(drawer.getByRole('heading', { name: 'Contextos' })).toBeVisible();
	await expect(drawer).toContainText('Never give up on the small boat.');
	await expect(drawer).toContainText('They never give up at night.');

	// Editar a tradução e a nota.
	await drawer.getByRole('button', { name: 'Editar' }).click();
	await drawer.getByLabel('Tradução').fill('parar de tentar');
	await drawer.getByLabel('Nota').fill('phrasal verb');
	await drawer.getByRole('button', { name: 'Salvar' }).click();
	await expect(toast(page)).toHaveText('Alterações salvas');
	await expect(drawer).toContainText('parar de tentar');
	await expect(drawer).toContainText('phrasal verb');

	// Marcar como conhecida e voltar.
	await drawer.getByRole('button', { name: 'Marcar “give up” como conhecida' }).click();
	await expect(drawer).toContainText('Fora da revisão');
	await expect(rows(page).filter({ hasText: 'give up' })).toContainText('Já sei');
	await drawer.getByRole('button', { name: 'Voltar “give up” para a revisão' }).click();
	await expect(drawer).not.toContainText('Fora da revisão');

	// Esc fecha o painel.
	await page.keyboard.press('Escape');
	await expect(drawer).toBeHidden();
	await expect(page).not.toHaveURL(/item=/);

	// Busca com o atalho /.
	await page.keyboard.press('/');
	await expect(page.getByRole('searchbox', { name: 'Buscar' })).toBeFocused();
	await page.keyboard.type('allo');
	await expect(rows(page)).toHaveCount(1);
	await expect(page).toHaveURL(/q=allo/);
	await page.getByRole('searchbox', { name: 'Buscar' }).fill('');
	await expect(rows(page)).toHaveCount(2);

	// Apagar pede confirmação.
	await rows(page).filter({ hasText: 'allora' }).click();
	page.once('dialog', (d) => d.accept());
	await page.getByRole('button', { name: 'Apagar “allora”' }).click();
	await expect(toast(page)).toHaveText('“allora” apagada');
	await expect(rows(page)).toHaveCount(1);
	await expect(rows(page).first()).toContainText('give up');

	await page.reload();
	await expect(rows(page)).toHaveCount(1);
});

test('cada idioma mostra só as próprias palavras', async ({ page }) => {
	await login(page);
	await page.goto('/palavras');
	await expect(page.getByTestId('idioma-ativo').first()).toHaveText('EN');
	await saveWord(page, 'however', 'porém');
	await expect(rows(page)).toHaveCount(1);

	const menu = page.getByRole('complementary', { name: 'Navegação' });
	await menu.getByLabel(/Trocar idioma/).click();
	await menu.getByRole('menuitemradio', { name: /Italiano/ }).click();
	await expect(menu.getByTestId('idioma-ativo')).toHaveText('IT');
	await expect(page.getByText('Seu banco está vazio')).toBeVisible();

	const dialog = await saveWord(page, 'magari', 'quem dera');
	await expect(dialog).toBeHidden();
	await expect(rows(page)).toHaveCount(1);
	await expect(rows(page).first()).toContainText('magari');

	// A escolha fica no cookie: recarregar mantém o italiano.
	await page.reload();
	await expect(menu.getByTestId('idioma-ativo')).toHaveText('IT');
	await expect(rows(page)).toHaveCount(1);
});

test('adicionar idioma pelo seletor grava e já troca para ele', async ({ page }) => {
	await login(page);
	const menu = page.getByRole('complementary', { name: 'Navegação' });
	await menu.getByLabel(/Trocar idioma/).click();
	await menu.getByRole('link', { name: 'Adicionar idioma' }).click();
	await menu.getByRole('button', { name: /Espanhol/ }).click();
	await expect(toast(page)).toHaveText('Espanhol adicionado aos seus idiomas');
	await expect(menu.getByTestId('idioma-ativo')).toHaveText('ES');

	await page.goto('/perfil');
	await expect(page.getByRole('list', { name: 'Seus idiomas' })).toContainText('Espanhol');
});

test.describe('sem JavaScript', () => {
	test.use({ javaScriptEnabled: false });

	test('o link Guardar abre o diálogo e o formulário comum guarda', async ({ page }) => {
		await login(page);
		await page.goto('/palavras?guardar');
		const dialog = page.getByRole('dialog', { name: /Guardar em/ });
		await expect(dialog).toBeVisible();
		await dialog.getByRole('textbox', { name: 'Palavra' }).fill('magari');
		await dialog.getByLabel('Tradução').fill('quem dera');
		await dialog.getByRole('button', { name: 'Guardar' }).click();
		await expect(rows(page)).toHaveCount(1);
		await expect(rows(page).first()).toContainText('magari');
	});
});
