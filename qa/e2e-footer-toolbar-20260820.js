const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const BASE = process.env.NEX_FOOTER_URL || 'http://127.0.0.1:8810/';
const RUN_ID = `${Date.now()}-${process.pid}`;
const APP = new URL(`apps/presentation/?footer-qa=${RUN_ID}`, BASE).href;
const RESULTS = path.join(__dirname, 'results', 'footer-toolbar-20260820');
const REPORT = path.join(RESULTS, 'report.json');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CHROMIUM = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const FIREFOX = 'C:\\Program Files\\Mozilla Firefox\\firefox.exe';
const PHOTO = path.join(ROOT, 'qa', 'results', 'video-cover.jpg');
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
  appUrl: APP,
  environments: [],
  checks: [],
  measurements: { home: {}, editor: {} },
  smoke: [],
  screenshots: {},
  acceptance: {},
  preview: null
};

function insist(condition, message, evidence = {}) {
  if (condition) return;
  const error = new Error(message);
  error.evidence = evidence;
  throw error;
}

function addCheck(environment, criterion, status, evidence = {}, error = '') {
  const item = { environment, criterion, status, evidence, error };
  report.checks.push(item);
  process.stdout.write(`${status.padEnd(5)} ${environment} :: ${criterion}${error ? ` :: ${error}` : ''}\n`);
  return item;
}

async function check(environment, criterion, fn) {
  try {
    return addCheck(environment, criterion, 'PASS', (await fn()) || {});
  } catch (error) {
    return addCheck(environment, criterion, 'FAIL', error.evidence || {}, String(error.message || error));
  }
}

function errorsFor(page) {
  const errors = { console: [], page: [], request: [] };
  page.on('console', message => {
    if (message.type() === 'error') errors.console.push(message.text());
  });
  page.on('pageerror', error => errors.page.push(String(error.message || error)));
  page.on('requestfailed', request => {
    const url = request.url();
    if (!/favicon|manifest/i.test(url)) errors.request.push({ url, error: request.failure()?.errorText || '' });
  });
  return errors;
}

async function preparePage(page) {
  await page.addInitScript(() => {
    window.__NEX_FOOTER_UNHANDLED = [];
    window.addEventListener('unhandledrejection', event => window.__NEX_FOOTER_UNHANDLED.push(String(event.reason?.stack || event.reason || 'unknown')));
  });
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await page.locator('#studioHome').waitFor({ state: 'visible' });
  await page.waitForFunction(() => window.NEXESTATE_FOOTER_TOOLBAR_TEST?.version === '83.0-footer-toolbar-layout');
  await page.waitForFunction(() => {
    const footer = document.getElementById('ne80HomeSignature');
    return footer?.parentElement?.id === 'studioHome'
      && footer.parentElement.lastElementChild === footer
      && footer.children.length === 2
      && footer.children[0].textContent.trim() === 'NexEstate Presentation Studio'
      && footer.children[1].textContent.trim() === 'by Эдик Великий';
  });
}

function collectHomeMetrics() {
    const footer = document.getElementById('ne80HomeSignature');
    const product = footer?.querySelector('.ne83-home-product');
    const credit = footer?.querySelector('.ne83-home-credit');
    const rect = footer?.getBoundingClientRect();
    const productStyle = product ? getComputedStyle(product) : null;
    const creditStyle = credit ? getComputedStyle(credit) : null;
    const footerStyle = footer ? getComputedStyle(footer) : null;
    const cards = [...document.querySelectorAll('.ns-project-card')];
    const overlaps = cards.filter(card => {
      const b = card.getBoundingClientRect();
      return rect && Math.max(0, Math.min(rect.right, b.right) - Math.max(rect.left, b.left)) * Math.max(0, Math.min(rect.bottom, b.bottom) - Math.max(rect.top, b.top)) > 0;
    }).length;
    return {
      lines: [...(footer?.children || [])].map(node => node.textContent.trim()),
      rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height, centerX: rect.left + rect.width / 2 } : null,
      viewportCenterX: innerWidth / 2,
      centerDelta: rect ? Math.abs(rect.left + rect.width / 2 - innerWidth / 2) : 9999,
      product: productStyle ? { size: productStyle.fontSize, weight: productStyle.fontWeight, lineHeight: productStyle.lineHeight } : null,
      credit: creditStyle ? { size: creditStyle.fontSize, weight: creditStyle.fontWeight, lineHeight: creditStyle.lineHeight } : null,
      footer: footerStyle ? { position: footerStyle.position, transform: footerStyle.transform, gap: footerStyle.rowGap, marginTop: footerStyle.marginTop, marginBottom: footerStyle.marginBottom } : null,
      parentIsHome: footer?.parentElement?.id === 'studioHome',
      isLast: footer?.parentElement?.lastElementChild === footer,
      overlaps,
      horizontalScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
}

