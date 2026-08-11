const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const BASE_URL = process.env.NEX_UNIFIED_URL || 'http://127.0.0.1:8771/';
const EDGE = process.env.NEX_EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const REPORT_PATH = path.join(__dirname, 'results', 'unified-pwa-report.json');
const TEMP_DIR = path.join(os.tmpdir(), 'nexestate-unified-pwa-smoke');
const PHOTO_FIXTURE = path.join(__dirname, 'results', 'video-cover.jpg');
const VIDEO_FIXTURE = path.join(__dirname, 'results', 'video-export.mp4');
const PDF_FIXTURE = path.join(TEMP_DIR, 'NexEstate-unified-smoke.pdf');

const report = {
  startedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
  browser: EDGE,
  checks: [],
  consoleErrors: [],
  downloads: []
};

function assert(condition, message, details = null) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

async function check(name, action) {
  const started = Date.now();
  process.stdout.write(`CHECK ${name} ... `);
  try {
    const details = await action();
    report.checks.push({ name, status: 'passed', durationMs: Date.now() - started, details });
    process.stdout.write('PASS\n');
    return details;
  } catch (error) {
    report.checks.push({
      name,
      status: 'failed',
      durationMs: Date.now() - started,
      error: error.message,
      details: error.details || null,
      stack: error.stack
    });
    process.stdout.write(`FAIL: ${error.message}\n`);
    throw error;
  }
}

function url(relative = '') {
  return new URL(relative, BASE_URL).href;
}

function createPdf(filePath) {
  const content = 'BT /F1 18 Tf 72 720 Td (NexEstate unified presentation smoke test with enough embedded searchable text for local PDF import.) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`
  ];
  let output = '%PDF-1.4\n%NexEstate\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach(offset => { output += `${String(offset).padStart(10, '0')} 00000 n \n`; });
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  fs.writeFileSync(filePath, output, 'binary');
}

async function saveDownload(download, label) {
  const suggested = download.suggestedFilename();
  const extension = path.extname(suggested) || path.extname(label);
  const target = path.join(TEMP_DIR, `${path.parse(label).name}${extension}`);
  await download.saveAs(target);
  const size = fs.statSync(target).size;
  assert(size > 100, `Downloaded file is empty: ${suggested}`, { size, target });
  report.downloads.push({ label, suggested, size });
  return { target, suggested, size };
}

function mimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain; charset=utf-8'
  })[extension] || 'application/octet-stream';
}

