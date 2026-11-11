import { expect, test, type Page } from '@playwright/test';
import { login, SUPABASE_URL } from '../../e2e/auth.ts';

/** Só os itens do banco (cada um tem a própria lista de encontros dentro). */
function itemsOf(page: Page) {
	return page.getByRole('list', { name: 'Palavras' }).locator(':scope > li');
}

test('sem login, /palavras manda para /entrar', async ({ page }) => {
	await page.goto('/palavras?lang=it');
	await expect(page).toHaveURL(/\/entrar\?next=%2Fpalavras%3Flang%3Dit$/);
	await expect(page.getByRole('button', { name: 'Entrar com Google' })).toBeVisible();
});

test('anon não lê items nem encounters direto pela API', async () => {
	const key = process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;
	test.skip(!key, 'PUBLIC_SUPABASE_PUBLISHABLE_KEY não definido');
	for (const table of ['items', 'encounters', 'works', 'cards']) {
		const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=id`, {
			headers: { apikey: key!, authorization: `Bearer ${key}` }
		});
		expect(res.ok, table).toBe(false);
	}
});

test('fluxo de palavras: guardar, encontro, duplicata, editar, conhecida, filtrar, apagar', async ({
	page
}) => {
	await login(page);
	await expect(page.getByText('Seu banco está vazio')).toBeVisible();

	const form = page.getByRole('form', { name: 'Guardar palavra' });
	await form.getByLabel('Palavra ou expressão').fill('  give   up ');
	await form.getByLabel('Sentido').fill('desistir');
	await form.getByLabel('Frase').fill('Never give up on the small boat.');
	await form.getByRole('button', { name: 'Guardar' }).click();
	await expect(form.getByRole('status')).toHaveText('“give up” guardada.');
	await expect(form.getByLabel('Palavra ou expressão')).toHaveValue('');

	await form.getByLabel('Palavra ou expressão').fill('allora');
	await form.getByRole('radio', { name: 'IT' }).check();
	await form.getByRole('button', { name: 'Guardar' }).click();
	await expect(form.getByRole('status')).toHaveText('“allora” guardada.');

	const items = itemsOf(page);
	await expect(items).toHaveCount(2);
	await expect(items.first()).toContainText('allora'); // mais recente primeiro
	const giveUp = items.filter({ hasText: 'give up' });
	await expect(giveUp).toContainText('desistir');
	await expect(giveUp.getByRole('list', { name: 'Encontros de “give up”' })).toContainText(
		'Never give up on the small boat.'
	);

	// Mesmo lema (outra caixa) sem frase: nada a acrescentar, mensagem amigável.
	await form.getByLabel('Palavra ou expressão').fill('Give Up');
	await form.getByRole('radio', { name: 'EN' }).check();
	await form.getByRole('button', { name: 'Guardar' }).click();
	await expect(form.getByRole('alert')).toHaveText('“give up” já está no seu banco.');
	await expect(form.getByLabel('Palavra ou expressão')).toHaveValue('Give Up');

	// Com frase, vira um novo encontro do mesmo item.
	await form.getByLabel('Frase').fill('They never give up at night.');
	await form.getByRole('button', { name: 'Guardar' }).click();
	await expect(form.getByRole('status')).toHaveText(
		'“give up” já estava no banco. A frase entrou como novo encontro.'
	);
	await expect(items).toHaveCount(2);
	await expect(
		giveUp.getByRole('list', { name: 'Encontros de “give up”' }).getByRole('listitem')
	).toHaveCount(2);

	// Editar o sentido e a nota.
	await giveUp.getByText('Editar').click();
	await giveUp.getByLabel('Sentido').fill('parar de tentar');
	await giveUp.getByLabel('Nota').fill('phrasal verb');
	await giveUp.getByRole('button', { name: 'Salvar' }).click();
	await expect(giveUp).toContainText('parar de tentar');
	await expect(giveUp).toContainText('phrasal verb');

	// Marcar como conhecida e voltar.
	await page.getByRole('button', { name: 'Marcar “allora” como conhecida' }).click();
	await expect(items.filter({ hasText: 'allora' })).toContainText('Conhecida');
	await page.getByRole('button', { name: 'Voltar “allora” para a revisão' }).click();
	await expect(items.filter({ hasText: 'allora' })).not.toContainText('Conhecida');

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

test('idiomas de estudo mudam o seletor e os filtros', async ({ page }) => {
	await login(page);
	const form = page.getByRole('form', { name: 'Guardar palavra' });
	await expect(form.getByRole('radio')).toHaveCount(2);

	await page.getByText('Idiomas de estudo').click();
	await page.getByRole('checkbox', { name: 'Espanhol' }).check();
	await page.getByRole('checkbox', { name: 'Inglês' }).uncheck();
	await page.getByRole('button', { name: 'Salvar idiomas' }).click();

	await expect(form.getByRole('radio', { name: 'ES' })).toBeVisible();
	await expect(form.getByRole('radio', { name: 'EN' })).toHaveCount(0);
	const filtros = page.getByRole('navigation', { name: 'Filtrar por idioma' });
	await expect(filtros.getByRole('link', { name: 'Espanhol' })).toBeVisible();

	await form.getByLabel('Palavra ou expressão').fill('ojalá');
	await form.getByRole('radio', { name: 'ES' }).check();
	await form.getByRole('button', { name: 'Guardar' }).click();
	await expect(form.getByRole('status')).toHaveText('“ojalá” guardada.');

	// Nenhum idioma marcado é recusado.
	await page.getByText('Idiomas de estudo').click();
	await page.getByRole('checkbox', { name: 'Espanhol' }).uncheck();
	await page.getByRole('checkbox', { name: 'Italiano' }).uncheck();
	await page.getByRole('button', { name: 'Salvar idiomas' }).click();
	await expect(page.getByText('Escolha pelo menos um idioma.')).toBeVisible();
});

test.describe('sem JavaScript', () => {
	test.use({ javaScriptEnabled: false });

	test('guarda, filtra e apaga com formulário comum', async ({ page }) => {
		await login(page);
		await page.getByRole('link', { name: 'Italiano' }).click();

		const form = page.getByRole('form', { name: 'Guardar palavra' });
		await form.getByLabel('Palavra ou expressão').fill('magari');
		await form.getByLabel('Sentido').fill('quem dera');
		await expect(form.getByRole('radio', { name: 'IT' })).toBeChecked();
		await form.getByRole('button', { name: 'Guardar' }).click();

		await expect(form.getByRole('status')).toHaveText('“magari” guardada.');
		await expect(page.getByRole('link', { name: 'Italiano' })).toHaveAttribute(
			'aria-current',
			'page'
		);
		await expect(itemsOf(page)).toHaveCount(1);

		await page.getByRole('button', { name: 'Apagar “magari”' }).click();
		await expect(page.getByText('Nenhuma palavra em italiano ainda.')).toBeVisible();
	});
});