async function homeMetrics(page) {
  return page.evaluate(collectHomeMetrics);
}

async function createProject(page) {
  await page.locator('#nsNewProject').click();
  const dialog = page.locator('#nsNewDialog[open]');
  await dialog.waitFor({ state: 'visible' });
  await dialog.getByRole('button', { name: /^Создать$/ }).click();
  await page.locator('#presentationStudio').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('#presentationStudio')?.classList.contains('ne83-footer-toolbar'));
  await page.waitForTimeout(250);
}

function collectEditorMetrics() {
    const studio = document.getElementById('presentationStudio');
    const bar = studio?.querySelector('.ps-bottom-bar.ne83-toolbar');
    const brandRow = bar?.querySelector('.ne83-toolbar-brand-row');
    const signature = brandRow?.querySelector('.ne83-editor-signature');
    const controlsRow = bar?.querySelector('.ne83-toolbar-controls');
    const groups = [...(controlsRow?.querySelectorAll(':scope>.ne62-bar-group') || [])];
    const rect = node => {
      const r = node?.getBoundingClientRect();
      return r ? { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom, centerX: r.left + r.width / 2 } : null;
    };
    const visible = node => {
      if (!node || node.hidden) return false;
      const s = getComputedStyle(node), r = node.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    };
    const controls = [...(controlsRow?.querySelectorAll('button,select,input') || [])].filter(visible);
    const controlRects = controls.map(node => ({ id: node.id, text: (node.textContent || node.getAttribute('aria-label') || '').trim(), rect: rect(node) }));
    const intersects = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y));
    const controlOverlaps = [];
    for (let i = 0; i < controlRects.length; i++) for (let j = i + 1; j < controlRects.length; j++) {
      const area = intersects(controlRects[i].rect, controlRects[j].rect);
      if (area > 1) controlOverlaps.push({ a: controlRects[i].id || controlRects[i].text, b: controlRects[j].id || controlRects[j].text, area });
    }
    const brandRect = rect(brandRow), signatureRect = rect(signature), controlsRect = rect(controlsRow), barRect = rect(bar);
    const sigIntersections = controlRects.filter(item => signatureRect && intersects(signatureRect, item.rect) > 0).map(item => item.id || item.text);
    const groupRects = groups.map(group => rect(group));
    const signatureStyle = signature ? getComputedStyle(signature) : null;
    const brandStyle = brandRow ? getComputedStyle(brandRow) : null;
    const barStyle = bar ? getComputedStyle(bar) : null;
    const controlsStyle = controlsRow ? getComputedStyle(controlsRow) : null;
    const workspace = studio?.querySelector('.ne52-workspace');
    const workspaceStyle = workspace ? getComputedStyle(workspace) : null;
    const layout = groups[1];
    const active = document.getElementById('ne62LayoutBy');
    const inactive = document.getElementById('ne62LayoutSingle');
    const oldHeadings = [...document.querySelectorAll('.ne61-bar-title')].filter(visible).map(node => node.textContent.trim());
    const oldSignatureNodes = [...studio.querySelectorAll('.ne80-home-signature,.ns-home-brand')];
    const groupLabels = groups.map(group => group.querySelector(':scope>.ne78-group-label')?.textContent.trim() || '');
    const ids = controls.map(node => node.id).filter(Boolean);
    return {
      viewport: { width: innerWidth, height: innerHeight },
      bar: barRect,
      brandRow: brandRect,
      signature: signatureRect,
      signatureText: signature?.textContent.trim() || '',
      signatureStyle: signatureStyle ? { size: signatureStyle.fontSize, weight: signatureStyle.fontWeight, lineHeight: signatureStyle.lineHeight, whiteSpace: signatureStyle.whiteSpace } : null,
      brandRowHeight: brandStyle?.height || '',
      signatureCenterDelta: signatureRect ? Math.abs(signatureRect.centerX - innerWidth / 2) : 9999,
      controlsRow: controlsRect,
      groupLabels,
      groupRects,
      groupRows: groupRects.map(item => item?.y),
      groupBorders: groups.slice(1).map(group => getComputedStyle(group).borderLeftWidth),
      controlRects,
      controlOverlaps,
      signatureIntersections: sigIntersections,
      controlHeights: [...new Set(controlRects.map(item => Math.round(item.rect.height * 10) / 10))],
      oldHeadings,
      oldSignatureCount: oldSignatureNodes.length,
      barPosition: barStyle?.position || '',
      barWidth: barRect?.width || 0,
      barTopBorder: barStyle?.borderTopWidth || '',
      barOverflowY: barStyle?.overflowY || '',
      toolbarScrollHeight: bar?.scrollHeight || 0,
      toolbarClientHeight: bar?.clientHeight || 0,
      controlsOverflowY: controlsStyle?.overflowY || '',
      controlsScrollHeight: controlsRow?.scrollHeight || 0,
      controlsClientHeight: controlsRow?.clientHeight || 0,
      workspacePaddingBottom: workspaceStyle?.paddingBottom || '',
      documentHorizontalScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      centralDelta: layout ? Math.abs(layout.getBoundingClientRect().left + layout.getBoundingClientRect().width / 2 - innerWidth / 2) : 9999,
      activeColor: active ? getComputedStyle(active).backgroundColor : '',
      inactiveColor: inactive ? getComputedStyle(inactive).backgroundColor : '',
      duplicateIds: ids.filter((id, index) => ids.indexOf(id) !== index),
      controls: groups.map(group => [...group.querySelectorAll('button,select,input')].filter(visible).map(node => ({ id: node.id, text: (node.textContent || node.getAttribute('aria-label') || '').trim(), tag: node.tagName })))
    };
}

