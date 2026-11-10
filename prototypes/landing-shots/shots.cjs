// Prints da landing. Uso: node prototypes/landing-shots/shots.cjs
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'node_modules/.bun/playwright@1.65.0/node_modules/playwright'));
const OUT = __dirname;
const URL = 'file://' + path.join(ROOT, 'prototypes/landing.html');

const erros = [];
const espera = ms => new Promise(r => setTimeout(r, ms));

async function rola(page) {
  // passa pela página inteira para disparar as animações das mini telas
  const h = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < h; y += 400) { await page.evaluate(y => scrollTo(0, y), y); await espera(120); }
  await espera(2200);
  await page.evaluate(() => scrollTo(0, 0));
  await espera(200);
}

async function salva(page, sel) {
  await page.locator(sel).first().scrollIntoViewIfNeeded();
  await page.locator(sel).first().click();
  await page.locator('#ctSalvar').click();
  await espera(1000);
}

async function roda(nome, vp, mobile) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: vp, deviceScaleFactor: mobile ? 2 : 1, hasTouch: mobile, isMobile: mobile });
  page.on('pageerror', e => erros.push(`[${nome}] pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') erros.push(`[${nome}] console: ${m.text()}`); });
  page.on('requestfailed', r => erros.push(`[${nome}] requestfailed: ${r.url()}`));
  await page.goto(URL);
  await espera(400);
  await page.screenshot({ path: `${OUT}/LP-01-topo-${nome}.png` });
  await rola(page);
  await page.screenshot({ path: `${OUT}/LP-00-pagina-${nome}.png`, fullPage: true });

  const pv = page.locator('#previa');
  await pv.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.querySelector('#previa').scrollIntoView({ block: 'start' }));
  await espera(300);
  await pv.screenshot({ path: `${OUT}/LP-02-filme-${nome}.png` });

  // filme: abre cartão
  await page.locator('#fala .pal').first().click();
  await espera(300);
  await pv.screenshot({ path: `${OUT}/LP-03-filme-cartao-${nome}.png` });
  await page.locator('#ctSalvar').click();
  await espera(mobile ? 230 : 200);
  await page.screenshot({ path: `${OUT}/LP-03b-lingua-${nome}.png` });
  await espera(1000);
  await page.locator('#fProx').click();
  await salva(page, '#fala .pal >> nth=1');

  // música: erra uma, acerta duas
  await page.locator('#tab-musica').click();
  await espera(300);
  await pv.screenshot({ path: `${OUT}/LP-04-musica-${nome}.png` });
  await page.locator('#mBaixo .op[data-o="rail"]').click();
  await page.locator('#mBaixo .op[data-o="rain"]').click();
  await page.locator('#mBaixo .op[data-o="hear"]').click();
  await espera(500);
  await pv.screenshot({ path: `${OUT}/LP-05-musica-combo-${nome}.png` });
  await salva(page, '#letra .pal[data-w="hear"]');

  // leitura
  await page.locator('#tab-leitura').click();
  await espera(300);
  await pv.screenshot({ path: `${OUT}/LP-06-leitura-${nome}.png` });
  await page.locator('#livro .pal[data-w="bread"]').click();
  await espera(300);
  await pv.screenshot({ path: `${OUT}/LP-07-leitura-cartao-${nome}.png` });
  await page.locator('#ctSalvar').click();
  await espera(1000);

  // italiano
  await page.locator('.lingua-sel button[data-l="it"]').click();
  await espera(250);
  await pv.screenshot({ path: `${OUT}/LP-08-troca-it-${nome}.png` });
  await espera(800);
  await salva(page, '#livro .pal[data-w="pane"]');
  await page.locator('#tab-filme').click();
  await espera(300);
  await pv.screenshot({ path: `${OUT}/LP-09-banco-${nome}.png` });
  if (mobile) {
    // gaveta é sticky: print de viewport com a cena visível acima
    await page.evaluate(() => document.querySelector('#palco').scrollIntoView({ block: 'start' }));
    await espera(200);
    await page.locator('#gavetaBtn').click();
    await espera(400);
    await page.screenshot({ path: `${OUT}/LP-10-gaveta-viewport-${nome}.png` });
  }

  // FAQ e CTA
  await page.locator('#q4').click();
  await page.locator('#perguntas').scrollIntoViewIfNeeded();
  await page.evaluate(() => document.querySelector('#perguntas').scrollIntoView({ block: 'start' }));
  await espera(400);
  await page.screenshot({ path: `${OUT}/LP-11-faq-${nome}.png` });
  await browser.close();
}

(async () => {
  await roda('d', { width: 1440, height: 900 }, false);
  await roda('m', { width: 400, height: 820 }, true);
  console.log(erros.length ? 'ERROS:\n' + erros.join('\n') : 'Zero erros.');
  process.exit(erros.length ? 1 : 0);
})();
