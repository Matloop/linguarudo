import { expect, test, type Page } from '@playwright/test';
import { login, SUPABASE_URL } from '../../e2e/auth.ts';

async function addWord(
	page: Page,
	w: { lemma: string; sense: string; language?: 'EN' | 'IT'; sentence?: string }
) {
	const form = page.getByRole('form', { name: 'Guardar palavra' });
	await form.getByLabel('Palavra ou expressão').fill(w.lemma);
	await form.getByLabel('Sentido').fill(w.sense);
	await form.getByRole('radio', { name: w.language ?? 'EN' }).check();
	if (w.sentence) await form.getByLabel('Frase').fill(w.sentence);
	await form.getByRole('button', { name: 'Guardar' }).click();
	await expect(form.getByRole('status')).toHaveText(`“${w.lemma}” guardada.`);
}

const bankItem = (page: Page, lemma: string) =>
	page.getByRole('list', { name: 'Palavras' }).locator(':scope > li').filter({ hasText: lemma });

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

test('revisão: conhecida, virar, avaliar, desfazer, teclado, resumo e estado vazio', async ({
	page
}) => {
	await login(page);
	await expect(header(page).getByRole('link', { name: /Revisar/ })).not.toContainText(
		'para revisar'
	);

	await addWord(page, {
		lemma: 'give up',
		sense: 'desistir',
		sentence: 'Never give up on the small boat.'
	});
	await addWord(page, { lemma: 'allora', sense: 'então', language: 'IT' });
	await addWord(page, { lemma: 'magari', sense: 'quem dera', language: 'IT' });

	// Todo item nasce com um cartão Reconhecer.
	await expect(header(page).getByRole('link', { name: 'Revisar 3 para revisar' })).toBeVisible();

	// Conhecida não entra na revisão.
	await page.getByRole('button', { name: 'Marcar “magari” como conhecida' }).click();
	await expect(bankItem(page, 'magari')).toContainText('Conhecida');
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
	await expect(cartao.getByText('Origem: Adicionado à mão')).toBeAttached();
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

	// Teclado: Espaço vira, 3 = Bom. (Fácil libera o Produzir; tem teste próprio.)
	await page.keyboard.press('Space');
	await expect(cartao).toContainText('desistir');
	await page.keyboard.press('3');
	await expect(page.getByRole('button', { name: /allora/ })).toBeVisible();
	await expect(progresso).toHaveAttribute('aria-valuenow', '50');

	await page.keyboard.press('Space');
	await expect(cartao).toContainText('então');
	await expect(cartao.locator('mark')).toHaveCount(0); // sem frase, sem destaque
	await page.keyboard.press('3');

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

	// Voltar a conhecida para a revisão traz o cartão de volta.
	await page.getByRole('link', { name: 'Ir para Minhas palavras' }).click();
	await page.getByRole('button', { name: 'Voltar “magari” para a revisão' }).click();
	await expect(bankItem(page, 'magari')).not.toContainText('Conhecida');
	await expect(header(page).getByRole('link', { name: 'Revisar 1 para revisar' })).toBeVisible();
	await header(page)
		.getByRole('link', { name: /Revisar/ })
		.click();
	await expect(page).toHaveURL(/\/revisar$/);
	await expect(page.getByRole('button', { name: /magari.*Toque para virar/ })).toBeVisible();
});

test('Produzir nasce quando o Reconhecer passa de 7 dias e pede o lema', async ({ page }) => {
	await login(page);
	await addWord(page, { lemma: 'aspettare', sense: 'esperar', language: 'IT' });
	await addWord(page, { lemma: 'ecco', sense: '', language: 'IT' });
	// Navegação no cliente: a página já está hidratada quando as teclas chegam.
	await header(page)
		.getByRole('link', { name: /Revisar/ })
		.click();

	// Fácil num cartão novo dá semanas de intervalo.
	for (const lemma of ['aspettare', 'ecco']) {
		await expect(
			page.getByRole('button', { name: new RegExp(`${lemma}\\s*Toque para virar`) })
		).toBeVisible();
		await page.keyboard.press('Space');
		await page.keyboard.press('4');
	}
	await expect(page.getByRole('heading', { name: 'Sessão concluída!' })).toBeVisible();

	// Só o item com sentido ganha o Produzir.
	await expect(page.getByText('Ainda tem 1 para revisar.')).toBeVisible();
	await page.getByRole('button', { name: 'Continuar revisando' }).click();
	const frente = page.getByRole('button', { name: /Como se diz em italiano\?\s*esperar/ });
	await expect(frente).toBeVisible();
	await expect(frente).not.toContainText('aspettare');
	await page.keyboard.press('Space');
	const cartao = page.getByRole('region', { name: 'Cartão' });
	await expect(cartao).toContainText('aspettare');
	await expect(cartao).toContainText('esperar');

	await page.keyboard.press('3');
	await expect(page.getByRole('heading', { name: 'Sessão concluída!' })).toBeVisible();
});

test('desfazer o Fácil do Reconhecer apaga o Produzir que ele liberou', async ({ page }) => {
	await login(page);
	await addWord(page, { lemma: 'aspettare', sense: 'esperar', language: 'IT' });
	await header(page)
		.getByRole('link', { name: /Revisar/ })
		.click();

	await expect(page.getByRole('button', { name: /aspettare\s*Toque para virar/ })).toBeVisible();
	await page.keyboard.press('Space');
	await page.keyboard.press('4');
	// O cabeçalho já dizia "1 para revisar" antes da nota: espere o fim da sessão.
	await expect(page.getByRole('heading', { name: 'Sessão concluída!' })).toBeVisible();
	await expect(page.getByText('Ainda tem 1 para revisar.')).toBeVisible();

	await page.keyboard.press('z');
	await expect(page.getByRole('button', { name: /aspettare\s*Toque para virar/ })).toBeVisible();
	await page.keyboard.press('Space');
	await page.keyboard.press('3');
	await expect(page.getByRole('heading', { name: 'Sessão concluída!' })).toBeVisible();

	// "Bom" deixa o cartão em minutos: o Produzir não volta.
	await page.goto('/palavras');
	await page.goto('/revisar');
	await expect(page.getByRole('button', { name: /Como se diz/ })).toHaveCount(0);
});