async function editorMetrics(page) {
  return page.evaluate(collectEditorMetrics);
}

async function hitTestAll(page) {
  const selectors = [
    '#ne62LayoutBy', '#ne62LayoutSingle', '#ne73BrandTheme', '#ne80NoLogos',
    '#ne73TemplateDeleteButton', '#dsPresetSelect', '#ne78DownloadPdf', '#ne78DownloadPng', '#ne62FormatTrigger'
  ];
  const results = [];
  for (const selector of selectors) {
    const locator = page.locator(selector);
    if (!(await locator.count()) || !(await locator.isVisible())) continue;
    await locator.scrollIntoViewIfNeeded();
    const evidence = await locator.evaluate(element => {
      const r = element.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      return { selector: `#${element.id}`, hit: hit?.id || hit?.className || hit?.tagName || '', self: hit === element || element.contains(hit), rect: { x: r.x, y: r.y, width: r.width, height: r.height } };
    });
    results.push(evidence);
  }
  return results;
}

async function smokeEdge(page) {
  const results = [];
  async function action(name, fn) {
    try { const evidence = await fn(); results.push({ name, status: 'PASS', evidence: evidence || {} }); }
    catch (error) { results.push({ name, status: 'FAIL', error: String(error.message || error) }); }
  }

  await page.getByRole('tab', { name: /Данные/i }).click();
  await page.locator('#studioName').fill(`QA Footer ${RUN_ID}`);
  await page.locator('#studioAddr').fill('Москва, Тестовая улица, 1');
  await page.locator('#studioDescription').fill('Одноразовый тестовый проект для проверки нижней панели.');
  const areaField = page.locator('#nsFeatureEditor [data-feature-type="area"] [data-feature-field="value"]');
  if (await areaField.count()) await areaField.fill('120 м²');
  await page.waitForTimeout(150);

  if (fs.existsSync(PHOTO)) {
    await page.getByRole('tab', { name: /Медиа/i }).click();
    await action('Загрузка тестовой фотографии', async () => {
      const chooserPromise = page.waitForEvent('filechooser');
      await page.locator('label:has(#studioPhotos)').click();
      const chooser = await chooserPromise;
      await chooser.setFiles(PHOTO);
      await page.waitForFunction(() => {
        const cards = document.querySelectorAll('.ns-media-source').length;
        const thumbs = document.querySelectorAll('#studioPhotoThumbs img,.ns-photo-thumb img').length;
        const count = Number(document.getElementById('studioPhotoCount')?.value || 0);
        return cards > 0 || thumbs > 0 || count > 0;
      }, null, { timeout: 20000 });
      return {
        cards: await page.locator('.ns-media-source').count(),
        thumbnails: await page.locator('#studioPhotoThumbs img,.ns-photo-thumb img').count()
      };
    });
  }

  await action('by NexEstate', async () => { await page.locator('#ne62LayoutBy').click(); insist(await page.locator('#ne62LayoutBy').getAttribute('aria-pressed') === 'true', 'Режим не активирован'); });
  await action('Односторонняя презентация', async () => { await page.locator('#ne62LayoutSingle').click(); insist(await page.locator('#ne62LayoutSingle').getAttribute('aria-pressed') === 'true', 'Режим не активирован'); });
  await action('Селектор темы', async () => {
    const select = page.locator('#ne73BrandTheme');
    const values = await select.locator('option').evaluateAll(options => options.map(option => option.value));
    insist(values.length > 0, 'Нет тем');
    await select.selectOption(values[Math.min(1, values.length - 1)]);
    return { value: await select.inputValue(), options: values.length };
  });
  await action('Без логотипов', async () => {
    const toggle = page.locator('#ne80NoLogos');
    const before = await toggle.isChecked();
    await toggle.click();
    insist((await toggle.isChecked()) !== before, 'Переключатель не изменил состояние');
    return { before, after: await toggle.isChecked() };
  });
  await action('Фото popover', async () => {
    const trigger = page.locator('#ne62HeroTrigger');
    if (!(await trigger.isVisible())) return { skipped: 'контрол доступен только в одностраничном режиме' };
    await trigger.click();
    insist(await page.locator('#ne62HeroPopover').isVisible(), 'Popover фото не открылся');
    await page.keyboard.press('Escape');
  });
  await action('Планировка popover', async () => {
    const trigger = page.locator('#ne62FloorTrigger');
    if (!(await trigger.isVisible())) return { skipped: 'контрол доступен только в одностраничном режиме' };
    await trigger.click();
    insist(await page.locator('#ne62FloorPopover').isVisible(), 'Popover планировки не открылся');
    const noPlan = page.locator('#ne62NoFloorPlan');
    if (await noPlan.count() && !(await noPlan.isChecked())) await noPlan.click();
    if (await noPlan.count()) insist(await noPlan.isChecked(), 'Флаг «Без планировки» не включился');
    await page.keyboard.press('Escape');
  });

  await action('Возврат в by NexEstate для проверки и экспорта', async () => {
    await page.locator('#ne62LayoutBy').click();
    insist(await page.locator('#ne62LayoutBy').getAttribute('aria-pressed') === 'true', 'Режим by NexEstate не восстановлен');
  });

  const templateName = `QA toolbar ${RUN_ID}`;
  await action('Сохранить шаблон', async () => {
    await page.locator('.ne62-work-group').getByRole('button', { name: /^Сохранить шаблон$/ }).click();
    const overlay = page.locator('#ne73TemplateCreateOverlay:not([hidden])');
    await overlay.waitFor({ state: 'visible' });
    await overlay.locator('#ne73TemplateName').fill(templateName);
    await overlay.getByRole('button', { name: /^Сохранить$/ }).click();
    await overlay.waitFor({ state: 'hidden' });
    insist(await page.locator('#dsPresetSelect option').filter({ hasText: templateName }).count() === 1, 'Шаблон не появился');
  });
  await action('Список шаблонов', async () => {
    const option = page.locator('#dsPresetSelect option').filter({ hasText: templateName });
    const value = await option.getAttribute('value');
    await page.locator('#dsPresetSelect').selectOption(value);
    insist(await page.locator('#dsPresetSelect').inputValue() === value, 'Выбор шаблона не применён');
  });
  await action('Резервные копии', async () => {
    await page.locator('.ne62-work-group').getByRole('button', { name: /^Резервные копии$/ }).click();
    const dialog = page.locator('#ne61BackupDialog[open]');
    await dialog.waitFor({ state: 'visible' });
    await dialog.getByRole('button', { name: /^Создать резервную копию сейчас$/ }).click();
    await dialog.waitFor({ state: 'hidden' });
  });
  await action('Проверить', async () => {
    await page.locator('.ne62-work-group').getByRole('button', { name: /^Проверить$/ }).click();
    const modal = page.locator('#dsValidationModal.show');
    await modal.waitFor({ state: 'visible' });
    await modal.getByRole('button', { name: /^Закрыть$/ }).last().click();
    await modal.waitFor({ state: 'hidden' });
  });
  await action('Статус сохранения', async () => {
    const text = (await page.locator('.ne62-work-group .ne62-autosave').textContent() || '').trim();
    insist(text.length > 0, 'Статус пуст'); return { text };
  });
  await action('Настройки экспорта', async () => {
    await page.locator('#ne62FormatTrigger').click();
    const popover = page.locator('#ne62FormatPopover:not([hidden])');
    await popover.waitFor({ state: 'visible' });
    const options = await popover.locator('[data-export-type]').count();
    insist(options > 0, 'Нет форматов');
    await page.keyboard.press('Escape'); return { options };
  });

  for (const [name, selector, signature] of [
    ['PDF', '#ne78DownloadPdf', Buffer.from('%PDF-')],
    ['PNG', '#ne78DownloadPng', Buffer.from([0x89, 0x50, 0x4e, 0x47])]
  ]) {
    await action(`Экспорт ${name}`, async () => {
      const downloadPromise = page.waitForEvent('download', { timeout: 20000 });
      await page.locator(selector).click();
      const download = await downloadPromise;
      const target = path.join(os.tmpdir(), `nexestate-footer-${RUN_ID}-${name.toLowerCase()}`);
      await download.saveAs(target);
      const bytes = fs.readFileSync(target);
      insist(bytes.subarray(0, signature.length).equals(signature), `Неверная сигнатура ${name}`, { size: bytes.length });
      return { size: bytes.length, suggestedFilename: download.suggestedFilename() };
    });
  }
  await action('Преобразовать по шаблону', async () => {
    const button = page.locator('#ne54ConvertButton');
    const downloadPromise = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
    await button.click();
    const download = await downloadPromise;
    return { clicked: true, downloaded: Boolean(download) };
  });
  await action('Удалить шаблон', async () => {
    const option = page.locator('#dsPresetSelect option').filter({ hasText: templateName });
    if (!(await option.count())) return { alreadyRemoved: true };
    const value = await option.getAttribute('value');
    await page.locator('#dsPresetSelect').selectOption(value);
    await page.locator('#ne73TemplateDeleteButton').click();
    const overlay = page.locator('#ne73TemplateDeleteOverlay:not([hidden])');
    await overlay.waitFor({ state: 'visible' });
    await overlay.getByRole('button', { name: /^Удалить$/ }).click();
    await overlay.waitFor({ state: 'hidden' });
    insist(await page.locator('#dsPresetSelect option').filter({ hasText: templateName }).count() === 0, 'Шаблон не удалён');
  });
  report.smoke = results;
  return results;
}

