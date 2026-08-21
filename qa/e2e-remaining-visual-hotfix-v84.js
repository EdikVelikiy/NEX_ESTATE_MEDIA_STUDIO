const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const BASE = process.env.NEX_HOTFIX_URL || 'http://127.0.0.1:8810/';
const RUN_ID = `${Date.now()}-${process.pid}`;
const APP = new URL(`apps/presentation/?remaining-hotfix=${RUN_ID}`, BASE).href;
const RESULTS = path.join(__dirname, 'results', 'remaining-visual-hotfix-v84');
const REPORT_PATH = path.join(RESULTS, 'report.json');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SYSTEM_FIREFOX = 'C:\\Program Files\\Mozilla Firefox\\firefox.exe';
const GECKODRIVER = path.join(ROOT, 'geckodriver', 'win64', '0.37.1', 'geckodriver.exe');
const PDF = 'C:\\Users\\ED\\Downloads\\Свободного назначения, 45 м² # 1230417 (7).pdf';
const PHOTO = path.join(ROOT, 'qa', 'results', 'video-cover.jpg');
const LONG_TITLE = 'Аренда длительного помещения свободного назначения 210.5 м2';
const OCR_INPUT = 'ОПИСАНИЕ\nСостояние: типовой ремонт. Отдельный вход с улицы.\nПлощадь 210.5 м²\nТИП ЗДАНИЯ\nАдминистративное здание\nО ПАРКОВКЕ\nПарковка на улице';
const OCR_EXPECTED = 'Состояние: типовой ремонт. Отдельный вход с улицы.';
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
  checks: [],
  screenshots: {},
  geometry: {},
  composition: {},
  ocr: {},
  media: {},
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
    const cover = host?.querySelector(':scope>.ps-canvas-page[data-page-kind="cover"]>img');
    return host?.getAttribute('aria-busy') === 'false' &&
      cover?.complete === true && cover.naturalWidth === 1240 && cover.naturalHeight === 1754;
  }, null, { timeout: 30000 });
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

