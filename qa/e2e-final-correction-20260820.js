const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const BASE = process.env.NEX_FINAL_URL || 'http://127.0.0.1:8810/';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const RUN_ID = `${Date.now()}-${process.pid}`;
const RESULTS = path.join(__dirname, 'results', 'final-correction-v2-20260820');
const SHOTS = path.join(RESULTS, 'screenshots');
const REPORT = path.join(RESULTS, 'visual-and-layout-report.json');
const PHOTO = path.join(ROOT, 'qa', 'results', 'video-cover.jpg');
const PLAN = path.join(ROOT, 'qa', 'results', 'photo-single.webp');
const D4 = 'F:\\CodexSetup\\NEXESTATE_FINAL_CORRECTION_PACKAGE_V2_2026-08-20\\09_D4_COVER_COLOR_REFERENCE.png';

const report = { runId: RUN_ID, baseUrl: BASE, checks: [], screenshots: {}, errors: { console: [], pageerror: [], unhandled: [] } };

function insist(condition, message, evidence = {}) {
  if (condition) return;
  const error = new Error(message);
  error.evidence = evidence;
  throw error;
}

async function check(name, fn) {
  try {
    const evidence = await fn();
    report.checks.push({ name, status: 'PASS', evidence: evidence || {} });
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    report.checks.push({ name, status: 'FAIL', evidence: error.evidence || {}, error: error.message });
    process.stdout.write(`FAIL ${name}: ${error.message}\n`);
  }
}