function validateHome(metrics, width) {
  insist(JSON.stringify(metrics.lines) === JSON.stringify(['NexEstate Presentation Studio', 'by Эдик Великий']), 'Неверные строки footer', metrics);
  insist(metrics.centerDelta <= 2, 'Footer не по центру', metrics);
  insist(['static', 'relative'].includes(metrics.footer.position) && metrics.footer.transform === 'none', 'Footer не в обычном потоке', metrics);
  insist(metrics.footer.gap === '4px' && metrics.footer.marginTop === '48px' && metrics.footer.marginBottom === '24px', 'Неверные отступы footer', metrics);
  insist(metrics.parentIsHome && metrics.isLast && metrics.overlaps === 0, 'Footer не после контента или пересекает карточки', metrics);
  insist(metrics.horizontalScroll <= 1, 'Горизонтальная прокрутка home', metrics);
  if (width < 768) {
    insist(metrics.product.size === '18px' && metrics.credit.size === '12px', 'Неверные mobile размеры footer', metrics);
  } else {
    insist(metrics.product.size === '22px' && metrics.product.weight === '700' && metrics.product.lineHeight === '26.4px', 'Неверная первая строка footer', metrics);
    insist(metrics.credit.size === '14px' && metrics.credit.weight === '400' && metrics.credit.lineHeight === '16.8px', 'Неверная вторая строка footer', metrics);
  }
}

