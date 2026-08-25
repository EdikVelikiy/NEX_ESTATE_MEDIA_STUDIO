const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { chromium, firefox } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const BASE = process.env.NEX_HOTFIX_URL || 'http://127.0.0.1:8810/';
const RUN_ID = `${Date.now()}-${process.pid}`;
const HUB = new URL(`?unresolved-ui-acceptance=${RUN_ID}`, BASE).href;
const APP = new URL(`apps/presentation/?unresolved-ui-acceptance=${RUN_ID}`, BASE).href;
const RESULTS = path.join(__dirname, 'results', 'unresolved-ui-performance-20260822', 'final-acceptance');
const REPORT_PATH = path.join(RESULTS, 'report.json');
const EXPECTED_BRANCH = 'codex/nexestate-unresolved-ui-performance-fix-20260822';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SYSTEM_FIREFOX = 'C:\\Program Files\\Mozilla Firefox\\firefox.exe';
const PLAYWRIGHT_FIREFOX = 'C:\\Users\\ED\\AppData\\Local\\ms-playwright\\firefox-1538\\firefox\\firefox.exe';
const GECKODRIVER = path.join(ROOT, 'geckodriver', 'win64', '0.37.1', 'geckodriver.exe');
const PDF = 'C:\\Users\\ED\\Downloads\\Свободного назначения, 45 м² # 1230417 (7).pdf';
const PHOTO = path.join(ROOT, 'qa', 'results', 'video-cover.jpg');
const LONG_TITLE = 'Аренда длительного помещения свободного назначения 210.5 м2';
const OCR_INPUT = 'ОПИСАНИЕ\nСостояние: типовой ремонт. Отдельный вход с улицы.\nПлощадь 210.5 м²\nТИП ЗДАНИЯ\nАдминистративное здание\nО ПАРКОВКЕ\nПарковка на улице';
const OCR_EXPECTED = 'Состояние: типовой ремонт. Отдельный вход с улицы.';
const PERFORMANCE_BEFORE = path.join(__dirname, 'results', 'unresolved-ui-performance-20260822', 'before.json');
const PERFORMANCE_AFTER = path.join(__dirname, 'results', 'unresolved-ui-performance-20260822', 'after.json');
const VIEWPORTS = [
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '390x844', width: 390, height: 844 }
];

fs.mkdirSync(RESULTS, { recursive: true });

const report = {
  runId: RUN_ID,
  startedAt: new Date().toISOString(),
  branch: '',
  baseUrl: BASE,
  appUrl: APP,
  environments: [],
  browserActions: {},
  checks: [],
  screenshots: {},
  geometry: {},
  composition: {},
  ocr: {},
  media: {},
  catalogActions: {},
  performance: {},
  exports: {},
  acceptance: {},
  errors: []
};

function insist(condition, message, evidence = {}) {
  if (condition) return;
  const error = new Error(message);
  error.evidence = evidence;
  throw error;
}

function add(environment, criterion, status, evidence = {}, error = '') {
  const item = { environment, criterion, status, evidence, error };
  report.checks.push(item);
  process.stdout.write(`${status.padEnd(5)} ${environment} :: ${criterion}${error ? ` :: ${error}` : ''}\n`);
  return item;
}

async function check(environment, criterion, task) {
  try {
    return add(environment, criterion, 'PASS', (await task()) || {});
  } catch (error) {
    return add(environment, criterion, 'FAIL', error.evidence || {}, String(error.message || error));
  }
}

function errorCollector(page) {
  const errors = { console: [], page: [], unhandled: [], request: [] };
  page.on('console', message => {
    if (message.type() === 'error') errors.console.push({ text: message.text(), location: message.location() });
  });
  page.on('pageerror', error => errors.page.push(String(error.message || error)));
  page.on('requestfailed', request => {
    const failure = request.failure()?.errorText || '';
    if (!/favicon|ERR_ABORTED/i.test(request.url() + failure)) errors.request.push({ url: request.url(), error: failure });
  });
  return errors;
}

async function installDiagnostics(page) {
  await page.addInitScript(() => {
    window.__NEX_HOTFIX_UNHANDLED = [];
    window.addEventListener('unhandledrejection', event => {
      window.__NEX_HOTFIX_UNHANDLED.push(String(event.reason?.stack || event.reason || 'unknown'));
    });
  });
}

async function saveShot(page, name, fullPage = false) {
  const target = path.join(RESULTS, `${name}.png`);
  await page.screenshot({ path: target, fullPage });
  report.screenshots[name] = target;
  return target;
}

async function saveAcceptedCoverShot(page, name) {
  await waitAcceptedPreview(page);
  const cover = page.locator('#studioPresoDeck>.ps-canvas-page[data-page-kind="cover"]').first();
  await cover.waitFor({ state: 'visible', timeout: 30000 });
  await cover.scrollIntoViewIfNeeded();
  await cover.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode ? image.decode().catch(() => undefined) : Promise.resolve())));
  await page.waitForTimeout(120);
  const target = path.join(RESULTS, `${name}.png`);
  await cover.screenshot({ path: target });
  report.screenshots[name] = target;
  return target;
}

async function waitAcceptedPreview(page) {
  await page.waitForFunction(() => {
    const host = document.getElementById('studioPresoDeck');
    const rendered = [...(host?.querySelectorAll(':scope>.ps-canvas-page') || [])]
      .filter(page => page.getClientRects().length && getComputedStyle(page).display !== 'none')
      .map(page => page.querySelector(':scope>canvas,:scope>img'))
      .find(Boolean);
    const single = window.NEXESTATE_CRITICAL_REGRESSION_TEST?.inspect?.()?.layout === 'singlePage';
    const expected = single ? { width: 1704, height: 2560 } : { width: 1240, height: 1754 };
    const ready = rendered instanceof HTMLCanvasElement
      ? rendered.width === expected.width && rendered.height === expected.height
      : rendered?.complete === true && rendered.naturalWidth === expected.width && rendered.naturalHeight === expected.height;
    return host?.getAttribute('aria-busy') === 'false' && ready;
  }, null, { timeout: 90000 });
}

async function stableBox(locator, relativeSelector = '') {
  const delta = (a, b) => Math.max(...['x','y','width','height'].map(key => Math.abs((a?.[key] || 0) - (b?.[key] || 0))));
  const read = () => relativeSelector ? locator.evaluate((node, selector) => {
    const rect = node.getBoundingClientRect(), parent = document.querySelector(selector)?.getBoundingClientRect();
    return { x: rect.x - (parent?.x || 0), y: rect.y - (parent?.y || 0), width: rect.width, height: rect.height };
  }, relativeSelector) : locator.boundingBox();
  let previous = await read();
  let stableSamples = 0;
  for (let attempt = 0; attempt < 20; attempt++) {
    await locator.page().waitForTimeout(50);
    const current = await read();
    stableSamples = delta(previous, current) <= 0.1 ? stableSamples + 1 : 0;
    if (stableSamples >= 4) return current;
    previous = current;
  }
  return previous;
}

function hubGeometry() {
  const shell = document.querySelector('.app-hub-shell');
  const main = document.querySelector('.app-hub-main');
  const footer = document.querySelector('.app-hub-footer');
  const rect = node => {
    const box = node?.getBoundingClientRect();
    return box ? { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom } : null;
  };
  const footerRect = rect(footer);
  return {
    viewport: { width: innerWidth, height: innerHeight },
    shell: rect(shell),
    main: rect(main),
    footer: footerRect,
    text: footer?.textContent?.trim() || '',
    copies: document.querySelectorAll('.app-hub-footer').length,
    isLast: shell?.lastElementChild === footer,
    position: footer ? getComputedStyle(footer).position : '',
    display: shell ? getComputedStyle(shell).display : '',
    rows: shell ? getComputedStyle(shell).gridTemplateRows : '',
    minHeight: shell ? getComputedStyle(shell).minHeight : '',
    bottomGap: footerRect ? innerHeight - footerRect.bottom : null,
    documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    presentationCard: rect(document.querySelector('[data-app-route="presentation"]'))
  };
}

function validateHub(metrics) {
  insist(metrics.text === 'NexEstate · Единая рабочая среда · by Эдик Великий', 'Неверная дословная подпись Hub', metrics);
  insist(metrics.copies === 1 && metrics.isLast, 'Подпись Hub дублируется или не является последним элементом', metrics);
  insist(!['fixed','absolute'].includes(metrics.position) && metrics.display === 'grid', 'Подпись Hub не находится в естественном grid-потоке', metrics);
  insist(metrics.shell?.height >= metrics.viewport.height - 1 && metrics.bottomGap >= -1 && metrics.bottomGap <= 24, 'Подпись Hub не прижата к физическому низу', metrics);
  insist(metrics.documentOverflow <= 1 && metrics.presentationCard?.width > 0, 'Hub имеет горизонтальное переполнение или недоступную карточку презентаций', metrics);
}

async function prepareHub(page) {
  await installDiagnostics(page);
  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.locator('.app-hub-shell').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('[data-app-route="presentation"]').waitFor({ state: 'visible', timeout: 30000 });
}

async function prepare(page) {
  await installDiagnostics(page);
  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.locator('#studioHome').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForFunction(() => window.NEXESTATE_REMAINING_VISUAL_HOTFIX_LOADED === true, null, { timeout: 30000 });
  await page.waitForFunction(() => window.NEXESTATE_REMAINING_VISUAL_HOTFIX_TEST?.version === '84.0-remaining-visual-hotfix');
  await page.waitForFunction(() => window.NEXESTATE_UNRESOLVED_UI_PERFORMANCE_LOADED === true && window.NEXESTATE_UNRESOLVED_UI_PERFORMANCE_TEST?.version === '85.0-unresolved-ui-performance-fix');
}

async function createProject(page) {
  await page.locator('#nsNewProject').click();
  const dialog = page.locator('#nsNewDialog[open]');
  await dialog.waitFor({ state: 'visible' });
  await dialog.getByRole('button', { name: /^Создать$/ }).click();
  await page.locator('#presentationStudio').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#ne72OpenOverlay').waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
  await page.waitForFunction(() => document.querySelector('#presentationStudio')?.classList.contains('ne83-footer-toolbar'));
  await page.waitForTimeout(250);
}

async function goHome(page) {
  const button = page.getByRole('button', { name: /^К презентациям$/ });
  if (await button.count() && await button.isVisible()) await button.click();
  else await page.evaluate(() => window.NEXESTATE_OPEN_LIFECYCLE_TEST?.close?.({ save: true }));
  await page.locator('#studioHome').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#presentationStudio').waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
}

async function openFirstProject(page) {
  const open = page.locator('.ns-project-card .ns-primary').first();
  await open.waitFor({ state: 'visible', timeout: 30000 });
  await open.click();
  await page.locator('#presentationStudio').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#ne72OpenOverlay').waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
  await page.waitForFunction(() => {
    const overlay = document.getElementById('ne72OpenOverlay');
    return !overlay || overlay.hidden || getComputedStyle(overlay).display === 'none' || !overlay.getClientRects().length;
  }, null, { timeout: 30000 });
  await page.waitForTimeout(250);
}

function homeGeometry() {
  const home = document.getElementById('studioHome');
  const footer = document.getElementById('ne80HomeSignature');
  const main = home?.querySelector(':scope>.ne84-home-main');
  const cards = [...document.querySelectorAll('.ns-project-card')];
  const rect = node => {
    const r = node?.getBoundingClientRect();
    return r ? { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom } : null;
  };
  const footerRect = rect(footer);
  const lastCardBottom = Math.max(0, ...cards.map(card => card.getBoundingClientRect().bottom + scrollY));
  return {
    viewport: { width: innerWidth, height: innerHeight },
    home: rect(home),
    main: rect(main),
    footer: footerRect,
    bottomGap: footerRect ? innerHeight - footerRect.bottom : null,
    topRatio: footerRect ? footerRect.y / innerHeight : null,
    lines: [...(footer?.children || [])].map(node => node.textContent.trim()),
    copies: document.querySelectorAll('#studioHome #ne80HomeSignature').length,
    headerCopies: document.querySelectorAll('#studioHome>.ns-home-brand').length,
    footerPosition: footer ? getComputedStyle(footer).position : '',
    homeMinHeight: home ? getComputedStyle(home).minHeight : '',
    mainFlex: main ? getComputedStyle(main).flex : '',
    isLast: home?.lastElementChild === footer,
    cards: cards.length,
    lastCardBottom,
    footerDocumentTop: footerRect ? footerRect.y + scrollY : null,
    scrollHeight: document.documentElement.scrollHeight
  };
}

