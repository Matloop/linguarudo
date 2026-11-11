import { expect, test, type Page } from '@playwright/test';
import { login, saveWord, SUPABASE_URL } from '../../e2e/auth.ts';

async function addWord(page: Page, lemma: string, sense: string, sentence = '') {
	const dialog = await saveWord(page, lemma, sense, sentence);
	await expect(dialog).toBeHidden();
}

const nav = (page: Page) => page.getByRole('navigation', { name: 'Principal' });
const reviewLink = (page: Page) => nav(page).getByRole('link', { name: /^Flashcards/ });
const front = (page: Page) => page.locator('section[aria-label="Frente do flashcard"]');
const back = (page: Page) => page.locator('section[aria-label="Verso do flashcard"]');
const card = (page: Page) => page.getByTestId('flashcard');
const counter = (page: Page) => page.getByTestId('contador');
const grades = (page: Page) => page.getByRole('form', { name: 'Como foi?' });
const endTitle = (page: Page) => page.getByRole('heading', { name: /^Pronto por/ });

async function markKnown(page: Page, lemma: string, known = true) {
	await page.goto('/palavras');
	await page.getByRole('list', { name: 'Palavras' }).getByRole('link', { name: lemma }).click();
	const label = known ? `Marcar “${lemma}” como conhecida` : `Voltar “${lemma}” para a revisão`;
	await page.getByRole('button', { name: label }).click();
	await expect(
		page.getByRole('button', {
			name: known ? `Voltar “${lemma}” para a revisão` : `Marcar “${lemma}” como conhecida`
		})
	).toBeVisible();
}

test('sem login, /flashcards manda para /entrar', async ({ page }) => {
	await page.goto('/flashcards');
	await expect(page).toHaveURL(/\/entrar\?next=%2Fflashcards$/);
});