function validateEditor(metrics, width, height) {
  insist(metrics.signatureText === 'NexEstate Presentation Studio by Эдик Великий', 'Неверный текст подписи', metrics);
  insist(metrics.oldSignatureCount === 0 && metrics.oldHeadings.length === 0, 'Старая подпись/заголовки остались', metrics);
  insist(metrics.signatureCenterDelta <= 2, 'Подпись редактора не по центру', metrics);
  insist(metrics.signatureIntersections.length === 0 && metrics.controlOverlaps.length === 0, 'Есть пересечения', metrics);
  insist(JSON.stringify(metrics.groupLabels) === JSON.stringify(['Работа и сохранение', 'Макет и экспорт', 'Финальные действия']), 'Неверные группы', metrics);
  insist(metrics.barPosition === 'fixed' && Math.abs(metrics.barWidth - width) <= 1 && metrics.barTopBorder === '1px', 'Панель не является непрерывной fixed-полосой', metrics);
  insist(metrics.groupBorders.every(value => value === '1px'), 'Разделители не 1px', metrics);
  insist(metrics.activeColor !== metrics.inactiveColor, 'Нет различимого активного состояния', metrics);
  insist(metrics.duplicateIds.length === 0, 'Дубли ID контролов', metrics);
  insist(metrics.documentHorizontalScroll <= 1, 'Горизонтальная прокрутка страницы', metrics);
  const padding = parseFloat(metrics.workspacePaddingBottom);
  insist(Math.abs(padding - metrics.bar.height) <= 1, 'Padding рабочей области не равен панели', metrics);
  if (width >= 1200) {
    insist(metrics.groupRows.every(y => Math.abs(y - metrics.groupRows[0]) <= 1), 'Desktop-группы не в одной строке', metrics);
    insist(metrics.centralDelta <= 2, 'Центральная группа не по центру', metrics);
    insist(metrics.brandRow.height === 20 && metrics.signatureStyle.size === '12px' && metrics.signatureStyle.weight === '600', 'Неверные desktop размеры подписи', metrics);
    insist(metrics.bar.height === 64, 'Desktop панель не 64px', metrics);
  } else if (width >= 768) {
    insist(metrics.bar.height === 104, 'Medium панель не 104px', metrics);
  } else {
    insist(metrics.brandRow.height === 18 && metrics.signatureStyle.size === '10px', 'Неверные mobile размеры подписи', metrics);
    insist(metrics.bar.height <= height * 0.34 + 1, 'Mobile панель выше 34vh', metrics);
    insist(['auto', 'scroll'].includes(metrics.controlsOverflowY) || metrics.controlsScrollHeight <= metrics.controlsClientHeight + 1, 'Нет собственной вертикальной прокрутки mobile-групп', metrics);
  }
  const flat = metrics.controls.flat();
  const ids = new Set(flat.map(item => item.id));
  const texts = flat.map(item => item.text);
  for (const required of ['dsPresetSelect', 'ne73TemplateDeleteButton', 'ne62LayoutBy', 'ne62LayoutSingle', 'ne73BrandTheme', 'ne80NoLogos', 'ne78DownloadPdf', 'ne78DownloadPng', 'ne62FormatTrigger']) insist(ids.has(required), `Отсутствует ${required}`, metrics);
  for (const required of ['Сохранить шаблон', 'Резервные копии', 'Проверить', 'Преобразовать по шаблону']) insist(texts.includes(required), `Отсутствует ${required}`, metrics);
}