function editorGeometry() {
  const studio = document.getElementById('presentationStudio');
  const bar = studio?.querySelector('.ps-bottom-bar');
  const signature = bar?.querySelector('.ne83-editor-signature');
  const groups = [...(bar?.querySelectorAll('.ne83-toolbar-controls>.ne62-bar-group') || [])];
  const rect = node => {
    const r = node?.getBoundingClientRect();
    return r ? { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom } : null;
  };
  const visible = node => {
    if (!node || node.hidden) return false;
    const style = getComputedStyle(node), r = node.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  };
  const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y));
  const items = [...(bar?.querySelectorAll('button,select,input,label') || [])].filter(visible).map(node => ({ id: node.id || '', text: (node.textContent || node.getAttribute('aria-label') || '').trim(), rect: rect(node) }));
  const overlaps = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const area = overlap(items[i].rect, items[j].rect);
    if (area > 1 && items[i].id && items[j].id) overlaps.push({ a: items[i].id, b: items[j].id, area });
  }
  return {
    viewport: { width: innerWidth, height: innerHeight },
    bar: rect(bar),
    signature: rect(signature),
    signatureText: signature?.innerText || '',
    signatureParent: signature?.parentElement?.className || '',
    signatureTextNodes: signature ? [...signature.childNodes].filter(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()).length : 0,
    topSignatureCopies: [...studio.querySelectorAll('.ne52-topbar,.ne79-header')].filter(node => /Presentation Studio by Эдик/i.test(node.innerText || '')).length,
    groups: groups.map(group => ({
      label: group.querySelector(':scope>.ne78-group-label')?.innerText.trim() || '',
      rect: rect(group),
      controls: rect(group.querySelector(':scope>.ne84-group-controls')),
      directLabels: group.querySelectorAll(':scope>.ne78-group-label').length
    })),
    overlaps,
    documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    barOverflow: { scrollWidth: bar?.scrollWidth || 0, clientWidth: bar?.clientWidth || 0, scrollHeight: bar?.scrollHeight || 0, clientHeight: bar?.clientHeight || 0 }
  };
}

function intersection(a, b) {
  if (!a || !b) return 0;
  return Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
}

function validateHome(metrics, longContent = false) {
  insist(JSON.stringify(metrics.lines) === JSON.stringify(['NexEstate Presentation Studio', 'by Эдик Великий']), 'Неверные строки footer', metrics);
  insist(metrics.copies === 1 && metrics.headerCopies === 0 && metrics.isLast, 'Footer дублируется или находится не последним элементом', metrics);
  insist(metrics.footerPosition !== 'fixed' && metrics.footerPosition !== 'absolute' && metrics.home && metrics.home.height >= metrics.viewport.height - 1, 'Footer реализован не естественным потоком', metrics);
  if (longContent) insist(metrics.footerDocumentTop >= metrics.lastCardBottom - 1, 'Footer длинного списка находится раньше карточек', metrics);
  else {
    insist(metrics.bottomGap >= -1 && metrics.bottomGap <= 24, 'Footer не прижат к физическому низу', metrics);
    if (metrics.viewport.width >= 1200) insist(metrics.topRatio >= 0.85, 'Footer слишком высоко на desktop', metrics);
  }
}

function validateEditor(metrics) {
  const labels = ['РАБОТА И СОХРАНЕНИЕ', 'МАКЕТ И ЭКСПОРТ', 'ФИНАЛЬНЫЕ ДЕЙСТВИЯ'];
  insist(metrics.signatureText === 'NexEstate Presentation Studio by Эдик Великий', 'STUDIO_SIGNATURE не совпадает дословно', metrics);
  insist(metrics.signatureTextNodes === 1 && metrics.topSignatureCopies === 0, 'STUDIO_SIGNATURE склеена или дублируется сверху', metrics);
  insist(metrics.groups.length === 3 && JSON.stringify(metrics.groups.map(item => item.label)) === JSON.stringify(labels), 'Неверные toolbar group-container', metrics);
  insist(metrics.groups.every(item => item.directLabels === 1 && item.controls && item.controls.y >= item.rect.y), 'Заголовок отделён от controls', metrics);
  insist(metrics.groups[2].rect.right >= metrics.bar.right - 24 || metrics.viewport.width < 1200, 'Финальная группа не прижата вправо', metrics);
  insist(metrics.overlaps.length === 0, 'Элементы нижней панели перекрываются', metrics);
}

async function uploadPdf(page) {
  if (!fs.existsSync(PDF)) return { skipped: true, reason: 'PDF fixture unavailable' };
  await page.locator('[role="tab"][data-step="pdf"]').click();
  const launcher = page.locator('#ne78ReplacePdf:visible,#ne53PdfDrop:visible').first();
  await launcher.waitFor({ state: 'visible' });
  const chooserPromise = page.waitForEvent('filechooser');
  await launcher.click();
  const chooser = await chooserPromise;
  await chooser.setFiles(PDF);
  await page.waitForFunction(expected => {
    const pdf = window.NE53_STATE?.pdf;
    return pdf?.fileName === expected && pdf.processing === false && /PDF обработан:/i.test(document.getElementById('studioPdfStatus')?.textContent || '');
  }, path.basename(PDF), { timeout: 120000 });
  return page.evaluate(() => {
    const pdf = window.NE53_STATE?.pdf || {};
    const api = window.NEXESTATE_V54_TEST;
    const extracted = (pdf.extractedPhotos || []).map((photo, index) => {
      const analysis = photo.canvas && api?.analyzeMediaCandidate ? api.analyzeMediaCandidate(photo.canvas) : null;
      const decision = photo.canvas && analysis && api?.candidateDecision ? api.candidateDecision(photo.canvas, analysis, '') : null;
      return { index, width: photo.width, height: photo.height, keep: decision?.keep !== false, reason: decision?.reason || '', analysis };
    });
    return {
      pageCount: Number(pdf.pageCount) || 0,
      sourcePages: (pdf.sourcePages || []).length,
      sourceCards: document.querySelectorAll('#ne53SourcePages .ne53-source-card').length,
      extractedCount: (pdf.extractedPhotos || []).length,
      extractedCards: document.querySelectorAll('#ne53ExtractedPhotos .ne53-extracted-card:not(.ne54-rejected-card)').length,
      rejectedCards: document.querySelectorAll('#ne53ExtractedPhotos .ne53-extracted-card.ne54-rejected-card').length,
      rejected: (pdf.rejectedCandidates || []).length,
      status: document.getElementById('studioPdfStatus')?.textContent || '',
      extracted
    };
  });
}

async function uploadPhoto(page) {
  if (!fs.existsSync(PHOTO)) return { skipped: true };
  await page.locator('[role="tab"][data-step="media"]').click();
  const label = page.locator('label:has(#studioPhotos)').first();
  const chooserPromise = page.waitForEvent('filechooser');
  await label.click();
  const chooser = await chooserPromise;
  await chooser.setFiles(PHOTO);
  await page.waitForFunction(() => (window.NEXESTATE_STANDALONE_TEST?.getState?.()?.mediaCount || 0) > 0, null, { timeout: 30000 });
  return { mediaCount: await page.locator('.ns-media-source').count() };
}

async function fillProject(page) {
  await page.locator('[role="tab"][data-step="data"]').click();
  await page.locator('#studioName').fill(LONG_TITLE);
  await page.locator('#studioAddr').fill('г Москва, ул Краснопрудная, д 3-5 стр 1');
  await page.locator('#studioMetro').fill('Красносельская — 5 минут пешком; Комсомольская — 7 минут пешком');
  await page.locator('#studioUse').fill('кофейня, пекарня, салон красоты');
  await page.locator('#studioDescription').fill('Состояние: типовой ремонт. Отдельный вход с улицы.');
  const area = page.locator('#nsFeatureEditor [data-feature-type="area"] [data-feature-field="value"]');
  if (await area.count()) await area.fill('210.5 м²');
  await page.locator('#studioName').press('Tab');
  await page.waitForTimeout(450);
  await page.locator('#ne62LayoutBy').scrollIntoViewIfNeeded();
  await page.locator('#ne62LayoutBy').click();
  await page.waitForFunction(() => window.NEXESTATE_CRITICAL_REGRESSION_TEST?.logo?.state?.() === 'ready', null, { timeout: 30000 });
  await page.waitForTimeout(250);
}

function validateCover(cover) {
  insist(cover && cover.geometry && cover.logo, 'Нет геометрии COVER_BRAND_LOGO', cover);
  const g = cover.geometry, logo = g.logoRect, brand = g.brandColumnRect, title = g.titleRect;
  insist(cover.logo.composition.join('/') === 'NEX/ESTATE/skyline' && cover.logo.parent === 'brandColumnRect', 'Неверный состав/родитель COVER_BRAND_LOGO', cover);
  insist(logo.x >= brand.x && logo.y >= brand.y && logo.x + logo.w <= brand.x + brand.w && logo.y + logo.h <= brand.y + brand.h, 'Логотип не внутри brandColumnRect', g);
  const leftGap = logo.x - brand.x, leftRatio = leftGap / brand.w, topGap = logo.y - brand.y, topRatio = topGap / brand.h;
  insist(leftRatio >= 0.04 && leftRatio <= 0.15 && topRatio >= 0.02 && topRatio <= 0.06, 'Неверные safe-margin сверху/слева логотипа', { leftGap, leftRatio, topGap, topRatio, g });
  insist(logo.x > 48 && logo.y < 48 && logo.w <= 92, 'Блок логотипа не сдвинут вправо/вверх или не уменьшен на 10–15%', { logo, baseline: { x: 48, y: 48, w: 103 } });
  insist(logo.x + logo.w <= brand.x + brand.w / 2 && logo.w <= brand.w * 0.45, 'Полный знак находится не в левом верхнем углу зелёной колонки', g);
  insist(title.y >= logo.y + logo.h + g.slideRect.h * 0.03 && title.y >= g.slideRect.y + g.slideRect.h * 0.14, 'Заголовок не ниже логотипа', g);
  insist(cover.title.lines <= 4 && title.h <= g.slideRect.h * 0.26, 'Заголовок не fit-to-box', { title: cover.title, geometry: g });
  const exclusions = [g.logoRect, g.addressRect, ...(g.metroRects || []), g.descriptionRect, g.photoRect];
  insist(exclusions.every(rect => intersection(title, rect) === 0), 'Заголовок пересекает другой блок', { title, exclusions });
  insist(intersection(g.logoRect, g.photoRect) === 0, 'Логотип попал в фото', g);
  return { leftGap, leftRatio, topGap, topRatio, intersections: exclusions.map(rect => intersection(title, rect)) };
}

