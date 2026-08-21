const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const BASE = process.env.NEX_ONE_SHOT_URL || 'http://127.0.0.1:8810/';
const RUN_ID = `${Date.now()}-${process.pid}`;
const APP = new URL(`apps/presentation/?one-shot=${RUN_ID}`, BASE).href;
const RESULTS = path.join(__dirname, 'results', 'one-shot-final-20260820');
const REPORT = path.join(RESULTS, 'report.json');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PHOTO = path.join(ROOT, 'qa', 'results', 'video-cover.jpg');
const PLAN = path.join(ROOT, 'qa', 'results', 'photo-single.webp');
const BACKUP = process.env.NEX_ONE_SHOT_BACKUP || path.join(
  path.dirname(ROOT),
  'NEXESTATE_ONE_SHOT_FINAL_FIX_2026-08-20_EXTRACTED',
  'NEXESTATE_ONE_SHOT_FINAL_FIX_2026-08-20',
  'backup-before-one-shot-20260820-235048'
);

fs.mkdirSync(RESULTS, { recursive: true });

const report = {
  runId: RUN_ID,
  startedAt: new Date().toISOString(),
  baseUrl: BASE,
  appUrl: APP,
  checks: [],
  environments: [],
  screenshots: {},
  inventory: {},
  acceptance: {},
  errors: []
};

function insist(condition, message, evidence = {}) {
  if (condition) return;
  const error = new Error(message);
  error.evidence = evidence;
  throw error;
}

function record(environment, scenario, status, evidence = {}, error = '') {
  const item = { environment, scenario, status, evidence, error };
  report.checks.push(item);
  process.stdout.write(`${status.padEnd(5)} ${environment} :: ${scenario}${error ? ` :: ${error}` : ''}\n`);
  return item;
}

async function check(environment, scenario, task) {
  try {
    return record(environment, scenario, 'PASS', (await task()) || {});
  } catch (error) {
    return record(environment, scenario, 'FAIL', error.evidence || {}, String(error.message || error));
  }
}

function collectErrors(page) {
  const errors = { console: [], pageerror: [], unhandled: [], requestfailed: [] };
  page.on('console', message => {
    if (message.type() === 'error') errors.console.push({ text: message.text(), location: message.location() });
  });
  page.on('pageerror', error => errors.pageerror.push(String(error.message || error)));
  page.on('requestfailed', request => {
    const failure = request.failure()?.errorText || '';
    if (!/ERR_INTERNET_DISCONNECTED|favicon/i.test(failure + request.url())) {
      errors.requestfailed.push({ url: request.url(), error: failure });
    }
  });
  return errors;
}

async function installDiagnostics(page) {
  await page.addInitScript(() => {
    window.__NEX_ONE_SHOT_UNHANDLED = [];
    window.__NEX_ONE_SHOT_TEXT = [];
    window.addEventListener('unhandledrejection', event => {
      window.__NEX_ONE_SHOT_UNHANDLED.push(String(event.reason?.stack || event.reason || 'unknown'));
    });
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function wrappedFillText(text, x, y, maxWidth) {
      window.__NEX_ONE_SHOT_TEXT.push(String(text ?? ''));
      if (window.__NEX_ONE_SHOT_TEXT.length > 12000) window.__NEX_ONE_SHOT_TEXT.splice(0, 3000);
      return arguments.length > 3
        ? original.call(this, text, x, y, maxWidth)
        : original.call(this, text, x, y);
    };
  });
}

function controlInventory(html) {
  const tagMatches = [...html.matchAll(/<(button|input|select|textarea|dialog|a)\b[^>]*>/gi)];
  const ids = [...html.matchAll(/\bid=["']([^"']+)["']/gi)].map(match => match[1]);
  const events = [...html.matchAll(/\bon(click|change|input|submit|keydown|keyup|pointerdown|pointerup)\s*=/gi)].map(match => match[1].toLowerCase());
  const controls = tagMatches.map(match => ({
    tag: match[1].toLowerCase(),
    id: /\bid=["']([^"']+)["']/i.exec(match[0])?.[1] || '',
    href: /\bhref=["']([^"']+)["']/i.exec(match[0])?.[1] || ''
  }));
  return {
    count: controls.length,
    byTag: controls.reduce((out, item) => ((out[item.tag] = (out[item.tag] || 0) + 1), out), {}),
    ids: [...new Set(ids)].sort(),
    duplicateIds: ids.filter((id, index) => ids.indexOf(id) !== index),
    inlineEvents: events.reduce((out, item) => ((out[item] = (out[item] || 0) + 1), out), {})
  };
}

function staticInventory() {
  const files = ['index.html', 'apps/presentation/index.html'];
  const result = {};
  for (const relative of files) {
    const currentPath = path.join(ROOT, relative);
    const backupPath = path.join(BACKUP, relative);
    const current = controlInventory(fs.readFileSync(currentPath, 'utf8'));
    const before = fs.existsSync(backupPath) ? controlInventory(fs.readFileSync(backupPath, 'utf8')) : null;
    result[relative] = {
      before,
      after: current,
      removedIds: before ? before.ids.filter(id => !current.ids.includes(id)) : [],
      addedIds: before ? current.ids.filter(id => !before.ids.includes(id)) : []
    };
  }
  report.inventory = result;
  return result;
}

async function saveShot(page, name, options = {}) {
  const target = path.join(RESULTS, `${name}.png`);
  await page.screenshot({ path: target, fullPage: options.fullPage === true });
  report.screenshots[name] = target;
  return target;
}