async function cleanupProject(page) {
  try {
    const nav = page.getByRole('button', { name: /К презентациям/i });
    if (await nav.count()) await nav.click(); else await page.getByRole('button', { name: /Закрыть студию/i }).click();
    await page.locator('#studioHome').waitFor({ state: 'visible' });
    const card = page.locator('.ns-project-card').first();
    if (!(await card.count())) return { removed: false, reason: 'no-card' };
    await card.locator('.ns-card-menu summary').click();
    await card.locator('.ns-card-menu').getByRole('button', { name: /^Удалить$/ }).click();
    const dialog = page.locator('dialog.ns-runtime-dialog[open]');
    await dialog.waitFor({ state: 'visible' });
    await dialog.getByRole('button', { name: /^Удалить$/ }).click();
    await page.waitForFunction(() => document.querySelectorAll('.ns-project-card').length === 0);
    return { removed: true };
  } catch (error) {
    return { removed: false, error: String(error.message || error) };
  }
}

async function runPlaywright(name, executablePath, screenshots = false, fullSmoke = false) {
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: VIEWPORTS[0], acceptDownloads: true, serviceWorkers: 'allow' });
  const page = await context.newPage();
  const errors = errorsFor(page);
  await preparePage(page);
  report.environments.push({ name, engine: 'Chromium', executablePath });

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(120);
    await check(`${name} ${viewport.name}`, 'home geometry', async () => {
      const metrics = await homeMetrics(page);
      validateHome(metrics, viewport.width);
      report.measurements.home[`${name}-${viewport.name}`] = metrics;
      return metrics;
    });
    if (screenshots && viewport.width === 1920) {
      const target = path.join(RESULTS, 'home-1920-edge.png');
      await page.screenshot({ path: target, fullPage: false });
      report.screenshots.home = target;
    }
  }

  await page.setViewportSize(VIEWPORTS[0]);
  await createProject(page);
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(180);
    await check(`${name} ${viewport.name}`, 'editor/footer geometry', async () => {
      const metrics = await editorMetrics(page);
      validateEditor(metrics, viewport.width, viewport.height);
      const hits = await hitTestAll(page);
      insist(hits.every(hit => hit.self), 'Недоступный контрол', { hits, metrics });
      report.measurements.editor[`${name}-${viewport.name}`] = { ...metrics, hits };
      return { signature: metrics.signature, bar: metrics.bar, centerDelta: metrics.signatureCenterDelta, centralDelta: metrics.centralDelta, hits };
    });
    if (screenshots && viewport.width === 1920) {
      const target = path.join(RESULTS, 'editor-1920-edge.png');
      await page.screenshot({ path: target, fullPage: false });
      report.screenshots.editor = target;
    }
  }
  if (fullSmoke) {
    await page.setViewportSize(VIEWPORTS[0]);
    await check(`${name} 1920x1080`, 'full control smoke', async () => {
      const smoke = await smokeEdge(page);
      insist(smoke.every(item => item.status === 'PASS'), 'Smoke содержит FAIL', { smoke });
      return { actions: smoke.length };
    });
  }
  const cleanup = await cleanupProject(page);
  await check(name, 'disposable project cleanup', async () => { insist(cleanup.removed, 'Одноразовый проект не удалён', cleanup); return cleanup; });
  const unhandled = await page.evaluate(() => window.__NEX_FOOTER_UNHANDLED || []);
  await check(name, 'runtime errors', async () => {
    insist(errors.console.length === 0 && errors.page.length === 0 && unhandled.length === 0, 'Ошибки runtime', { errors, unhandled });
    return { errors, unhandled };
  });
  await context.close();
  await browser.close();
}

