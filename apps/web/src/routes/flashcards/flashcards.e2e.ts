import { expect, test, type Page } from '@playwright/test';
import { login, restAsUser, saveWord, SUPABASE_URL } from '../../e2e/auth.ts';

async function addWord(page: Page, lemma: string, sense: string, sentence = '') {
	const dialog = await saveWord(page, lemma, sense, sentence);
	await expect(dialog).toBeHidden();
}

const nav = (page: Page) => page.getByRole('navigation', { name: 'Principal' });
const reviewLink = (page: Page) => nav(page).getByRole('link', { name: /^Baralhos/ });
const front = (page: Page) => page.locator('section[aria-label="Frente do flashcard"]');
const back = (page: Page) => page.locator('section[aria-label="Verso do flashcard"]');
const card = (page: Page) => page.getByTestId('flashcard');
const counter = (page: Page) => page.getByTestId('contador');
const grades = (page: Page) => page.getByRole('form', { name: 'Como foi?' });
const endTitle = (page: Page) => page.getByRole('heading', { name: /^Pronto por/ });

/** Nav → hub de baralhos → "Estudar tudo" (navegação no cliente: o player já está hidratado). */
async function study(page: Page) {
	await reviewLink(page).click();
	await expect(page).toHaveURL(/\/flashcards$/);
	await page.getByTestId('estudar-tudo').click();
	await expect(page).toHaveURL(/\/flashcards\/estudar$/);
}

async function markKnown(page: Page, lemma: string, known = true) {
	await page.goto('/palavras');
	await page.getByRole('list', { name: 'Palavras' }).getByRole('link', { name: lemma }).click();
	// "Já sei" / "Revisar de novo" moram no menu ⋯ do painel.
	const menu = page.getByRole('button', { name: 'Mais ações' });
	await menu.click();
	await page.getByRole('button', { name: known ? /^Já sei/ : /^Revisar de novo/ }).click();
	await menu.click();
	await expect(
		page.getByRole('button', { name: known ? /^Revisar de novo/ : /^Já sei/ })
	).toBeVisible();
	await page.keyboard.press('Escape');
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
	await expect(reviewLink(page)).not.toContainText('para hoje');

	await addWord(page, 'give up', 'desistir', 'Never give up on the small boat.');
	await addWord(page, 'however', 'porém');
	await addWord(page, 'maybe', 'talvez');

	// Todo item nasce com um flashcard Reconhecer.
	await expect(reviewLink(page)).toContainText('3 para hoje');

	// Conhecida não entra na revisão.
	await markKnown(page, 'maybe');
	await expect(reviewLink(page)).toContainText('2 para hoje');

	await study(page);

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
		/Bom\s*10 min/,
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
	// Bom num novo vai para o passo de 10 min: volta no fim da fila, como no Anki.
	await page.keyboard.press('3');
	await expect(front(page)).toContainText('however');
	await expect(counter(page)).toHaveText('2 de 3');

	await page.keyboard.press('Space');
	await expect(back(page)).toContainText('porém');
	await expect(front(page).locator('u')).toHaveCount(0); // sem frase, sem destaque
	await page.keyboard.press('3');

	// Bom no último passo forma o flashcard (dias): sai da sessão.
	await expect(front(page)).toContainText('give up');
	await page.keyboard.press('Space');
	await page.keyboard.press('3');
	await expect(front(page)).toContainText('however');
	await expect(progresso).toHaveAttribute('aria-valuenow', '75');
	await page.keyboard.press('Space');
	await page.keyboard.press('3');

	await expect(endTitle(page)).toHaveText('Pronto por hoje');
	await expect(page.getByText('Você revisou 4 flashcards.')).toBeVisible();
	await expect(page.getByTestId('resumo').locator('[data-g="3"] b')).toHaveText('4');
	await expect(reviewLink(page)).not.toContainText('para hoje');

	// Z desfaz a última nota mesmo na tela final.
	await page.keyboard.press('z');
	await expect(front(page)).toContainText('however');
	await page.keyboard.press('Space');
	await page.keyboard.press('3');
	await expect(endTitle(page)).toBeVisible();

	// Recarregar: nada vencido, o estado vazio diz quando volta.
	await page.reload();
	await expect(page.getByRole('heading', { name: 'Nada para revisar' })).toBeVisible();
	await expect(page.getByText(/O próximo flashcard em inglês volta/)).toBeVisible();

	// Voltar a conhecida para a revisão traz o flashcard de volta.
	await markKnown(page, 'maybe', false);
	await expect(reviewLink(page)).toContainText('1 para hoje');
	await study(page);
	await expect(front(page)).toContainText('maybe');
});

/** Flashcards Produzir do usuário, lidos pela API com a sessão da página. */
const produces = (page: Page) =>
	restAsUser<{ id: string; state: number }[]>(page, 'flashcards?select=id,state&kind=eq.produzir');

test('Produzir nasce quando o Reconhecer passa de 7 dias e espera o dia seguinte', async ({
	page
}) => {
	await login(page);
	await addWord(page, 'wait', 'esperar');
	await addWord(page, 'here', '');
	await study(page);

	// Fácil num flashcard novo dá semanas de intervalo.
	for (const lemma of ['wait', 'here']) {
		await expect(front(page)).toContainText(lemma);
		await page.keyboard.press('Space');
		await page.keyboard.press('4');
	}
	// O Produzir nasce novo, mas o irmão foi revisado hoje: só entra amanhã (ADR 0005).
	await expect(endTitle(page)).toHaveText('Pronto por hoje');
	await expect(page.getByText('Você revisou 2 flashcards.')).toBeVisible();

	// Só o item com sentido ganha o Produzir.
	await expect.poll(async () => (await produces(page)).map((c) => c.state)).toEqual([0]);
	await page.reload();
	await expect(page.getByText('Como se diz')).toHaveCount(0);
});