async function rootPage(page, shot = false) {
  await page.goto(new URL(`?one-shot=${RUN_ID}`, BASE).href, { waitUntil: 'domcontentloaded' });
  await page.locator('.app-hub-shell').waitFor({ state: 'visible' });
  const state = await page.evaluate(() => {
    const footer = document.querySelector('.app-hub-footer');
    const shell = document.querySelector('.app-hub-shell');
    const rect = footer?.getBoundingClientRect();
    return {
      footer: footer?.textContent.trim() || '',
      isLast: shell?.lastElementChild === footer,
      topBrandCount: document.querySelectorAll('.app-hub-brand,.app-hub-mark').length,
      footerRect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
      viewport: { width: innerWidth, height: innerHeight },
      scroll: { width: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }
    };
  });
  insist(state.footer === 'NexEstate · Единая рабочая среда · by Эдик Великий', 'Неверная подпись корневого hub', state);
  insist(state.isLast && state.topBrandCount === 0, 'Подпись корневого hub не внизу или верхний бренд не удалён', state);
  insist(state.scroll.width <= state.scroll.client + 1, 'Корневой hub имеет горизонтальное переполнение', state);
  if (shot) await saveShot(page, '01-root-hub', { fullPage: true });
  await page.locator('a[data-app-route="presentation"]').click();
  await page.locator('#studioHome').waitFor({ state: 'visible' });
  await page.waitForFunction(() => window.NEXESTATE_FOOTER_TOOLBAR_TEST?.version === '83.1-one-shot-final');
  return state;
}

async function presentationHome(page, shot = false) {
  const state = await page.evaluate(() => {
    const footer = document.getElementById('ne80HomeSignature');
    const home = document.getElementById('studioHome');
    const product = footer?.querySelector('.ne83-home-product');
    const credit = footer?.querySelector('.ne83-home-credit');
    const rect = footer?.getBoundingClientRect();
    const cardBottom = Math.max(0, ...[...document.querySelectorAll('.ns-project-card')].map(node => node.getBoundingClientRect().bottom));
    return {
      lines: [...(footer?.children || [])].map(node => node.textContent.trim()),
      isLast: home?.lastElementChild === footer,
      count: document.querySelectorAll('#ne80HomeSignature').length,
      topSignatureCount: document.querySelectorAll('#studioHome>.ns-home-brand').length,
      productSize: product ? getComputedStyle(product).fontSize : '',
      creditSize: credit ? getComputedStyle(credit).fontSize : '',
      rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height, bottom: rect.bottom } : null,
      afterCards: !cardBottom || (rect && rect.top >= cardBottom),
      scroll: { width: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }
    };
  });
  insist(JSON.stringify(state.lines) === JSON.stringify(['NexEstate Presentation Studio', 'by Эдик Великий']), 'Неверные строки подписи presentation hub', state);
  insist(state.isLast && state.count === 1 && state.topSignatureCount === 0 && state.afterCards, 'Подпись presentation hub не является единственным нижним footer', state);
  insist(['18px', '16px'].includes(state.productSize) && ['12px', '11px'].includes(state.creditSize), 'Подпись presentation hub масштабирована неверно', state);
  insist(state.scroll.width <= state.scroll.client + 1, 'Presentation hub имеет горизонтальное переполнение', state);
  if (shot) await saveShot(page, '02-presentations-hub', { fullPage: true });
  return state;
}

async function createProject(page) {
  await page.locator('#nsNewProject').click();
  const dialog = page.locator('#nsNewDialog[open]');
  await dialog.waitFor({ state: 'visible' });
  await dialog.getByRole('button', { name: /^Создать$/ }).click();
  await page.locator('#presentationStudio.ne83-footer-toolbar').waitFor({ state: 'visible' });
  await page.waitForFunction(() => window.NEXESTATE_CRITICAL_REGRESSION_LOADED === true && window.NEXESTATE_FOOTER_TOOLBAR_TEST?.version === '83.1-one-shot-final');
}

function toolbarMetrics() {
  const studio = document.getElementById('presentationStudio');
  const bar = studio?.querySelector('.ps-bottom-bar.ne83-toolbar');
  const controls = bar?.querySelector(':scope>.ne83-toolbar-controls');
  const signatureRow = bar?.querySelector(':scope>.ne83-toolbar-brand-row');
  const signature = signatureRow?.querySelector('.ne83-editor-signature');
  const groups = [...(controls?.querySelectorAll(':scope>.ne62-bar-group') || [])];
  const visible = node => {
    if (!node || node.hidden) return false;
    const style = getComputedStyle(node), rect = node.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };
  const rect = node => {
    const value = node?.getBoundingClientRect();
    return value ? { x: value.x, y: value.y, width: value.width, height: value.height, right: value.right, bottom: value.bottom } : null;
  };
  const items = [...(controls?.querySelectorAll('button,select,input,label') || [])].filter(visible).map(node => ({
    id: node.id || '',
    text: (node.textContent || node.getAttribute('aria-label') || '').trim(),
    rect: rect(node)
  }));
  const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y));
  const overlaps = [];
  const actionable = items.filter(item => item.id);
  for (let i = 0; i < actionable.length; i++) for (let j = i + 1; j < actionable.length; j++) {
    const area = overlap(actionable[i].rect, actionable[j].rect);
    if (area > 1) overlaps.push({ a: actionable[i].id, b: actionable[j].id, area });
  }
  const controlsRect = rect(controls), signatureRect = rect(signatureRow), barRect = rect(bar);
  const hitIds = ['ne62LayoutBy', 'ne62LayoutSingle', 'ne73BrandTheme', 'ne80NoLogos', 'ne78DownloadPdf', 'ne78DownloadPng', 'ne62FormatTrigger'].map(id => {
    const node = document.getElementById(id);
    if (!visible(node)) return { id, visible: false, self: true };
    const value = node.getBoundingClientRect(), x = value.left + value.width / 2, y = value.top + value.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { id, visible: true, self: hit === node || node.contains(hit), hit: hit?.id || hit?.className || hit?.tagName || '' };
  });
  return {
    viewport: { width: innerWidth, height: innerHeight },
    bar: barRect,
    controls: controlsRect,
    signature: signatureRect,
    signatureText: signature?.textContent.trim() || '',
    signatureSize: signature ? getComputedStyle(signature).fontSize : '',
    firstChildClass: bar?.firstElementChild?.className || '',
    lastChildClass: bar?.lastElementChild?.className || '',
    controlsAboveSignature: Boolean(controlsRect && signatureRect && controlsRect.bottom <= signatureRect.y + 1),
    topSignatureCount: studio?.querySelectorAll('.ne79-header-title,.ne80-home-signature').length || 0,
    groupLabels: groups.map(group => group.querySelector(':scope>.ne78-group-label')?.textContent.trim() || ''),
    groupCount: groups.length,
    separatorWidths: groups.slice(1).map(group => getComputedStyle(group).borderLeftWidth),
    overlaps,
    hitIds,
    documentScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    barScroll: { width: bar?.scrollWidth || 0, client: bar?.clientWidth || 0, height: bar?.scrollHeight || 0, clientHeight: bar?.clientHeight || 0 }
  };
}

