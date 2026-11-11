// Prints do jogo de música. Uso: node prototypes/musica-jogo-shots/shots.cjs
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'node_modules/.bun/playwright@1.65.0/node_modules/playwright'));
const OUT = __dirname;
const URL = 'file://' + path.join(ROOT, 'prototypes/musica-jogo.html');
const erros = [];
const espera = ms => new Promise(r => setTimeout(r, ms));
const estado = (page, s) => page.waitForFunction(s => window.__jogo.estado === s, s, { timeout: 30000 });

async function responde(page, certo) {
  await estado(page, 'espera');
  const resp = await page.evaluate(() => window.__jogo.resp);
  const ops = page.locator('#ops .op');
  const n = await ops.count();
  for (let i = 0; i < n; i++) {
    const t = (await ops.nth(i).getAttribute('data-o'));
    if ((t === resp) === certo) { await ops.nth(i).click(); return; }
  }
}

async function roda(nome, vp, mobile) {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: vp, deviceScaleFactor: mobile ? 2 : 1, hasTouch: mobile, isMobile: mobile });
  page.on('pageerror', e => erros.push(`[${nome}] pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') erros.push(`[${nome}] console: ${m.text()}`); });
  page.on('requestfailed', r => erros.push(`[${nome}] requestfailed: ${r.url()}`));
  await page.goto(URL);
  await espera(300);
  await page.screenshot({ path: `${OUT}/MJ-01-inicio-${nome}.png` });

  await page.click('.dif[data-d="medio"]');
  await page.click('#iGo');
  // 1ª lacuna: escolhendo
  await estado(page, 'espera');
  await espera(1200);
  await page.screenshot({ path: `${OUT}/MJ-02-escolhendo-${nome}.png` });
  await responde(page, true);
  await espera(250);
  await page.screenshot({ path: `${OUT}/MJ-03-acertou-${nome}.png` });
  // 2ª lacuna: errou
  await responde(page, false);
  await espera(350);
  await page.screenshot({ path: `${OUT}/MJ-04-errou-${nome}.png` });
  await page.waitForFunction(() => document.querySelector('#estadoTxt').textContent.includes('devagar'), null, { timeout: 8000 });
  await espera(900);
  await page.screenshot({ path: `${OUT}/MJ-05-repete-devagar-${nome}.png` });
  // 3ª lacuna: cartão de palavra
  await estado(page, 'espera');
  await page.locator('.lin.atual .w').first().click();
  await espera(300);
  await page.screenshot({ path: `${OUT}/MJ-06-cartao-${nome}.png` });
  // salva uma palavra que não está no banco
  await page.click('#ctX');
  const livre = page.locator('.lin.atual .w[data-k="loud"]');
  await livre.click();
  await espera(200);
  await page.click('#ctSalvar');
  await espera(330);
  await page.screenshot({ path: `${OUT}/MJ-07-lingua-${nome}.png` });
  await espera(900);
  // pula uma, sem PT, e responde o resto
  await page.click('#bPt');
  await responde(page, true);
  await estado(page, 'espera');
  await espera(400);
  await page.screenshot({ path: `${OUT}/MJ-08-sem-pt-${nome}.png` });
  await page.click('#bPt');
  await page.click('#bPular');
  await responde(page, false);
  await responde(page, true);
  await page.waitForSelector('#fim:not([hidden])', { timeout: 40000 });
  await espera(500);
  await page.screenshot({ path: `${OUT}/MJ-09-resumo-${nome}.png` });
  await page.click('#fSalvarTodas');
  await espera(4000);
  await page.screenshot({ path: `${OUT}/MJ-10-resumo-salvas-${nome}.png` });
  // italiano
  await page.click('#fDeNovo');
  await page.click('.seg button[data-l="it"]');
  await page.click('.dif[data-d="dificil"]');
  await espera(200);
  await page.screenshot({ path: `${OUT}/MJ-11-inicio-it-${nome}.png` });
  await page.click('#iGo');
  await responde(page, true);
  await estado(page, 'espera');
  await espera(1000);
  await page.screenshot({ path: `${OUT}/MJ-12-it-escolhendo-${nome}.png` });
  await browser.close();
}

(async () => {
  await roda('d', { width: 1440, height: 900 }, false);
  await roda('m', { width: 400, height: 820 }, true);
  console.log(erros.length ? erros.join('\n') : 'sem erros no console');
})().catch(e => { console.error(e); console.log(erros.join('\n')); process.exit(1); });