test('desfazer o Fácil do Reconhecer apaga o Produzir que ele liberou', async ({ page }) => {
	await login(page);
	await addWord(page, 'wait', 'esperar');
	await study(page);

	await expect(front(page)).toContainText('wait');
	await page.keyboard.press('Space');
	await page.keyboard.press('4');
	await expect(endTitle(page)).toHaveText('Pronto por hoje');
	await expect.poll(async () => (await produces(page)).length).toBe(1);

	await page.keyboard.press('z');
	await expect(front(page)).toContainText('wait');
	await page.keyboard.press('Space');
	await page.keyboard.press('3');
	// Bom num novo fica no passo de 10 min e volta na sessão.
	await expect(counter(page)).toHaveText('2 de 2');
	await expect(front(page)).toContainText('wait');

	// "Bom" deixa o flashcard em minutos: o Produzir some.
	await expect.poll(async () => (await produces(page)).length).toBe(0);
});

test('a revisão só traz as palavras do idioma ativo', async ({ page }) => {
	await login(page);
	await addWord(page, 'however', 'porém');
	const side = page.getByRole('complementary', { name: 'Navegação' });
	await side.getByLabel(/Trocar idioma/).click();
	await side.getByRole('menuitemradio', { name: /Italiano/ }).click();
	await expect(side.getByTestId('idioma-ativo')).toHaveText('IT');
	await addWord(page, 'magari', 'quem dera');

	await study(page);
	await expect(counter(page)).toHaveText('1 de 1');
	await expect(front(page)).toContainText('magari');
	await page.keyboard.press('Space');
	await page.keyboard.press('4');
	await expect(endTitle(page)).toBeVisible();
	await expect(page.getByText('however')).toHaveCount(0);
});

test('baralhos: criar, mover palavras, página do baralho e estudar só ele', async ({ page }) => {
	await login(page);
	await addWord(page, 'however', 'porém');
	await addWord(page, 'maybe', 'talvez');

	await reviewLink(page).click();
	await expect(page.getByTestId('para-hoje')).toHaveText('2 para hoje');
	// Só o baralho padrão: com a dica e o total de cartas na linha.
	await expect(page.getByText('Separe por tema ou')).toBeVisible();
	await expect(page.getByTestId('hub-sub')).toHaveText('1 baralho · 2 cartas');
	await expect(page.getByTestId('deck-total')).toContainText('2');

	await page.getByRole('button', { name: 'Novo baralho' }).click();
	await page.getByLabel('Nome do baralho').fill('Viagem');
	await page.getByRole('button', { name: 'Criar' }).click();
	await expect(page.getByText('Baralho “Viagem” criado')).toBeVisible();
	await expect(page.getByRole('link', { name: 'Viagem', exact: true })).toBeVisible();

	await page.goto('/palavras');
	await page.getByRole('checkbox', { name: 'Selecionar maybe' }).check();
	await page.getByRole('button', { name: 'Mover para baralho…' }).click();
	await page
		.getByRole('toolbar', { name: 'Ações das palavras' })
		.getByRole('option', { name: 'Viagem' })
		.click();
	await expect(page.getByText('1 palavra movida para Viagem')).toBeVisible();

	await page.goto('/flashcards');
	await page.getByRole('link', { name: 'Viagem', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Viagem' })).toBeVisible();
	await expect(page.getByRole('link', { name: /maybe/ })).toBeVisible();
	await expect(page.getByRole('link', { name: /however/ })).toHaveCount(0);

	await page.getByTestId('estudar-deck').click();
	await expect(page).toHaveURL(/\/flashcards\/estudar\?deck=/);
	await expect(counter(page)).toHaveText('1 de 1');
	await expect(front(page)).toContainText('maybe');
});

test('limites diários do baralho: Este baralho e Só hoje', async ({ page }) => {
	await login(page);
	await addWord(page, 'however', 'porém');
	await addWord(page, 'maybe', 'talvez');
	await addWord(page, 'still', 'ainda');

	await reviewLink(page).click();
	await expect(page.getByTestId('para-hoje')).toHaveText('3 para hoje');

	const limits = page.getByRole('dialog', { name: /^Limites de/ });
	await page.getByTestId('deck-limits').click();
	await limits.getByLabel('Novas por dia', { exact: true }).fill('1');
	await limits
		.getByRole('group', { name: /novas por dia/ })
		.getByRole('button', { name: 'Este baralho' })
		.click();
	await limits.getByRole('button', { name: 'Salvar' }).click();
	await expect(page.getByText('Limites salvos')).toBeVisible();
	await expect(page.getByTestId('para-hoje')).toHaveText('1 para hoje');

	// Só hoje vence o do baralho; ao reabrir, o modo salvo vem marcado.
	await page.getByTestId('deck-limits').click();
	await expect(
		limits
			.getByRole('group', { name: /novas por dia/ })
			.getByRole('button', { name: 'Este baralho' })
	).toHaveAttribute('aria-pressed', 'true');
	await limits.getByLabel('Novas por dia', { exact: true }).fill('2');
	await limits
		.getByRole('group', { name: /novas por dia/ })
		.getByRole('button', { name: 'Só hoje' })
		.click();
	await limits.getByRole('button', { name: 'Salvar' }).click();
	await expect(page.getByTestId('para-hoje')).toHaveText('2 para hoje');

	await page.getByTestId('estudar-tudo').click();
	await expect(counter(page)).toHaveText('1 de 2');
});