function validateToolbar(metrics) {
  insist(metrics.signatureText === 'NexEstate Presentation Studio by Эдик Великий', 'Неверная editor-подпись', metrics);
  insist(metrics.firstChildClass.includes('ne83-toolbar-controls') && metrics.lastChildClass.includes('ne83-toolbar-brand-row'), 'Неверный DOM-порядок нижней панели', metrics);
  insist(metrics.controlsAboveSignature && metrics.topSignatureCount === 0, 'Подпись находится не в нижней строке или дублируется сверху', metrics);
  insist(metrics.groupCount === 3 && JSON.stringify(metrics.groupLabels) === JSON.stringify(['Работа и сохранение', 'Макет и экспорт', 'Финальные действия']), 'Неверные группы нижней панели', metrics);
  insist(metrics.separatorWidths.every(value => value === '1px'), 'Нет тонких разделителей между группами', metrics);
  insist(metrics.overlaps.length === 0, 'Контролы нижней панели перекрываются', metrics);
  insist(metrics.documentScroll <= 1, 'Страница имеет горизонтальное переполнение', metrics);
  if (metrics.viewport.width >= 1200) {
    insist(Math.abs(metrics.bar.height - 64) <= 1 && metrics.signatureSize === '11px', 'Неверная desktop-геометрия панели', metrics);
  } else if (metrics.viewport.width >= 768) {
    insist(Math.abs(metrics.bar.height - 104) <= 1, 'Неверная medium-геометрия панели', metrics);
  } else {
    insist(metrics.bar.height <= metrics.viewport.height * 0.34 + 1 && metrics.signatureSize === '10px', 'Неверная mobile-геометрия панели', metrics);
    insist(metrics.barScroll.height >= metrics.barScroll.clientHeight, 'Mobile-панель не допускает внутреннюю прокрутку', metrics);
  }
}

async function hitTestToolbarControls(page) {
  const selectors = ['#ne62LayoutBy', '#ne62LayoutSingle', '#ne73BrandTheme', '#ne80NoLogos', '#ne78DownloadPdf', '#ne78DownloadPng', '#ne62FormatTrigger'];
  const results = [];
  for (const selector of selectors) {
    const locator = page.locator(selector);
    if (!(await locator.count()) || !(await locator.isVisible())) {
      results.push({ selector, visible: false, self: true });
      continue;
    }
    await locator.scrollIntoViewIfNeeded();
    await page.waitForTimeout(30);
    results.push(await locator.evaluate((node, currentSelector) => {
      const value = node.getBoundingClientRect();
      const hit = document.elementFromPoint(value.left + value.width / 2, value.top + value.height / 2);
      return {
        selector: currentSelector,
        visible: true,
        self: hit === node || node.contains(hit),
        hit: hit?.id || hit?.className || hit?.tagName || ''
      };
    }, selector));
  }
  insist(results.every(item => item.self), 'Контрол нижней панели перехвачен другим элементом после прокрутки в видимую область', results);
  return results;
}

async function physicalToolbarSmoke(page, touch = false) {
  const results = [];
  const activate = async selector => {
    const locator = page.locator(selector);
    await locator.scrollIntoViewIfNeeded();
    const before = await locator.evaluate(node => ({ pressed: node.getAttribute('aria-pressed'), checked: node.checked, value: node.value }));
    if (touch) await locator.tap(); else await locator.click();
    await page.waitForTimeout(100);
    const after = await locator.evaluate(node => ({ pressed: node.getAttribute('aria-pressed'), checked: node.checked, value: node.value }));
    results.push({ selector, before, after });
  };
  await activate('#ne62LayoutSingle');
  await activate('#ne62LayoutBy');
  await activate('#ne80NoLogos');
  await activate('#ne80NoLogos');
  const theme = page.locator('#ne73BrandTheme');
  if (await theme.isVisible()) {
    const options = await theme.locator('option').evaluateAll(nodes => nodes.map(node => node.value).filter(Boolean));
    if (options.length > 1) await theme.selectOption(options[1]);
    results.push({ selector: '#ne73BrandTheme', value: await theme.inputValue() });
  }
  for (const step of ['pdf', 'data', 'media']) {
    const tab = page.locator(`[role="tab"][data-step="${step}"]`);
    if (touch) await tab.tap(); else await tab.click();
    results.push({ selector: `[data-step=${step}]`, selected: await tab.getAttribute('aria-selected') });
  }
  return results;
}

async function uploadPhoto(page) {
  await page.locator('[role="tab"][data-step="media"]').click();
  const chooserPromise = page.waitForEvent('filechooser');
  const visibleUpload = page.locator('label:has(#studioPhotos)').first();
  await visibleUpload.click();
  const chooser = await chooserPromise;
  await chooser.setFiles(PHOTO);
  await page.waitForFunction(() => (window.NEXESTATE_STANDALONE_TEST?.getState?.()?.mediaCount || 0) >= 1, null, { timeout: 20000 });
}

