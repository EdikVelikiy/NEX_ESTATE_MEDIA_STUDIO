const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = process.env.NEX_STUDIO_URL || 'http://127.0.0.1:8765/';
const EDGE = process.env.NEX_EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const REPORT = path.join(__dirname, 'results', 'service-worker-report.json');

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
    if (!state.cacheNames.includes('nex-estate-media-studio-v2-2-media-fixes')) throw new Error('Кэш v2.2 не найден');
    for (const asset of ['index.html', 'photo-engine.js', 'studio-upgrade.js', 'studio-upgrade.css']) {
      if (!state.cached.some(url => url.endsWith(asset))) throw new Error(`В кэше нет ${asset}`);
    }

    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => document.documentElement.classList.contains('studio-upgrade-ready'));
    if (await page.getByRole('button', { name: 'Фото', exact: true }).count() !== 1) throw new Error('Офлайн-оболочка не отрисована');
    await page.waitForTimeout(400);
    if (errors.length) throw new Error(`Ошибки офлайн-запуска: ${errors.join(' | ')}`);

    const report = { status: 'passed', baseUrl: BASE_URL, state, errors };
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
