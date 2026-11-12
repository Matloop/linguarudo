import { expect, test, type Page } from '@playwright/test';
import { login, saveWord } from '../../e2e/auth.ts';
import { installFakeYoutube } from '../../e2e/fake-youtube.ts';
import { VERSES, VIDEOS } from '../../e2e/fixtures.ts';

// O app roda de verdade; só o YouTube (script da IFrame API) e o LRCLIB/oEmbed (servidor falso
// em src/e2e/mock-sources.ts) são falsos. Os versos são inventados.

type Fake = {
	playing: boolean;
	time: number;
	rate: number;
	log: string[];
	count(name: string): number;
};
declare global {
	interface Window {
		__fakeYT: Fake;
	}
}

const playing = (page: Page) => page.evaluate(() => window.__fakeYT.playing);
const calls = (page: Page, name: string) => page.evaluate((n) => window.__fakeYT.count(n), name);

async function addWord(page: Page, lemma: string, sense: string) {
	await page.goto('/palavras');
	const dialog = await saveWord(page, lemma, sense);
	await expect(dialog).toBeHidden();
	await expect(page.locator('.toast[role="status"]')).toHaveText(`“${lemma}” guardada.`);
}

const bankItem = (page: Page, lemma: string) =>
	page.getByRole('list', { name: 'Palavras' }).getByRole('link').filter({ hasText: lemma });

async function pickSong(
	page: Page,
	video: { id: string; title: string; artist: string },
	lang = 'Inglês'
) {
	await page.goto('/musica');
	await page.getByLabel('Link do YouTube').fill(`https://www.youtube.com/watch?v=${video.id}`);
	// O título e o artista vêm do oEmbed (falso) e não pisam no que já foi escrito.
	await expect(page.getByLabel('Título da música')).toHaveValue(video.title);
	await expect(page.getByLabel('Artista')).toHaveValue(video.artist);
	await page.getByRole('radio', { name: lang === 'Inglês' ? /^(Inglês|English)$/ : lang }).check();
	await page.getByRole('button', { name: 'Jogar' }).click();
	await expect(page).toHaveURL(/\/musica\/[0-9a-f-]{36}$/);
}

type Level = 'Iniciante' | 'Intermediário' | 'Avançado' | 'Especialista';
const level = (page: Page, name: Level) =>
	page.getByRole('group', { name: 'Dificuldade' }).getByRole('button', { name: new RegExp(name) });

/** Tocar no nível já começa o jogo. */
async function begin(page: Page, difficulty: Level = 'Iniciante') {
	await level(page, difficulty).click();
	await expect(page.getByTestId('estado')).toBeVisible();
}