async function runMediaFixtures(page) {
  return page.evaluate(() => {
    const api = window.NEXESTATE_V54_TEST;
    if (!api?.analyzeMediaCandidate || !api?.candidateDecision) return { pass: false, reason: 'classifier API unavailable', cases: [] };
    const make = painter => { const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480; painter(canvas.getContext('2d'), canvas); return canvas; };
    const solid = color => make((ctx, canvas) => { ctx.fillStyle = color; ctx.fillRect(0, 0, canvas.width, canvas.height); });
    const noisePhoto = (ctx, x, y, w, h, seed) => {
      const image = ctx.createImageData(w, h);
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) { const o = (yy * w + xx) * 4; image.data[o] = (xx * 7 + yy * 3 + seed) % 256; image.data[o + 1] = (xx * 2 + yy * 9 + seed * 3) % 256; image.data[o + 2] = (xx * 11 + yy * 5 + seed * 7) % 256; image.data[o + 3] = 255; }
      ctx.putImageData(image, x, y);
    };
    const fixtures = [
      { name: 'white', expected: false, text: '', canvas: solid('#ffffff') },
      { name: 'black', expected: false, text: '', canvas: solid('#000000') },
      { name: 'near-white-one-word', expected: false, text: '', canvas: make((ctx, canvas) => { ctx.fillStyle = '#fdfdfb'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#d9d9d4'; ctx.font = '18px Arial'; ctx.fillText('Текст', 290, 245); }) },
      { name: 'bright-interior', expected: true, text: '', canvas: make((ctx, canvas) => { ctx.fillStyle = '#f6f4ec'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#d8d2c4'; ctx.fillRect(0, 330, 640, 150); ctx.fillStyle = '#9fc4d8'; ctx.fillRect(40, 40, 240, 250); ctx.fillStyle = '#c9b99d'; ctx.fillRect(330, 180, 250, 210); ctx.strokeStyle = '#6b7478'; ctx.lineWidth = 8; for (let x = 50; x < 600; x += 75) { ctx.beginPath(); ctx.moveTo(x, 35); ctx.lineTo(x, 440); ctx.stroke(); } }) },
      { name: 'map', expected: true, text: 'Карта расположения объекта', canvas: make((ctx, canvas) => { ctx.fillStyle = '#e7e3d2'; ctx.fillRect(0, 0, canvas.width, canvas.height); for (let y = 0; y < 12; y++) for (let x = 0; x < 16; x++) { ctx.fillStyle = ['#d4c69f','#b8d8c2','#c3d7ea','#f2eee1'][(x + y * 3) % 4]; ctx.fillRect(x * 40 + 2, y * 40 + 2, 35, 35); } ctx.strokeStyle = '#fff'; ctx.lineWidth = 10; for (let n = -260; n < 900; n += 100) { ctx.beginPath(); ctx.moveTo(n, 0); ctx.lineTo(n + 410, 480); ctx.stroke(); } ctx.fillStyle = '#d42e26'; ctx.beginPath(); ctx.arc(340, 230, 24, 0, Math.PI * 2); ctx.fill(); }) },
      { name: 'floor-plan', expected: true, text: 'Планировка', canvas: make((ctx, canvas) => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.strokeStyle = '#263238'; ctx.lineWidth = 7; ctx.strokeRect(65, 50, 510, 370); ctx.lineWidth = 4; [[250,50,250,420],[410,50,410,260],[65,225,410,225],[250,330,575,330]].forEach(line => { ctx.beginPath(); ctx.moveTo(line[0], line[1]); ctx.lineTo(line[2], line[3]); ctx.stroke(); }); }) },
      { name: 'two-photos-with-padding', expected: true, text: '', canvas: make((ctx, canvas) => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); noisePhoto(ctx, 40, 70, 250, 340, 17); noisePhoto(ctx, 350, 70, 250, 340, 53); }) }
    ];
    const cases = fixtures.map(item => { const analysis = api.analyzeMediaCandidate(item.canvas); const decision = api.candidateDecision(item.canvas, analysis, item.text); return { name: item.name, expected: item.expected, actual: decision.keep === true, reason: decision.reason, analysis }; });
    return { pass: cases.every(item => item.expected === item.actual), cases };
  });
}

function performanceEvidence() {
  insist(fs.existsSync(PERFORMANCE_BEFORE) && fs.existsSync(PERFORMANCE_AFTER), 'Отсутствуют парные performance-отчёты', { before: PERFORMANCE_BEFORE, after: PERFORMANCE_AFTER });
  const before = JSON.parse(fs.readFileSync(PERFORMANCE_BEFORE, 'utf8'));
  const after = JSON.parse(fs.readFileSync(PERFORMANCE_AFTER, 'utf8'));
  const sameFixture = before.fixture?.count === 18 && after.fixture?.count === 18
    && before.fixture?.items?.map(item => item.hash).join('|') === after.fixture?.items?.map(item => item.hash).join('|');
  const sameBrowserFamily = before.browser === after.browser;
  const sameViewport = before.viewport?.width === after.viewport?.width && before.viewport?.height === after.viewport?.height;
  const controlledBaseline = sameBrowserFamily && sameViewport && before.browserVersion === after.browserVersion && before.hardware?.cpu === after.hardware?.cpu;
  const metrics = {
    sameFixture,
    sameBrowserFamily,
    sameViewport,
    controlledBaseline,
    baselineNote: controlledBaseline ? 'Comparable browser build and hardware' : 'Historical baseline is informational; current-run budgets are authoritative',
    before: {
      transferStableMs: before.operations?.transfer?.clickToStableMs,
      singleStableMs: before.operations?.toSinglePage?.clickToStableMs,
      byStableMs: before.operations?.toByNexEstate?.clickToStableMs,
      longTaskTotalMs: before.operations?.transfer?.longTaskTotalMs,
      work: before.operations?.transfer?.counts
    },
    after: {
      transferStableMs: after.operations?.transfer?.clickToStableMs,
      singleStableMs: after.operations?.toSinglePage?.clickToStableMs,
      byStableMs: after.operations?.toByNexEstate?.clickToStableMs,
      longTaskTotalMs: after.operations?.transfer?.longTaskTotalMs,
      work: after.operations?.transfer?.counts
    },
    finalState: after.finalState
  };
  insist(sameFixture && sameBrowserFamily && sameViewport, 'Performance-фикстура, семейство браузера или viewport не совпадают', metrics);
  insist(after.finalState?.mediaCount === 18 && after.finalState?.transferredCount === 18 && after.finalState?.previewBusy === 'false', '18-медиа сценарий не достиг стабильного состояния', metrics);
  insist(metrics.after.transferStableMs < 5000, 'Перенос 18 фото не укладывается в текущий performance-бюджет', metrics);
  insist(metrics.after.singleStableMs < 3000, 'Переключение в одностраничный режим не укладывается в performance-бюджет', metrics);
  insist(metrics.after.byStableMs < 3000, 'Возврат в by NexEstate не укладывается в performance-бюджет', metrics);
  if (controlledBaseline) {
    insist(metrics.after.transferStableMs < metrics.before.transferStableMs && metrics.after.singleStableMs < metrics.before.singleStableMs && metrics.after.byStableMs < metrics.before.byStableMs, 'На сопоставимой среде performance не улучшился', metrics);
  }
  insist(metrics.after.work.imageDecode === 0 && metrics.after.work.canvasToBlob === 0 && metrics.after.work.indexedDbPut === 0, 'При переключении сохраняется повторная тяжёлая обработка', metrics);
  return metrics;
}

async function titleFitMatrix(page) {
  const cases = [
    { name: 'short', value: 'Офис' },
    { name: 'medium', value: 'Аренда офиса у метро Красносельская' },
    { name: 'long', value: LONG_TITLE },
    { name: 'extreme', value: 'Аренда многофункционального коммерческого помещения свободного назначения с отдельным входом в центре Москвы' }
  ];
  const evidence = [];
  for (const item of cases) {
    await page.locator('#studioName').fill(item.value);
    await page.locator('#studioName').press('Tab');
    await waitAcceptedPreview(page);
    const cover = await page.evaluate(() => window.NEXESTATE_REMAINING_VISUAL_HOTFIX_TEST.inspectCover());
    const constraints = validateCover(cover);
    const canonical = await page.evaluate(() => window.NEXESTATE_STANDALONE_TEST?.getState?.()?.data?.objName || '');
    insist(canonical === item.value, 'Fit-to-box изменил канонический заголовок', { item, canonical });
    evidence.push({ name: item.name, value: item.value, lines: cover.title.lines, title: cover.geometry.titleRect, constraints });
    if (item.name === 'long' || item.name === 'extreme') await saveAcceptedCoverShot(page, 'title-' + item.name);
  }
  await page.locator('#studioName').fill(LONG_TITLE);
  await page.locator('#studioName').press('Tab');
  await waitAcceptedPreview(page);
  return evidence;
}

async function mediaGeometryEvidence(page) {
  const dom = await page.evaluate(() => {
    const visible = node => {
      const style = getComputedStyle(node), rect = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    return [...document.querySelectorAll('.ns-media-source')].filter(visible).map(card => {
      const media = card.querySelector('img,canvas'), rect = card.getBoundingClientRect(), mediaRect = media?.getBoundingClientRect(), style = getComputedStyle(card);
      return {
        card: { width: rect.width, height: rect.height },
        media: mediaRect ? { width: mediaRect.width, height: mediaRect.height } : null,
        writingMode: style.writingMode,
        wordBreak: style.wordBreak,
        text: card.innerText
      };
    });
  });
  const after = JSON.parse(fs.readFileSync(PERFORMANCE_AFTER, 'utf8'));
  const dimensions = after.fixture?.items?.map(item => ({ width: item.width, height: item.height })) || [];
  const orientations = {
    landscape: dimensions.filter(item => item.width > item.height).length,
    portrait: dimensions.filter(item => item.height > item.width).length,
    square: dimensions.filter(item => item.height === item.width).length,
    narrow: dimensions.filter(item => item.height / item.width > 1.8).length,
    wide: dimensions.filter(item => item.width / item.height > 1.8).length
  };
  insist(dom.length > 0 && dom.every(item => item.media && item.media.width > 20 && item.media.height > 20 && item.writingMode === 'horizontal-tb'), 'Карточки Media имеют нестабильную геометрию или вертикальный текст', { dom });
  insist(dimensions.length === 18 && orientations.landscape > 0 && orientations.portrait > 0 && orientations.square > 0 && orientations.narrow > 0 && orientations.wide > 0, '18-медиа fixture не покрывает требуемые пропорции', { dimensions, orientations });
  return { dom, dimensions, orientations, stableMs: after.operations?.transfer?.clickToStableMs };
}

async function focusLifecycleEvidence(page) {
  const stage = label => process.stdout.write(`FOCUS ${label}\n`);
  await page.locator('[role="tab"][data-step="data"]').click();
  const read = () => page.evaluate(() => {
    const state = window.NEXESTATE_FINAL_FUNCTIONAL_TEST?.inspect?.() || {};
    return { focusSources: state.focusSources || 0, focusTargets: state.focusTargets || 0, connectors: state.connectors || 0 };
  });
  const waitActive = async () => page.waitForFunction(() => {
    const state = window.NEXESTATE_FINAL_FUNCTIONAL_TEST?.inspect?.() || {};
    return (state.focusSources || 0) > 0 && (state.focusTargets || 0) > 0 && (state.connectors || 0) > 0;
  }, null, { timeout: 10000 });
  const waitClear = async () => page.waitForFunction(() => {
    const state = window.NEXESTATE_FINAL_FUNCTIONAL_TEST?.inspect?.() || {};
    return !(state.focusSources || 0) && !(state.focusTargets || 0) && !(state.connectors || 0);
  }, null, { timeout: 10000 });

  stage('regular-focus');
  await page.locator('#studioAddr').focus();
  await waitActive();
  const regular = await read();
  stage('regular-active');
  await page.keyboard.press('Escape');
  await page.locator('.ps-preview-stage').click({ position: { x: 8, y: 8 } });
  await waitClear();
  const regularCleared = await read();
  stage('regular-cleared');

  const contacts = page.locator('.ne70-broker-details').first();
  if (!(await contacts.getAttribute('open'))) await contacts.locator(':scope>summary').click();
  const contactToggle = page.locator('#ne73ShowContact');
  if (!(await contactToggle.isChecked())) {
    await contactToggle.check();
    await waitAcceptedPreview(page);
  }
  const socials = page.locator('#ne73CompanySocials');
  if (!(await socials.getAttribute('open'))) await socials.locator(':scope>summary').click();
  stage('dynamic-focus');
  await page.locator('#ne73CompanyTelegram').focus();
  await waitActive();
  const dynamic = await read();
  stage('dynamic-active');
  await page.keyboard.press('Escape');
  await page.locator('.ps-preview-stage').click({ position: { x: 8, y: 8 } });
  await waitClear();
  const dynamicCleared = await read();
  stage('dynamic-cleared');
  return { regular, regularCleared, dynamic, dynamicCleared };
}

async function deleteButtonEvidence(page) {
  const save = page.locator('.ps-bottom-bar button:visible').filter({ hasText: /^Сохранить шаблон$/ }).first();
  await save.click();
  const create = page.locator('#ne73TemplateCreateOverlay:not([hidden])');
  await create.waitFor({ state: 'visible' });
  await create.locator('#ne73TemplateName').fill('QA compact delete ' + RUN_ID);
  await create.locator('button[type="submit"]').click();
  await create.waitFor({ state: 'hidden' });
  const select = page.locator('#dsPresetSelect');
  await page.waitForFunction(() => document.getElementById('dsPresetSelect')?.options?.length > 1);
  await select.selectOption({ index: 1 });
  const remove = page.locator('#ne73TemplateDeleteButton');
  await remove.waitFor({ state: 'visible' });
  insist(!(await remove.isDisabled()), 'Кнопка удаления шаблона осталась disabled');
  const before = await stableBox(remove, '.ps-bottom-bar');
  const absolute = await remove.boundingBox();
  await page.mouse.move(absolute.x + absolute.width / 2, absolute.y + absolute.height / 2);
  const hover = await stableBox(remove, '.ps-bottom-bar');
  await remove.focus();
  const focus = await stableBox(remove, '.ps-bottom-bar');
  const visual = await remove.evaluate(node => ({
    text: node.textContent.trim(),
    childElements: node.children.length,
    writingMode: getComputedStyle(node).writingMode,
    whiteSpace: getComputedStyle(node).whiteSpace,
    overflow: getComputedStyle(node).overflow
  }));
  const delta = (a, b) => Math.max(...['x','y','width','height'].map(key => Math.abs((a?.[key] || 0) - (b?.[key] || 0))));
  insist(visual.text === 'Удалить' && visual.childElements === 0 && visual.writingMode === 'horizontal-tb', 'Кнопка удаления визуально разбита', visual);
  insist(before.width <= 64 && before.height <= 32 && delta(before, hover) <= 0.5 && delta(before, focus) <= 0.5, 'Кнопка удаления не компактна или двигается при hover/focus', { before, hover, focus, visual });
  await remove.click();
  const overlay = page.locator('#ne73TemplateDeleteOverlay:not([hidden])');
  await overlay.waitFor({ state: 'visible' });
  await overlay.locator('[data-action="delete"]').click();
  await overlay.waitFor({ state: 'hidden' });
  insist((await select.locator('option').count()) === 1, 'Временный QA-шаблон не удалён');
  return { before, hover, focus, visual, deleted: true };
}

async function purposeFontsStorageEvidence(page) {
  await page.locator('[role="tab"][data-step="data"]').click();
  await page.locator('#studioUse').fill('кофейня, пекарня, салон красоты');
  await page.locator('#studioUse').press('Tab');
  const fontDetails = page.locator('#ne78FontSettings');
  if (!(await fontDetails.getAttribute('open'))) await fontDetails.locator(':scope>summary').click();
  const font = page.locator('#dsFontSelect');
  const options = await font.locator('option').evaluateAll(nodes => nodes.map(node => node.value).filter(Boolean));
  insist(options.length >= 2, 'Недостаточно вариантов шрифта', { options });
  const byChoice = options[1] || options[0], singleChoice = options[2] || options[0];
  await font.selectOption(byChoice);
  await page.locator('#ne62LayoutSingle').click();
  await waitAcceptedPreview(page);
  await font.selectOption(singleChoice);
  await page.locator('#ne62LayoutBy').click();
  await waitAcceptedPreview(page);
  await page.waitForFunction(choice => document.getElementById('dsFontSelect')?.value === choice, byChoice, { timeout: 3000 });
  const state = await page.evaluate(() => ({
    data: window.NEXESTATE_DATA_RENDER_TEST?.state?.(),
    purpose: window.NEXESTATE_CRITICAL_REGRESSION_TEST?.inspect?.()?.purpose || '',
    lifecycle: window.NEXESTATE_OPEN_LIFECYCLE_TEST?.inspect?.() || {},
    autosave: document.querySelector('.ne62-autosave')?.textContent?.trim() || '',
    selected: document.getElementById('dsFontSelect')?.value || ''
  }));
  insist(state.purpose === 'кофейня, пекарня, салон красоты', 'Назначение не сохранилось в модели данных', state);
  insist(state.data?.fonts?.byNexEstate === byChoice && state.data?.fonts?.singlePage === singleChoice && state.selected === byChoice, 'Шрифты двух режимов не изолированы', { state, byChoice, singleChoice });
  insist(!/ошиб|не сохран/i.test(state.autosave) && state.lifecycle?.projectId, 'Ошибка автосохранения или отсутствует активный проект', state);
  return { state, byChoice, singleChoice };
}

async function floorPlanAndFirstFrameEvidence(page) {
  await page.locator('#ne62LayoutBy').click();
  await waitAcceptedPreview(page);
  await page.locator('[role="tab"][data-step="media"]').click();
  const before = await page.evaluate(() => ({
    render: window.NEXESTATE_DATA_RENDER_TEST?.state?.(),
    critical: window.NEXESTATE_CRITICAL_REGRESSION_TEST?.inspect?.(),
    ui: window.NEXESTATE_UNRESOLVED_UI_PERFORMANCE_TEST?.inspect?.(),
    pages: document.querySelectorAll('#studioPresoDeck>.ps-canvas-page').length
  }));
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('label:has(#studioFloorPlanInput)').click();
  const chooser = await chooserPromise;
  await chooser.setFiles(PHOTO);
  await page.waitForFunction(() => window.NEXESTATE_CRITICAL_REGRESSION_TEST?.inspect?.()?.plan === true, null, { timeout: 30000 });
  const placement = page.locator('#ne82PlanPlacement:not([hidden])');
  if (!(await placement.isVisible())) {
    const placementButton = page.locator('#ne82PlanPlacementButton');
    await placementButton.waitFor({ state: 'visible', timeout: 30000 });
    await placementButton.click();
  }
  await placement.waitFor({ state: 'visible', timeout: 30000 });
  await placement.locator('input[name="ne82Placement"]').first().check();
  await placement.locator('#ne82PlanApply').click();
  await placement.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => window.NEXESTATE_CRITICAL_REGRESSION_TEST?.inspect?.()?.plan === true);
  await waitAcceptedPreview(page);
  const after = await page.evaluate(() => ({
    render: window.NEXESTATE_DATA_RENDER_TEST?.state?.(),
    critical: window.NEXESTATE_CRITICAL_REGRESSION_TEST?.inspect?.(),
    ui: window.NEXESTATE_UNRESOLVED_UI_PERFORMANCE_TEST?.inspect?.(),
    pages: document.querySelectorAll('#studioPresoDeck>.ps-canvas-page').length
  }));
  insist(after.critical?.plan && after.critical?.placement?.mode, 'Планировка или явное размещение не сохранены', { before, after });
  insist(after.render?.layout === before.render?.layout && after.render?.font === before.render?.font && after.ui?.theme === before.ui?.theme, 'Загрузка планировки переключила макет/шрифт/тему', { before, after });
  insist(after.pages >= before.pages && after.pages <= before.pages + 1, 'Планировка создала дубликаты страниц', { before, after });
  await saveShot(page, 'floor-plan-placement');

  await goHome(page);
  await page.waitForTimeout(700);
  const open = page.locator('.ns-project-card .ns-primary').first();
  await open.click();
  const firstFrame = await page.evaluate(() => {
    const overlay = document.getElementById('ne72OpenOverlay');
    const visible = overlay && !overlay.hidden && getComputedStyle(overlay).display !== 'none' && overlay.getClientRects().length > 0;
    return {
      overlayVisible: !!visible,
      layout: window.NEXESTATE_CRITICAL_REGRESSION_TEST?.inspect?.()?.layout || '',
      visiblePages: [...document.querySelectorAll('#studioPresoDeck>.ps-canvas-page')].filter(node => node.getClientRects().length).length
    };
  });
  await page.locator('#presentationStudio').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#ne72OpenOverlay').waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
  await waitAcceptedPreview(page);
  const reopened = await page.evaluate(() => ({
    render: window.NEXESTATE_DATA_RENDER_TEST?.state?.(),
    critical: window.NEXESTATE_CRITICAL_REGRESSION_TEST?.inspect?.(),
    pages: document.querySelectorAll('#studioPresoDeck>.ps-canvas-page').length
  }));
  insist(firstFrame.overlayVisible || firstFrame.layout === before.render?.layout, 'На первом кадре показан чужой макет без защитного overlay', { firstFrame, before, reopened });
  insist(reopened.critical?.plan && reopened.render?.layout === before.render?.layout && reopened.render?.font === before.render?.font, 'После переоткрытия потеряны планировка/макет/шрифт', { before, reopened });
  return { before, after, firstFrame, reopened };
}

async function cancelFileChooserAction(page, selector, action, actions) {
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: 'visible', timeout: 30000 });
  const chooserPromise = page.waitForEvent('filechooser', { timeout: 30000 });
  await locator.click();
  const chooser = await chooserPromise;
  await chooser.setFiles([]);
  actions.push({ action, result: 'file chooser opened and cancelled' });
}