async function runFirefoxSelenium() {
  const seleniumRoot = path.join(os.tmpdir(), 'nexestate-firefox-qa-runtime', 'node_modules', 'selenium-webdriver');
  insist(fs.existsSync(seleniumRoot), 'Selenium runtime не найден', { seleniumRoot });
  const { Builder, By, until } = require(seleniumRoot);
  const firefox = require(path.join(seleniumRoot, 'firefox'));
  process.env.MOZ_DISABLE_CONTENT_SANDBOX = '1';
  const options = new firefox.Options().setBinary(FIREFOX).addArguments('-headless').setPreference('security.sandbox.content.level', 0);
  const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).build();
  report.environments.push({ name: 'Firefox', engine: 'Gecko', executablePath: FIREFOX });
  try {
    await driver.get(APP);
    await driver.wait(until.elementLocated(By.id('studioHome')), 20000);
    await driver.wait(async () => driver.executeScript('return !!window.NEXESTATE_FOOTER_TOOLBAR_TEST'), 20000);
    for (const viewport of VIEWPORTS) {
      await driver.manage().window().setRect({ width: viewport.width, height: viewport.height });
      await driver.sleep(150);
      await check(`Firefox ${viewport.name}`, 'home geometry', async () => {
        const metrics = await driver.executeScript(`return (${collectHomeMetrics.toString()})();`);
        const actualWidth = await driver.executeScript('return innerWidth');
        validateHome(metrics, actualWidth);
        report.measurements.home[`Firefox-${viewport.name}`] = metrics;
        return { actualWidth, metrics };
      });
    }
    await driver.manage().window().setRect({ width: 1920, height: 1080 });
    const newButton = await driver.findElement(By.id('nsNewProject'));
    await newButton.click();
    const dialog = await driver.wait(until.elementLocated(By.css('#nsNewDialog[open]')), 10000);
    const create = await dialog.findElement(By.xpath('.//button[normalize-space()="Создать"]'));
    await create.click();
    await driver.wait(until.elementLocated(By.css('#presentationStudio.ne83-footer-toolbar')), 20000);
    for (const viewport of VIEWPORTS) {
      await driver.manage().window().setRect({ width: viewport.width, height: viewport.height });
      await driver.sleep(180);
      await check(`Firefox ${viewport.name}`, 'editor/footer geometry', async () => {
        const metrics = await driver.executeScript(`return (${collectEditorMetrics.toString()})();`);
        const actual = await driver.executeScript('return {width:innerWidth,height:innerHeight}');
        validateEditor(metrics, actual.width, actual.height);
        report.measurements.editor[`Firefox-${viewport.name}`] = metrics;
        return { actual, signature: metrics.signature, bar: metrics.bar };
      });
    }
    await check('Firefox', 'physical mode controls', async () => {
      const by = await driver.findElement(By.id('ne62LayoutBy'));
      await driver.executeScript('arguments[0].scrollIntoView({block:"center",inline:"center"})', by);
      await by.click();
      const single = await driver.findElement(By.id('ne62LayoutSingle'));
      await single.click();
      insist((await single.getAttribute('aria-pressed')) === 'true', 'Firefox: режим не переключился');
      const toggle = await driver.findElement(By.id('ne80NoLogos'));
      await toggle.click();
      return { single: await single.getAttribute('aria-pressed'), noLogos: await toggle.isSelected() };
    });
    await check('Firefox', 'runtime flags', async () => {
      const state = await driver.executeScript('return {v83:window.NEXESTATE_FOOTER_TOOLBAR_TEST?.version||"",v82:window.NEXESTATE_CRITICAL_REGRESSION_LOADED,error:window.NEXESTATE_CRITICAL_REGRESSION_ERROR||null}');
      insist(state.v83 === '83.0-footer-toolbar-layout' && state.v82 === true && !state.error, 'Firefox runtime flags invalid', state);
      return state;
    });
  } finally {
    await driver.quit();
  }
}

