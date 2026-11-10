import { expect, test, type Page } from '@playwright/test';
import { login, SUPABASE_URL } from '../../e2e/auth.ts';

async function addWord(
	page: Page,
	w: { term: string; translation: string; lang?: 'EN' | 'IT'; context?: string }
) {
	const form = page.getByRole('form', { name: 'Guardar palavra' });
	await form.getByLabel('Palavra ou expressão').fill(w.term);
	await form.getByLabel('Tradução').fill(w.translation);
	await form.getByRole('radio', { name: w.lang ?? 'EN' }).check();
	if (w.context) await form.getByLabel('Contexto').fill(w.context);
	await form.getByRole('button', { name: 'Guardar' }).click();
	await expect(form.getByRole('status')).toHaveText(`“${w.term}” guardada.`);
}

const header = (page: Page) => page.getByRole('navigation', { name: 'Principal' });

test('sem login, /revisar manda para /entrar', async ({ page }) => {
	await page.goto('/revisar');
	await expect(page).toHaveURL(/\/entrar\?next=%2Frevisar$/);
});

test('anon não lê cartões nem logs pela API', async () => {
	const key = process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;
	test.skip(!key, 'PUBLIC_SUPABASE_PUBLISHABLE_KEY não definido');
	for (const table of ['cards', 'review_logs', 'user_settings']) {
		const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*`, {
			headers: { apikey: key!, authorization: `Bearer ${key}` }
		});
		expect(res.ok, table).toBe(false);
	}
});

test('revisão: pausar, virar, avaliar, desfazer, teclado, resumo e estado vazio', async ({
	page
}) => {
	await login(page);
	await expect(header(page).getByRole('link', { name: /Revisar/ })).not.toContainText(
		'para revisar'
	);

	await addWord(page, {
		term: 'give up',
		translation: 'desistir',
		context: "Don't give up on me."
	});
	await addWord(page, { term: 'allora', translation: 'então', lang: 'IT' });
	await addWord(page, { term: 'magari', translation: 'quem dera', lang: 'IT' });

	// Toda palavra vira cartão.
	await expect(header(page).getByRole('link', { name: 'Revisar 3 para revisar' })).toBeVisible();

	// Pausada não entra na revisão.
	await page.getByRole('button', { name: 'Pausar “magari” na revisão' }).click();
	await expect(page.getByRole('listitem').filter({ hasText: 'magari' })).toContainText('Pausada');
	await expect(header(page).getByRole('link', { name: 'Revisar 2 para revisar' })).toBeVisible();

	await page.getByRole('link', { name: /2 para revisar.*Leva poucos minutos/ }).click();
	await expect(page).toHaveURL(/\/revisar$/);

	const progresso = page.getByRole('progressbar', { name: 'Progresso da sessão' });
	await expect(progresso).toHaveAttribute('aria-valuenow', '0');

	// Novos saem por ordem de criação: "give up" primeiro.
	await expect(page.getByRole('button', { name: /give up/ })).toBeVisible();
	await page.getByRole('button', { name: 'Mostrar resposta' }).click();

	const cartao = page.getByRole('region', { name: 'Cartão' });
	await expect(cartao).toContainText('desistir');
	await expect(cartao.locator('mark')).toHaveText('give up');
	await expect(cartao.getByText('Origem: Adicionada à mão')).toBeAttached();
	await expect(cartao.getByRole('button', { name: 'Ouvir' })).toBeVisible();

	const notas = page.getByRole('form', { name: 'Como foi?' });
	await expect(notas.getByRole('button')).toHaveText([
		/De novo\s*\d+ min/,
		/Difícil/,
		/Bom\s*\d+ (h|d)/,
		/Fácil\s*\d+ (d|mês|meses)/
	]);

	// De novo: o cartão volta para o fim da fila (vence em minutos).
	await notas.getByRole('button', { name: /De novo/ }).click();
	await expect(page.getByRole('button', { name: /allora/ })).toBeVisible();
	await expect(page.getByText('1/3')).toBeVisible();

	// Desfazer devolve "give up" ao topo, como novo.
	await page.getByRole('button', { name: /Desfazer/ }).click();
	await expect(page.getByRole('button', { name: /give up/ })).toBeVisible();
	await expect(page.getByText('0/2')).toBeVisible();
	await expect(progresso).toHaveAttribute('aria-valuenow', '0');

	// Teclado: Espaço vira, 3 = Bom, 4 = Fácil.
	await page.keyboard.press('Space');
	await expect(cartao).toContainText('desistir');
	await page.keyboard.press('3');
	await expect(page.getByRole('button', { name: /allora/ })).toBeVisible();
	await expect(progresso).toHaveAttribute('aria-valuenow', '50');

	await page.keyboard.press('Space');
	await expect(cartao).toContainText('então');
	await page.keyboard.press('4');

	await expect(page.getByRole('heading', { name: 'Sessão concluída!' })).toBeVisible();
	await expect(page.getByText('2 de 2')).toBeVisible();
	await expect(page.getByText(/O próximo cartão vence/)).toBeVisible();
	await expect(header(page).getByRole('link', { name: 'Revisar' })).toHaveText(/^\s*Revisar\s*$/);

	// Z desfaz a última nota mesmo no resumo.
	await page.keyboard.press('z');
	await expect(page.getByRole('button', { name: /allora/ })).toBeVisible();
	await page.keyboard.press('Space');
	await page.keyboard.press('3');
	await expect(page.getByRole('heading', { name: 'Sessão concluída!' })).toBeVisible();

	// Recarregar: nada vencido, estado vazio diz quando volta.
	await page.reload();
	await expect(page.getByRole('heading', { name: 'Nada para revisar agora' })).toBeVisible();
	await expect(page.getByText(/O próximo cartão vence (hoje|amanhã|\d\d\/\d\d) às/)).toBeVisible();

	// Retomar a pausada traz o cartão de volta.
	await page.getByRole('link', { name: 'Ir para Minhas palavras' }).click();
	await page.getByRole('button', { name: 'Retomar “magari” na revisão' }).click();
	await expect(page.getByRole('listitem').filter({ hasText: 'magari' })).not.toContainText(
		'Pausada'
	);
	await expect(header(page).getByRole('link', { name: 'Revisar 1 para revisar' })).toBeVisible();
	await header(page)
		.getByRole('link', { name: /Revisar/ })
		.click();
	await expect(page).toHaveURL(/\/revisar$/);
	await expect(page.getByRole('button', { name: /magari.*Toque para virar/ })).toBeVisible();
});