async function uploadFloorPlanAndMove(page) {
  await page.locator('[role="tab"][data-step="media"]').click();
  const beforeMediaCount = await page.evaluate(() => window.NEXESTATE_STANDALONE_TEST?.getState?.()?.mediaCount || 0);
  const label = page.locator('label:has(#studioFloorPlanInput):visible').first();
  insist(await label.count(), 'Не найдена видимая загрузка планировки');
  const chooserPromise = page.waitForEvent('filechooser', { timeout: 15000 });
  await label.click();
  const chooser = await chooserPromise;
  await chooser.setFiles(PLAN);
  await page.waitForFunction(() => window.NEXESTATE_CRITICAL_REGRESSION_TEST?.inspect?.().plan === true, null, { timeout: 20000 });
  await page.locator('#ne82PlanPlacementButton:not([hidden])').waitFor({ state: 'visible', timeout: 20000 });

  const choosePlacement = async (prefix, expectedMode) => {
    const overlay = page.locator('#ne82PlanPlacement');
    if (!await overlay.isVisible()) await page.locator('#ne82PlanPlacementButton').click();
    await overlay.waitFor({ state: 'visible' });
    const option = overlay.locator(`input[name="ne82Placement"][value^="${prefix}"]`).first();
    insist(await option.count(), `Нет варианта размещения ${prefix}`);
    await option.check();
    await page.locator('#ne82PlanApply').click();
    await overlay.waitFor({ state: 'hidden' });
    await page.waitForFunction(mode => window.NEXESTATE_CRITICAL_REGRESSION_TEST?.placement?.().mode === mode, expectedMode);
    return page.evaluate(() => window.NEXESTATE_CRITICAL_REGRESSION_TEST?.placement?.());
  };

  const cover = await choosePlacement('cover|', 'cover');
  const separate = await choosePlacement('separate|', 'separate');
  const evidence = await page.evaluate(() => {
    const slides = window.NEXESTATE_CRITICAL_REGRESSION_TEST?.render?.({ forExport: false }) || [];
    return {
      mediaCount: window.NEXESTATE_STANDALONE_TEST?.getState?.()?.mediaCount || 0,
      placement: window.NEXESTATE_CRITICAL_REGRESSION_TEST?.placement?.(),
      separatePlanPages: slides.filter(canvas => canvas?.neStage4Kind === 'floor').length,
      coverPlanSlots: slides.filter(canvas => canvas?.neStage4Kind === 'cover').flatMap(canvas => canvas?.neStage4PlanSlots || [])
    };
  });
  insist(evidence.mediaCount === beforeMediaCount, 'Размещение планировки удалило фотографии из Media', { beforeMediaCount, evidence });
  insist(cover.mode === 'cover' && separate.mode === 'separate' && evidence.separatePlanPages === 1 && evidence.coverPlanSlots.length === 0,
    'Планировка не перемещается без дублей', { cover, separate, evidence });
  return { beforeMediaCount, cover, separate, ...evidence };
}

async function fillProject(page) {
  await page.locator('[role="tab"][data-step="data"]').click();
  await page.locator('#studioName').fill('Аренда премиального помещения для итоговой проверки');
  await page.locator('#studioAddr').fill('г Москва, ул Краснопрудная, д 3-5 стр 1');
  await page.locator('#studioMetro').fill('Красносельская — 5 минут пешком; Комсомольская — 7 минут пешком');
  await page.locator('#studioUse').fill('кофейня, пекарня, салон красоты');
  await page.locator('#studioDescription').fill('Функциональное помещение с отдельным входом и витринными окнами.');
  const area = page.locator('#nsFeatureEditor [data-feature-type="area"] [data-feature-field="value"]');
  if (await area.count()) await area.fill('210.5 м²');
  await page.locator('#studioName').press('Tab');
  await page.waitForTimeout(350);
}

async function runClassifierFixtures(page) {
  return page.evaluate(() => {
    const api = window.NEXESTATE_V54_TEST;
    if (!api?.analyzeMediaCandidate || !api?.candidateDecision) return { pass: false, reason: 'classifier API unavailable', cases: [] };
    const make = painter => {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      painter(canvas.getContext('2d'), canvas);
      return canvas;
    };
    const solid = color => make((ctx, canvas) => { ctx.fillStyle = color; ctx.fillRect(0, 0, canvas.width, canvas.height); });
    const fixtures = [
      { name: 'white', expected: false, text: '', canvas: solid('#ffffff') },
      { name: 'black', expected: false, text: '', canvas: solid('#000000') },
      { name: 'near-white', expected: false, text: '', canvas: solid('#fdfdfb') },
      { name: 'text-only', expected: false, text: '', canvas: make((ctx, canvas) => {
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#20242a'; ctx.font = '24px Arial';
        for (let row = 0; row < 9; row++) ctx.fillText(`Служебная текстовая строка ${row + 1}`, 52, 70 + row * 38);
      }) },
      { name: 'floor-plan', expected: true, text: 'Планировка помещения', canvas: make((ctx, canvas) => {
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = '#263238'; ctx.lineWidth = 7; ctx.strokeRect(65, 50, 510, 370);
        ctx.lineWidth = 4;
        [[250,50,250,420],[410,50,410,260],[65,225,410,225],[250,330,575,330]].forEach(line => { ctx.beginPath(); ctx.moveTo(line[0], line[1]); ctx.lineTo(line[2], line[3]); ctx.stroke(); });
        ctx.fillStyle = '#37474f'; ctx.font = '18px Arial'; ctx.fillText('12,4 м²', 105, 145); ctx.fillText('18,6 м²', 285, 145); ctx.fillText('9,2 м²', 445, 145);
      }) },
      { name: 'map', expected: true, text: 'Карта расположения объекта', canvas: make((ctx, canvas) => {
        ctx.fillStyle = '#e9e5d5'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        const colors = ['#d7c9a7', '#b8d7c1', '#c9d8ea', '#f3f0e4'];
        for (let y = 0; y < 12; y++) for (let x = 0; x < 16; x++) { ctx.fillStyle = colors[(x * 3 + y * 5) % colors.length]; ctx.fillRect(x * 40 + 2, y * 40 + 2, 35, 35); }
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 10;
        for (let i = -300; i < 900; i += 95) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 420, 480); ctx.stroke(); }
        ctx.fillStyle = '#d4382c'; ctx.beginPath(); ctx.arc(350, 230, 24, 0, Math.PI * 2); ctx.fill();
      }) },
      { name: 'scheme', expected: true, text: 'Схема инженерных коммуникаций', canvas: make((ctx, canvas) => {
        ctx.fillStyle = '#fbfbf8'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = '#245f8a'; ctx.lineWidth = 4;
        for (let y = 70; y <= 410; y += 68) { ctx.beginPath(); ctx.moveTo(45, y); ctx.lineTo(595, y); ctx.stroke(); }
        for (let x = 80; x <= 560; x += 80) { ctx.beginPath(); ctx.moveTo(x, 40); ctx.lineTo(x, 440); ctx.stroke(); }
        ctx.fillStyle = '#df9b2d'; for (let i = 0; i < 14; i++) ctx.fillRect(68 + (i % 7) * 80, 58 + Math.floor(i / 7) * 272, 24, 24);
      }) },
      { name: 'photo', expected: true, text: '', canvas: make((ctx, canvas) => {
        const image = ctx.createImageData(canvas.width, canvas.height);
        for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
          const offset = (y * canvas.width + x) * 4;
          image.data[offset] = (x * 7 + y * 3 + (x ^ y)) % 256;
          image.data[offset + 1] = (x * 2 + y * 9 + ((x * y) % 97)) % 256;
          image.data[offset + 2] = (x * 11 + y * 5 + ((x + y) % 83)) % 256;
          image.data[offset + 3] = 255;
        }
        ctx.putImageData(image, 0, 0);
      }) }
    ];
    const cases = fixtures.map(item => {
      const analysis = api.analyzeMediaCandidate(item.canvas);
      const decision = api.candidateDecision(item.canvas, analysis, item.text);
      return { name: item.name, expected: item.expected, actual: decision.keep === true, reason: decision.reason, analysis };
    });
    return { pass: cases.every(item => item.actual === item.expected), cases };
  });
}