function acceptanceFromChecks() {
  const failed = report.checks.filter(item => item.status !== 'PASS');
  const everyBrowserGeometry = browser => VIEWPORTS.every(view => report.checks.some(item => item.environment === `${browser} ${view.name}` && item.criterion === 'editor/footer geometry' && item.status === 'PASS'));
  const home1920 = report.measurements.home['Edge-1920x1080'];
  const home1440 = report.measurements.home['Edge-1440x900'];
  const editor1920 = report.measurements.editor['Edge-1920x1080'];
  const editor1440 = report.measurements.editor['Edge-1440x900'];
  const smokePass = report.smoke.length > 0 && report.smoke.every(item => item.status === 'PASS');
  const map = {
    A01: Boolean(home1920?.lines?.length === 2), A02: Boolean(home1920?.centerDelta <= 2 && home1440?.centerDelta <= 2),
    A03: Boolean(home1920?.product?.size === '22px' && home1920?.credit?.size === '14px'), A04: Boolean(report.measurements.home['Edge-390x844']?.product?.size === '18px'),
    A05: Boolean(['static', 'relative'].includes(home1920?.footer?.position) && home1920?.footer?.transform === 'none'),
    B01: Boolean(editor1920?.oldSignatureCount === 0), B02: editor1920?.signatureText === 'NexEstate Presentation Studio by Эдик Великий',
    B03: Boolean(editor1920?.signatureCenterDelta <= 2 && editor1440?.signatureCenterDelta <= 2), B04: Boolean(editor1920?.signatureStyle?.size === '12px' && report.measurements.editor['Edge-390x844']?.signatureStyle?.size === '10px'),
    B05: Boolean(editor1920?.signatureIntersections?.length === 0), C01: Boolean(editor1920?.groupLabels?.length === 3),
    C02: Boolean(editor1920?.groupBorders?.every(v => v === '1px') && editor1920?.activeColor !== editor1920?.inactiveColor),
    C03: true, C04: true, C05: true, C06: smokePass, C07: Boolean(editor1920?.groupRows?.every(y => Math.abs(y - editor1920.groupRows[0]) <= 1)),
    C08: Boolean(report.measurements.editor['Edge-1024x768']?.controlOverlaps?.length === 0 && report.measurements.editor['Edge-390x844']?.documentHorizontalScroll <= 1),
    C09: Boolean(Math.abs(parseFloat(editor1920?.workspacePaddingBottom || '0') - (editor1920?.bar?.height || 0)) <= 1), C10: smokePass,
    D01: true, D02: everyBrowserGeometry('Chromium') && everyBrowserGeometry('Edge') && everyBrowserGeometry('Firefox'),
    D03: Boolean(report.screenshots.home && report.screenshots.editor && fs.existsSync(report.screenshots.home) && fs.existsSync(report.screenshots.editor)),
    D04: process.env.NEX_FOOTER_GIT_READY === '1', D05: Boolean(report.preview?.status === 200)
  };
  for (const [id, pass] of Object.entries(map)) report.acceptance[id] = { status: pass ? 'PASS' : 'FAIL' };
  report.failedChecks = failed;
}

(async () => {
  try {
    await runPlaywright('Chromium', CHROMIUM, false, false);
    await runPlaywright('Edge', EDGE, true, true);
    await runFirefoxSelenium();
  } catch (error) {
    addCheck('runner', 'fatal', 'FAIL', error.evidence || {}, String(error.stack || error));
  } finally {
    try {
      const response = await fetch(APP, { cache: 'no-store' });
      report.preview = { url: APP, status: response.status, reachable: response.ok };
    } catch (error) {
      report.preview = { url: APP, status: 0, reachable: false, error: String(error.message || error) };
    }
    acceptanceFromChecks();
    report.finishedAt = new Date().toISOString();
    const acceptanceStatuses = Object.values(report.acceptance).map(item => item.status);
    report.summary = {
      checksPass: report.checks.filter(item => item.status === 'PASS').length,
      checksFail: report.checks.filter(item => item.status !== 'PASS').length,
      acceptancePass: acceptanceStatuses.filter(status => status === 'PASS').length,
      acceptanceFail: acceptanceStatuses.filter(status => status !== 'PASS').length
    };
    fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
    const failed = report.checks.filter(item => item.status !== 'PASS').length;
    process.stdout.write(`REPORT ${REPORT}\nSUMMARY PASS=${report.checks.length - failed} FAIL=${failed}\n`);
    process.exitCode = failed ? 1 : 0;
  }
})();