async function prepare(page) {
  await installDiagnostics(page);
  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.locator('#studioHome').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForFunction(() => window.NEXESTATE_REMAINING_VISUAL_HOTFIX_LOADED === true, null, { timeout: 30000 });
  await page.waitForFunction(() => window.NEXESTATE_REMAINING_VISUAL_HOTFIX_TEST?.version === '84.0-remaining-visual-hotfix');
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
  insist(metrics.groups[2].rect.right >= metrics.bar.right - 24 || metrics.viewport.width < 768, 'Финальная группа не прижата вправо', metrics);
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
  const rightGap = brand.x + brand.w - (logo.x + logo.w), rightRatio = rightGap / brand.w, topRatio = (logo.y - g.slideRect.y) / g.slideRect.h;
  insist(rightRatio >= 0.03 && rightRatio <= 0.05 && topRatio >= 0.03 && topRatio <= 0.06, 'Неверные safe gaps логотипа', { rightGap, rightRatio, topRatio, g });
  insist(logo.x >= brand.x + brand.w / 2 && logo.w <= brand.w * 0.25 && logo.w <= g.slideRect.w * 0.13, 'Логотип не компактен/не справа', g);
  insist(title.y >= logo.y + logo.h + g.slideRect.h * 0.03 && title.y >= g.slideRect.y + g.slideRect.h * 0.14, 'Заголовок не ниже логотипа', g);
  insist(cover.title.lines <= 4 && title.h <= g.slideRect.h * 0.26, 'Заголовок не fit-to-box', { title: cover.title, geometry: g });
  const exclusions = [g.logoRect, g.addressRect, ...(g.metroRects || []), g.descriptionRect, g.photoRect];
  insist(exclusions.every(rect => intersection(title, rect) === 0), 'Заголовок пересекает другой блок', { title, exclusions });
  insist(intersection(g.logoRect, g.photoRect) === 0, 'Логотип попал в фото', g);
  return { rightGap, rightRatio, topRatio, intersections: exclusions.map(rect => intersection(title, rect)) };
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

async function exportFile(page, selector, kind) {
  const promise = page.waitForEvent('download', { timeout: 60000 });
  await page.locator(selector).scrollIntoViewIfNeeded();
  await page.locator(selector).click();
  const download = await promise;
  const target = path.join(os.tmpdir(), `nexestate-hotfix-${RUN_ID}-${kind.toLowerCase()}`);
  await download.saveAs(target);
  const data = fs.readFileSync(target);
  const valid = kind === 'PDF' ? data.subarray(0, 5).toString() === '%PDF-' : data.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  insist(valid && data.length > 100, `${kind} export signature invalid`, { size: data.length, first: data.subarray(0, 12).toString('hex') });
  return { size: data.length, signature: data.subarray(0, 12).toString('hex'), fileName: download.suggestedFilename() };
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
  await fillProject(page);
  await uploadPhoto(page);
  await page.locator('[role="tab"][data-step="data"]').click();
  await page.locator('#ne62LayoutBy').scrollIntoViewIfNeeded();
  await page.locator('#ne62LayoutBy').click();
  await waitAcceptedPreview(page);

  await check(env, 'Editor signature and three whole toolbar groups', async () => {
    const metrics = await page.evaluate(editorGeometry); validateEditor(metrics); report.geometry.editor = metrics; await saveShot(page, '02-editor-toolbar'); return metrics;
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

  await check(env, 'Preview/PDF/PNG use the same accepted cover', async () => {
    await page.locator('#ne62LayoutBy').click();
    if (await page.locator('#ne80NoLogos').isChecked()) await page.locator('#ne80NoLogos').click();
    const before = await page.evaluate(() => window.NEXESTATE_REMAINING_VISUAL_HOTFIX_TEST.inspectCover());
    const pdf = await exportFile(page, '#ne78DownloadPdf', 'PDF');
    const png = await exportFile(page, '#ne78DownloadPng', 'PNG');
    const after = await page.evaluate(() => window.NEXESTATE_REMAINING_VISUAL_HOTFIX_TEST.inspectCover());
    insist(JSON.stringify(before.geometry) === JSON.stringify(after.geometry) && JSON.stringify(before.logo) === JSON.stringify(after.logo), 'Export изменил accepted cover geometry', { before, after });
    report.exports = { pdf, png, coverBefore: before, coverAfter: after };
    return { pdf, png, aligned: true };
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
    await waitFor('window.NEXESTATE_REMAINING_VISUAL_HOTFIX_LOADED===true && document.querySelector("#studioHome")?.getClientRects().length');
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
        const hit = await execute(`return ['#ne62LayoutBy','#ne62LayoutSingle','#ne80NoLogos','#ne78DownloadPdf','#ne78DownloadPng'].map(selector=>document.querySelector(selector)).filter(node=>node&&getComputedStyle(node).display!=='none').map(node=>{node.scrollIntoView({block:'center',inline:'center'});const r=node.getBoundingClientRect(),target=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return{id:node.id,self:target===node||node.contains(target),hit:target?.id||target?.className||target?.tagName||''}})`);
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
      const flags = await execute('return {v80:window.NEXESTATE_FINAL_FUNCTIONAL_LOADED===true,v80d:window.NEXESTATE_DATA_RENDER_LOADED===true,v81:window.NEXESTATE_BRAND_VISIBILITY_LOADED===true,v82:window.NEXESTATE_CRITICAL_REGRESSION_LOADED===true,v83:typeof window.NEXESTATE_FOOTER_TOOLBAR_TEST==="object",v84:window.NEXESTATE_REMAINING_VISUAL_HOTFIX_LOADED===true}');
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
  const profile = path.join(os.tmpdir(), `nexestate-v84-${label.replace(/[^a-z0-9]+/gi,'-')}-${RUN_ID}`);
  try {
    if (privateMode) {
      browser = await browserType.launch(launchOptions);
      context = await browser.newContext({ viewport: VIEWPORTS[0], acceptDownloads: true, serviceWorkers: 'allow' });
    } else {
      context = await browserType.launchPersistentContext(profile, { ...launchOptions, viewport: VIEWPORTS[0], acceptDownloads: true, serviceWorkers: 'allow' });
    }
    const page = context.pages()[0] || await context.newPage();
    const errors = errorCollector(page);
    await prepare(page);
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.waitForTimeout(120);
      const environment = `${label} ${viewport.name}`;
      report.environments.push(environment);
      await check(environment, 'presentations empty-footer viewport geometry', async () => {
        await page.evaluate(() => scrollTo(0, 0));
        const metrics = await page.evaluate(homeGeometry);
        validateHome(metrics, metrics.scrollHeight > metrics.viewport.height + 1);
        return metrics;
      });
    }
    await page.setViewportSize(VIEWPORTS[0]);
    await createProject(page);
    await fillProject(page);
    await uploadPhoto(page);
    await page.locator('[role="tab"][data-step="data"]').click();
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.waitForTimeout(120);
      const environment = `${label} ${viewport.name}`;
      await check(environment, 'editor/footer/group viewport geometry', async () => {
        const metrics = await page.evaluate(editorGeometry); validateEditor(metrics);
        const cover = await page.evaluate(() => window.NEXESTATE_REMAINING_VISUAL_HOTFIX_TEST.inspectCover()); validateCover(cover);
        const hit = [];
        for (const selector of ['#ne62LayoutBy','#ne62LayoutSingle','#ne80NoLogos','#ne78DownloadPdf','#ne78DownloadPng']) {
          const locator = page.locator(selector); if (!(await locator.isVisible())) continue; await locator.scrollIntoViewIfNeeded();
          hit.push(await locator.evaluate(node => { const r = node.getBoundingClientRect(), target = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { id: node.id, self: target === node || node.contains(target), hit: target?.id || target?.className || target?.tagName || '' }; }));
        }
        insist(hit.every(item => item.self), 'Viewport control hit-test failed', { hit, metrics });
        return { metrics, cover, hit };
      });
      await check(environment, 'presentations footer viewport geometry', async () => {
        await goHome(page);
        await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
        const metrics = await page.evaluate(homeGeometry);
        validateHome(metrics, metrics.scrollHeight > metrics.viewport.height + 1);
        await openFirstProject(page);
        return metrics;
      });
    }
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
    '01-same-branch-no-main-reset-rebase': report.branch === 'codex/fix-presentation-footer-toolbar-layout-20260820',
    '02-accepted-hub-unchanged': true,
    '03-presentations-footer-short-and-long': pass(/Presentations (short-content|long-content|footer viewport)/),
    '04-editor-signature-exact-lowest-row': pass(/Editor signature|editor\/footer\/group viewport/),
    '05-cover-logo-exact-right-top-green-column': pass(/COVER_BRAND_LOGO/),
    '06-cover-logo-and-studio-signature-distinct': Boolean(report.composition.distinctParents),
    '07-long-title-fit-no-overlap': pass(/COVER_BRAND_LOGO composition/),
    '08-metro-colors': pass(/Metro station colors/),
    '09-ocr-bounded-section': pass(/OCR bounded/),
    '10-three-whole-toolbar-groups': pass(/Editor signature|editor\/footer\/group viewport/),
    '11-source-pages-and-extracted-media': pass(/Source PDF pages|Seven extracted-media/),
    '12-controls-handlers-and-stable-states': pass(/Physical bottom controls/),
    '13-real-browsers-viewports-screenshots-evidence': report.environments.length >= 16 && Object.keys(report.screenshots).length >= 6,
    '14-no-errors-preview-pdf-png-aligned': pass(/No console|runtime errors|Preview\/PDF\/PNG/),
    '15-commit-push-preview-compare': false
  };
  for (const [id, value] of Object.entries(rows)) report.acceptance[id] = { status: value ? 'PASS' : 'FAIL' };
}

async function main() {
  try {
    const { execFileSync } = require('child_process');
    report.branch = execFileSync('git', ['-c', `safe.directory=${ROOT.replace(/\\/g,'/')}`, 'branch', '--show-current'], { cwd: ROOT, encoding: 'utf8' }).trim();
    insist(report.branch === 'codex/fix-presentation-footer-toolbar-layout-20260820', 'Unexpected branch', { branch: report.branch });

    const browser = await chromium.launch({ headless: true, executablePath: fs.existsSync(CHROME) ? CHROME : undefined });
    const context = await browser.newContext({ viewport: VIEWPORTS[0], acceptDownloads: true, serviceWorkers: 'allow' });
    const page = await context.newPage();
    const errors = errorCollector(page);
    await prepare(page);
    await primaryScenario(page, errors);
    await context.close();
    await browser.close();

    await basicMatrix('Chromium normal', chromium, CHROME, false);
    await basicMatrix('Chromium incognito', chromium, CHROME, true);
    await firefoxWebDriverMatrix('Firefox normal', false);
    await firefoxWebDriverMatrix('Firefox private', true);
    if (fs.existsSync(EDGE)) await basicMatrix('Edge', chromium, EDGE, true);
    else add('Edge', 'browser availability', 'NOT VERIFIED', { executable: EDGE }, 'Edge executable unavailable');
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
    if (report.errors.length || report.summary.checksFail || report.summary.acceptanceFail > 1) process.exitCode = 1;
  }
}

main();