async function fullFunctionalScenario(page) {
  await fillProject(page);
  await uploadPhoto(page);
  await page.locator('[role="tab"][data-step="data"]').click();
  await saveShot(page, '04-data-tab');

  const longTitle = 'Очень длинный заголовок коммерческого объекта свободного назначения с витринными окнами и отдельным входом в центре Москвы для проверки безопасной области';
  await page.locator('#studioName').fill(longTitle);
  await page.locator('#studioName').press('Tab');
  await page.waitForTimeout(400);
  const title = await page.evaluate(expected => {
    const slides = window.NEXESTATE_STANDALONE_TEST?.buildSlides?.({ forExport: false }) || [];
    const metrics = slides[0]?.neTitleMetrics || null;
    const canonical = window.NEXESTATE_STANDALONE_TEST?.getState?.()?.data?.objName || '';
    return { metrics, canonical, expected, tokens: slides.map(canvas => canvas?.neAppBrandTokens || []) };
  }, longTitle);
  insist(title.metrics && title.metrics.lines <= 4 && title.canonical === longTitle, 'Длинный заголовок не ограничен четырьмя строками или канон обрезан', title);

  const font = page.locator('#dsFontSelect');
  const fontSettings = page.locator('#ne78FontSettings');
  if (await fontSettings.count()) {
    const isOpen = await fontSettings.evaluate(node => node.open === true);
    if (!isOpen) await fontSettings.locator(':scope>summary').click();
  }
  await font.waitFor({ state: 'visible' });
  const fontEvidence = await font.evaluate(node => ({ count: node.options.length, value: node.value }));
  insist(fontEvidence.count >= 6, 'Доступно меньше шести кириллических шрифтов', fontEvidence);
  const alternate = await font.locator('option').evaluateAll((nodes, current) => nodes.map(node => node.value).find(value => value && value !== current) || '', fontEvidence.value);
  if (alternate) await font.selectOption(alternate);

  const focusEvidence = await page.locator('#studioAddr').evaluate(async node => {
    node.focus();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const active = {
      sources: document.querySelectorAll('#presentationStudio .ne78-source-active').length,
      targets: document.querySelectorAll('#presentationStudio .ne78-preview-target').length,
      connectors: [...document.querySelectorAll('#presentationStudio>.ne78-connector')].filter(item => !item.hidden).length
    };
    node.blur();
    document.querySelector('.ps-preview-stage')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const cleared = {
      sources: document.querySelectorAll('#presentationStudio .ne78-source-active').length,
      targets: document.querySelectorAll('#presentationStudio .ne78-preview-target').length,
      connectors: [...document.querySelectorAll('#presentationStudio>.ne78-connector')].filter(item => !item.hidden).length
    };
    return { active, cleared };
  });
  insist(focusEvidence.active.sources <= 1 && focusEvidence.active.targets <= 1 && focusEvidence.active.connectors <= 1, 'Фокус создаёт дубликаты рамок/коннекторов', focusEvidence);
  insist(Object.values(focusEvidence.cleared).every(value => value === 0), 'Blur не очищает рамки и коннектор', focusEvidence);

  const fixtures = await runClassifierFixtures(page);
  insist(fixtures.pass === true, 'Фильтрация извлечённых медиа не прошла fixtures', { fixtures });

  const branded = await page.evaluate(() => window.NEXESTATE_BRAND_VISIBILITY_TEST?.state?.());
  insist(branded && branded.hidden === false && branded.tokens?.[0]?.includes('NEX') && branded.tokens[0].includes('ESTATE') && branded.tokens[0].includes('BUILDINGS'), 'Первый брендированный лист не содержит полный логотип', branded);
  if (branded.tokens.length > 1) insist(branded.tokens.slice(1).every(tokens => tokens.length === 1 && tokens[0] === 'NEX'), 'На внутренних страницах должен быть только NEX', branded);
  await page.locator('#ne80NoLogos').click();
  const hidden = await page.evaluate(() => window.NEXESTATE_BRAND_VISIBILITY_TEST?.state?.());
  insist(hidden?.hidden === true && hidden.tokens.every(tokens => tokens.length === 0), 'Без логотипов не скрывает app-branding', hidden);
  await page.locator('#ne80NoLogos').click();

  await saveShot(page, '05-by-cover');
  const deck = page.locator('#studioPresoDeck canvas');
  if (await deck.count() > 1) {
    await deck.nth(1).scrollIntoViewIfNeeded();
    await saveShot(page, '06-by-internal');
    await deck.last().scrollIntoViewIfNeeded();
    await saveShot(page, '07-contacts');
  }
  const floorPlanEvidence = await uploadFloorPlanAndMove(page);
  await page.locator('#ne62LayoutSingle').click();
  await page.waitForTimeout(400);
  await page.locator('#ne62FloorTrigger').click();
  const noFloorPlan = page.locator('#ne62NoFloorPlan');
  await noFloorPlan.check();
  await page.waitForFunction(() => window.NEXESTATE_V62_TEST?.getState?.().withoutPlan === true);
  await page.keyboard.press('Escape');
  await saveShot(page, '08-single-page');

  await page.locator('[role="tab"][data-step="pdf"]').click();
  await saveShot(page, '03-pdf-tab');
  await page.locator('[role="tab"][data-step="media"]').click();
  await saveShot(page, '09-media-tab');

  const exportEvidence = {};
  for (const [selector, key, signature] of [['#ne78DownloadPdf', 'pdf', '%PDF-'], ['#ne78DownloadPng', 'png', '89504e470d0a1a0a']]) {
    const button = page.locator(selector);
    await button.scrollIntoViewIfNeeded();
    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
    await button.click();
    const download = await downloadPromise;
    const destination = path.join(os.tmpdir(), `nexestate-one-shot-${RUN_ID}-${key}`);
    await download.saveAs(destination);
    const buffer = fs.readFileSync(destination);
    const actual = key === 'pdf' ? buffer.subarray(0, 5).toString('ascii') : buffer.subarray(0, 8).toString('hex');
    insist(actual === signature && buffer.length > 100, `Неверная сигнатура ${key.toUpperCase()} экспорта`, { actual, size: buffer.length });
    exportEvidence[key] = { size: buffer.length, signature: actual };
  }

  const emptyEvidence = await page.evaluate(async () => {
    const fields = ['studioName', 'studioAddr', 'studioUse'];
    const saved = Object.fromEntries(fields.map(id => [id, document.getElementById(id)?.value || '']));
    fields.forEach(id => { const node = document.getElementById(id); if (node) { node.value = ''; node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })); } });
    await new Promise(resolve => setTimeout(resolve, 250));
    window.__NEX_ONE_SHOT_TEXT.length = 0;
    window.NEXESTATE_STANDALONE_TEST?.buildSlides?.({ forExport: false });
    const drawn = [...window.__NEX_ONE_SHOT_TEXT];
    fields.forEach(id => { const node = document.getElementById(id); if (node) { node.value = saved[id]; node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })); } });
    return { drawn, forbidden: drawn.filter(text => /Объект недвижимости|Название объекта|Москва$|Торговое помещение 45/i.test(text)) };
  });
  insist(emptyEvidence.forbidden.length === 0, 'Пустые поля породили фантомные значения', emptyEvidence);

  const noFloorPlanEvidence = await page.evaluate(() => window.NEXESTATE_V62_TEST?.getState?.().withoutPlan === true);
  return { title, fontEvidence, focusEvidence, fixtures, branded, hidden, floorPlanEvidence, noFloorPlanEvidence, exportEvidence, emptyEvidence };
}