/** Palavra que falta na linha: o verso original menos o que está na tela. */
async function missingWord(page: Page, line: number): Promise<string> {
	const shown = await page.locator(`.lin[data-line="${line}"] .txt`).innerText();
	const present = new Set(shown.toLowerCase().match(/[a-z']+/g) ?? []);
	const missing = VERSES[line].split(' ').filter((w) => !present.has(w.toLowerCase()));
	expect(missing, `linha ${line}: "${shown}"`).toHaveLength(1);
	return missing[0];
}

const option = (page: Page, word: string) =>
	page.getByRole('button', { name: new RegExp(`^\\d\\s*${word}$`, 'i') });

async function answerLine(page: Page, line: number, correct: boolean) {
	await expect(page.locator(`.lin[data-line="${line}"] .gap.alvo`)).toBeVisible({
		timeout: 20_000
	});
	const word = await missingWord(page, line);
	if (correct) {
		await option(page, word).click();
		return word;
	}
	const wrong = page
		.locator('.op:not(.vazia)')
		.filter({ hasNotText: new RegExp(`^\\d\\s*${word}$`, 'i') })
		.first();
	await wrong.click();
	return word;
}

test('sem login, /musica manda para /entrar', async ({ page }) => {
	await page.goto('/musica');
	await expect(page).toHaveURL(/\/entrar\?next=%2Fmusica$/);
});

test('escolher a música: oEmbed preenche título e artista, e a música vira "tocada recentemente"', async ({
	page
}) => {
	await installFakeYoutube(page);
	await login(page);
	await page
		.getByRole('navigation', { name: 'Principal' })
		.getByRole('link', { name: 'Música' })
		.click();
	await expect(page).toHaveURL(/\/musica$/);
	await expect(page.getByText('Nenhuma música ainda.')).toBeVisible();

	// Link inválido: erro em português, sem sair da tela.
	await page.getByLabel('Link do YouTube').fill('isso não é um link');
	await page.getByLabel('Título da música').fill('Qualquer');
	await page.getByLabel('Artista').fill('Qualquer');
	await page.getByRole('button', { name: 'Jogar' }).click();
	await expect(page.getByText('Cole um link de vídeo do YouTube.')).toBeVisible();

	await page.getByLabel('Título da música').fill('');
	await page.getByLabel('Artista').fill('');
	await pickSong(page, VIDEOS.ok);
	await expect(page.getByRole('dialog', { name: VIDEOS.ok.title })).toBeVisible();

	await page.goto('/musica');
	const recent = page.getByRole('region', { name: 'Tocadas recentemente' });
	await expect(recent.getByRole('link', { name: new RegExp(VIDEOS.ok.title) })).toBeVisible();
	await expect(recent).toContainText('EN');
});

test('outra pessoa não abre a música de um usuário', async ({ page, browser }) => {
	await installFakeYoutube(page);
	await login(page);
	await pickSong(page, VIDEOS.ok);
	const url = page.url();

	const other = await browser.newContext({ baseURL: 'http://localhost:4173' });
	const otherPage = await other.newPage();
	await login(otherPage);
	const res = await otherPage.goto(url);
	expect(res?.status()).toBe(404);
	await other.close();
});

test('música sem letra sincronizada e serviço fora do ar mostram mensagem clara', async ({
	page
}) => {
	await installFakeYoutube(page);
	await login(page);

	await pickSong(page, VIDEOS.noLyrics);
	await expect(page.getByRole('alert')).toContainText('Não achei letra sincronizada');
	await expect(page.getByRole('group', { name: 'Dificuldade' })).toHaveCount(0);

	await pickSong(page, VIDEOS.down);
	await expect(page.getByRole('alert')).toContainText('O serviço de letras não respondeu');
	await expect(page.getByRole('button', { name: 'Tentar de novo' })).toBeVisible();
});

test('jogo: responde com a música tocando, espera, pausa, fim de jogo e resumo salva as erradas', async ({
	page
}) => {
	test.setTimeout(120_000);
	await installFakeYoutube(page, 2);
	await login(page);
	await pickSong(page, VIDEOS.ok);

	// 43 palavras: 15%, 30%, metade e todas.
	// Iniciante cai nas linhas 0, 1, 3, 4, 5 e 7.
	await expect(level(page, 'Iniciante')).toContainText('6 de 43 palavras');
	await expect(level(page, 'Intermediário')).toContainText('13 de 43 palavras');
	await expect(level(page, 'Avançado')).toContainText('22 de 43 palavras');
	await expect(level(page, 'Especialista')).toContainText('43 de 43 palavras');
	await begin(page, 'Iniciante');
	expect(await calls(page, 'seek:0')).toBe(1);
	expect(await playing(page)).toBe(true);

	// 1) Responder enquanto a linha toca: acerta, soma 100, combo ×2, o vídeo não para.
	await answerLine(page, 0, true);
	await expect(page.getByTestId('pontos')).toContainText('100');
	await expect(page.getByTestId('combo')).toHaveText('×2');
	expect(await playing(page)).toBe(true);

	// 2) Linha com lacuna que acaba sem resposta: o vídeo pausa sozinho e aparece o contador.
	await expect(page.getByTestId('estado')).toContainText('A música espera você', {
		timeout: 20_000
	});
	expect(await playing(page)).toBe(false);
	await expect(page.getByTestId('contador')).toBeVisible();
	const pausesBefore = await calls(page, 'pause');

	// Pausa manual congela o contador.
	await page.keyboard.press('Space');
	await expect(page.getByTestId('estado')).toHaveText('Pausado');
	const frozen = await page.getByTestId('contador').count();
	expect(frozen).toBe(0);
	await page.waitForTimeout(1500);
	await page.keyboard.press('Space');
	await expect(page.getByTestId('estado')).toContainText('A música espera você');
	// O contador voltou de onde parou: não recomeçou em 10 s.
	const left = Number((await page.getByTestId('contador').innerText()).replace(/\D/g, ''));
	expect(left).toBeLessThanOrEqual(10);
	expect(await calls(page, 'pause')).toBeGreaterThanOrEqual(pausesBefore);

	// Errar durante a espera: mostra a resposta, zera o combo, retoma o vídeo.
	const word1 = await answerLine(page, 1, false);
	await expect(page.getByTestId('combo')).toHaveText('×1');
	await expect(page.getByTestId('rev-n')).toHaveText('1');
	await expect(page.getByText(`Era “${word1}”`)).toBeVisible();
	await expect.poll(() => playing(page)).toBe(true);

	// 3) Passados 10 s sem resposta: Fim de jogo, com os três botões.
	const gameOver = page.getByRole('alertdialog', { name: 'Fim de jogo' });
	await expect(gameOver).toBeVisible({ timeout: 40_000 });
	expect(await playing(page)).toBe(false);
	await expect(gameOver.getByRole('button', { name: 'Tentar de novo' })).toBeVisible();
	await expect(gameOver.getByRole('button', { name: 'Sair' })).toBeVisible();

	// 4) Continuar jogando: volta ao início da linha 3 (10 s) e a lacuna segue aberta.
	const seeksBefore = await calls(page, 'seek');
	await gameOver.getByRole('button', { name: 'Continuar jogando' }).click();
	await expect(gameOver).toBeHidden();
	expect(await calls(page, 'seek')).toBe(seeksBefore + 1);
	expect(
		await page.evaluate(() => window.__fakeYT.log.filter((l) => l.startsWith('seek:')).at(-1))
	).toBe('seek:10');
	await expect(page.getByTestId('combo')).toHaveText('×1');

	// 5) Acertar com o atalho do teclado (tecla 1–4 da opção certa): 100 + 100.
	await expect(page.locator('.lin[data-line="3"] .gap.alvo')).toBeVisible({ timeout: 20_000 });
	const word3 = await missingWord(page, 3);
	const label = await option(page, word3).innerText();
	await page.keyboard.press(label.trim()[0]);
	await expect(page.getByTestId('pontos')).toContainText('200');
	for (const line of [4, 5, 7]) await answerLine(page, line, true);

	// 6) Resumo: 5 de 6 de primeira, e salvar a errada manda para o banco.
	const summary = page.getByRole('dialog', { name: 'Música fechada!' });
	await expect(summary).toBeVisible({ timeout: 30_000 });
	await expect(summary.getByText('5/6')).toBeVisible();
	await expect(summary.getByText(word1, { exact: false })).toBeVisible();
	await expect(page.getByTestId('banco')).toHaveText('0');
	await summary.getByRole('button', { name: 'Salvar a errada' }).click();
	await expect(summary.getByRole('button', { name: 'Erradas no banco' })).toBeVisible();
	await expect(page.getByTestId('banco')).toHaveText('1');

	// A palavra foi para "Minhas palavras" com um encontro: o verso e a música.
	await page.goto('/palavras');
	const item = bankItem(page, word1.toLowerCase());
	await expect(item).toBeVisible();
	await expect(item).toContainText(VERSES[1]);
	await item.click();
	await expect(page.getByRole('region', { name: /^Detalhes de/ })).toContainText(
		`${VIDEOS.ok.title} · ${VIDEOS.ok.artist}`
	);
});

test('errar não salva no banco sozinho; tentar de novo zera o jogo; sair volta para /musica', async ({
	page
}) => {
	test.setTimeout(90_000);
	await installFakeYoutube(page, 2);
	await login(page);
	await pickSong(page, VIDEOS.ok);
	await begin(page);

	await answerLine(page, 0, false);
	await expect(page.getByTestId('rev-n')).toHaveText('1');
	await expect(page.getByTestId('banco')).toHaveText('0');

	// Deixa a lacuna da linha 1 vencer.
	const gameOver = page.getByRole('alertdialog', { name: 'Fim de jogo' });
	await expect(gameOver).toBeVisible({ timeout: 40_000 });
	await gameOver.getByRole('button', { name: 'Tentar de novo' }).click();
	await expect(gameOver).toBeHidden();
	await expect(page.getByTestId('pontos')).toContainText('0');
	await expect(page.getByTestId('rev-n')).toHaveText('0');
	expect(
		await page.evaluate(() => window.__fakeYT.log.filter((l) => l.startsWith('seek:')).at(-1))
	).toBe('seek:0');

	await expect(gameOver).toBeVisible({ timeout: 40_000 });
	await gameOver.getByRole('button', { name: 'Sair' }).click();
	await expect(page).toHaveURL(/\/musica$/);
});

test('palavras do banco viram lacuna primeiro; o cartão mostra o sentido, ouve e salva', async ({
	page
}) => {
	test.setTimeout(90_000);
	await installFakeYoutube(page, 1);
	await login(page);
	await addWord(page, 'harbor', 'porto');
	await pickSong(page, VIDEOS.ok);

	await begin(page);

	// A lacuna da linha 1 é a palavra do banco.
	expect(await missingWord(page, 1)).toBe('harbor');

	// Tocar numa palavra pausa o jogo e abre o cartão; "No seu banco" mostra o sentido.
	await page.locator('.lin[data-line="0"] .w', { hasText: 'meadow' }).click();
	const card = page.getByRole('dialog', { name: 'meadow' });
	await expect(card).toBeVisible();
	await expect(page.getByTestId('estado')).toHaveText('Pausado');
	expect(await playing(page)).toBe(false);
	await expect(card.getByRole('button', { name: 'Ouvir' })).toBeVisible();

	// Salvar com sentido próprio.
	await card.getByLabel(/Sentido/).fill('prado');
	await card.getByRole('button', { name: 'Salvar' }).click();
	await expect(card).toBeHidden();
	await expect(page.getByTestId('banco')).toHaveText('2');
	// Fechou o cartão: o jogo volta a tocar.
	await expect.poll(() => playing(page)).toBe(true);

	// Agora "meadow" está no banco: o cartão mostra o sentido e não oferece Salvar de novo.
	await page.locator('.lin[data-line="0"] .w', { hasText: 'meadow' }).click();
	const again = page.getByRole('dialog', { name: 'meadow' });
	await expect(again).toContainText('prado');
	await expect(again.getByRole('button', { name: 'Já no seu banco' })).toBeDisabled();
	await page.keyboard.press('Escape');
	await expect(again).toBeHidden();

	await page.goto('/palavras');
	await expect(bankItem(page, 'meadow')).toContainText('prado');
	await expect(bankItem(page, 'meadow')).toContainText(VERSES[0]);
});

test('R repete a linha: o vídeo volta ao início dela', async ({ page }) => {
	await installFakeYoutube(page, 1);
	await login(page);
	await pickSong(page, VIDEOS.ok);
	await begin(page);

	// A linha 0 tem lacuna: responde para a música seguir até a linha 1.
	await answerLine(page, 0, true);
	await expect(page.locator('.lin[data-line="1"].atual')).toBeVisible({ timeout: 15_000 });
	await page.keyboard.press('r');
	await expect
		.poll(() =>
			page.evaluate(() => window.__fakeYT.log.filter((l) => l.startsWith('seek:')).at(-1))
		)
		.toBe('seek:4');
});

test('Especialista esconde todas as palavras e a linha se responde da esquerda para a direita', async ({
	page
}) => {
	await installFakeYoutube(page, 1);
	await login(page);
	await pickSong(page, VIDEOS.ok);
	await begin(page, 'Especialista');

	const first = page.locator('.lin[data-line="0"]');
	await expect(first.locator('.gap')).toHaveCount(6);
	await expect(first.locator('.gap').first()).toHaveClass(/alvo/, { timeout: 15_000 });
	await option(page, 'Lantern').click();
	await expect(first.locator('.gap')).toHaveCount(5);
	await expect(first.locator('.gap').first()).toHaveClass(/alvo/);
	await option(page, 'light').click();
	await expect(page.getByTestId('pontos')).toContainText('300');
	await expect(first).toContainText('Lantern light');
});

test('no celular o vídeo e as opções cabem na tela', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await installFakeYoutube(page, 1);
	await login(page);
	await pickSong(page, VIDEOS.ok);
	await begin(page);
	await expect(page.locator('.video-host')).toBeVisible();
	const box = await page.locator('.video-host').boundingBox();
	expect(box!.width).toBeGreaterThanOrEqual(200);
	expect(box!.height).toBeGreaterThanOrEqual(112);
	await expect(page.locator('.ops')).toBeVisible();
	const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
	expect(overflow).toBe(false);
});

test('sincronia: clipe mostra o palpite e outra versão da letra fica salva na música', async ({
	page
}) => {
	await installFakeYoutube(page);
	await login(page);
	await pickSong(page, VIDEOS.clip);

	// O vídeo tem 12 s a mais que a faixa do LRCLIB: a letra é achada mesmo assim e vem o aviso.
	const dica = page.getByTestId('dica-sincronia');
	await expect(dica).toContainText('12,0 s a mais que a música');
	await expect(dica.getByRole('button', { name: /^Aplicar/ })).toHaveCount(0);

	// Outras versões: a ao vivo (70 s) troca a letra e fica salva.
	await dica.getByRole('button', { name: 'Ver outras versões' }).click();
	const versoes = page.getByTestId('versoes');
	await expect(versoes).toContainText('Ao Vivo');
	await Promise.all([
		page.waitForRequest((r) => r.url().includes('/musica/letra') && r.url().includes('id=3')),
		page.waitForResponse((r) => r.url().includes('/musica/sincronia') && r.ok()),
		versoes.getByRole('button', { name: /Ao Vivo/ }).click()
	]);

	const letra = page.waitForRequest((r) => r.url().includes('/musica/letra'));
	await page.reload();
	expect((await letra).url()).toContain('id=3');
	await expect(page.getByRole('group', { name: 'Dificuldade' })).toBeVisible();
});

test('sincronia: ignorar o palpite também fica salvo', async ({ page }) => {
	await installFakeYoutube(page);
	await login(page);
	await pickSong(page, VIDEOS.clip);
	// Salvar é em segundo plano: espera a resposta antes de recarregar.
	await Promise.all([
		page.waitForResponse((r) => r.url().includes('/musica/sincronia') && r.ok()),
		page.getByTestId('dica-sincronia').getByRole('button', { name: 'Ignorar' }).click()
	]);
	await expect(page.getByTestId('dica-sincronia')).toBeHidden();
	await page.reload();
	await expect(page.getByRole('group', { name: 'Dificuldade' })).toBeVisible();
	await expect(page.getByTestId('dica-sincronia')).toHaveCount(0);
});

test('sincronia: não mexe no vídeo, marca trechos, não pula de linha sozinha, concluir salva e cancelar desfaz', async ({
	page
}) => {
	test.setTimeout(60_000);
	await installFakeYoutube(page);
	await login(page);
	await pickSong(page, VIDEOS.ok);
	// Faixa e vídeo com a mesma duração: sem palpite.
	await expect(page.getByRole('group', { name: 'Dificuldade' })).toBeVisible();
	await expect(page.getByTestId('dica-sincronia')).toHaveCount(0);
	await begin(page);
	await expect.poll(() => page.evaluate(() => window.__fakeYT.time)).toBeGreaterThan(2);

	const log = () => page.evaluate(() => [...window.__fakeYT.log]);
	const panel = page.getByRole('region', { name: 'Sincronizar a letra' });
	const trechos = page.getByTestId('sinc-trechos');
	const gapsBefore = await page.locator('.lin .gap').count();

	// Abrir não manda nada para o player: nem pausa, nem play, nem seek.
	const logBefore = await log();
	await page.keyboard.press('s');
	await expect(panel).toBeVisible();
	await expect(page.getByTestId('estado')).toHaveText('Ajustando a sincronia');
	await page.waitForTimeout(500);
	expect(await log()).toEqual(logBefore);
	expect(await playing(page)).toBe(true);
	// As lacunas continuam escondidas: a sincronia não entrega as respostas.
	await expect(page.locator('.lin .gap')).toHaveCount(gapsBefore);
	await expect(page.locator('.op')).toHaveCount(0);

	// Tocar na linha 2 ancora ela agora.
	await page.locator('.lin[data-line="1"] .lin-alvo').click();
	await expect(trechos.locator('li')).toHaveCount(1);
	await expect(trechos).toContainText('Linha 2 em diante');
	await expect(page.locator('.lin.alvo-sinc')).toHaveCount(1);
	await expect(page.locator('.lin[data-line="1"].alvo-sinc')).toBeVisible();

	// O tempo passa e a linha escolhida não muda sozinha.
	await page.waitForTimeout(2500);
	await expect(page.locator('.lin[data-line="1"].alvo-sinc')).toBeVisible();

	// ↓ escolhe a próxima, Espaço marca: dois trechos.
	await page.keyboard.press('ArrowDown');
	await expect(page.locator('.lin[data-line="2"].alvo-sinc')).toBeVisible();
	await page.keyboard.press('Space');
	await expect(trechos.locator('li')).toHaveCount(2);
	await expect(trechos).toContainText('Linha 3 em diante');

	// Ajuste fino do trecho: Shift+→ soma 1 s, ← tira 0,1 s.
	const marked = await page.getByTestId('sinc-offset').innerText();
	await page.keyboard.press('Shift+ArrowRight');
	await page.keyboard.press('ArrowLeft');
	const num = (s: string) =>
		Number(
			s
				.replace(/[^\d,−+-]/g, '')
				.replace(',', '.')
				.replace('−', '-')
		);
	await expect
		.poll(async () => num(await page.getByTestId('sinc-offset').innerText()) - num(marked))
		.toBeCloseTo(0.9, 5);

	// Desfazer volta o último passo (o −0,1).
	await panel.getByRole('button', { name: 'Desfazer' }).click();
	await expect
		.poll(async () => num(await page.getByTestId('sinc-offset').innerText()) - num(marked))
		.toBeCloseTo(1, 5);
	const tuned = await page.getByTestId('sinc-offset').innerText();

	// Concluir (Enter): salva, avisa e também não mexe no vídeo.
	const logBeforeClose = await log();
	await Promise.all([
		page.waitForResponse((r) => r.url().includes('/musica/sincronia') && r.ok()),
		page.keyboard.press('Enter')
	]);
	await expect(panel).toBeHidden();
	await expect(page.getByText('Sincronia salva.')).toBeVisible();
	expect(await log()).toEqual(logBeforeClose);
	expect(await playing(page)).toBe(true);
	const bar = await page.getByTestId('barra-offset').innerText();

	// Cancelar (Esc) desfaz o que mudou no modo.
	await page.keyboard.press('s');
	await expect(panel).toBeVisible();
	await page.keyboard.press('Shift+ArrowRight');
	await expect(page.getByTestId('sinc-offset')).not.toHaveText(tuned);
	await page.keyboard.press('Escape');
	await expect(panel).toBeHidden();
	await expect(page.getByTestId('barra-offset')).toHaveText(bar);

	// Depois de recarregar, os trechos continuam lá.
	await page.reload();
	await begin(page);
	await page.keyboard.press('s');
	await expect(trechos.locator('li')).toHaveCount(2);
	await expect(trechos).toContainText('Linha 2 em diante');
	await expect(trechos).toContainText('Linha 3 em diante');
	await expect(trechos).toContainText(tuned);
});
