const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = process.env.NEX_STUDIO_URL || 'http://127.0.0.1:8765/';
const PRESENTATION_URL = new URL('apps/presentation/', BASE_URL).href;
const EDGE = process.env.NEX_EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const REPORT = path.join(__dirname, 'results', 'service-worker-report.json');
const EXPECTED_CACHE = process.env.NEX_EXPECTED_CACHE || 'nex-estate-media-studio-unified-v53-final-regression-acceptance-20260826';

async function main() {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const context = await browser.newContext({
    viewport: { width: 1100, height: 760 },
    serviceWorkers: 'allow'
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  try {
    const response = await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    if (!response?.ok()) throw new Error(`HTTP ${response?.status()}`);
    const state = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise(resolve => {
          const timer = setTimeout(resolve, 3000);
          navigator.serviceWorker.addEventListener('controllerchange', () => {
            clearTimeout(timer);
            resolve();
          }, { once: true });
        });
      }
      const cacheNames = await caches.keys();
      const cached = [];
      for (const name of cacheNames) {
        const cache = await caches.open(name);
        cached.push(...(await cache.keys()).map(request => request.url));
      }
      return {
        active: Boolean(registration.active),
        controlled: Boolean(navigator.serviceWorker.controller),
        cacheNames,
        cached
      };
    });
    if (!state.active || !state.controlled) throw new Error('Service worker не управляет страницей');
    if (!state.cacheNames.includes(EXPECTED_CACHE)) throw new Error(`Текущий кэш ${EXPECTED_CACHE} не найден`);
    for (const asset of ['index.html', 'pwa-shell.js', 'apps/presentation/index.html', 'nexestate-logo-reference-clean.png', 'pdf.min.js', 'pdf.worker.min.js']) {
      if (!state.cached.some(url => url.endsWith(asset))) throw new Error(`В кэше нет ${asset}`);
    }

    const presentationResponse = await page.goto(PRESENTATION_URL, { waitUntil: 'domcontentloaded' });
    if (!presentationResponse?.ok()) throw new Error(`Presentation HTTP ${presentationResponse?.status()}`);
    await page.locator('#studioHome').waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForFunction(() => window.NEXESTATE_PRESENTATION_MEDIA_FIX_LOADED === true);

    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.locator('#studioHome').waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForFunction(() => window.NEXESTATE_PRESENTATION_MEDIA_FIX_LOADED === true);
    if (await page.getByRole('button', { name: 'Новая презентация', exact: true }).count() !== 1) throw new Error('Офлайн-каталог Presentation Studio не отрисован');
    if ((await page.locator('#ne80HomeSignature').innerText()).replace(/\s+/g, ' ').trim() !== 'NexEstate Presentation Studio by Эдик Великий') throw new Error('Офлайн-footer Presentation Studio неверен');
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.locator('.app-hub-shell').waitFor({ state: 'visible', timeout: 30000 });
    await page.locator('[data-app-route="presentation"]').click();
    await page.locator('#studioHome').waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(400);
    if (errors.length) throw new Error(`Ошибки офлайн-запуска: ${errors.join(' | ')}`);

    const report = { status: 'passed', baseUrl: BASE_URL, presentationUrl: PRESENTATION_URL, expectedCache: EXPECTED_CACHE, state, offline: { presentationReload: true, hubNavigation: true }, errors };
    fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\nPASS\n`);
  } finally {
    await context.setOffline(false).catch(() => {});
    await context.close();
    await browser.close();
  }
}

main().catch(error => {
  fs.writeFileSync(REPORT, JSON.stringify({ status: 'failed', error: error.message }, null, 2));
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