async function launchChromiumMatrix(name, executablePath, args = [], detailed = false) {
  const browser = await chromium.launch({ executablePath, headless: true, args });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, serviceWorkers: 'allow' });
  const page = await context.newPage();
  await installDiagnostics(page);
  const errors = collectErrors(page);
  report.environments.push({ name, executablePath, args });
  try {
    await check(name, 'root hub/footer and navigation', async () => rootPage(page, detailed));
    await check(name, 'presentations hub/footer', async () => presentationHome(page, detailed));
    await createProject(page);
    const viewports = detailed
      ? [{ width: 1920, height: 1080 }, { width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]
      : [{ width: 1440, height: 900 }];
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(180);
      await check(`${name} ${viewport.width}x${viewport.height}`, 'editor toolbar geometry', async () => {
        const metrics = await page.evaluate(toolbarMetrics);
        validateToolbar(metrics);
        const hitTests = await hitTestToolbarControls(page);
        return { metrics, hitTests };
      });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await check(name, 'physical toolbar/tab controls', async () => ({ actions: await physicalToolbarSmoke(page, false) }));
    if (detailed) await check(name, 'functional acceptance scenario', async () => fullFunctionalScenario(page));
    await check(name, 'return to presentations', async () => {
      await page.getByRole('button', { name: /К презентациям/i }).click();
      await page.locator('#studioHome').waitFor({ state: 'visible' });
      return presentationHome(page, false);
    });
    const unhandled = await page.evaluate(() => window.__NEX_ONE_SHOT_UNHANDLED || []);
    errors.unhandled = unhandled;
    await check(name, 'console/page/unhandled errors', async () => {
      insist(errors.console.length === 0 && errors.pageerror.length === 0 && errors.unhandled.length === 0, 'Runtime errors обнаружены', errors);
      return errors;
    });
  } finally {
    await context.close();
    await browser.close();
  }
}

async function mobileTouch() {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, acceptDownloads: true, serviceWorkers: 'allow' });
  const page = await context.newPage();
  await installDiagnostics(page);
  const errors = collectErrors(page);
  try {
    await rootPage(page, false);
    await presentationHome(page, false);
    await createProject(page);
    await check('Edge touch 390x844', 'toolbar geometry and real taps', async () => {
      const before = await page.evaluate(toolbarMetrics);
      validateToolbar(before);
      const hitTestsBefore = await hitTestToolbarControls(page);
      const actions = await physicalToolbarSmoke(page, true);
      const after = await page.evaluate(toolbarMetrics);
      validateToolbar(after);
      const hitTestsAfter = await hitTestToolbarControls(page);
      await saveShot(page, '10-mobile-editor');
      return { before, after, hitTestsBefore, hitTestsAfter, actions };
    });
    const unhandled = await page.evaluate(() => window.__NEX_ONE_SHOT_UNHANDLED || []);
    await check('Edge touch 390x844', 'runtime errors', async () => {
      insist(errors.console.length === 0 && errors.pageerror.length === 0 && unhandled.length === 0, 'Mobile runtime errors', { errors, unhandled });
      return { errors, unhandled };
    });
  } finally {
    await context.close();
    await browser.close();
  }
}