async function startPagesBaseServer() {
  const prefix = '/NEX_ESTATE_MEDIA_STUDIO/';
  const server = http.createServer((request, response) => {
    const requestPath = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    if (!requestPath.startsWith(prefix)) {
      response.writeHead(404).end('Not found');
      return;
    }
    let relative = requestPath.slice(prefix.length);
    let target = path.resolve(ROOT, relative || '.');
    if (!target.startsWith(ROOT)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    try {
      if (fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
      const body = fs.readFileSync(target);
      response.writeHead(200, {
        'Content-Type': mimeType(target),
        'Cache-Control': 'no-cache',
        'Content-Length': body.length
      });
      response.end(body);
    } catch (_) {
      response.writeHead(404).end('Not found');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}${prefix}`
  };
}

async function waitForServiceWorker(page) {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise(resolve => {
        const timer = setTimeout(resolve, 5000);
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
      });
    }
    return {
      scope: registration.scope,
      scriptURL: registration.active?.scriptURL || '',
      controlled: Boolean(navigator.serviceWorker.controller)
    };
  });
}

async function main() {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  createPdf(PDF_FIXTURE);
  assert(fs.existsSync(PHOTO_FIXTURE), 'Photo fixture is missing', PHOTO_FIXTURE);
  assert(fs.existsSync(VIDEO_FIXTURE), 'Video fixture is missing', VIDEO_FIXTURE);

  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    acceptDownloads: true,
    serviceWorkers: 'allow'
  });
  const page = await context.newPage();
  page.on('pageerror', error => report.consoleErrors.push({ url: page.url(), type: 'pageerror', text: error.message }));
  page.on('console', message => {
    if (message.type() === 'error') report.consoleErrors.push({ url: page.url(), type: 'console', text: message.text() });
  });

  let pagesServer;
  try {
    await check('Главный экран: две точные карточки и изоляция модулей', async () => {
      const response = await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
      assert(response?.ok(), `Hub returned HTTP ${response?.status()}`);
      const cards = page.locator('.app-hub-card');
      assert(await cards.count() === 2, 'Hub must contain exactly two cards');
      const data = await cards.evaluateAll(items => items.map(item => ({
        title: item.querySelector('h2')?.textContent.trim(),
        description: item.querySelector('p')?.textContent.trim(),
        href: item.getAttribute('href')
      })));
      assert(JSON.stringify(data) === JSON.stringify([
        { title: 'Редактор фото и видео', description: 'Обработка фотографий и видео объектов', href: './apps/media/' },
        { title: 'Редактор презентаций', description: 'Создание и экспорт презентаций объектов', href: './apps/presentation/' }
      ]), 'Hub card copy or route differs from the approved specification', data);
      const scripts = await page.locator('script[src]').evaluateAll(items => items.map(item => item.getAttribute('src')));
      assert(!scripts.some(item => /photo-engine|studio-upgrade|presentation/i.test(item)), 'Editor code leaked into the Hub', scripts);
      return { cards: data, scripts };
    });

    await check('Hover, focus, keyboard and reduced motion', async () => {
      const first = page.locator('.app-hub-card').first();
      const second = page.locator('.app-hub-card').nth(1);
      const documentBox = locator => locator.evaluate(element => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height };
      });
      const beforeFirst = await documentBox(first);
      const beforeSecond = await documentBox(second);
      await first.hover();
      await page.waitForTimeout(340);
      const afterFirst = await documentBox(first);
      const afterSecond = await documentBox(second);
      const hoverStyle = await first.evaluate(element => ({
        transform: getComputedStyle(element).transform,
        borderColor: getComputedStyle(element).borderColor,
        boxShadow: getComputedStyle(element).boxShadow
      }));
      assert(afterFirst.width / beforeFirst.width >= 1.045 && afterFirst.width / beforeFirst.width <= 1.075, 'Hover scale is outside 1.05–1.07', { beforeFirst, afterFirst, hoverStyle });
      assert(afterFirst.y < beforeFirst.y - 5, 'Hover card did not lift upward', { beforeFirst, afterFirst });
      assert(Math.abs(afterSecond.x - beforeSecond.x) < 1 && Math.abs(afterSecond.y - beforeSecond.y) < 1, 'Hover shifted the neighboring card', { beforeSecond, afterSecond });
      await second.focus();
      const focusStyle = await second.evaluate(element => ({ active: document.activeElement === element, shadow: getComputedStyle(element).boxShadow }));
      assert(focusStyle.active && focusStyle.shadow !== 'none', 'Keyboard focus is not visibly emphasized', focusStyle);
      await page.keyboard.press('Space');
      await page.waitForURL(/\/apps\/presentation\/$/);
      await page.goBack({ waitUntil: 'domcontentloaded' });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await first.hover();
      await page.waitForTimeout(30);
      const reduced = await first.evaluate(element => ({ transform: getComputedStyle(element).transform, duration: getComputedStyle(element).transitionDuration }));
      assert(reduced.transform === 'none', 'Reduced-motion mode still transforms the card', reduced);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      return { hoverStyle, focusStyle, reduced };
    });

    await check('Мобильная компоновка Hub', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
      const layout = await page.evaluate(() => ({
        viewport: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        cards: [...document.querySelectorAll('.app-hub-card')].map(card => {
          const rect = card.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right };
        })
      }));
      assert(layout.scrollWidth <= layout.viewport, 'Mobile Hub has horizontal overflow', layout);
      assert(layout.cards.every(card => card.x >= 0 && card.right <= layout.viewport), 'A Hub card leaves the mobile viewport', layout);
      assert(layout.cards[1].y > layout.cards[0].y + layout.cards[0].height, 'Mobile Hub cards are not stacked vertically', layout);
      await page.setViewportSize({ width: 1280, height: 800 });
      return layout;
    });

    await check('Навигация, browser Back и сохранение origin-storage', async () => {
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => localStorage.setItem('nexestate-unified-smoke-sentinel', 'preserve'));
      await page.locator('[data-app-route="media"]').click();
      await page.waitForURL(/\/apps\/media\/$/);
      const mediaIsolation = await page.evaluate(() => ({
        manifest: document.querySelector('link[rel="manifest"]')?.href,
        presentationScripts: [...document.scripts].filter(script => /presentation/i.test(script.src)).length,
        sentinel: localStorage.getItem('nexestate-unified-smoke-sentinel')
      }));
      assert(mediaIsolation.presentationScripts === 0 && mediaIsolation.sentinel === 'preserve', 'Media route is not isolated or cleared storage', mediaIsolation);
      await page.goBack({ waitUntil: 'domcontentloaded' });
      assert(new URL(page.url()).pathname === new URL(BASE_URL).pathname, 'Browser Back did not return to Hub', page.url());
      await page.locator('[data-app-route="presentation"]').click();
      await page.waitForURL(/\/apps\/presentation\/$/);
      const presentationIsolation = await page.evaluate(() => ({
        manifest: document.querySelector('link[rel="manifest"]')?.href,
        mediaScripts: [...document.scripts].filter(script => /photo-engine|studio-upgrade|photo-tools/i.test(script.src)).length,
        sentinel: localStorage.getItem('nexestate-unified-smoke-sentinel')
      }));
      assert(presentationIsolation.mediaScripts === 0 && presentationIsolation.sentinel === 'preserve', 'Presentation route is not isolated or cleared storage', presentationIsolation);
      return { mediaIsolation, presentationIsolation };
    });

    await check('Медиаредактор: фото, существующее изменение и скачивание', async () => {
      await page.goto(url('apps/media/'), { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.documentElement.classList.contains('studio-upgrade-ready'));
      await page.locator('#file').setInputFiles(PHOTO_FIXTURE);
      await page.waitForFunction(() => window.NEXPhotoState?.count?.() === 1 && document.querySelector('.photo-canvas-surface canvas')?.width > 0, null, { timeout: 30000 });
      const before = await page.locator('.photo-canvas-surface canvas:not(.photo-tool-preview)').first().evaluate(canvas => ({ width: canvas.width, height: canvas.height, data: canvas.toDataURL('image/png').slice(-128) }));
      await page.getByRole('button', { name: /Улучшить фото/ }).click();
      await page.waitForFunction(() => document.getElementById('litePhotoEnhanceBtn')?.textContent.includes('включено'));
      await page.waitForTimeout(250);
      const after = await page.locator('.photo-canvas-surface canvas:not(.photo-tool-preview)').first().evaluate(canvas => ({ width: canvas.width, height: canvas.height, data: canvas.toDataURL('image/png').slice(-128) }));
      assert(before.data !== after.data, 'Existing photo enhancement did not change rendered pixels', { before, after });
      const downloadPromise = page.waitForEvent('download', { timeout: 90000 });
      await page.getByRole('button', { name: 'Скачать это фото', exact: true }).click();
      const photoDownload = await saveDownload(await downloadPromise, 'unified-photo-result');
      const signature = fs.readFileSync(photoDownload.target).subarray(0, 12).toString('hex');
      assert(/^(ffd8ff|89504e470d0a1a0a|52494646)/.test(signature), 'Photo download has an unknown image signature', { signature, photoDownload });
      return { before, after, photoDownload, signature };
    });

    await check('Медиаредактор: загрузка существующего видео и возврат в Hub', async () => {
      await page.getByRole('button', { name: 'Видео', exact: true }).click();
      await page.locator('#vxFile').setInputFiles(VIDEO_FIXTURE);
      await page.waitForFunction(() => {
        const metadata = window.NEXVideoRuntime?.metadata?.();
        return metadata?.width > 0 && metadata?.height > 0 && metadata?.duration > 0;
      }, null, { timeout: 30000 });
      const metadata = await page.evaluate(() => window.NEXVideoRuntime.metadata());
      const settingsBefore = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => /^nexestate/i.test(key))));
      await page.getByRole('link', { name: 'К главному экрану NexEstate', exact: true }).click();
      await page.waitForURL(BASE_URL);
      await page.locator('[data-app-route="media"]').click();
      await page.waitForURL(/\/apps\/media\/$/);
      const settingsAfter = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => /^nexestate/i.test(key))));
      assert(JSON.stringify(settingsBefore) === JSON.stringify(settingsAfter), 'Media localStorage changed during module navigation', { settingsBefore, settingsAfter });
      return { metadata, storedKeys: Object.keys(settingsAfter) };
    });

    await check('Presentation Studio: импорт PDF, разделы, сохранение и PDF-экспорт', async () => {
      await page.goto(url('apps/presentation/'), { waitUntil: 'domcontentloaded' });
      await page.locator('#nsBulkPdf').setInputFiles(PDF_FIXTURE);
      await page.waitForFunction(() => {
        const card = document.querySelector('.ns-project-card');
        return card && card.getAttribute('aria-busy') !== 'true' && /Готова|Сохранено/.test(card.textContent || '');
      }, null, { timeout: 120000 });
      const projectCount = await page.locator('.ns-project-card').count();
      assert(projectCount === 1, 'Test PDF did not create exactly one presentation', { projectCount });
      await page.getByRole('button', { name: 'Открыть презентацию', exact: true }).click();
      await page.getByRole('dialog', { name: /NexEstate Presentation Studio/ }).waitFor({ state: 'visible', timeout: 30000 });
      const tabs = [];
      for (const tabName of ['2 Данные', '3 Медиа', '4 Дизайн', '1 PDF']) {
        const tab = page.getByRole('tab', { name: tabName, exact: true });
        await tab.click();
        tabs.push({ name: tabName, selected: await tab.getAttribute('aria-selected') });
      }
      assert(tabs.every(tab => tab.selected === 'true'), 'A Presentation Studio section did not activate', tabs);
      const bottomBar = await page.locator('#presentationStudio .ps-bottom-bar').evaluate(element => {
        const rect = element.getBoundingClientRect();
        return { height: rect.height, bottom: rect.bottom, viewport: innerHeight, groups: [...element.children].map(item => item.getAttribute('aria-label')) };
      });
      assert(bottomBar.height <= 64 && bottomBar.bottom <= bottomBar.viewport, 'Presentation bottom bar exceeds its approved geometry', bottomBar);
      const dynamicHomeLink = page.getByRole('link', { name: '← К приложениям', exact: true });
      assert(await dynamicHomeLink.isVisible(), 'Dynamic Presentation Studio shell has no Hub return link');
      const stored = await page.evaluate(async () => {
        const projects = await window.NEXESTATE_STANDALONE_TEST.getProjects();
        return projects.map(project => ({ id: project.id, status: project.status, hasSnapshot: Boolean(project.snapshot) }));
      });
      assert(stored.length === 1 && stored[0].status === 'ready' && stored[0].hasSnapshot, 'Presentation project was not saved to IndexedDB', stored);
      const exportPromise = page.waitForEvent('download', { timeout: 120000 });
      await page.getByRole('button', { name: 'Скачать PDF', exact: true }).click();
      const pdfDownload = await saveDownload(await exportPromise, 'unified-presentation');
      const pdfHeader = fs.readFileSync(pdfDownload.target).subarray(0, 5).toString('ascii');
      assert(pdfHeader === '%PDF-', 'Presentation export is not a PDF', { pdfHeader, pdfDownload });
      await dynamicHomeLink.click();
      await page.waitForURL(BASE_URL);
      await page.locator('[data-app-route="presentation"]').click();
      await page.waitForURL(/\/apps\/presentation\/$/);
      await page.waitForFunction(() => document.querySelectorAll('.ns-project-card').length === 1);
      const persisted = await page.locator('.ns-project-card').innerText();
      assert(/Готова|Сохранено/.test(persisted), 'Presentation project did not persist after returning through Hub', persisted);
      const storedAfterHub = await page.evaluate(async () => {
        const projects = await window.NEXESTATE_STANDALONE_TEST.getProjects();
        return projects.map(project => ({ id: project.id, status: project.status, hasSnapshot: Boolean(project.snapshot) }));
      });
      assert(storedAfterHub.length === 1 && storedAfterHub[0].status === 'ready' && storedAfterHub[0].hasSnapshot, 'Hub return did not preserve the saved Presentation project', storedAfterHub);
      return { projectCount, tabs, bottomBar, stored, storedAfterHub, pdfDownload };
    });

    await check('Manifest, иконки, installability и единственный service worker', async () => {
      const pwaContext = await browser.newContext({ viewport: { width: 1120, height: 760 }, serviceWorkers: 'allow' });
      const pwaPage = await pwaContext.newPage();
      try {
        await pwaPage.goto(BASE_URL, { waitUntil: 'commit' });
        await pwaPage.evaluate(async () => {
          await caches.open('foreign-origin-cache-unified-qa');
          await caches.open('nex-estate-media-studio-obsolete-qa');
        });
        await pwaPage.waitForLoadState('load');
        const firstWorker = await waitForServiceWorker(pwaPage);
        if (!firstWorker.controlled) await pwaPage.reload({ waitUntil: 'domcontentloaded' });
        const worker = await waitForServiceWorker(pwaPage);
        const state = await pwaPage.evaluate(async () => {
          const manifestResponse = await fetch(document.querySelector('link[rel="manifest"]').href);
          const manifest = await manifestResponse.json();
          const registrations = await navigator.serviceWorker.getRegistrations();
          const cacheNames = await caches.keys();
          const cache = await caches.open('nex-estate-media-studio-unified-v1');
          const cachedUrls = (await cache.keys()).map(request => request.url);
          const icons = await Promise.all(manifest.icons.map(icon => new Promise(resolve => {
            const image = new Image();
            image.onload = () => resolve({ src: icon.src, width: image.naturalWidth, height: image.naturalHeight, purpose: icon.purpose });
            image.onerror = () => resolve({ src: icon.src, width: 0, height: 0, purpose: icon.purpose });
            image.src = new URL(icon.src, document.baseURI).href;
          })));
          return {
            manifest,
            registrations: registrations.map(item => ({ scope: item.scope, scriptURL: item.active?.scriptURL || '' })),
            cacheNames,
            cachedUrls,
            icons
          };
        });
        assert(state.manifest.id === './' && state.manifest.start_url === './' && state.manifest.scope === './', 'Manifest identity/start/scope changed unexpectedly', state.manifest);
        assert(state.manifest.name === 'NEX ESTATE Media Studio' && state.manifest.short_name === 'NEX Media', 'Installed PWA name changed', state.manifest);
        assert(state.registrations.length === 1 && /\/service-worker\.js(?:\?|$)/.test(state.registrations[0].scriptURL), 'Expected one root service worker registration', state.registrations);
        assert(state.cacheNames.includes('nex-estate-media-studio-unified-v1'), 'Unified cache was not installed', state.cacheNames);
        assert(!state.cacheNames.includes('nex-estate-media-studio-obsolete-qa'), 'Obsolete own cache was not removed', state.cacheNames);
        assert(state.cacheNames.includes('foreign-origin-cache-unified-qa'), 'Foreign cache was incorrectly removed', state.cacheNames);
        const required = ['/index.html', '/apps/media/index.html', '/apps/presentation/index.html', '/apps/presentation/vendor/pdfjs/pdf.min.js'];
        assert(required.every(part => state.cachedUrls.some(item => item.endsWith(part))), 'Required PWA shell file is missing from cache', { required, cachedUrls: state.cachedUrls });
        assert(!state.cachedUrls.some(item => /blob:|data:|unified-smoke\.pdf|video-cover|video-export/i.test(item)), 'User/test media leaked into precache', state.cachedUrls);
        assert(state.icons.some(icon => icon.width === 192 && icon.height === 192) && state.icons.some(icon => icon.width === 512 && icon.height === 512), 'Required PWA icon sizes are unavailable', state.icons);
        const cdp = await pwaContext.newCDPSession(pwaPage);
        const appManifest = await cdp.send('Page.getAppManifest');
        const installability = await cdp.send('Page.getInstallabilityErrors');
        assert((appManifest.errors || []).length === 0, 'Browser reports manifest errors', appManifest.errors);
        const functionalInstallabilityErrors = (installability.installabilityErrors || []).filter(item => item.errorId !== 'in-incognito');
        assert(functionalInstallabilityErrors.length === 0, 'Browser reports functional PWA installability errors', functionalInstallabilityErrors);
        await pwaPage.evaluate(() => caches.delete('foreign-origin-cache-unified-qa'));
        return { worker, manifest: state.manifest, registrations: state.registrations, cacheNames: state.cacheNames, icons: state.icons, installability, functionalInstallabilityErrors };
      } finally {
        await pwaContext.close();
      }
    });

    await check('Офлайн-запуск Hub и обоих редакторов', async () => {
      const offlineContext = await browser.newContext({ viewport: { width: 1120, height: 760 }, serviceWorkers: 'allow' });
      const offlinePage = await offlineContext.newPage();
      const errors = [];
      offlinePage.on('pageerror', error => errors.push(error.message));
      offlinePage.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      try {
        await offlinePage.goto(BASE_URL, { waitUntil: 'load' });
        await waitForServiceWorker(offlinePage);
        if (!await offlinePage.evaluate(() => Boolean(navigator.serviceWorker.controller))) await offlinePage.reload({ waitUntil: 'load' });
        for (const route of ['apps/media/', 'apps/presentation/']) await offlinePage.goto(url(route), { waitUntil: 'domcontentloaded' });
        await offlineContext.setOffline(true);
        const routes = [];
        await offlinePage.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
        routes.push({ route: '/', cards: await offlinePage.locator('.app-hub-card').count() });
        await offlinePage.goto(url('apps/media/'), { waitUntil: 'domcontentloaded' });
        await offlinePage.waitForFunction(() => document.documentElement.classList.contains('studio-upgrade-ready'));
        routes.push({ route: '/apps/media/', photoButton: await offlinePage.getByRole('button', { name: 'Фото', exact: true }).count() });
        await offlinePage.goto(url('apps/presentation/'), { waitUntil: 'domcontentloaded' });
        routes.push({ route: '/apps/presentation/', heading: await offlinePage.getByRole('heading', { name: 'Мои презентации', exact: true }).count() });
        assert(routes.every(item => Object.values(item).some(value => value === 1 || value === 2)), 'An offline route did not render', routes);
        assert(errors.length === 0, 'Offline launch produced browser errors', errors);
        return { routes, errors };
      } finally {
        await offlineContext.setOffline(false).catch(() => {});
        await offlineContext.close();
      }
    });

    await check('GitHub Pages base-path simulation', async () => {
      pagesServer = await startPagesBaseServer();
      const pagesContext = await browser.newContext({ viewport: { width: 1100, height: 760 }, serviceWorkers: 'allow' });
      const pagesPage = await pagesContext.newPage();
      try {
        await pagesPage.goto(pagesServer.baseUrl, { waitUntil: 'load' });
        const hub = { cards: await pagesPage.locator('.app-hub-card').count(), url: pagesPage.url() };
        await pagesPage.locator('[data-app-route="media"]').click();
        await pagesPage.waitForURL(/\/NEX_ESTATE_MEDIA_STUDIO\/apps\/media\/$/);
        const media = {
          url: pagesPage.url(),
          manifest: await pagesPage.locator('link[rel="manifest"]').getAttribute('href'),
          back: await pagesPage.getByRole('link', { name: 'К главному экрану NexEstate', exact: true }).getAttribute('href')
        };
        await pagesPage.goto(new URL('apps/presentation/', pagesServer.baseUrl).href, { waitUntil: 'domcontentloaded' });
        const presentation = {
          url: pagesPage.url(),
          manifest: await pagesPage.locator('link[rel="manifest"]').getAttribute('href'),
          back: await pagesPage.getByRole('link', { name: '← К приложениям', exact: true }).getAttribute('href')
        };
        const worker = await waitForServiceWorker(pagesPage);
        assert(hub.cards === 2, 'Subpath Hub is incomplete', hub);
        assert(media.url.includes('/NEX_ESTATE_MEDIA_STUDIO/apps/media/') && presentation.url.includes('/NEX_ESTATE_MEDIA_STUDIO/apps/presentation/'), 'Subpath routes escaped repository base', { media, presentation });
        assert(worker.scope.endsWith('/NEX_ESTATE_MEDIA_STUDIO/'), 'Service worker scope escaped repository base', worker);
        return { baseUrl: pagesServer.baseUrl, hub, media, presentation, worker };
      } finally {
        await pagesContext.close();
      }
    });

    const newIntegrationErrors = report.consoleErrors.filter(item => !/favicon\.ico/i.test(item.text));
    await check('Нет новых browser errors интеграции', async () => {
      assert(newIntegrationErrors.length === 0, 'Browser errors were recorded during the unified smoke test', newIntegrationErrors);
      return [];
    });

    report.status = 'passed';
  } finally {
    if (pagesServer?.server) await new Promise(resolve => pagesServer.server.close(resolve));
    await context.close();
    await browser.close();
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }
}

main().catch(error => {
  report.status = 'failed';
  report.error = error.message;
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