async function homeActionPrelude(page, actions) {
  await cancelFileChooserAction(page, 'button[data-ne79-file-target="nsBulkPdf"]', 'Загрузить PDF', actions);
  await page.locator('button[data-ne79-file-target="ne79TextImport"]').click();
  const textModal = page.locator('#ne80TextModal:not([hidden])');
  await textModal.waitFor({ state: 'visible', timeout: 30000 });
  await textModal.getByRole('button', { name: /^Отмена$/ }).click();
  await textModal.waitFor({ state: 'hidden', timeout: 30000 });
  actions.push({ action: 'Загрузить текст', result: 'text dialog opened and cancelled' });
  await cancelFileChooserAction(page, 'button[data-ne79-file-target="ne79PhotoImport"]', 'Загрузить фото', actions);
  await cancelFileChooserAction(page, 'button[data-ne79-file-target="nsImportProject"]', 'Импортировать файл проекта', actions);

  const apps = page.locator('#studioHome .app-module-home-link').first();
  await apps.click();
  await page.locator('.app-hub-shell').waitFor({ state: 'visible', timeout: 30000 });
  actions.push({ action: 'К приложениям', result: 'Hub opened' });
  await page.locator('[data-app-route="presentation"]').click();
  await page.locator('#studioHome').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForFunction(() => window.NEXESTATE_UNRESOLVED_UI_PERFORMANCE_LOADED === true, null, { timeout: 30000 });
  actions.push({ action: 'Редактор презентаций на Hub', result: 'presentation list reopened' });
}