async function firefoxMatrix(name, privateMode = false) {
  const seleniumRoot = path.join(os.tmpdir(), 'nexestate-firefox-qa-runtime', 'node_modules', 'selenium-webdriver');
  insist(fs.existsSync(seleniumRoot), 'Firefox Selenium runtime не найден', { seleniumRoot });
  const { Builder, By, until } = require(seleniumRoot);
  const firefox = require(path.join(seleniumRoot, 'firefox'));
  const binary = 'C:\\Program Files\\Mozilla Firefox\\firefox.exe';
  process.env.MOZ_DISABLE_CONTENT_SANDBOX = '1';
  const options = new firefox.Options()
    .setBinary(binary)
    .addArguments('-headless')
    .setPreference('security.sandbox.content.level', 0)
    .setPreference('browser.privatebrowsing.autostart', privateMode);
  if (privateMode) options.addArguments('-private-window');
  const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).build();
  report.environments.push({ name, executablePath: binary, privateMode });
  try {
    await driver.manage().window().setRect({ width: 1440, height: 900 });
    await driver.get(new URL(`?one-shot=${RUN_ID}-${privateMode ? 'private' : 'normal'}`, BASE).href);
    await driver.wait(until.elementLocated(By.css('.app-hub-shell')), 20000);
    await check(name, 'root hub/footer and navigation', async () => {
      const state = await driver.executeScript(`return {
        footer:document.querySelector('.app-hub-footer')?.textContent.trim()||'',
        top:document.querySelectorAll('.app-hub-brand,.app-hub-mark').length,
        last:document.querySelector('.app-hub-shell')?.lastElementChild===document.querySelector('.app-hub-footer')
      }`);
      insist(state.footer === 'NexEstate · Единая рабочая среда · by Эдик Великий' && state.top === 0 && state.last, 'Firefox root hub неверен', state);
      await driver.findElement(By.css('a[data-app-route="presentation"]')).click();
      await driver.wait(until.elementLocated(By.id('studioHome')), 20000);
      await driver.wait(async () => driver.executeScript("return window.NEXESTATE_FOOTER_TOOLBAR_TEST?.version==='83.1-one-shot-final'"), 20000);
      return state;
    });
    await check(name, 'presentations hub/footer', async () => {
      const state = await driver.executeScript(`const f=document.getElementById('ne80HomeSignature'),h=document.getElementById('studioHome');return {lines:[...(f?.children||[])].map(n=>n.textContent.trim()),last:h?.lastElementChild===f,count:document.querySelectorAll('#ne80HomeSignature').length,top:document.querySelectorAll('#studioHome>.ns-home-brand').length}`);
      insist(JSON.stringify(state.lines) === JSON.stringify(['NexEstate Presentation Studio', 'by Эдик Великий']) && state.last && state.count === 1 && state.top === 0, 'Firefox presentation hub неверен', state);
      return state;
    });
    await driver.findElement(By.id('nsNewProject')).click();
    const dialog = await driver.wait(until.elementLocated(By.css('#nsNewDialog[open]')), 10000);
    await dialog.findElement(By.xpath('.//button[normalize-space()="Создать"]')).click();
    await driver.wait(until.elementLocated(By.css('#presentationStudio.ne83-footer-toolbar')), 20000);
    await driver.wait(async () => driver.executeScript(`const bar=document.querySelector('#presentationStudio .ps-bottom-bar.ne83-toolbar');return !!bar&&bar.firstElementChild?.classList.contains('ne83-toolbar-controls')&&bar.lastElementChild?.classList.contains('ne83-toolbar-brand-row')`), 10000);
    await check(`${name} 1440x900`, 'editor toolbar geometry', async () => {
      const metrics = await driver.executeScript(`return (${toolbarMetrics.toString()})();`);
      validateToolbar(metrics);
      return metrics;
    });
    await check(name, 'physical toolbar/tab controls', async () => {
      const results = [];
      for (const id of ['ne62LayoutSingle', 'ne62LayoutBy', 'ne80NoLogos', 'ne80NoLogos']) {
        const node = await driver.findElement(By.id(id));
        await driver.executeScript('arguments[0].scrollIntoView({block:"center",inline:"center"})', node);
        await node.click();
        results.push({ id, pressed: await node.getAttribute('aria-pressed'), selected: await node.isSelected() });
      }
      const theme = await driver.findElement(By.id('ne73BrandTheme'));
      const options = await theme.findElements(By.css('option'));
      if (options.length > 1) await options[1].click();
      for (const step of ['pdf', 'data', 'media']) {
        const tab = await driver.findElement(By.css(`[role="tab"][data-step="${step}"]`));
        await tab.click();
        results.push({ step, selected: await tab.getAttribute('aria-selected') });
      }
      return { results };
    });
    await check(name, 'return to presentations', async () => {
      const buttons = await driver.findElements(By.css('#presentationStudio .ne79-header-nav button'));
      let returnButton = null;
      for (const button of buttons) {
        if (await button.isDisplayed() && (await button.getText()).trim() === 'К презентациям') {
          returnButton = button;
          break;
        }
      }
      insist(returnButton, 'Firefox: видимая кнопка К презентациям не найдена');
      await driver.executeScript('arguments[0].scrollIntoView({block:"center",inline:"center"})', returnButton);
      await returnButton.click();
      await driver.wait(async () => driver.executeScript("const home=document.getElementById('studioHome');return !!home&&!home.hidden&&getComputedStyle(home).display!=='none'"), 20000);
      const visible = await driver.executeScript("const home=document.getElementById('studioHome');return !!home&&!home.hidden&&getComputedStyle(home).display!=='none'");
      insist(visible, 'Firefox: hub не открылся');
      return { visible };
    });
    await check(name, 'runtime errors', async () => {
      const state = await driver.executeScript("return {v82:window.NEXESTATE_CRITICAL_REGRESSION_LOADED===true,v83:window.NEXESTATE_FOOTER_TOOLBAR_TEST?.version||'',error:window.NEXESTATE_CRITICAL_REGRESSION_ERROR||null}");
      insist(state.v82 && state.v83 === '83.1-one-shot-final' && !state.error, 'Firefox runtime flags неверны', state);
      return state;
    });
  } finally {
    await driver.quit();
  }
}