test('anon não lê flashcards nem logs pela API', async () => {
	const key = process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;
	test.skip(!key, 'PUBLIC_SUPABASE_PUBLISHABLE_KEY não definido');
	for (const table of ['flashcards', 'review_logs', 'user_settings']) {
		const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*`, {
			headers: { apikey: key!, authorization: `Bearer ${key}` }
		});
		expect(res.ok, table).toBe(false);
	}
});

test('revisão: conhecida, virar, avaliar, desfazer, teclado, fim e estado vazio', async ({
	page
}) => {
	await login(page);
	await expect(reviewLink(page)).not.toContainText('para revisar');

	await addWord(page, 'give up', 'desistir', 'Never give up on the small boat.');
	await addWord(page, 'however', 'porém');
	await addWord(page, 'maybe', 'talvez');

	// Todo item nasce com um flashcard Reconhecer.
	await expect(reviewLink(page)).toContainText('3 para revisar');

	// Conhecida não entra na revisão.
	await markKnown(page, 'maybe');
	await expect(reviewLink(page)).toContainText('2 para revisar');

	await reviewLink(page).click();
	await expect(page).toHaveURL(/\/flashcards$/);

	const progresso = page.getByRole('progressbar', { name: 'Progresso da revisão' });
	await expect(progresso).toHaveAttribute('aria-valuenow', '0');
	await expect(counter(page)).toHaveText('1 de 2');

	// Novos saem por ordem de criação: "give up" primeiro, com a frase sublinhada.
	await expect(front(page)).toContainText('give up');
	await expect(front(page).locator('u')).toHaveText('give up');
	await expect(grades(page)).toBeHidden();
	await page.getByRole('button', { name: 'Mostrar resposta' }).click();

	await expect(card(page)).toHaveClass(/flipped/);
	await expect(back(page)).toContainText('desistir');
	await expect(grades(page).getByRole('button')).toHaveText([
		/Errei\s*\d+ min/,
		/Difícil/,
		/Bom\s*\d+ (h|d)/,
		/Fácil\s*\d+ (d|mês|meses)/
	]);

	// Errei: o flashcard volta para o fim da fila (vence em minutos).
	await grades(page).getByRole('button', { name: /Errei/ }).click();
	await expect(front(page)).toContainText('however');
	await expect(counter(page)).toHaveText('2 de 3');

	// Desfazer devolve "give up" ao topo, como novo.
	await page.getByRole('button', { name: /Desfazer/ }).click();
	await expect(front(page)).toContainText('give up');
	await expect(counter(page)).toHaveText('1 de 2');
	await expect(progresso).toHaveAttribute('aria-valuenow', '0');

	// Teclado: Espaço vira, 3 = Bom. (Fácil libera o Produzir; tem teste próprio.)
	await page.keyboard.press('Space');
	await expect(card(page)).toHaveClass(/flipped/);
	await page.keyboard.press('3');
	await expect(front(page)).toContainText('however');
	await expect(progresso).toHaveAttribute('aria-valuenow', '50');

	await page.keyboard.press('Space');
	await expect(back(page)).toContainText('porém');
	await expect(front(page).locator('u')).toHaveCount(0); // sem frase, sem destaque
	await page.keyboard.press('3');

	await expect(endTitle(page)).toHaveText('Pronto por hoje');
	await expect(page.getByText('Você revisou 2 palavras.')).toBeVisible();
	await expect(page.getByTestId('resumo').locator('[data-g="3"] b')).toHaveText('2');
	await expect(reviewLink(page)).not.toContainText('para revisar');

	// Z desfaz a última nota mesmo na tela final.
	await page.keyboard.press('z');
	await expect(front(page)).toContainText('however');
	await page.keyboard.press('Space');
	await page.keyboard.press('3');
	await expect(endTitle(page)).toBeVisible();

	// Recarregar: nada vencido, o estado vazio diz quando volta.
	await page.reload();
	await expect(page.getByRole('heading', { name: 'Nada para revisar' })).toBeVisible();
	await expect(page.getByText(/A próxima palavra em inglês volta/)).toBeVisible();

	// Voltar a conhecida para a revisão traz o flashcard de volta.
	await markKnown(page, 'maybe', false);
	await expect(reviewLink(page)).toContainText('1 para revisar');
	await reviewLink(page).click();
	await expect(page).toHaveURL(/\/flashcards$/);
	await expect(front(page)).toContainText('maybe');
});

test('Produzir nasce quando o Reconhecer passa de 7 dias e pede o lema', async ({ page }) => {
	await login(page);
	await addWord(page, 'wait', 'esperar');
	await addWord(page, 'here', '');
	// Navegação no cliente: a página já está hidratada quando as teclas chegam.
	await reviewLink(page).click();

	// Fácil num flashcard novo dá semanas de intervalo.
	for (const lemma of ['wait', 'here']) {
		await expect(front(page)).toContainText(lemma);
		await page.keyboard.press('Space');
		await page.keyboard.press('4');
	}
	await expect(endTitle(page)).toHaveText('Pronto por agora');

	// Só o item com sentido ganha o Produzir.
	await expect(page.getByText('Ainda tem 1 palavra para revisar.')).toBeVisible();
	await page.getByRole('button', { name: 'Continuar revisando' }).click();
	await expect(front(page)).toContainText('Como se diz em inglês?');
	await expect(front(page)).toContainText('esperar');
	await expect(front(page)).not.toContainText('wait');
	await page.keyboard.press('Space');
	await expect(back(page)).toContainText('wait');

	await page.keyboard.press('3');
	await expect(endTitle(page)).toBeVisible();
});

test('desfazer o Fácil do Reconhecer apaga o Produzir que ele liberou', async ({ page }) => {
	await login(page);
	await addWord(page, 'wait', 'esperar');
	await reviewLink(page).click();

	await expect(front(page)).toContainText('wait');
	await page.keyboard.press('Space');
	await page.keyboard.press('4');
	await expect(endTitle(page)).toHaveText('Pronto por agora');
	await expect(page.getByText('Ainda tem 1 palavra para revisar.')).toBeVisible();

	await page.keyboard.press('z');
	await expect(front(page)).toContainText('wait');
	await page.keyboard.press('Space');
	await page.keyboard.press('3');
	await expect(endTitle(page)).toHaveText('Pronto por hoje');

	// "Bom" deixa o flashcard em minutos: o Produzir não volta.
	await page.goto('/palavras');
	await page.goto('/flashcards');
	await expect(page.getByText('Como se diz')).toHaveCount(0);
});

test('a revisão só traz as palavras do idioma ativo', async ({ page }) => {
	await login(page);
	await addWord(page, 'however', 'porém');
	const side = page.getByRole('complementary', { name: 'Navegação' });
	await side.getByLabel(/Trocar idioma/).click();
	await side.getByRole('menuitemradio', { name: /Italiano/ }).click();
	await expect(side.getByTestId('idioma-ativo')).toHaveText('IT');
	await addWord(page, 'magari', 'quem dera');

	await reviewLink(page).click();
	await expect(counter(page)).toHaveText('1 de 1');
	await expect(front(page)).toContainText('magari');
	await page.keyboard.press('Space');
	await page.keyboard.press('3');
	await expect(endTitle(page)).toBeVisible();
	await expect(page.getByText('however')).toHaveCount(0);
});