async function catalogImportAndCardMenuEvidence(page) {
  const actions = [];
  const importButton = page.locator('button[data-ne79-file-target="nsImportProject"]');
  const tooltipVisible = () => page.evaluate(() => {
    const node = document.getElementById('ne54Tooltip');
    return !!node && node.classList.contains('show') && node.getAttribute('aria-hidden') === 'false';
  });
  const tooltipHidden = () => page.evaluate(() => {
    const node = document.getElementById('ne54Tooltip');
    return !node || !node.classList.contains('show') || node.getAttribute('aria-hidden') === 'true';
  });

  await importButton.hover();
  await page.waitForFunction(() => document.getElementById('ne54Tooltip')?.classList.contains('show'));
  const tooltip = { hover: await tooltipVisible() };
  await page.mouse.move(2, 2);
  await page.waitForFunction(() => !document.getElementById('ne54Tooltip')?.classList.contains('show'));
  tooltip.mouseleave = await tooltipHidden();
  await importButton.focus();
  await page.waitForFunction(() => document.getElementById('ne54Tooltip')?.classList.contains('show'));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('ne54Tooltip')?.classList.contains('show'));
  tooltip.escape = await tooltipHidden();
  const cancelChooser = page.waitForEvent('filechooser', { timeout: 30000 });
  await importButton.click();
  await (await cancelChooser).setFiles([]);
  tooltip.dialogClose = await tooltipHidden();
  insist(Object.values(tooltip).every(Boolean), 'Подсказка импорта осталась приклеенной', tooltip);
  actions.push({ action: 'Подсказка импорта', result: 'mouseleave, Escape and file-dialog close all dismiss it', tooltip });

  const inspectImported = () => page.evaluate(() => ({
    data: window.NEXESTATE_STANDALONE_TEST?.getState?.()?.data || {},
    projectId: window.NEXESTATE_STANDALONE_TEST?.getState?.()?.projectId || '',
    rawText: window.NE53_STATE?.pdf?.rawTextOriginal || '',
    mediaCount: window.NEXESTATE_STANDALONE_TEST?.getState?.()?.mediaCount || 0,
    importTitle: document.getElementById('ne79ImportTitle')?.textContent?.trim() || ''
  }));
  const meaningful = evidence => Object.entries(evidence.data || {}).some(([key, value]) => !['scenario', 'otype', 'metro'].includes(key) && String(value || '').trim());

  const pastedText = [
    'АРЕНДА ОФИСА',
    'Заголовок объекта: Офис из вставленного текста',
    'Адрес: г. Москва, ул. Тестовая, д. 1',
    'Метро: Комсомольская — 5 минут пешком',
    'Назначение: офис',
    'Площадь: 321 м²',
    'Описание объекта: светлый офис, уникальный маркер PASTE-QA.'
  ].join('\n');
  await page.locator('button[data-ne79-file-target="ne79TextImport"]').click();
  const textModal = page.locator('#ne80TextModal:not([hidden])');
  await textModal.waitFor({ state: 'visible', timeout: 30000 });
  await textModal.locator('#ne80TextArea').fill(pastedText);
  await textModal.locator('#ne80TextConfirm').click();
  await textModal.waitFor({ state: 'hidden', timeout: 60000 });
  await page.locator('#presentationStudio').waitFor({ state: 'visible', timeout: 30000 });
  const pasted = await inspectImported();
  insist(pasted.projectId && pasted.rawText.includes('PASTE-QA') && meaningful(pasted), 'Вставленный текст не создал/не заполнил проект', pasted);
  actions.push({ action: 'Вставить текст', result: 'project created and canonical fields populated', projectId: pasted.projectId });
  await goHome(page);

  const fileText = [
    'АРЕНДА',
    'Торговое помещение 87 м²',
    'Адрес: г. Москва, ул. Файловая, д. 2',
    'Метро: Красносельская — 7 минут пешком',
    'Назначение: магазин',
    'Описание объекта: уникальный маркер FILE-QA.'
  ].join('\n');
  await page.locator('button[data-ne79-file-target="ne79TextImport"]').click();
  await textModal.waitFor({ state: 'visible', timeout: 30000 });
  const fileChooser = page.waitForEvent('filechooser', { timeout: 30000 });
  await textModal.locator('#ne80ChooseTextFile').click();
  await (await fileChooser).setFiles({ name: 'qa-object.txt', mimeType: 'text/plain', buffer: Buffer.from(fileText, 'utf8') });
  await page.waitForFunction(() => document.getElementById('ne80TextArea')?.value.includes('FILE-QA'));
  await textModal.locator('#ne80TextConfirm').click();
  await textModal.waitFor({ state: 'hidden', timeout: 60000 });
  await page.locator('#presentationStudio').waitFor({ state: 'visible', timeout: 30000 });
  const textFile = await inspectImported();
  insist(textFile.projectId && textFile.rawText.includes('FILE-QA') && meaningful(textFile), 'UTF-8 TXT не создал/не заполнил проект', textFile);
  actions.push({ action: 'Загрузить TXT', result: 'UTF-8 file read, project created and fields populated', projectId: textFile.projectId });
  await goHome(page);

  const photoOcrText = 'АРЕНДА\nОфис из фото\nАдрес: г. Москва, ул. Фото, д. 3\nНазначение: офис\nОписание: PHOTO-QA';
  await page.evaluate(text => {
    window.Tesseract = { recognize: async () => ({ data: { text } }), PSM: { SPARSE_TEXT: 11 } };
    window.neEnsureTesseract = async () => window.Tesseract;
  }, photoOcrText);
  const photoChooser = page.waitForEvent('filechooser', { timeout: 30000 });
  await page.locator('button[data-ne79-file-target="ne79PhotoImport"]').click();
  await (await photoChooser).setFiles(PHOTO);
  await page.locator('#presentationStudio').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForFunction(() => document.getElementById('ne79ImportTitle')?.textContent?.trim() === 'Фотографии импортированы', null, { timeout: 60000 });
  const photo = await inspectImported();
  insist(photo.projectId && photo.mediaCount > 0 && photo.rawText.includes('PHOTO-QA'), 'Фото не создало проект/медиа', photo);
  actions.push({ action: 'Загрузить фото', result: 'image added, OCR pipeline completed and project saved', projectId: photo.projectId });
  await goHome(page);

  const cardById = id => page.locator(`.ns-project-card[data-project-id="${id}"]`);
  const menuAction = async (id, name) => {
    const card = cardById(id);
    await card.locator('summary[aria-label="Дополнительные действия"]').click();
    const button = card.getByRole('button', { name, exact: true });
    await button.waitFor({ state: 'visible', timeout: 30000 });
    insist(!(await button.isDisabled()), `Пункт меню «${name}» недоступен`, { id, name });
    await button.click();
  };

  await cardById(photo.projectId).locator('input[type="checkbox"]').check();
  await cardById(pasted.projectId).locator('input[type="checkbox"]').check();
  await page.waitForFunction(() => !document.getElementById('nsOpenCatalog')?.disabled);
  await page.locator('#nsOpenCatalog').click();
  await page.locator('#nsCatalogScreen:not([hidden])').waitFor({ state: 'visible', timeout: 30000 });
  const catalogDownload = page.waitForEvent('download', { timeout: 90000 });
  await page.locator('#nsDownloadCatalog').click();
  const catalog = await catalogDownload;
  const catalogPath = await catalog.path();
  const catalogBytes = fs.readFileSync(catalogPath);
  insist(catalogBytes.length > 1000 && catalogBytes.subarray(0, 4).toString() === '%PDF', 'PDF-каталог пуст или повреждён', { size: catalogBytes.length });
  await page.locator('#nsCatalogBack').click();
  await page.locator('#studioHome').waitFor({ state: 'visible', timeout: 30000 });
  actions.push({ action: 'PDF-каталог', result: 'two projects selected and non-empty PDF downloaded', size: catalogBytes.length });

  await menuAction(photo.projectId, 'Переименовать');
  const renameDialog = page.locator('.ns-runtime-dialog[open]');
  await renameDialog.waitFor({ state: 'visible', timeout: 30000 });
  await renameDialog.locator('input').fill('QA catalog renamed');
  await renameDialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await page.waitForFunction(id => document.querySelector(`.ns-project-card[data-project-id="${id}"] h2`)?.textContent === 'QA catalog renamed', photo.projectId);
  actions.push({ action: 'Переименовать', result: 'title persisted' });

  const beforeDuplicate = await page.locator('.ns-project-card').count();
  await menuAction(photo.projectId, 'Дублировать');
  await page.waitForFunction(count => document.querySelectorAll('.ns-project-card').length === count + 1, beforeDuplicate);
  actions.push({ action: 'Дублировать', result: 'independent copy created' });

  const order = () => page.locator('.ns-project-card').evaluateAll(nodes => nodes.map(node => node.dataset.projectId));
  const beforeMove = await order();
  const initialIndex = beforeMove.indexOf(photo.projectId);
  await menuAction(photo.projectId, 'Выше');
  await page.waitForFunction(({ id, index }) => [...document.querySelectorAll('.ns-project-card')].findIndex(node => node.dataset.projectId === id) === index - 1, { id: photo.projectId, index: initialIndex });
  const movedUp = await order();
  insist(movedUp.indexOf(photo.projectId) === initialIndex - 1, 'Проект не переместился выше', { beforeMove, movedUp });
  await menuAction(photo.projectId, 'Ниже');
  await page.waitForFunction(({ id, index }) => [...document.querySelectorAll('.ns-project-card')].findIndex(node => node.dataset.projectId === id) === index, { id: photo.projectId, index: initialIndex });
  const movedDown = await order();
  insist(movedDown.indexOf(photo.projectId) === initialIndex, 'Проект не вернулся ниже', { beforeMove, movedUp, movedDown });
  actions.push({ action: 'Выше/Ниже', result: 'order changed in both directions' });

  const projectDownload = page.waitForEvent('download', { timeout: 90000 });
  await menuAction(photo.projectId, 'Экспортировать проект');
  const projectFile = await projectDownload;
  const projectPath = await projectFile.path();
  const portable = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
  insist(portable.kind === 'NexEstatePresentationProject' && portable.record, 'Экспорт проекта повреждён', { kind: portable.kind, size: fs.statSync(projectPath).size });
  actions.push({ action: 'Экспортировать проект', result: 'portable project downloaded', size: fs.statSync(projectPath).size });

  const beforeImport = await page.locator('.ns-project-card').count();
  const projectChooser = page.waitForEvent('filechooser', { timeout: 30000 });
  await importButton.click();
  await (await projectChooser).setFiles(projectPath);
  const conflict = page.locator('.ns-runtime-dialog[open]');
  await conflict.waitFor({ state: 'visible', timeout: 30000 });
  await conflict.getByRole('button', { name: 'Импортировать копию', exact: true }).click();
  await page.waitForFunction(count => document.querySelectorAll('.ns-project-card').length === count + 1, beforeImport);
  actions.push({ action: 'Импортировать файл проекта', result: 'portable project imported as copy' });

  await cardById(photo.projectId).getByRole('button', { name: 'Открыть презентацию', exact: true }).click();
  await page.locator('#presentationStudio').waitFor({ state: 'visible', timeout: 30000 });
  await goHome(page);
  actions.push({ action: 'Открыть презентацию', result: 'saved project opened and returned to catalog' });

  await menuAction(photo.projectId, 'Удалить');
  const deleteDialog = page.locator('.ns-runtime-dialog[open]');
  await deleteDialog.waitFor({ state: 'visible', timeout: 30000 });
  await deleteDialog.getByRole('button', { name: 'Удалить', exact: true }).click();
  await page.waitForFunction(id => !document.querySelector(`.ns-project-card[data-project-id="${id}"]`), photo.projectId);
  actions.push({ action: 'Удалить проект', result: 'confirmation accepted and original card removed' });

  return { actions, tooltip, pasted, textFile, photo, projectMenu: ['Переименовать', 'Дублировать', 'Экспортировать проект', 'Выше', 'Ниже', 'Удалить'] };
}

const EXPORT_LABELS = {
  pdf: 'Скачать PDF',
  png: 'Скачать PNG',
  html: 'Скачать HTML',
  web: 'Открыть WEB'
};

async function selectExportFormat(page, type) {
  const trigger = page.locator('#ne62FormatTrigger');
  await trigger.waitFor({ state: 'visible', timeout: 30000 });
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  const option = page.locator(`#ne62FormatPopover [data-export-type="${type}"]`);
  await option.waitFor({ state: 'visible', timeout: 30000 });
  await option.click();
  const main = page.locator('#ne62DownloadMain');
  await main.waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForFunction(
    ({ type, label }) => {
      const button = document.getElementById('ne62DownloadMain');
      return button?.dataset.exportFormat === type && button.textContent?.trim() === label;
    },
    { type, label: EXPORT_LABELS[type] },
    { timeout: 30000 }
  );
  return main;
}

function validateDownloadedExport(kind, data, evidence = {}) {
  const normalized = kind.toLowerCase();
  const valid = normalized === 'pdf'
    ? data.subarray(0, 5).toString() === '%PDF-'
    : normalized === 'png'
      ? data.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))
      : /^\s*(?:<!doctype\s+html|<html)/i.test(data.subarray(0, 1024).toString('utf8'));
  insist(valid && data.length > 100, `${kind.toUpperCase()} export signature invalid`, { ...evidence, size: data.length, first: data.subarray(0, 20).toString('hex') });
}

async function runSelectedExportSmoke(page, type, environment, saveTarget = '') {
  const main = await selectExportFormat(page, type);
  const waitIdle = () => page.waitForFunction(() => {
    const button = document.getElementById('ne62DownloadMain');
    return button && button.getAttribute('aria-busy') !== 'true' && !button.disabled;
  }, null, { timeout: 180000 });
  if (type === 'web') {
    const [popup] = await Promise.all([
      page.waitForEvent('popup', { timeout: 90000 }),
      main.click()
    ]);
    await popup.waitForLoadState('domcontentloaded', { timeout: 90000 });
    await waitIdle();
    const content = await popup.content();
    const title = await popup.title();
    insist(content.length > 100 && /<html|<!doctype/i.test(content), 'WEB export is empty', { environment, title, length: content.length, url: popup.url() });
    await popup.close();
    return { action: 'Экспорт Web', result: 'popup', size: Buffer.byteLength(content), title };
  }
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 90000 }),
    main.click()
  ]);
  await waitIdle();
  const source = await download.path();
  const data = fs.readFileSync(source);
  validateDownloadedExport(type, data, { environment });
  if (saveTarget) await download.saveAs(saveTarget);
  return { action: `Экспорт ${type.toUpperCase()}`, result: 'download', size: data.length, fileName: download.suggestedFilename(), path: saveTarget || source };
}

async function editorActionSmoke(page, environment, actions) {
  for (const step of ['pdf', 'data', 'media']) {
    await page.locator(`[role="tab"][data-step="${step}"]`).click();
    actions.push({ action: `Вкладка ${step.toUpperCase()}`, result: 'active' });
  }

  await page.locator('[role="tab"][data-step="pdf"]').click();
  const pdf = await uploadPdf(page);
  insist(!pdf.skipped && pdf.sourcePages > 0, 'PDF не загрузился в click-matrix', { environment, pdf });
  actions.push({ action: 'Загрузить PDF в editor', result: `${pdf.sourcePages} source pages` });
  const transfer = page.locator('#ne53TransferAll');
  await transfer.waitFor({ state: 'visible', timeout: 30000 });
  insist(!(await transfer.isDisabled()), 'Перенести всё в Медиа недоступно после PDF', { environment, pdf });
  await transfer.click();
  await page.waitForFunction(() => (window.NEXESTATE_STANDALONE_TEST?.getState?.()?.mediaCount || 0) > 0, null, { timeout: 60000 });
  actions.push({ action: 'Перенести всё в Медиа', result: 'media populated' });

  await fillProject(page);
  await uploadPhoto(page);
  actions.push({ action: 'Загрузить фото в editor', result: 'photo visible in Media' });
  await page.locator('#ne62LayoutSingle').click();
  await waitAcceptedPreview(page);
  actions.push({ action: 'Одностраничная презентация', result: 'active' });
  await page.locator('#ne62LayoutBy').click();
  await waitAcceptedPreview(page);
  actions.push({ action: 'by NexEstate', result: 'active' });
  const noLogos = page.locator('#ne80NoLogos');
  if (await noLogos.isChecked()) await noLogos.click();
  await noLogos.click();
  await noLogos.click();
  actions.push({ action: 'Без логотипов', result: 'enabled and restored' });

  await page.locator('[role="tab"][data-step="media"]').click();
  const planChooserPromise = page.waitForEvent('filechooser', { timeout: 30000 });
  await page.locator('label:has(#studioFloorPlanInput)').click();
  const planChooser = await planChooserPromise;
  await planChooser.setFiles(PHOTO);
  const placement = page.locator('#ne82PlanPlacement:not([hidden])');
  if (!(await placement.isVisible())) {
    const placementButton = page.locator('#ne82PlanPlacementButton');
    await placementButton.waitFor({ state: 'visible', timeout: 30000 });
    await placementButton.click();
  }
  await placement.waitFor({ state: 'visible', timeout: 30000 });
  await placement.locator('input[name="ne82Placement"]').first().check();
  await placement.locator('#ne82PlanApply').click();
  await placement.waitFor({ state: 'hidden' });
  actions.push({ action: 'Планировка', result: 'uploaded and placement applied' });

  await page.locator('[role="tab"][data-step="data"]').click();
  const contacts = page.locator('.ne70-broker-details').first();
  if (!(await contacts.getAttribute('open'))) await contacts.locator(':scope>summary').click();
  const socials = page.locator('#ne73CompanySocials');
  if (!(await socials.getAttribute('open'))) await socials.locator(':scope>summary').click();
  await page.locator('#ne73CompanyTelegram').fill('https://t.me/nexestate_qa');
  actions.push({ action: 'Контакты', result: 'dynamic company contact edited' });

  const fontDetails = page.locator('#ne78FontSettings');
  if (!(await fontDetails.getAttribute('open'))) await fontDetails.locator(':scope>summary').click();
  const font = page.locator('#dsFontSelect');
  const fontOptions = await font.locator('option').evaluateAll(nodes => nodes.map(node => node.value).filter(Boolean));
  insist(fontOptions.length > 1, 'Нет вариантов шрифта', { environment, fontOptions });
  await font.selectOption(fontOptions[1]);
  actions.push({ action: 'Шрифты', result: `selected ${fontOptions[1]}` });

  const save = page.locator('.ps-bottom-bar button:visible').filter({ hasText: /^Сохранить шаблон$/ }).first();
  await save.click();
  const templateDialog = page.locator('#ne73TemplateCreateOverlay:not([hidden])');
  await templateDialog.waitFor({ state: 'visible' });
  await templateDialog.locator('[data-action="cancel"]').click();
  await templateDialog.waitFor({ state: 'hidden' });
  actions.push({ action: 'Шаблоны', result: 'dialog opened and cancelled' });

  const backup = page.locator('.ps-bottom-bar button:visible').filter({ hasText: /^Резервные копии$/ }).first();
  await backup.click();
  const backupDialog = page.locator('#ne61BackupDialog[open]');
  await backupDialog.waitFor({ state: 'visible' });
  await backupDialog.getByRole('button', { name: /^Закрыть$/ }).click();
  actions.push({ action: 'Резервные копии', result: 'dialog opened and closed' });

  const deletion = await deleteButtonEvidence(page);
  actions.push({ action: 'Удаление', result: deletion.deleted ? 'template created and deleted' : 'failed' });
  actions.push({ action: 'Шестерёнка экспорта', result: 'opened for every format' });
  for (const type of ['pdf', 'png', 'html', 'web']) {
    actions.push(await runSelectedExportSmoke(page, type, environment));
  }
}