async function settle(page, ms = 250) {
  await page.waitForTimeout(ms);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function dismissTransientNotices(page) {
  const importClose = page.locator('#ne79ImportProgress button[aria-label="Закрыть сообщение об импорте"]');
  if (await importClose.isVisible().catch(() => false)) await importClose.click();
  const closeButtons = page.getByRole('button', { name: 'Закрыть', exact: true });
  for (let index = (await closeButtons.count()) - 1; index >= 0; index -= 1) {
    const button = closeButtons.nth(index);
    if (await button.isVisible().catch(() => false)) await button.click();
  }
  await page.locator('#appLiveRegion.show').waitFor({ state: 'hidden', timeout: 6500 }).catch(() => {});
  await page.waitForTimeout(250);
}

async function screenshot(locator, name, options = {}) {
  const target = path.join(SHOTS, name);
  await locator.screenshot({ path: target, animations: 'disabled', ...options });
  report.screenshots[name] = target;
  return target;
}

async function uploadByVisibleLabel(page, inputSelector, files) {
  const label = page.locator(`label:has(${inputSelector})`).first();
  await label.waitFor({ state: 'visible' });
  const chooserPromise = page.waitForEvent('filechooser');
  await label.click();
  const chooser = await chooserPromise;
  await chooser.setFiles(files);
}

async function createProject(page) {
  await page.locator('button[data-ne79-file-target="ne79TextImport"]').click();
  const modal = page.locator('#ne80TextModal:not([hidden])');
  await modal.waitFor({ state: 'visible' });
  const text = [
    `Аренда длительного помещения свободного назначения ${RUN_ID}`,
    'Москва, Краснопрудная улица, 3',
    'Назначение: кофейня, пекарня, салон красоты',
    'Метро Комсомольская — 5 минут пешком; Красносельская — 7 минут пешком',
    'Площадь 210.5 м²',
    'Описание объекта',
    'Функциональное помещение с отдельным входом, витринными окнами и удобной планировкой.'
  ].join('\n');
  await modal.locator('#ne80TextArea').fill(text);
  await modal.locator('#ne80TextConfirm').click();
  await modal.waitFor({ state: 'hidden' });
  await page.locator('#presentationStudio.show').waitFor({ state: 'visible' });
  await page.waitForFunction(() => Boolean(window.NEXESTATE_STANDALONE_TEST?.getState?.().projectId));
  await settle(page, 500);

  await page.locator('[role="tab"][data-step="data"]').click();
  const contactDetails = page.locator('details').filter({ has: page.locator('#ne73ShowContact') }).first();
  if (await contactDetails.count() && !(await contactDetails.evaluate(node => node.open))) {
    await contactDetails.locator(':scope > summary').click();
  }
  const contact = page.locator('#ne73ShowContact');
  if (await contact.count() && !(await contact.isChecked())) await contact.click();
  for (const [selector, value] of [
    ['#studioMgr', 'Анна Брокер'],
    ['#studioMgrRole', 'Эксперт по коммерческой недвижимости'],
    ['#studioPhone', '+7 900 123-45-67'],
    ['#studioEmail', 'broker@example.test']
  ]) {
    const field = page.locator(selector);
    if (await field.count()) await field.fill(value);
  }
  await settle(page);

  await page.locator('[role="tab"][data-step="media"]').click();
  await uploadByVisibleLabel(page, '#studioPhotos', [PHOTO]);
  await page.waitForFunction(() => (window.NEXESTATE_STANDALONE_TEST?.getState?.().mediaCount || 0) >= 1);
  await uploadByVisibleLabel(page, '#studioFloorPlanInput', PLAN);
  await page.waitForFunction(() => window.NEXESTATE_CRITICAL_REGRESSION_TEST?.inspect?.().plan === true);
  const placement = page.locator('#ne82PlanPlacement:not([hidden])');
  if (await placement.isVisible().catch(() => false)) await placement.locator('[aria-label="Закрыть"]').click();
  await settle(page, 600);
  await dismissTransientNotices(page);
}

async function main() {
  fs.rmSync(SHOTS, { recursive: true, force: true });
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, acceptDownloads: true, serviceWorkers: 'allow' });
  const page = await context.newPage();
  page.on('console', message => { if (message.type() === 'error') report.errors.console.push(message.text()); });
  page.on('pageerror', error => report.errors.pageerror.push(error.message));
  await page.addInitScript(() => {
    window.__NEX_FINAL_UNHANDLED = [];
    addEventListener('unhandledrejection', event => window.__NEX_FINAL_UNHANDLED.push(String(event.reason?.stack || event.reason || 'unknown')));
  });

  await check('Hub: exact footer and no top duplicate', async () => {
    const response = await page.goto(new URL(`?visual=${RUN_ID}`, BASE).href, { waitUntil: 'networkidle' });
    insist(response?.ok(), `HTTP ${response?.status()}`);
    await page.locator('h1').waitFor({ state: 'visible' });
    await screenshot(page, '01-hub-full.png', { fullPage: true });
    return page.evaluate(() => {
      const exact = 'NexEstate · Единая рабочая среда · by Эдик Великий';
      const footer = document.querySelector('.app-hub-footer');
      const allText = document.body.innerText;
      const count = allText.split(exact).length - 1;
      const topBrand = document.querySelector('.app-hub-brand');
      const footerRect = footer?.getBoundingClientRect();
      if (count !== 1 || topBrand || !footer || footer.textContent.trim() !== exact) throw new Error('Hub branding hierarchy mismatch');
      return { exact, count, footerTag: footer.tagName, footerRect: footerRect?.toJSON(), bodyHeight: document.body.scrollHeight };
    });
  });

  await page.goto(new URL(`apps/presentation/?visual=${RUN_ID}`, BASE).href, { waitUntil: 'networkidle' });
  await page.locator('#studioHome').waitFor({ state: 'visible' });
  await createProject(page);

  await check('Editor: title is inside bottom bar at exact 150% size', async () => {
    const metrics = await page.evaluate(() => {
      const title = document.querySelector('.ps-bottom-bar .ne79-header-title');
      const topCopy = document.querySelector('.ne52-topbar .ne79-header-title');
      const bar = document.querySelector('.ps-bottom-bar');
      const titleRect = title?.getBoundingClientRect();
      const barRect = bar?.getBoundingClientRect();
      return { title: title?.textContent.trim(), fontSize: title ? getComputedStyle(title).fontSize : '', titleRect: titleRect?.toJSON(), barRect: barRect?.toJSON(), topCopy: Boolean(topCopy), barHeight: barRect?.height };
    });
    insist(metrics.title === 'NexEstate Presentation Studio by Эдик Великий', 'Editor title text mismatch', metrics);
    insist(metrics.fontSize === '11.25px' && !metrics.topCopy, 'Editor title placement/size mismatch', metrics);
    insist(metrics.barHeight <= 64.5, 'Bottom bar is taller than 64px', metrics);
    return metrics;
  });

  await page.locator('#presentationStudio .ne79-header-nav').getByRole('button', { name: 'К презентациям', exact: true }).click();
  await page.locator('#studioHome').waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('#presentationStudio')?.classList.contains('show'));
  await page.evaluate(() => scrollTo(0, 0));
  await dismissTransientNotices(page);

  await check('Presentations: true footer, exact text and exact 150% sizes', async () => {
    await screenshot(page, '02-presentations-full.png', { fullPage: true });
    return page.evaluate(() => {
      const home = document.querySelector('#studioHome');
      const grid = document.querySelector('#nsProjectGrid');
      const footer = document.querySelector('#ne80HomeSignature');
      const product = footer?.querySelector('b');
      const author = footer?.querySelector('span');
      const exact = `${product?.textContent.trim()} ${author?.textContent.trim()}`;
      const gridRect = grid?.getBoundingClientRect();
      const footerRect = footer?.getBoundingClientRect();
      const evidence = { exact, productSize: product ? getComputedStyle(product).fontSize : '', authorSize: author ? getComputedStyle(author).fontSize : '', homeDisplay: home ? getComputedStyle(home).display : '', gridRect: gridRect?.toJSON(), footerRect: footerRect?.toJSON(), footerTag: footer?.tagName };
      if (exact !== 'NexEstate Presentation Studio by Эдик Великий' || evidence.productSize !== '37.5px' || evidence.authorSize !== '24px' || !footer || footer.tagName !== 'FOOTER' || footerRect.top < gridRect.bottom) throw new Error(JSON.stringify(evidence));
      return evidence;
    });
  });

  await page.locator('.ns-project-card').first().getByRole('button', { name: /Открыть презентацию/ }).click();
  await page.locator('#presentationStudio.show').waitFor({ state: 'visible' });
  await settle(page, 600);
  await dismissTransientNotices(page);

  await page.locator('[role="tab"][data-step="pdf"]').click();
  await screenshot(page, '03-editor-pdf-full.png');
  await page.locator('[role="tab"][data-step="data"]').click();
  await screenshot(page, '04-editor-data-full.png');
  await page.locator('[role="tab"][data-step="media"]').click();
  await screenshot(page, '05-editor-media-full.png');

  await page.locator('#ne62LayoutBy').scrollIntoViewIfNeeded();
  await page.locator('#ne62LayoutBy').click();
  await page.waitForFunction(() => window.NEXESTATE_CRITICAL_REGRESSION_TEST?.inspect?.().layout === 'byNexEstate');
  await settle(page, 650);
  await dismissTransientNotices(page);
  const byPages = page.locator('#studioPresoDeck > .ps-canvas-page');
  await byPages.first().waitFor({ state: 'visible' });
  await screenshot(byPages.first(), '06-by-nexestate-cover.png');
  if (await byPages.count() > 1) await screenshot(byPages.nth(1), '07-by-nexestate-second-page.png');
  const contacts = page.locator('#studioPresoDeck > .ps-canvas-page[data-page-kind="contact"]');
  insist(await contacts.count() > 0, 'Contact page is missing from the by NexEstate deck');
  await screenshot(contacts.first(), '09-contact-page.png');

  await check('By cover: D4-only background metadata, exact logo token and compact title', async () => {
    return page.evaluate(() => {
      const slides = window.NEXESTATE_CRITICAL_REGRESSION_TEST?.render?.({}) || [];
      const first = slides[0];
      const title = first?.neTitleMetrics || null;
      const evidence = { d4: first?.neD4Background || null, tokens: first?.neAppBrandTokens || [], logoBoxes: first?.neAppBrandBoxes || [], title, pageCount: slides.length };
      if (!evidence.d4 || evidence.d4.warm !== '#E8E4DE' || evidence.d4.dark !== '#0A2A25') throw new Error(`D4 metadata mismatch: ${JSON.stringify(evidence)}`);
      if (!evidence.tokens.includes('NEX') || !evidence.tokens.includes('ESTATE') || !evidence.tokens.includes('BUILDINGS')) throw new Error(`Exact first-page logo tokens missing: ${JSON.stringify(evidence)}`);
      if (!title || title.lineCount > 4 || title.height > 300) throw new Error(`Title fit mismatch: ${JSON.stringify(evidence)}`);
      return evidence;
    });
  });

  await page.locator('#ne62LayoutSingle').scrollIntoViewIfNeeded();
  await page.locator('#ne62LayoutSingle').click();
  await page.waitForFunction(() => window.NEXESTATE_CRITICAL_REGRESSION_TEST?.inspect?.().layout === 'singlePage');
  await settle(page, 650);
  await dismissTransientNotices(page);
  await screenshot(page.locator('#studioPresoDeck > .ps-canvas-page').first(), '08-single-page.png');
  await screenshot(page, '10-editor-with-bottom-bar-desktop.png');

  await page.setViewportSize({ width: 412, height: 839 });
  await settle(page, 350);
  await screenshot(page, '11-editor-bottom-bar-mobile.png');
  await page.setViewportSize({ width: 1920, height: 1080 });

  await check('Mobile bottom bar remains 64px and controls are reachable', async () => {
    await page.setViewportSize({ width: 412, height: 839 });
    const evidence = await page.evaluate(() => {
      const bar = document.querySelector('.ps-bottom-bar');
      const rect = bar.getBoundingClientRect();
      return { height: rect.height, clientWidth: bar.clientWidth, scrollWidth: bar.scrollWidth, overflowX: getComputedStyle(bar).overflowX, titleVisible: Boolean(document.querySelector('.ps-bottom-bar .ne79-header-title')) };
    });
    insist(evidence.height <= 64.5 && evidence.overflowX === 'auto' && evidence.titleVisible, 'Mobile bottom bar geometry mismatch', evidence);
    await page.setViewportSize({ width: 1920, height: 1080 });
    return evidence;
  });

  const comparePage = await context.newPage();
  const coverPath = report.screenshots['06-by-nexestate-cover.png'];
  const coverData = `data:image/png;base64,${fs.readFileSync(coverPath).toString('base64')}`;
  const d4Data = `data:image/png;base64,${fs.readFileSync(D4).toString('base64')}`;
  await comparePage.setViewportSize({ width: 1800, height: 1000 });
  await comparePage.setContent(`<style>body{margin:0;background:#07131d;color:#fff;font:22px Arial;display:grid;grid-template-columns:1fr 1fr;gap:24px;padding:24px;box-sizing:border-box}figure{margin:0;display:flex;flex-direction:column;gap:12px}img{width:100%;height:900px;object-fit:contain;background:#101820;border:1px solid #31556d}figcaption{text-align:center}</style><figure><figcaption>09_D4_COVER_COLOR_REFERENCE.png — только цветовые поля</figcaption><img src="${d4Data}"></figure><figure><figcaption>Итоговая первая обложка by NexEstate — логотип только из 05</figcaption><img src="${coverData}"></figure>`);
  await screenshot(comparePage, '12-d4-reference-vs-by-cover.png');
  await comparePage.close();

  report.errors.unhandled = await page.evaluate(() => window.__NEX_FINAL_UNHANDLED || []);
  await check('No console/page/unhandled errors', async () => {
    insist(!report.errors.console.length && !report.errors.pageerror.length && !report.errors.unhandled.length, 'Runtime errors detected', report.errors);
    return report.errors;
  });

  report.summary = report.checks.reduce((acc, item) => { acc[item.status] = (acc[item.status] || 0) + 1; return acc; }, {});
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`REPORT ${REPORT}\nSUMMARY ${JSON.stringify(report.summary)}\n`);
  await browser.close();
  process.exitCode = report.summary.FAIL ? 1 : 0;
}

main().catch(error => {
  fs.mkdirSync(RESULTS, { recursive: true });
  report.fatal = error.stack || error.message;
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