async function pwaOffline() {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'allow' });
  const page = await context.newPage();
  await installDiagnostics(page);
  const errors = collectErrors(page);
  try {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.evaluate(() => navigator.serviceWorker?.ready);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller));
    await page.goto(APP, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller));
    const online = await page.evaluate(async () => ({
      controller: Boolean(navigator.serviceWorker?.controller),
      registrations: (await navigator.serviceWorker?.getRegistrations?.() || []).length,
      caches: await caches.keys()
    }));
    insist(online.caches.some(name => name.includes('unified-v47-one-shot-final')), 'Новая версия PWA-кэша не активна', online);
    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('#studioHome').waitFor({ state: 'visible' });
    const appOffline = await page.title();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.locator('.app-hub-shell').waitFor({ state: 'visible' });
    const rootOffline = await page.locator('.app-hub-footer').textContent();
    await context.setOffline(false);
    await check('Edge PWA', 'online controller and offline root/editor', async () => ({ online, appOffline, rootOffline: rootOffline.trim() }));
    const unhandled = await page.evaluate(() => window.__NEX_ONE_SHOT_UNHANDLED || []);
    await check('Edge PWA', 'runtime errors', async () => {
      insist(errors.console.length === 0 && errors.pageerror.length === 0 && unhandled.length === 0, 'PWA runtime errors', { errors, unhandled });
      return { errors, unhandled };
    });
  } finally {
    await context.setOffline(false).catch(() => {});
    await context.close();
    await browser.close();
  }
}

function acceptanceSummary() {
  const failures = report.checks.filter(item => item.status !== 'PASS');
  const scenarios = report.checks.map(item => `${item.environment}::${item.scenario}`);
  const pass = pattern => report.checks.some(item => item.status === 'PASS' && pattern.test(`${item.environment} ${item.scenario}`));
  const map = {
    1: pass(/root hub\/footer/),
    2: pass(/presentations hub\/footer/),
    3: pass(/editor toolbar geometry/),
    4: pass(/physical toolbar\/tab controls/),
    5: ['Chrome normal', 'Chrome private', 'Edge normal', 'Edge private', 'Firefox normal', 'Firefox private'].every(name => scenarios.some(value => value.startsWith(`${name}::physical toolbar`))),
    6: pass(/functional acceptance scenario/),
    7: pass(/functional acceptance scenario/),
    8: pass(/functional acceptance scenario/),
    9: pass(/functional acceptance scenario/),
    10: pass(/functional acceptance scenario/),
    11: pass(/functional acceptance scenario/),
    12: pass(/functional acceptance scenario/),
    13: pass(/functional acceptance scenario/),
    14: pass(/functional acceptance scenario/),
    15: pass(/functional acceptance scenario/),
    16: pass(/return to presentations/),
    17: pass(/functional acceptance scenario/) && pass(/Edge PWA online controller/)
  };
  for (const [id, value] of Object.entries(map)) report.acceptance[id] = { status: value ? 'PASS' : 'FAIL' };
  report.summary = {
    checksPass: report.checks.length - failures.length,
    checksFail: failures.length,
    acceptancePass: Object.values(report.acceptance).filter(item => item.status === 'PASS').length,
    acceptanceFail: Object.values(report.acceptance).filter(item => item.status !== 'PASS').length
  };
}

(async () => {
  try {
    const inventory = staticInventory();
    await check('Static', 'interactive inventory preserved', async () => {
      const presentation = inventory['apps/presentation/index.html'];
      const root = inventory['index.html'];
      for (const [relative, value] of Object.entries({ 'apps/presentation/index.html': presentation, 'index.html': root })) {
        insist(value.before, `Нет baseline-инвентаря для ${relative}`, value);
        insist(value.after.count === value.before.count, `Изменилось число интерактивных элементов в ${relative}`, value);
        insist(JSON.stringify(value.after.byTag) === JSON.stringify(value.before.byTag), `Изменился состав интерактивных тегов в ${relative}`, value);
        insist(value.removedIds.length === 0 && value.addedIds.length === 0, `Изменился набор интерактивных id в ${relative}`, value);
        insist(JSON.stringify(value.after.duplicateIds) === JSON.stringify(value.before.duplicateIds), `Изменился baseline повторяющихся id в HTML-шаблонах ${relative}`, value);
        insist(JSON.stringify(value.after.inlineEvents) === JSON.stringify(value.before.inlineEvents), `Изменился inline-event inventory в ${relative}`, value);
      }
      return inventory;
    });
    await launchChromiumMatrix('Edge normal', EDGE, [], true);
    await launchChromiumMatrix('Edge private', EDGE, ['--inprivate'], false);
    await launchChromiumMatrix('Chrome normal', CHROME, [], false);
    await launchChromiumMatrix('Chrome private', CHROME, ['--incognito'], false);
    await firefoxMatrix('Firefox normal', false);
    await firefoxMatrix('Firefox private', true);
    await mobileTouch();
    await pwaOffline();
  } catch (error) {
    report.errors.push({ message: String(error.message || error), stack: String(error.stack || '') });
    record('Runner', 'fatal', 'FAIL', error.evidence || {}, String(error.message || error));
  } finally {
    acceptanceSummary();
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
    process.stdout.write(`REPORT ${REPORT}\nSUMMARY PASS=${report.summary.checksPass} FAIL=${report.summary.checksFail} ACCEPTANCE=${report.summary.acceptancePass}/17\n`);
    process.exitCode = report.summary.checksFail || report.summary.acceptanceFail ? 1 : 0;
  }
})();