async function physicalBottomSmoke(page) {
  const result = [];
  const click = async selector => { const locator = page.locator(selector); await locator.scrollIntoViewIfNeeded(); const box = await locator.boundingBox(); await locator.click(); result.push({ selector, box }); };
  await click('#ne62LayoutSingle');
  await click('#ne62LayoutBy');
  await click('#ne80NoLogos');
  await click('#ne80NoLogos');
  await click('#ne62FormatTrigger');
  await page.keyboard.press('Escape');
  await click('#dsUndoBtn');
  await click('#dsRedoBtn');
  return result;
}

async function exportFile(page, type, mode) {
  const extension = type === 'pdf' ? '.pdf' : type === 'png' ? '.png' : '.html';
  const target = type === 'web' ? '' : path.join(RESULTS, `export-${mode}-${type}-${RUN_ID}${extension}`);
  const result = await runSelectedExportSmoke(page, type, `Chrome normal ${mode}`, target);
  return { ...result, mode, type };
}

async function primaryScenario(page, errors) {
  const env = 'Chromium normal 1920x1080';
  await check(env, 'Presentations short-content footer', async () => { const metrics = await page.evaluate(homeGeometry); validateHome(metrics, false); report.geometry.homeShort = metrics; await saveShot(page, '01-presentations-short'); return metrics; });
  await createProject(page);
  await check(env, 'Source PDF pages preserved and extracted media filtered', async () => {
    const evidence = await uploadPdf(page);
    insist(!evidence.skipped && evidence.pageCount > 0 && evidence.pageCount === evidence.sourcePages && evidence.pageCount === evidence.sourceCards, 'Не все исходные PDF-страницы сохранены', evidence);
    insist(evidence.extractedCount === evidence.extractedCards && evidence.rejected === evidence.rejectedCards && evidence.extracted.every(item => item.keep), 'Принятые/отклонённые extracted media смешаны или DOM не согласован', evidence);
    report.media.pdf = evidence;
    await page.locator('[role="tab"][data-step="pdf"]').click();
    await saveShot(page, '05-extracted-media');
    return evidence;
  });
  await check(env, 'Transfer all extracted media by real click', async () => {
    const button = page.locator('#ne53TransferAll');
    await button.waitFor({ state: 'visible', timeout: 30000 });
    insist(!(await button.isDisabled()), 'Перенос extracted media недоступен', report.media.pdf || {});
    await button.click();
    await page.waitForFunction(() => (window.NEXESTATE_STANDALONE_TEST?.getState?.()?.mediaCount || 0) > 0, null, { timeout: 60000 });
    return page.evaluate(() => ({ mediaCount: window.NEXESTATE_STANDALONE_TEST?.getState?.()?.mediaCount || 0 }));
  });
  await fillProject(page);
  await uploadPhoto(page);
  await page.locator('[role="tab"][data-step="data"]').click();
  await page.locator('#ne62LayoutBy').scrollIntoViewIfNeeded();
  await page.locator('#ne62LayoutBy').click();
  await waitAcceptedPreview(page);

  await check(env, 'Editor signature and three whole toolbar groups', async () => {
    const metrics = await page.evaluate(editorGeometry);
    validateEditor(metrics);
    const exportControl = await page.evaluate(() => {
      const main = document.getElementById('ne62DownloadMain');
      const gear = document.getElementById('ne62FormatTrigger');
      return {
        label: main?.textContent?.trim() || '',
        format: main?.dataset.exportFormat || '',
        mainVisible: !!main && getComputedStyle(main).display !== 'none' && !main.hidden,
        gearVisible: !!gear && getComputedStyle(gear).display !== 'none' && !gear.hidden
      };
    });
    insist(exportControl.label === 'Скачать PDF' && exportControl.format === 'pdf' && exportControl.mainVisible && exportControl.gearVisible, 'Новый проект не использует видимый PDF по умолчанию', exportControl);
    report.geometry.editor = metrics;
    await saveShot(page, '02-editor-toolbar');
    return { metrics, exportControl };
  });

  await check(env, 'COVER_BRAND_LOGO composition and long-title geometry', async () => {
    const cover = await page.evaluate(() => window.NEXESTATE_REMAINING_VISUAL_HOTFIX_TEST.inspectCover());
    const constraints = validateCover(cover);
    const canonical = await page.evaluate(() => window.NEXESTATE_STANDALONE_TEST?.getState?.()?.data?.objName || '');
    insist(canonical === LONG_TITLE, 'Канонический заголовок изменён', { canonical });
    const signature = await page.evaluate(() => ({ text: document.querySelector('.ne83-editor-signature')?.innerText || '', parent: document.querySelector('.ne83-editor-signature')?.parentElement?.className || '', skyline: /skyline/i.test(document.querySelector('.ne83-editor-signature')?.innerText || '') }));
    report.geometry.cover = cover;
    report.composition = { coverBrandLogo: cover.logo, studioSignature: signature, distinctParents: cover.logo.parent !== signature.parent };
    insist(!/Presentation Studio|Эдик Великий/i.test(cover.logo.composition.join(' ')) && !signature.skyline && report.composition.distinctParents, 'COVER_BRAND_LOGO перепутан со STUDIO_SIGNATURE', report.composition);
    await saveAcceptedCoverShot(page, '03-long-title-cover');
    return { cover, constraints, canonical, signature };
  });

  await check(env, 'Metro station colors and pedestrian semantics', async () => {
    const colors = await page.evaluate(() => ({
      red: window.NEXESTATE_REMAINING_VISUAL_HOTFIX_TEST.metroColors('Красносельская'),
      interchange: window.NEXESTATE_REMAINING_VISUAL_HOTFIX_TEST.metroColors('Комсомольская'),
      unknown: window.NEXESTATE_REMAINING_VISUAL_HOTFIX_TEST.metroColors('Неизвестная'),
      cover: window.NEXESTATE_REMAINING_VISUAL_HOTFIX_TEST.inspectCover()?.metroColors || [],
      labels: window.NEXESTATE_CRITICAL_REGRESSION_TEST?.inspect?.()?.metros || []
    }));
    const opaqueNonWhite = value => { const hex = String(value).replace('#',''); const rgb = [0,2,4].map(offset => parseInt(hex.slice(offset, offset + 2), 16)); return rgb.every(Number.isFinite) && !rgb.every(channel => channel > 230); };
    insist(colors.red[0] === '#e42313' && JSON.stringify(colors.interchange) === JSON.stringify(['#e42313','#8b5b29']), 'Неверная таблица цветов метро', colors);
    insist([...colors.red, ...colors.interchange, ...colors.unknown].every(opaqueNonWhite), 'Белый/почти белый маркер метро', colors);
    report.geometry.metroComputedColors = colors;
    await saveAcceptedCoverShot(page, '04-metro-red-brown');
    return colors;
  });

  await check(env, 'OCR bounded description fixture', async () => {
    const evidence = await page.evaluate(input => ({ input, result: window.NEXESTATE_REMAINING_VISUAL_HOTFIX_TEST.extractDescription(input) }), OCR_INPUT);
    insist(evidence.result === OCR_EXPECTED, 'OCR описание вышло за границы секции', evidence);
    report.ocr = { ...evidence, expected: OCR_EXPECTED };
    return evidence;
  });

  await check(env, 'Seven extracted-media bitmap fixtures', async () => {
    const evidence = await runMediaFixtures(page);
    insist(evidence.pass, 'Media fixture decision mismatch', evidence);
    report.media.fixtures = evidence;
    return evidence;
  });

  await check(env, 'Title fit matrix for short medium long extreme cases', async () => {
    const evidence = await titleFitMatrix(page);
    report.geometry.titleFit = evidence;
    return evidence;
  });

  await check(env, '18-media performance evidence before and after', async () => {
    const evidence = performanceEvidence();
    report.performance = evidence;
    return evidence;
  });

  await check(env, 'Media preview geometry matrix on first render', async () => {
    await page.locator('[role="tab"][data-step="media"]').click();
    const evidence = await mediaGeometryEvidence(page);
    report.media.geometry = evidence;
    await saveShot(page, 'media-preview-stable-geometry');
    return evidence;
  });

  await check(env, 'Focus-link lifecycle for ordinary and dynamic contacts', async () => {
    const evidence = await focusLifecycleEvidence(page);
    report.geometry.focusLifecycle = evidence;
    return evidence;
  });

  await check(env, 'Purpose fonts and storage persistence', async () => {
    const evidence = await purposeFontsStorageEvidence(page);
    report.geometry.purposeFontsStorage = evidence;
    return evidence;
  });

  await check(env, 'Floor plan stability placement and First frame saved layout', async () => {
    const evidence = await floorPlanAndFirstFrameEvidence(page);
    report.geometry.floorPlan = evidence;
    return evidence;
  });

  await check(env, 'Delete button compact real create and delete', async () => {
    const evidence = await deleteButtonEvidence(page);
    report.geometry.deleteButton = evidence;
    return evidence;
  });

  await check(env, 'Physical bottom controls and stable geometry', async () => {
    const before = await page.evaluate(editorGeometry);
    const modeButton = page.locator('#ne62LayoutBy');
    const modeBefore = await stableBox(modeButton, '.ps-bottom-bar');
    const absoluteMode = await modeButton.boundingBox();
    await page.mouse.move(absoluteMode.x + absoluteMode.width / 2, absoluteMode.y + absoluteMode.height / 2);
    const modeHover = await stableBox(modeButton, '.ps-bottom-bar');
    await modeButton.focus();
    const modeFocus = await stableBox(modeButton, '.ps-bottom-bar');
    const delta = (a, b) => Math.max(...['x','y','width','height'].map(key => Math.abs((a?.[key] || 0) - (b?.[key] || 0))));
    insist(delta(modeBefore, modeHover) <= 0.5 && delta(modeBefore, modeFocus) <= 0.5, 'Hover/focus двигает режимы', { modeBefore, modeHover, modeFocus });
    const actions = await physicalBottomSmoke(page);
    const after = await page.evaluate(editorGeometry); validateEditor(after);
    return { before, after, actions, hoverDelta: delta(modeBefore, modeHover), focusDelta: delta(modeBefore, modeFocus) };
  });

  await check(env, 'Preview and 2 modes x 4 export formats use one accepted state', async () => {
    if (await page.locator('#ne80NoLogos').isChecked()) await page.locator('#ne80NoLogos').click();
    const matrix = {};
    for (const [mode, selector] of [['byNexEstate', '#ne62LayoutBy'], ['singlePage', '#ne62LayoutSingle']]) {
      await page.locator(selector).click();
      await waitAcceptedPreview(page);
      const before = await page.evaluate(() => window.NEXESTATE_REMAINING_VISUAL_HOTFIX_TEST.inspectCover());
      matrix[mode] = {};
      for (const type of ['pdf', 'png', 'html', 'web']) matrix[mode][type] = await exportFile(page, type, mode);
      const after = await page.evaluate(() => window.NEXESTATE_REMAINING_VISUAL_HOTFIX_TEST.inspectCover());
      insist(JSON.stringify(before.geometry) === JSON.stringify(after.geometry) && JSON.stringify(before.logo) === JSON.stringify(after.logo), 'Export изменил accepted cover geometry', { mode, before, after });
      matrix[mode].coverBefore = before;
      matrix[mode].coverAfter = after;
    }
    await selectExportFormat(page, 'html');
    await page.locator('#ne62LayoutBy').click();
    await page.waitForTimeout(250);
    const byState = await page.locator('#ne62DownloadMain').evaluate(node => ({ label: node.textContent.trim(), format: node.dataset.exportFormat }));
    await page.locator('#ne62LayoutSingle').click();
    await page.waitForTimeout(250);
    const singleState = await page.locator('#ne62DownloadMain').evaluate(node => ({ label: node.textContent.trim(), format: node.dataset.exportFormat }));
    insist(byState.format === 'html' && singleState.format === 'html' && byState.label === 'Скачать HTML' && singleState.label === 'Скачать HTML', 'Смена режима сбрасывает общий формат экспорта', { byState, singleState });
    await page.locator('#ne62LayoutBy').click();
    await waitAcceptedPreview(page);
    report.exports = matrix;
    return { matrix, sharedState: { byState, singleState }, aligned: true };
  });

  await check(env, 'No-logo reversibly hides only COVER_BRAND_LOGO', async () => {
    const toggle = page.locator('#ne80NoLogos');
    if (await toggle.isChecked()) await toggle.click();
    const visible = await page.evaluate(() => window.NEXESTATE_REMAINING_VISUAL_HOTFIX_TEST.inspectCover());
    await toggle.click();
    const hidden = await page.evaluate(() => window.NEXESTATE_REMAINING_VISUAL_HOTFIX_TEST.inspectCover());
    await toggle.click();
    const restored = await page.evaluate(() => window.NEXESTATE_REMAINING_VISUAL_HOTFIX_TEST.inspectCover());
    insist(visible.logo && !hidden.logo && restored.logo, 'Без логотипов не скрывает/не восстанавливает знак', { visible, hidden, restored });
    insist((await page.locator('.ne83-editor-signature').innerText()) === 'NexEstate Presentation Studio by Эдик Великий', 'STUDIO_SIGNATURE изменена переключателем', {});
    return { visible: !!visible.logo, hidden: !!hidden.logo, restored: !!restored.logo };
  });

  await goHome(page);
  await check(env, 'Presentations long-content footer after last card', async () => {
    for (let index = 0; index < 7; index++) {
      await createProject(page);
      await page.locator('[role="tab"][data-step="data"]').click();
      await page.locator('#studioName').fill(`QA hotfix project ${index + 2}`);
      await page.locator('#studioName').press('Tab');
      await goHome(page);
    }
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(100);
    const metrics = await page.evaluate(homeGeometry); validateHome(metrics, true); report.geometry.homeLong = metrics; await saveShot(page, '06-presentations-long-end'); return metrics;
  });

  const unhandled = await page.evaluate(() => window.__NEX_HOTFIX_UNHANDLED || []);
  errors.unhandled.push(...unhandled);
  await check(env, 'No console/page/unhandled errors', async () => { insist(errors.console.length === 0 && errors.page.length === 0 && errors.unhandled.length === 0, 'Runtime errors detected', errors); return errors; });
}

async function firefoxWebDriverMatrix(label, privateMode) {
  insist(fs.existsSync(SYSTEM_FIREFOX), 'System Firefox unavailable', { executable: SYSTEM_FIREFOX });
  insist(fs.existsSync(GECKODRIVER), 'GeckoDriver unavailable', { executable: GECKODRIVER });
  const port = 4450 + Math.floor(Math.random() * 300);
  const base = `http://127.0.0.1:${port}`;
  const driverLog = [];
  const driver = spawn(GECKODRIVER, ['--port', String(port)], {
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env,
      MOZ_FORCE_DISABLE_E10S: '1',
      MOZ_DISABLE_CONTENT_SANDBOX: '1',
      MOZ_DISABLE_GMP_SANDBOX: '1',
      MOZ_DISABLE_RDD_SANDBOX: '1'
    }
  });
  driver.stderr.on('data', chunk => driverLog.push(String(chunk)));
  const sleep = delay => new Promise(resolve => setTimeout(resolve, delay));
  const request = async (urlPath, method = 'GET', body) => {
    const response = await fetch(base + urlPath, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const payload = await response.json();
    if (!response.ok || payload.value?.error) throw new Error(`WebDriver ${method} ${urlPath}: ${JSON.stringify(payload)}`);
    return payload.value;
  };
  const waitFor = async (script, timeout = 30000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const value = await request(`/session/${sessionId}/execute/sync`, 'POST', { script: `return !!(${script})`, args: [] });
      if (value) return true;
      await sleep(100);
    }
    throw new Error(`Firefox wait timed out: ${script}`);
  };
  const execute = (script, args = []) => request(`/session/${sessionId}/execute/sync`, 'POST', { script, args });
  const elementKey = 'element-6066-11e4-a52e-4f735466cecf';
  const find = async selector => {
    const value = await request(`/session/${sessionId}/element`, 'POST', { using: 'css selector', value: selector });
    return value[elementKey];
  };
  const click = async selector => {
    const id = await find(selector);
    await execute('arguments[0].scrollIntoView({block:"center",inline:"center"})', [{ [elementKey]: id }]);
    await request(`/session/${sessionId}/element/${id}/click`, 'POST', {});
    return id;
  };
  const fill = async (selector, value) => {
    const id = await find(selector);
    await request(`/session/${sessionId}/element/${id}/clear`, 'POST', {});
    await request(`/session/${sessionId}/element/${id}/value`, 'POST', { text: value, value: [value] });
  };
  const setViewport = async viewport => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const inner = await execute('return {width:innerWidth,height:innerHeight}');
      const rect = await request(`/session/${sessionId}/window/rect`);
      const width = Math.max(320, viewport.width + (rect.width - inner.width));
      const height = Math.max(320, viewport.height + (rect.height - inner.height));
      await request(`/session/${sessionId}/window/rect`, 'POST', { x: 0, y: 0, width, height });
      await sleep(120);
      const next = await execute('return {width:innerWidth,height:innerHeight}');
      if (next.width === viewport.width && next.height === viewport.height) return next;
    }
    return execute('return {width:innerWidth,height:innerHeight}');
  };
  const screenshot = async name => {
    const data = await request(`/session/${sessionId}/screenshot`);
    const target = path.join(RESULTS, `${name}.png`);
    fs.writeFileSync(target, Buffer.from(data, 'base64'));
    report.screenshots[name] = target;
    return target;
  };
  let sessionId = '';
  let bidiSocket = null;
  let bidiContext = '';
  let bidiSequence = 0;
  const bidiPending = new Map();
  const bidi = (method, params = {}) => new Promise((resolve, reject) => {
    if (!bidiSocket || bidiSocket.readyState !== WebSocket.OPEN) return reject(new Error('Firefox BiDi socket unavailable'));
    const id = ++bidiSequence;
    bidiPending.set(id, { resolve, reject });
    bidiSocket.send(JSON.stringify({ id, method, params }));
  });
  const connectBidi = async webSocketUrl => {
    insist(webSocketUrl, 'Firefox WebDriver did not expose BiDi URL', {});
    bidiSocket = new WebSocket(webSocketUrl);
    bidiSocket.addEventListener('message', event => {
      const payload = JSON.parse(String(event.data));
      const pending = bidiPending.get(payload.id);
      if (!pending) return;
      bidiPending.delete(payload.id);
      if (payload.type === 'error') pending.reject(new Error(`${payload.error}: ${payload.message || ''}`));
      else pending.resolve(payload.result);
    });
    await new Promise((resolve, reject) => {
      bidiSocket.addEventListener('open', resolve, { once: true });
      bidiSocket.addEventListener('error', reject, { once: true });
    });
    const tree = await bidi('browsingContext.getTree', { maxDepth: 0 });
    bidiContext = tree.contexts?.[0]?.context || '';
    insist(bidiContext, 'Firefox BiDi browsing context unavailable', tree);
  };
  const setBidiViewport = async viewport => {
    await bidi('browsingContext.setViewport', { context: bidiContext, viewport: { width: viewport.width, height: viewport.height }, devicePixelRatio: 1 });
    await sleep(120);
    return execute('return {width:innerWidth,height:innerHeight}');
  };
  try {
    for (let attempt = 0; attempt < 60; attempt++) {
      try { await request('/status'); break; } catch (error) { if (attempt === 59) throw error; await sleep(100); }
    }
    const args = ['-headless'];
    if (privateMode) args.push('-private');
    const session = await request('/session', 'POST', {
      capabilities: {
        alwaysMatch: {
          browserName: 'firefox',
          webSocketUrl: true,
          acceptInsecureCerts: true,
          'moz:firefoxOptions': {
            binary: SYSTEM_FIREFOX,
            args,
            prefs: {
              'browser.tabs.remote.autostart': false,
              'browser.tabs.remote.autostart.2': false,
              'fission.autostart': false,
              'dom.ipc.processCount': 1,
              'layers.acceleration.disabled': true,
              'gfx.webrender.software': true
            }
          }
        }
      }
    });
    sessionId = session.sessionId;
    await connectBidi(session.capabilities?.webSocketUrl);
    await request(`/session/${sessionId}/url`, 'POST', { url: `${APP}&firefox-webdriver=${encodeURIComponent(label)}` });
    await waitFor('window.NEXESTATE_REMAINING_VISUAL_HOTFIX_LOADED===true && window.NEXESTATE_UNRESOLVED_UI_PERFORMANCE_LOADED===true && document.querySelector("#studioHome")?.getClientRects().length');
    for (const viewport of VIEWPORTS) {
      const actual = await setBidiViewport(viewport);
      const environment = `${label} ${viewport.name}`;
      report.environments.push(environment);
      await check(environment, 'presentations empty-footer viewport geometry', async () => {
        const metrics = await execute(`return (${homeGeometry.toString()})()`);
        validateHome(metrics, metrics.scrollHeight > metrics.viewport.height + 1);
        insist(actual.width === viewport.width && actual.height === viewport.height, 'Firefox viewport mismatch', { expected: viewport, actual });
        return { metrics, actual };
      });
    }
    await setBidiViewport(VIEWPORTS[0]);
    await click('#nsNewProject');
    await waitFor('document.querySelector("#nsNewDialog[open]")');
    await click('#nsNewDialog[open] button.ns-primary');
    await waitFor('document.querySelector("#presentationStudio")?.getClientRects().length && document.querySelector("#presentationStudio")?.classList.contains("ne83-footer-toolbar")');
    await click('[role="tab"][data-step="data"]');
    await fill('#studioName', LONG_TITLE);
    await fill('#studioAddr', 'г Москва, ул Краснопрудная, д 3-5 стр 1');
    await fill('#studioMetro', 'Красносельская — 5 минут пешком; Комсомольская — 7 минут пешком');
    await fill('#studioUse', 'кофейня, пекарня, салон красоты');
    await fill('#studioDescription', 'Состояние: типовой ремонт. Отдельный вход с улицы.');
    await click('#ne62LayoutBy');
    await waitFor('window.NEXESTATE_CRITICAL_REGRESSION_TEST?.logo?.state?.()==="ready"');
    await waitFor('document.querySelector("#studioPresoDeck")?.getAttribute("aria-busy")==="false"');
    for (const viewport of VIEWPORTS) {
      const actual = await setBidiViewport(viewport);
      const environment = `${label} ${viewport.name}`;
      await check(environment, 'editor/footer/group viewport geometry', async () => {
        const metrics = await execute(`return (${editorGeometry.toString()})()`);
        validateEditor(metrics);
        const cover = await execute('return window.NEXESTATE_REMAINING_VISUAL_HOTFIX_TEST.inspectCover()');
        validateCover(cover);
        const hit = await execute(`return ['#ne62LayoutBy','#ne62LayoutSingle','#ne80NoLogos','#ne62DownloadMain','#ne62FormatTrigger'].map(selector=>document.querySelector(selector)).filter(node=>node&&getComputedStyle(node).display!=='none'&&!node.hidden).map(node=>{node.scrollIntoView({block:'center',inline:'center'});const r=node.getBoundingClientRect(),target=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return{id:node.id,self:target===node||node.contains(target),hit:target?.id||target?.className||target?.tagName||''}})`);
        insist(hit.every(item => item.self), 'Firefox viewport control hit-test failed', { hit, metrics, actual });
        return { metrics, cover, hit, actual };
      });
      if (viewport.name === '1920x1080' || viewport.name === '390x844') await screenshot(`${privateMode ? 'firefox-private' : 'firefox-normal'}-${viewport.name}`);
    }
    await setBidiViewport(VIEWPORTS[0]);
    await check(label, 'Firefox physical bottom controls', async () => {
      await click('#ne62LayoutSingle');
      await click('#ne62LayoutBy');
      await click('#ne80NoLogos');
      const enabled = await execute('return {layout:document.getElementById("ne62LayoutBy")?.getAttribute("aria-pressed")==="true"?"byNexEstate":document.getElementById("ne62LayoutSingle")?.getAttribute("aria-pressed")==="true"?"singlePage":null,hidden:document.getElementById("ne80NoLogos")?.checked===true}');
      await click('#ne80NoLogos');
      insist(enabled.layout === 'byNexEstate' && enabled.hidden, 'Firefox control handlers failed', enabled);
      return enabled;
    });
    await click('#presentationStudio .ne79-header-nav button');
    await waitFor('document.querySelector("#studioHome")?.getClientRects().length');
    await check(label, 'Firefox return to presentations', async () => {
      const metrics = await execute(`return (${homeGeometry.toString()})()`);
      validateHome(metrics, metrics.scrollHeight > metrics.viewport.height + 1);
      return metrics;
    });
    await check(label, 'Firefox runtime flags', async () => {
      const flags = await execute('return {v80:window.NEXESTATE_FINAL_FUNCTIONAL_LOADED===true,v80d:window.NEXESTATE_DATA_RENDER_LOADED===true,v81:window.NEXESTATE_BRAND_VISIBILITY_LOADED===true,v82:window.NEXESTATE_CRITICAL_REGRESSION_LOADED===true,v83:typeof window.NEXESTATE_FOOTER_TOOLBAR_TEST==="object",v84:window.NEXESTATE_REMAINING_VISUAL_HOTFIX_LOADED===true,v85:window.NEXESTATE_UNRESOLVED_UI_PERFORMANCE_LOADED===true}');
      insist(Object.values(flags).every(Boolean), 'Firefox runtime flag failed', flags);
      return { flags, privateMode, driverWarnings: driverLog.filter(line => /Failed to launch/i.test(line)).length };
    });
  } finally {
    if (bidiSocket) bidiSocket.close();
    if (sessionId) await request(`/session/${sessionId}`, 'DELETE').catch(() => {});
    driver.kill();
  }
}

async function basicMatrix(label, browserType, executablePath, privateMode) {
  const launchOptions = { headless: true };
  if (executablePath && fs.existsSync(executablePath)) launchOptions.executablePath = executablePath;
  let browser = null, context = null;
  const profile = path.join(os.tmpdir(), `nexestate-v85-${label.replace(/[^a-z0-9]+/gi,'-')}-${RUN_ID}`);
  try {
    if (privateMode) {
      browser = await browserType.launch(launchOptions);
      context = await browser.newContext({ viewport: VIEWPORTS[0], acceptDownloads: true, serviceWorkers: 'allow' });
    } else {
      context = await browserType.launchPersistentContext(profile, { ...launchOptions, viewport: VIEWPORTS[0], acceptDownloads: true, serviceWorkers: 'allow' });
    }
    const page = context.pages()[0] || await context.newPage();
    const errors = errorCollector(page);
    const actions = [];
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    await prepareHub(page);
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.waitForTimeout(120);
      const environment = `${label} ${viewport.name}`;
      report.environments.push(environment);
      await check(environment, 'Hub exact physical footer viewport geometry', async () => {
        await page.evaluate(() => scrollTo(0, 0));
        const metrics = await page.evaluate(hubGeometry);
        validateHub(metrics);
        return metrics;
      });
      if (viewport.name === '1920x1080' || viewport.name === '390x844') {
        await saveShot(page, `${slug}-hub-${viewport.name}`);
      }
    }
    await page.setViewportSize({ width: VIEWPORTS[0].width, height: VIEWPORTS[0].height });
    await page.locator('[data-app-route="presentation"]').click();
    await page.locator('#studioHome').waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForFunction(() => window.NEXESTATE_UNRESOLVED_UI_PERFORMANCE_TEST?.version === '85.0-unresolved-ui-performance-fix', null, { timeout: 30000 });
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.waitForTimeout(120);
      const environment = `${label} ${viewport.name}`;
      await check(environment, 'presentations empty-footer viewport geometry', async () => {
        await page.evaluate(() => scrollTo(0, 0));
        const metrics = await page.evaluate(homeGeometry);
        validateHome(metrics, metrics.scrollHeight > metrics.viewport.height + 1);
        return metrics;
      });
    }
    await page.setViewportSize({ width: VIEWPORTS[0].width, height: VIEWPORTS[0].height });
    await homeActionPrelude(page, actions);
    await createProject(page);
    actions.push({ action: 'Новая презентация', result: 'empty project created' });
    await editorActionSmoke(page, label, actions);
    await page.locator('[role="tab"][data-step="data"]').click();
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.waitForTimeout(120);
      const environment = `${label} ${viewport.name}`;
      await check(environment, 'editor/footer/group viewport geometry', async () => {
        const metrics = await page.evaluate(editorGeometry); validateEditor(metrics);
        const cover = await page.evaluate(() => window.NEXESTATE_REMAINING_VISUAL_HOTFIX_TEST.inspectCover()); validateCover(cover);
        const hit = [];
        for (const selector of ['#ne62LayoutBy','#ne62LayoutSingle','#ne80NoLogos','#ne62DownloadMain','#ne62FormatTrigger']) {
          const locator = page.locator(selector); if (!(await locator.isVisible())) continue; await locator.scrollIntoViewIfNeeded();
          hit.push(await locator.evaluate(node => { const r = node.getBoundingClientRect(), target = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { id: node.id, self: target === node || node.contains(target), hit: target?.id || target?.className || target?.tagName || '' }; }));
        }
        insist(hit.every(item => item.self), 'Viewport control hit-test failed', { hit, metrics });
        return { metrics, cover, hit };
      });
      if (viewport.name === '1920x1080' || viewport.name === '390x844') {
        await saveShot(page, `${slug}-editor-${viewport.name}`);
      }
      await check(environment, 'presentations footer viewport geometry', async () => {
        await goHome(page);
        if (!actions.some(item => item.action === 'К презентациям')) actions.push({ action: 'К презентациям', result: 'presentation list opened' });
        await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
        const metrics = await page.evaluate(homeGeometry);
        validateHome(metrics, metrics.scrollHeight > metrics.viewport.height + 1);
        await openFirstProject(page);
        return metrics;
      });
    }
    await page.setViewportSize({ width: VIEWPORTS[0].width, height: VIEWPORTS[0].height });
    await goHome(page);
    await page.locator('#studioHome .app-module-home-link').first().click();
    await page.locator('.app-hub-shell').waitFor({ state: 'visible', timeout: 30000 });
    await check(label, 'Hub exact physical footer after editor return', async () => {
      const metrics = await page.evaluate(hubGeometry);
      validateHub(metrics);
      return metrics;
    });

    report.browserActions[label] = actions;
    const requiredActions = [
      'Загрузить PDF', 'Загрузить текст', 'Загрузить фото', 'Импортировать файл проекта',
      'К приложениям', 'Редактор презентаций на Hub', 'Новая презентация',
      'Вкладка PDF', 'Вкладка DATA', 'Вкладка MEDIA', 'Загрузить PDF в editor',
      'Перенести всё в Медиа', 'Загрузить фото в editor', 'Одностраничная презентация',
      'by NexEstate', 'Без логотипов', 'Планировка', 'Контакты', 'Шрифты', 'Шаблоны',
      'Резервные копии', 'Удаление', 'Шестерёнка экспорта', 'Экспорт PDF', 'Экспорт PNG',
      'Экспорт HTML', 'Экспорт Web', 'К презентациям'
    ];
    await check(label, 'Required real-click matrix', async () => {
      const completed = new Set(actions.map(item => item.action));
      const missing = requiredActions.filter(action => !completed.has(action));
      insist(missing.length === 0, 'Не выполнены обязательные реальные клики', { missing, actions });
      return { privateMode, requiredActions, actions };
    });
    const unhandled = await page.evaluate(() => window.__NEX_HOTFIX_UNHANDLED || []);
    errors.unhandled.push(...unhandled);
    await check(label, 'runtime errors', async () => { insist(errors.console.length === 0 && errors.page.length === 0 && errors.unhandled.length === 0, 'Runtime errors', errors); return errors; });
  } finally {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}

function acceptance() {
  const all = criterion => report.checks.filter(item => criterion.test(item.criterion));
  const pass = criterion => { const items = all(criterion); return items.length > 0 && items.every(item => item.status === 'PASS'); };
  const rows = {
    '01-hub-footer-exact-and-physical-bottom': pass(/Hub exact physical footer/),
    '02-presentations-footer-physical-bottom': pass(/Presentations (short-content|long-content|footer viewport)/),
    '03-editor-signature-only-lowest-row': pass(/Editor signature|editor\/footer\/group viewport/),
    '04-exact-logo-left-top-only': pass(/COVER_BRAND_LOGO composition/),
    '05-title-fit-four-cases-zero-overlap': pass(/Title fit matrix/),
    '06-toolbar-reference-and-delete': pass(/Physical bottom controls|Delete button compact/),
    '07-metro-markers-and-walk-time': pass(/Metro station colors/),
    '08-source-pages-preserved-extracted-filtered': pass(/Source PDF pages|Seven extracted-media/),
    '09-performance-18-media': pass(/18-media performance evidence/),
    '10-first-frame-saved-layout-no-flash': pass(/First frame saved layout/),
    '11-media-preview-immediate-geometry': pass(/Media preview geometry matrix/),
    '12-focus-link-lifecycle-and-contacts': pass(/Focus-link lifecycle/),
    '13-floor-plan-layout-stability-placement': pass(/Floor plan stability/),
    '14-purpose-fonts-storage': pass(/Purpose fonts and storage/),
    '15-real-browser-click-matrix': pass(/Required real-click matrix/) && report.environments.length >= 16,
    '16-preview-export-2x4-consistent': pass(/Preview and 2 modes x 4 export formats/) && Object.keys(report.screenshots).length >= 6,
    '17-catalog-imports-and-project-menu': pass(/Catalog imports and all project-card actions/)
  };
  for (const [id, value] of Object.entries(rows)) report.acceptance[id] = { status: value ? 'PASS' : 'FAIL' };
}

async function main() {
  try {
    const { execFileSync } = require('child_process');
    report.branch = execFileSync('git', ['-c', `safe.directory=${ROOT.replace(/\\/g,'/')}`, 'branch', '--show-current'], { cwd: ROOT, encoding: 'utf8' }).trim();
    insist(report.branch === EXPECTED_BRANCH, 'Unexpected branch', { branch: report.branch, expected: EXPECTED_BRANCH });

    const browser = await chromium.launch({ headless: true, executablePath: fs.existsSync(CHROME) ? CHROME : undefined });
    const context = await browser.newContext({ viewport: VIEWPORTS[0], acceptDownloads: true, serviceWorkers: 'allow' });
    const page = await context.newPage();
    const errors = errorCollector(page);
    await prepareHub(page);
    await check('Chrome normal 1920x1080', 'Hub exact physical footer initial load', async () => {
      const metrics = await page.evaluate(hubGeometry);
      validateHub(metrics);
      await saveShot(page, '00-hub-physical-footer');
      return metrics;
    });
    await page.locator('[data-app-route="presentation"]').click();
    await page.locator('#studioHome').waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForFunction(() => window.NEXESTATE_UNRESOLVED_UI_PERFORMANCE_TEST?.version === '85.0-unresolved-ui-performance-fix', null, { timeout: 30000 });
    await primaryScenario(page, errors);
    await context.close();
    await browser.close();

    const catalogBrowser = await chromium.launch({ headless: true, executablePath: fs.existsSync(CHROME) ? CHROME : undefined });
    const catalogContext = await catalogBrowser.newContext({ viewport: VIEWPORTS[0], acceptDownloads: true, serviceWorkers: 'allow' });
    const catalogPage = await catalogContext.newPage();
    const catalogErrors = errorCollector(catalogPage);
    await prepare(catalogPage);
    await check('Chrome normal 1920x1080', 'Catalog imports and all project-card actions', async () => {
      const evidence = await catalogImportAndCardMenuEvidence(catalogPage);
      report.catalogActions = evidence;
      return evidence;
    });
    const catalogUnhandled = await catalogPage.evaluate(() => window.__NEX_HOTFIX_UNHANDLED || []);
    catalogErrors.unhandled.push(...catalogUnhandled);
    await check('Chrome normal 1920x1080', 'Catalog import runtime errors', async () => {
      insist(catalogErrors.console.length === 0 && catalogErrors.page.length === 0 && catalogErrors.unhandled.length === 0, 'Catalog runtime errors', catalogErrors);
      return catalogErrors;
    });
    await catalogContext.close();
    await catalogBrowser.close();

    const runMatrix = async (label, browserType, executablePath, privateMode) => {
      try {
        insist(fs.existsSync(executablePath), `${label} executable unavailable`, { executablePath });
        await basicMatrix(label, browserType, executablePath, privateMode);
      } catch (error) {
        add(label, 'Required real-click matrix', 'FAIL', error.evidence || { executablePath, privateMode }, String(error.message || error));
        report.errors.push({ environment: label, message: String(error.message || error), stack: String(error.stack || ''), evidence: error.evidence || {} });
      }
    };
    if (process.env.NEX_QA_PRIMARY_ONLY !== '1') {
      await runMatrix('Chrome normal', chromium, CHROME, false);
      await runMatrix('Chrome incognito', chromium, CHROME, true);
      await runMatrix('Edge normal', chromium, EDGE, false);
      await runMatrix('Edge InPrivate', chromium, EDGE, true);
      await runMatrix('Firefox normal', firefox, PLAYWRIGHT_FIREFOX, false);
      await runMatrix('Firefox private', firefox, PLAYWRIGHT_FIREFOX, true);
    }
  } catch (error) {
    report.errors.push({ message: String(error.message || error), stack: String(error.stack || ''), evidence: error.evidence || {} });
  } finally {
    acceptance();
    report.finishedAt = new Date().toISOString();
    report.summary = {
      checksPass: report.checks.filter(item => item.status === 'PASS').length,
      checksFail: report.checks.filter(item => item.status === 'FAIL').length,
      checksNotVerified: report.checks.filter(item => item.status === 'NOT VERIFIED').length,
      acceptancePass: Object.values(report.acceptance).filter(item => item.status === 'PASS').length,
      acceptanceFail: Object.values(report.acceptance).filter(item => item.status !== 'PASS').length
    };
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    process.stdout.write(`REPORT ${REPORT_PATH}\nSUMMARY ${JSON.stringify(report.summary)}\n`);
    if (report.errors.length || report.summary.checksFail || report.summary.acceptanceFail) process.exitCode = 1;
  }
}

main();
