const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium, firefox, devices } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const BASE = process.env.NEX_CRITICAL_URL || 'http://127.0.0.1:8807/';
const PHASE = process.argv.includes('--final') ? 'final' : 'pre';
const RUN_ID = `${Date.now()}-${process.pid}`;
const RESULTS = path.join(__dirname, 'results');
const REPORT = process.env.NEX_CRITICAL_REPORT
  ? path.resolve(process.env.NEX_CRITICAL_REPORT)
  : path.join(RESULTS, `critical-regression-20260819-${PHASE}.json`);
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP = new URL(`apps/presentation/?critical=${RUN_ID}`, BASE).href;
const TEMP = path.join(os.tmpdir(), `nexestate-critical-${RUN_ID}`);
const PHOTO_FIXTURE = path.join(ROOT, 'qa', 'results', 'video-cover.jpg');
const PLAN_FIXTURE = path.join(ROOT, 'qa', 'results', 'photo-single.webp');
const PDF_CANDIDATES = [
  process.env.NEX_CRITICAL_PDF_FIXTURE,
  'C:\\Users\\ED\\Downloads\\Офис_с_видом_на_Кремль_NexEstate_ (2).pdf',
  'C:\\Users\\ED\\Downloads\\Аренда длительно помещения свободного назначения 210.5 м² # 1238734 (1).pdf'
].filter(Boolean);
const PDF_FIXTURE = PDF_CANDIDATES.find(candidate => fs.existsSync(candidate)) || '';

const report = {
  phase: PHASE,
  runId: RUN_ID,
  startedAt: new Date().toISOString(),
  baseUrl: BASE,
  appUrl: APP,
  environments: [],
  checks: []
};

function record(environment, scenario, status, evidence = {}, error = '') {
  const item = { environment, scenario, status, evidence, error };
  report.checks.push(item);
  process.stdout.write(`${status.padEnd(10)} ${environment} :: ${scenario}${error ? ` :: ${error}` : ''}\n`);
  return item;
}

async function runCheck(environment, scenario, fn) {
  try {
    const evidence = await fn();
    return record(environment, scenario, 'PASS', evidence || {});
  } catch (error) {
    return record(environment, scenario, 'FAIL', error.evidence || {}, error.message);
  }
}

function insist(condition, message, evidence = {}) {
  if (condition) return;
  const error = new Error(message);
  error.evidence = evidence;
  throw error;
}

function contextErrors(page) {
  const errors = { console: [], pageerror: [], unhandled: [], requestfailed: [] };
  page.on('console', message => {
    if (message.type() === 'error') errors.console.push({ text: message.text(), location: message.location() });
  });
  page.on('pageerror', error => errors.pageerror.push(error.message));
  page.on('requestfailed', request => errors.requestfailed.push({ url: request.url(), error: request.failure()?.errorText || '' }));
  return errors;
}

async function installUnhandled(page, errors) {
  await page.addInitScript(() => {
    window.__NEX_QA_UNHANDLED = [];
    window.__NEX_QA_FILLTEXT = [];
    window.addEventListener('unhandledrejection', event => {
      window.__NEX_QA_UNHANDLED.push(String(event.reason?.stack || event.reason || 'unknown'));
    });
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, x, y, maxWidth) {
      window.__NEX_QA_FILLTEXT.push({ text: String(text ?? ''), x, y, maxWidth: Number.isFinite(maxWidth) ? maxWidth : null });
      if (window.__NEX_QA_FILLTEXT.length > 12000) window.__NEX_QA_FILLTEXT.splice(0, 3000);
      return arguments.length > 3 ? original.call(this, text, x, y, maxWidth) : original.call(this, text, x, y);
    };
  });
  errors.readUnhandled = async () => {
    errors.unhandled = await page.evaluate(() => window.__NEX_QA_UNHANDLED || []);
    return errors.unhandled;
  };
}

async function hitEvidence(locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  insist(box, 'У элемента нет геометрии');
  return locator.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    const blockers = [...document.querySelectorAll('dialog[open], [aria-modal="true"]:not([hidden]), .show, [data-tooltip]')]
      .filter(node => {
        const style = getComputedStyle(node);
        const r = node.getBoundingClientRect();
        return style.pointerEvents !== 'none' && style.visibility !== 'hidden' && style.display !== 'none' && r.width > 0 && r.height > 0;
      })
      .slice(0, 12)
      .map(node => ({ id: node.id, cls: node.className, tag: node.tagName, pointerEvents: getComputedStyle(node).pointerEvents }));
    return {
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      hit: hit ? { tag: hit.tagName, id: hit.id, cls: hit.className, text: (hit.textContent || '').trim().slice(0, 80) } : null,
      selfOrDescendant: Boolean(hit && (hit === element || element.contains(hit))),
      blockers
    };
  });
}

async function waitHome(page) {
  await page.locator('#studioHome').waitFor({ state: 'visible' });
  await page.locator('#nsNewProject').waitFor({ state: 'visible' });
  await page.waitForFunction(() => typeof window.NEXESTATE_STANDALONE_TEST === 'object');
}

async function activate(locator, touch = false) {
  return touch ? locator.tap() : locator.click();
}

async function homeButtonProbe(page, envName, touch = false) {
  const actions = [
    ['Новая презентация', page.locator('#nsNewProject')],
    ['Загрузить PDF', page.locator('button[data-ne79-file-target="nsBulkPdf"]')],
    ['Загрузить текст', page.locator('button[data-ne79-file-target="ne79TextImport"]')],
    ['Загрузить фото', page.locator('button[data-ne79-file-target="ne79PhotoImport"]')],
    ['Импортировать файл проекта', page.locator('button[data-ne79-file-target="nsImportProject"]')]
  ];
  for (const [name, locator] of actions) {
    await runCheck(envName, `hit-test: ${name}`, async () => {
      await locator.waitFor({ state: 'visible' });
      const evidence = await hitEvidence(locator);
      insist(evidence.selfOrDescendant, `Клик перехватывает ${evidence.hit?.tag || 'неизвестный'}#${evidence.hit?.id || ''}`, evidence);
      return evidence;
    });
  }

  await runCheck(envName, 'Физический клик «Новая презентация»', async () => {
    await activate(page.locator('#nsNewProject'), touch);
    const dialog = page.locator('#nsNewDialog[open]');
    await dialog.waitFor({ state: 'visible' });
    const buttons = await dialog.getByRole('button').allTextContents();
    insist(buttons.some(value => /Создать/.test(value)), 'Диалог новой презентации открылся без действия «Создать»', { buttons });
    await activate(dialog.getByRole('button', { name: /^Отмена$/ }), touch);
    await dialog.waitFor({ state: 'hidden' });
    return { buttons };
  });

  await runCheck(envName, 'Физический клик «Загрузить текст»', async () => {
    await activate(page.locator('button[data-ne79-file-target="ne79TextImport"]'), touch);
    const modal = page.locator('#ne80TextModal:not([hidden])');
    await modal.waitFor({ state: 'visible' });
    const textarea = modal.locator('#ne80TextArea');
    const sample = `Аренда офиса ${RUN_ID}\nМосква, Краснопрудная улица, 3\nНазначение: офис\nОписание объекта\nТестовый текст.`;
    await activate(textarea, touch);
    await textarea.fill(sample);
    insist(await modal.locator('#ne80TextConfirm').isEnabled(), 'Кнопка создания не активировалась после ввода текста');
    const count = await modal.locator('#ne80TextCount').textContent();
    await activate(modal.getByRole('button', { name: /^Отмена$/ }), touch);
    await modal.waitFor({ state: 'hidden' });
    return { count };
  });

  for (const [name, target] of [
    ['Загрузить PDF', 'nsBulkPdf'],
    ['Загрузить фото', 'ne79PhotoImport'],
    ['Импортировать файл проекта', 'nsImportProject']
  ]) {
    await runCheck(envName, `Физический launcher/filechooser: ${name}`, async () => {
      const chooserPromise = page.waitForEvent('filechooser');
      await activate(page.locator(`button[data-ne79-file-target="${target}"]`), touch);
      const chooser = await chooserPromise;
      await chooser.setFiles([]);
      return { multiple: chooser.isMultiple() };
    });
  }
}

async function keyboardHomeProbe(page, envName) {
  await runCheck(envName, 'Клавиатура: главные действия доступны через Enter/Space', async () => {
    const evidence = [];

    const newButton = page.locator('#nsNewProject');
    await newButton.focus();
    await page.keyboard.press('Enter');
    const newDialog = page.locator('#nsNewDialog[open]');
    await newDialog.waitFor({ state: 'visible' });
    evidence.push({ action: 'Новая презентация', key: 'Enter', opened: true });
    await page.keyboard.press('Escape');
    await newDialog.waitFor({ state: 'hidden' });

    const textButton = page.locator('button[data-ne79-file-target="ne79TextImport"]');
    await textButton.focus();
    await page.keyboard.press('Space');
    const textDialog = page.locator('#ne80TextModal:not([hidden])');
    await textDialog.waitFor({ state: 'visible' });
    evidence.push({ action: 'Загрузить текст', key: 'Space', opened: true });
    const cancelText = textDialog.getByRole('button', { name: /^Отмена$/ });
    await cancelText.focus();
    await page.keyboard.press('Enter');
    await textDialog.waitFor({ state: 'hidden' });

    for (const [action, target, key] of [
      ['Загрузить PDF', 'nsBulkPdf', 'Enter'],
      ['Загрузить фото', 'ne79PhotoImport', 'Space'],
      ['Импортировать файл проекта', 'nsImportProject', 'Enter']
    ]) {
      const launcher = page.locator(`button[data-ne79-file-target="${target}"]`);
      const chooserPromise = page.waitForEvent('filechooser');
      await launcher.focus();
      await page.keyboard.press(key);
      const chooser = await chooserPromise;
      await chooser.setFiles([]);
      evidence.push({ action, key, filechooser: true, multiple: chooser.isMultiple() });
    }
    return evidence;
  });
}

async function tooltipProbe(page, envName) {
  await runCheck(envName, 'Tooltip не перехватывает соседние клики', async () => {
    const trigger = page.locator('button[data-ne79-file-target="nsImportProject"]');
    await trigger.hover();
    const tip = page.locator('#ne54Tooltip');
    await page.waitForTimeout(80);
    const visibleState = await tip.count() ? await tip.evaluate(node => ({
      ariaHidden: node.getAttribute('aria-hidden'),
      pointerEvents: getComputedStyle(node).pointerEvents,
      rect: node.getBoundingClientRect().toJSON()
    })) : null;
    await page.mouse.move(4, 4);
    await page.keyboard.press('Escape');
    await page.locator('#nsNewProject').focus();
    await page.waitForTimeout(80);
    const hiddenState = await tip.count() ? await tip.evaluate(node => ({
      hidden: node.hidden,
      ariaHidden: node.getAttribute('aria-hidden'),
      pointerEvents: getComputedStyle(node).pointerEvents
    })) : null;
    await page.locator('#nsNewProject').evaluate(node => node.scrollIntoView({ block: 'center', inline: 'center' }));
    const newHit = await hitEvidence(page.locator('#nsNewProject'));
    insist(newHit.selfOrDescendant, 'Tooltip/overlay перекрывает «Новая презентация»', { visibleState, hiddenState, newHit });
    return { visibleState, hiddenState, newHit };
  });
}

async function createEditor(page) {
  await page.locator('#nsNewProject').click();
  const dialog = page.locator('#nsNewDialog[open]');
  await dialog.waitFor({ state: 'visible' });
  await dialog.getByRole('button', { name: /^Создать$/ }).click();
  await page.locator('#presentationStudio.show').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('#presentationStudio .ne52-shell'));
}

async function editorSmoke(page, envName, touch = false) {
  await runCheck(envName, 'Создание пустой презентации и открытие редактора', async () => {
    await createEditor(page);
    return page.evaluate(() => window.NEXESTATE_STANDALONE_TEST?.getState?.());
  });

  await runCheck(envName, 'Вкладки PDF / Данные / Медиа', async () => {
    const result = {};
    for (const step of ['pdf', 'data', 'media']) {
      const tab = page.locator(`[role="tab"][data-step="${step}"]`);
      touch ? await tab.tap() : await tab.click();
      result[step] = await tab.getAttribute('aria-selected');
      insist(result[step] === 'true', `Вкладка ${step} не стала активной`, result);
    }
    return result;
  });

  await page.locator('[role="tab"][data-step="data"]').click();
  await runCheck(envName, 'Настройки шрифтов видимы и интерактивны', async () => {
    const settings = page.locator('#ne78FontSettings');
    const diagnostic = await settings.count() ? await settings.evaluate(node => {
      const ancestors = [];
      for (let current = node; current; current = current.parentElement) {
        const style = getComputedStyle(current);
        if (current.hidden || style.display === 'none' || style.visibility === 'hidden') ancestors.push({ id: current.id, cls: current.className, tag: current.tagName, hidden: current.hidden, display: style.display, visibility: style.visibility });
      }
      const rect = node.getBoundingClientRect();
      return { rect: rect.toJSON(), ancestors };
    }) : { missing: true };
    insist(await settings.isVisible(), 'Раздел настроек шрифтов скрыт', diagnostic);
    await settings.scrollIntoViewIfNeeded();
    if (!(await settings.evaluate(node => node.open))) await settings.locator('summary').click();
    await page.waitForFunction(() => Boolean(document.querySelector('#ne78FontSettings')?.open));
    const select = page.locator('#dsFontSelect');
    await select.waitFor({ state: 'visible' });
    const options = await select.locator('option').count();
    insist(options >= 2, 'В списке шрифтов меньше двух вариантов', { options });
    const before = await select.inputValue();
    const values = await select.locator('option').evaluateAll(nodes => nodes.map(node => node.value));
    const next = values.find(value => value !== before);
    if (next) await select.selectOption(next);
    return { before, after: await select.inputValue(), options };
  });

  await runCheck(envName, 'Физические клики режимов и «Без логотипов»', async () => {
    const evidence = {};
    for (const selector of ['#ne62LayoutBy', '#ne62LayoutSingle', '#ne80NoLogos']) {
      const locator = page.locator(selector);
      await locator.scrollIntoViewIfNeeded();
      evidence[selector] = await hitEvidence(locator);
      insist(evidence[selector].selfOrDescendant, `${selector} перекрыт`, evidence[selector]);
      touch ? await locator.tap() : await locator.click();
    }
    return evidence;
  });

  await runCheck(envName, 'Нижняя панель: высота и отсутствие перекрытий', async () => {
    const bar = page.locator('#presentationStudio .ps-bottom-bar');
    const controls = bar.locator('button:not([hidden]),select:not([hidden]),input:not([hidden]),label:not([hidden])');
    const failures = [], hitTests = [];
    for (let index = 0; index < await controls.count(); index++) {
      const control = controls.nth(index);
      if (!(await control.isVisible())) continue;
      const evidence = await hitEvidence(control);
      hitTests.push({ id: await control.getAttribute('id'), text: (await control.textContent() || '').trim().slice(0, 32), ...evidence });
      if (!evidence.selfOrDescendant) failures.push(hitTests.at(-1));
    }
    const result = await bar.evaluate((node, details) => {
      const rect = node.getBoundingClientRect();
      return { height: rect.height, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth, controls: details.hitTests.length, failures: details.failures, overflowX: getComputedStyle(node).overflowX };
    }, { hitTests, failures });
    insist(Math.round(result.height) <= 64 && !result.failures.length, 'Нижняя панель перекрыта или выше 64 px', result);
    return result;
  });

  await runCheck(envName, '«К презентациям» возвращает на экран проектов', async () => {
    const button = page.getByRole('button', { name: 'К презентациям' });
    await button.click();
    await page.locator('#studioHome').waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.querySelector('#presentationStudio')?.classList.contains('show'));
    return { url: page.url() };
  });
}

async function settle(page, ms = 180) {
  if (ms) await page.waitForTimeout(ms);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function criticalState(page) {
  return page.evaluate(() => {
    const state = window.NEXESTATE_STANDALONE_TEST?.getState?.() || {};
    const settings = state.settings || {};
    const pick = {};
    for (const key of [
      'activeBrandedLayout', 'brandLayout', 'presentationLayout', 'byNexEstateTheme',
      'singlePageTheme', 'selectedFont', 'byNexEstateFont', 'singlePageFont',
      'hideAppBranding', 'byNexEstateCharacteristicIds', 'singlePageCharacteristicIds',
      'selectedSinglePageAdvantageIds', 'pageOrder', 'galleryPages', 'showContactPage'
    ]) pick[key] = structuredClone(settings[key]);
    return {
      projectId: state.projectId,
      data: state.data,
      settings: pick,
      fullSettings: settings,
      design: state.design,
      mediaCount: state.mediaCount,
      includedCount: state.includedCount,
      activeStep: state.activeStep,
      critical: window.NEXESTATE_CRITICAL_REGRESSION_TEST?.inspect?.(),
      scroll: {
        preview: document.querySelector('.ps-preview-stage')?.scrollTop || 0,
        sidebar: document.querySelector('.ps-sidebar')?.scrollTop || 0
      }
    };
  });
}

async function slideEvidence(page) {
  return page.evaluate(() => {
    window.__NEX_QA_FILLTEXT = [];
    const slides = window.NEXESTATE_CRITICAL_REGRESSION_TEST?.render?.({}) || [];
    return {
      count: slides.length,
      slides: slides.map((canvas, index) => ({
        index,
        kind: canvas.neStage4Kind || canvas.neStage3PageKind || '',
        pageKind: canvas.neStage3PageKind || '',
        purpose: canvas.nePurpose || '',
        metros: Array.isArray(canvas.neMetroStations) ? canvas.neMetroStations.slice() : [],
        title: canvas.neTitleMetrics ? { ...canvas.neTitleMetrics } : null,
        planSlots: Array.isArray(canvas.neStage4PlanSlots) ? canvas.neStage4PlanSlots.slice() : [],
        planPlacement: canvas.nePlanPlacement || null,
        brandBoxes: Array.isArray(canvas.neAppBrandBoxes) ? canvas.neAppBrandBoxes.map(box => ({ ...box })) : [],
        brandTokens: Array.isArray(canvas.neAppBrandTokens) ? canvas.neAppBrandTokens.slice() : [],
        isPlan: Boolean(
          canvas.neStage5Renderer === '82.0-plan'
          || canvas.neStage3PageKind === 'singlePlan'
          || canvas.neStage4Kind === 'floor'
        )
      })),
      texts: (window.__NEX_QA_FILLTEXT || []).map(item => item.text)
    };
  });
}

async function focusEvidence(page) {
  return page.evaluate(() => ({
    source: document.querySelectorAll('.ne78-source-active').length,
    target: document.querySelectorAll('.ne78-preview-target').length,
    connector: [...document.querySelectorAll('#presentationStudio > .ne78-connector, #presentationStudio .ne78-connector')]
      .filter(node => {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width + rect.height > 0;
      }).length,
    activeId: document.activeElement?.id || '',
    layout: window.NEXESTATE_CRITICAL_REGRESSION_TEST?.inspect?.().layout || '',
    pages: [...document.querySelectorAll('#studioPresoDeck > .ps-canvas-page')].map(node => ({
      id: node.dataset.pageId || '',
      kind: node.dataset.pageKind || '',
      hidden: Boolean(node.hidden)
    }))
  }));
}

async function assertFocusedLink(page, locator, id) {
  await locator.scrollIntoViewIfNeeded();
  await locator.focus();
  await settle(page, 120);
  const evidence = await focusEvidence(page);
  insist(evidence.source === 1 && evidence.target === 1 && evidence.connector === 1 && evidence.activeId === id,
    `Неполная или множественная focus-связь для ${id}`, evidence);
  return evidence;
}

async function assertFocusCleared(page) {
  await page.locator('#presentationStudio .ne52-preview').click({ position: { x: 8, y: 8 } });
  await settle(page, 80);
  const evidence = await focusEvidence(page);
  insist(evidence.source === 0 && evidence.target === 0 && evidence.connector === 0,
    'После blur/click-away осталась focus-связь', evidence);
  return evidence;
}

async function setStep(page, step) {
  const tab = page.locator(`[role="tab"][data-step="${step}"]`);
  await tab.scrollIntoViewIfNeeded();
  const hit = await hitEvidence(tab);
  insist(hit.selfOrDescendant, `Вкладка ${step} перекрыта перед физическим кликом: ${JSON.stringify(hit)}`, hit);
  await tab.click();
  try {
    await page.waitForFunction(value => {
      const tab = document.querySelector(`[role="tab"][data-step="${value}"]`);
      const panel = document.querySelector(`.ne52-panel[data-panel="${value}"]`);
      return Boolean(tab && (tab.getAttribute('aria-selected') === 'true' || tab.classList.contains('on')) && panel && !panel.hidden && panel.classList.contains('on'));
    }, step, { timeout: 5000 });
  } catch (error) {
    const evidence = await page.evaluate(value => ({
      requested: value,
      stateStep: window.NE53_STATE?.step || '',
      layout: window.NEXESTATE_CRITICAL_REGRESSION_TEST?.state?.()?.layout || '',
      globalSetStep: String(window.NexCompactStudio?.setStep || '').slice(0, 500),
      tabs: [...document.querySelectorAll('[role="tab"][data-step]')].map(node => ({ step: node.dataset.step, hidden: node.hidden, disabled: Boolean(node.disabled), on: node.classList.contains('on'), selected: node.getAttribute('aria-selected'), onclick: node.getAttribute('onclick'), onclickType: typeof node.onclick, rects: node.getClientRects().length })),
      panels: [...document.querySelectorAll('.ne52-panel[data-panel]')].map(node => ({ panel: node.dataset.panel, hidden: node.hidden, on: node.classList.contains('on'), display: getComputedStyle(node).display, rects: node.getClientRects().length })),
      dialogs: [...document.querySelectorAll('dialog[open], [aria-modal="true"]')].map(node => ({ id: node.id, hidden: Boolean(node.hidden), ariaHidden: node.getAttribute('aria-hidden'), display: getComputedStyle(node).display, pointerEvents: getComputedStyle(node).pointerEvents })),
      status: document.querySelector('#studioPdfStatus')?.textContent || '',
      toast: document.querySelector('.ns-toast:last-of-type,.toast:last-of-type')?.textContent || ''
    }), step);
    const diagnosed = new Error(`Вкладка ${step} не стала активной: ${JSON.stringify(evidence)}`);
    diagnosed.evidence = evidence;
    throw diagnosed;
  }
  await settle(page, 80);
}

async function fillField(page, selector, value) {
  const field = page.locator(selector);
  await field.scrollIntoViewIfNeeded();
  await field.fill(value);
  await field.press('Tab');
  await settle(page, 180);
}

async function chooseFilesByVisibleLabel(page, inputSelector, files) {
  const label = page.locator(`label:has(${inputSelector}):visible`).first();
  insist(await label.count(), `Не найдена видимая подпись загрузки ${inputSelector}`);
  await label.scrollIntoViewIfNeeded();
  const chooserPromise = page.waitForEvent('filechooser');
  await label.click();
  const chooser = await chooserPromise;
  await chooser.setFiles(files);
  return { multiple: chooser.isMultiple() };
}

async function downloadByClick(page, locator, expected) {
  await locator.scrollIntoViewIfNeeded();
  const hit = await hitEvidence(locator);
  insist(hit.selfOrDescendant, `Кнопка экспорта перекрыта: ${locator}`, hit);
  const timeout = Number(process.env.NEX_DOWNLOAD_TIMEOUT || 120000);
  const promise = page.waitForEvent('download', { timeout });
  await locator.click();
  let download;
  try {
    download = await promise;
  } catch (error) {
    const evidence = await page.evaluate(exportType => ({
      layout: window.NEXESTATE_CRITICAL_REGRESSION_TEST?.state?.()?.layout || null,
      standalone: window.NEXESTATE_STANDALONE_TEST?.getState?.() || null,
      dataRender: window.NEXESTATE_DATA_RENDER_TEST?.state?.() || null,
      studioState: document.getElementById('dsState')?.textContent || '',
      visibleMessages: [...document.querySelectorAll('[role="alert"],.toast,.ns-toast,.ne54-toast,.ne79-toast')]
        .filter(node => node.getClientRects().length)
        .map(node => node.textContent?.trim()).filter(Boolean).slice(-8),
      planStatus: document.getElementById('ne61PlanStatus')?.textContent || '',
      button: (() => { const node = document.querySelector(exportType === 'pdf' ? '#ne78DownloadPdf' : '#ne78DownloadPng'); return node ? { disabled: node.disabled, text: node.textContent, title: node.title } : null; })(),
    }), expected);
    error.message += `\nЭкспортное состояние: ${JSON.stringify(evidence)}`;
    throw error;
  }
  const filePath = await download.path();
  insist(filePath && fs.existsSync(filePath), 'Браузер не сохранил загрузку', { suggested: download.suggestedFilename() });
  const buffer = fs.readFileSync(filePath);
  if (expected === 'pdf') insist(buffer.subarray(0, 5).toString() === '%PDF-', 'Скачан не PDF', { header: buffer.subarray(0, 8).toString('hex'), size: buffer.length });
  if (expected === 'png') insist(buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a', 'Скачан не PNG', { header: buffer.subarray(0, 8).toString('hex'), size: buffer.length });
  insist(buffer.length > 100, 'Экспорт подозрительно мал', { size: buffer.length });
  return { filename: download.suggestedFilename(), size: buffer.length, header: buffer.subarray(0, 8).toString('hex') };
}

async function applyPlacement(page, prefix) {
  const button = page.locator('#ne82PlanPlacementButton');
  await button.scrollIntoViewIfNeeded();
  await button.click();
  const overlay = page.locator('#ne82PlanPlacement:not([hidden])');
  await overlay.waitFor({ state: 'visible' });
  const radio = overlay.locator(`input[name="ne82Placement"][value^="${prefix}"]`).first();
  insist(await radio.count(), `Нет варианта размещения ${prefix}`);
  await radio.check();
  await overlay.locator('#ne82PlanApply').click();
  await overlay.waitFor({ state: 'hidden' });
  await settle(page, 260);
  return page.evaluate(() => window.NEXESTATE_CRITICAL_REGRESSION_TEST?.placement?.());
}

async function createDeepProject(page) {
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
    'Функциональное помещение с отдельным входом и витринными окнами.'
  ].join('\n');
  await modal.locator('#ne80TextArea').fill(text);
  await modal.locator('#ne80TextConfirm').click();
  await modal.waitFor({ state: 'hidden', timeout: 30_000 });
  await page.locator('#presentationStudio.show').waitFor({ state: 'visible' });
  await page.waitForFunction(() => Boolean(window.NEXESTATE_STANDALONE_TEST?.getState?.().projectId));
  await settle(page, 300);
  return { text, state: await criticalState(page) };
}

async function deepRegression(page, envName) {
  let deepProjectId = '';
  await runCheck(envName, 'Импорт TXT/paste создаёт канонический проект', async () => {
    const result = await createDeepProject(page);
    deepProjectId = result.state.projectId;
    insist(deepProjectId, 'Проект не создан после подтверждения текстового импорта', result.state);
    return { projectId: deepProjectId, data: result.state.data };
  });

  await setStep(page, 'data');
  await runCheck(envName, 'Назначение: UI → state → оба renderer', async () => {
    // Use a genuinely different value from the imported fixture. Re-entering the
    // already-present value is not a real edit and can make Playwright's synthetic
    // fill race a live preview rerender while the same text is being inserted.
    const purpose = 'офис, шоурум и клиентская зона';
    await fillField(page, '#studioUse', purpose);
    const before = await page.evaluate(() => ({
      field: document.querySelector('#studioUse')?.value || '',
      data: window.NEXESTATE_STANDALONE_TEST?.getState?.().data?.use || '',
      critical: window.NEXESTATE_CRITICAL_REGRESSION_TEST?.inspect?.().purpose || ''
    }));
    const out = {};
    for (const [selector, mode] of [['#ne62LayoutBy', 'byNexEstate'], ['#ne62LayoutSingle', 'singlePage']]) {
      await page.locator(selector).click();
      await settle(page, 180);
      out[mode] = await slideEvidence(page);
      const purposes = out[mode].slides.map(slide => slide.purpose).filter(Boolean);
      insist(purposes.includes(purpose), `Назначение не попало в ${mode}`, { before, rendered: out[mode] });
    }
    const state = await criticalState(page);
    insist(state.data?.use === purpose, 'Назначение не сохранено в канонических данных', state);
    return { purpose, modes: Object.fromEntries(Object.entries(out).map(([key, value]) => [key, value.slides.map(item => ({ kind: item.kind, purpose: item.purpose }))])) };
  });

  await runCheck(envName, 'Метро: две станции, пешее время и отсутствие выдуманного автомобиля', async () => {
    const metro = 'Комсомольская — 5 минут пешком; Красносельская — 7 минут пешком';
    await fillField(page, '#studioMetro', metro);
    const evidence = await slideEvidence(page);
    const rendered = evidence.slides.flatMap(slide => slide.metros || []);
    insist(rendered.some(value => /Комсомольская.*5.*пешком/i.test(value)), 'Не показана Комсомольская с 5 минутами пешком', evidence);
    insist(rendered.some(value => /Красносельская.*7.*пешком/i.test(value)), 'Не показана Красносельская с 7 минутами пешком', evidence);
    insist(!rendered.some(value => /автомоб/i.test(value)), 'Автомобильное время было выдумано', evidence);
    await fillField(page, '#studioMetro', 'Комсомольская');
    const single = await slideEvidence(page);
    insist(single.slides.flatMap(slide => slide.metros || []).some(value => value === 'Комсомольская'), 'Станция без времени потеряна', single);
    await fillField(page, '#studioMetro', metro);
    return { rendered, withoutTime: single.slides.flatMap(slide => slide.metros || []) };
  });

  await runCheck(envName, 'Focus-связь мгновенно появляется и полностью исчезает', async () => {
    const focused = await assertFocusedLink(page, page.locator('#studioUse'), 'studioUse');
    const cleared = await assertFocusCleared(page);
    return { focused, cleared };
  });

  await runCheck(envName, 'Контакт брокера: связь работает с первого focus после включения страницы', async () => {
    const contactDetails = page.locator('details').filter({ has: page.locator('#ne73ShowContact') }).first();
    insist(await contactDetails.count(), 'Не найден раздел контакта брокера');
    if (!(await contactDetails.evaluate(node => node.open))) await contactDetails.locator(':scope > summary').click();
    const toggle = page.locator('#ne73ShowContact');
    await toggle.scrollIntoViewIfNeeded();
    if (!(await toggle.isChecked())) await toggle.click();
    await page.waitForFunction(() => document.querySelector('#studioPresoDeck>.ps-canvas-page[data-page-kind="contact"]'), null, { timeout: 5000 }).catch(() => {});
    await settle(page, 260);
    const results = {};
    for (const [selector, id, value] of [
      ['#studioMgr', 'studioMgr', 'Анна Брокер'],
      ['#studioMgrRole', 'studioMgrRole', 'Эксперт по коммерческой недвижимости'],
      ['#studioPhone', 'studioPhone', '+7 900 123-45-67'],
      ['#studioEmail', 'studioEmail', 'broker@example.test'],
      ['#studioTg', 'studioTg', '@nexestate_test'],
      ['#studioSite', 'studioSite', 'https://example.test']
    ]) {
      const field = page.locator(selector);
      if (!await field.count()) continue;
      if (!await field.isVisible()) {
        const details = field.locator('xpath=ancestor::details[1]');
        if (await details.count() && !(await details.evaluate(node => node.open))) await details.locator('summary').click();
      }
      await field.fill(value);
      results[id] = await assertFocusedLink(page, field, id);
      await assertFocusCleared(page);
    }
    insist(Object.keys(results).length >= 5, 'Проверено недостаточно полей контакта', results);
    return results;
  });

  await runCheck(envName, 'Шрифты независимы в обоих режимах', async () => {
    const details = page.locator('#ne78FontSettings');
    const select = page.locator('#dsFontSelect');
    const values = await select.locator('option').evaluateAll(nodes => nodes.map(node => node.value));
    insist(values.length >= 2, 'Недостаточно вариантов шрифта', { values });
    await page.locator('#ne62LayoutBy').click();
    if (!(await details.evaluate(node => node.open))) await details.locator('summary').click();
    await page.waitForFunction(() => Boolean(document.querySelector('#ne78FontSettings')?.open));
    const byFont = await page.evaluate(() => {
      const select = document.querySelector('#dsFontSelect'), details = document.querySelector('#ne78FontSettings');
      return { detailsHidden: Boolean(details?.hidden), detailsOpen: Boolean(details?.open), selectHidden: Boolean(select?.hidden), display: select ? getComputedStyle(select).display : '', rect: select?.getBoundingClientRect().toJSON?.() || null, parent: select?.parentElement?.outerHTML?.slice(0, 500) || '' };
    });
    insist(await select.isVisible(), 'Выбор шрифта скрыт в режиме by NexEstate', byFont);
    await select.selectOption(values[0]);
    await settle(page, 140);
    await page.locator('#ne62LayoutSingle').click();
    if (!(await details.evaluate(node => node.open))) await details.locator('summary').click();
    await page.waitForFunction(() => Boolean(document.querySelector('#ne78FontSettings')?.open));
    const singleFont = await page.evaluate(() => {
      const select = document.querySelector('#dsFontSelect'), details = document.querySelector('#ne78FontSettings');
      return { detailsHidden: Boolean(details?.hidden), detailsOpen: Boolean(details?.open), selectHidden: Boolean(select?.hidden), display: select ? getComputedStyle(select).display : '', rect: select?.getBoundingClientRect().toJSON?.() || null, parent: select?.parentElement?.outerHTML?.slice(0, 500) || '' };
    });
    insist(await select.isVisible(), 'Выбор шрифта скрыт в одностраничном режиме', singleFont);
    await select.selectOption(values[1]);
    await settle(page, 140);
    const state = await criticalState(page);
    insist(state.fullSettings.byNexEstateFont === values[0] && state.fullSettings.singlePageFont === values[1], 'Настройки шрифтов режимов смешались', state.fullSettings);
    return { by: state.fullSettings.byNexEstateFont, single: state.fullSettings.singlePageFont, values };
  });

  await runCheck(envName, 'Fit заголовка: короткий/средний/длинный/экстремальный в обоих режимах', async () => {
    const titles = [
      'Офис',
      'Аренда офиса с видом на Кремль',
      'Аренда длительного помещения свободного назначения 210,5 м²',
      'Экстремально длинный кириллический заголовок коммерческого объекта '.repeat(9).trim()
    ];
    const rows = [];
    for (const selector of ['#ne62LayoutBy', '#ne62LayoutSingle']) {
      await page.locator(selector).click();
      for (const title of titles) {
        await fillField(page, '#studioName', title);
        const evidence = await slideEvidence(page);
        const metric = evidence.slides.map(slide => slide.title).find(Boolean);
        insist(metric && metric.fits && metric.lines > 0 && metric.fontSize >= 20, 'Заголовок не вошёл в измеренный безопасный блок', { selector, titleLength: title.length, metric, evidence });
        rows.push({ selector, titleLength: title.length, metric });
      }
    }
    await fillField(page, '#studioName', `Аренда длительного помещения свободного назначения ${RUN_ID}`);
    return rows;
  });

  await runCheck(envName, 'Точный прозрачный logo-asset загружен и зарезервирован отдельно', async () => {
    const ready = await page.evaluate(() => window.NEXESTATE_CRITICAL_REGRESSION_TEST.logo.wait());
    const evidence = await slideEvidence(page);
    const state = await page.evaluate(() => ({
      asset: window.NEXESTATE_CRITICAL_REGRESSION_TEST.logo.asset,
      state: window.NEXESTATE_CRITICAL_REGRESSION_TEST.logo.state()
    }));
    insist(ready && state.state === 'ready' && /nexestate-logo-reference-clean\.png$/.test(state.asset), 'Единый logo-asset не готов', state);
    insist(evidence.slides.some(slide => slide.brandBoxes.some(box => box.kind === 'wordmark') && slide.brandBoxes.some(box => box.kind === 'buildings')), 'Renderer не записал безопасные области wordmark и силуэта', evidence);
    return { state, brandBoxes: evidence.slides.map(slide => slide.brandBoxes) };
  });

  await setStep(page, 'pdf');
  if (PDF_FIXTURE) {
    await runCheck(envName, 'Физическая загрузка PDF и «Перенести всё в Медиа»', async () => {
      const replace = page.locator('#ne78ReplacePdf:visible').first();
      const drop = page.locator('#ne53PdfDrop:visible').first();
      const pdfUi = await page.evaluate(() => {
        const drop = document.querySelector('#ne53PdfDrop'), panel = document.querySelector('.ne52-panel[data-panel="pdf"]'), tab = document.querySelector('[role="tab"][data-step="pdf"]'), state = window.NE53_STATE?.pdf || {};
        return { step: window.NE53_STATE?.step || '', tabOn: Boolean(tab?.classList.contains('on')), tabSelected: tab?.getAttribute('aria-selected'), panelOn: Boolean(panel?.classList.contains('on')), panelHidden: Boolean(panel?.hidden), dropHidden: Boolean(drop?.hidden), dropDisplay: drop ? getComputedStyle(drop).display : '', dropRect: drop?.getBoundingClientRect().toJSON?.() || null, pdf: { pageCount: state.pageCount || 0, fileName: state.fileName || '', processing: Boolean(state.processing) } };
      });
      const launcher = await replace.count() ? replace : drop;
      insist(await launcher.count(), 'Не найдено видимое действие выбора или замены PDF', pdfUi);
      await launcher.scrollIntoViewIfNeeded();
      const chooserPromise = page.waitForEvent('filechooser');
      await launcher.click();
      const chooser = await chooserPromise;
      const previousFileName = await page.evaluate(() => window.NE53_STATE?.pdf?.fileName || '');
      await chooser.setFiles(PDF_FIXTURE);
      await page.waitForFunction(({ previousFileName, expectedFileName }) => {
        const pdf = window.NE53_STATE?.pdf;
        const status = document.querySelector('#studioPdfStatus')?.textContent || '';
        return Boolean(
          pdf &&
          pdf.fileName === expectedFileName &&
          pdf.fileName !== previousFileName &&
          pdf.processing === false &&
          /PDF обработан:/i.test(status)
        );
      }, {
        previousFileName,
        expectedFileName: path.basename(PDF_FIXTURE)
      }, { timeout: 120000 });
      const before = await page.evaluate(() => ({
        pages: window.NE53_STATE?.pdf?.pageCount || 0,
        extracted: window.NE53_STATE?.pdf?.extractedPhotos?.length || 0,
        media: window.NEXESTATE_STANDALONE_TEST?.getState?.().mediaCount || 0,
        status: document.querySelector('#studioPdfStatus')?.textContent || ''
      }));
      insist(before.pages > 0, 'PDF не был обработан', before);
      const transfer = page.locator('#ne53TransferAll');
      insist(before.extracted > 0 && await transfer.isEnabled(), 'PDF обработан без доступных для переноса изображений', before);
      await transfer.scrollIntoViewIfNeeded();
      await transfer.click();
      await page.waitForFunction(previousMediaCount => {
        const photos = window.NE53_STATE?.pdf?.extractedPhotos || [];
        const mediaCount = window.NEXESTATE_STANDALONE_TEST?.getState?.().mediaCount || 0;
        const transferButton = document.querySelector('#ne53TransferAll');
        return mediaCount > previousMediaCount || (photos.length > 0 && photos.every(photo => photo.transferred)) || transferButton?.disabled === true;
      }, before.media, { timeout: 60000 });
      await settle(page, 180);
      const after = await criticalState(page);
      const transferState = await page.evaluate(() => ({
        mediaCount: window.NEXESTATE_STANDALONE_TEST?.getState?.().mediaCount || 0,
        extracted: (window.NE53_STATE?.pdf?.extractedPhotos || []).map(photo => ({ transferred: Boolean(photo.transferred), assetId: photo.assetId || '' })),
        disabled: Boolean(document.querySelector('#ne53TransferAll')?.disabled)
      }));
      insist(after.mediaCount > before.media && transferState.extracted.some(photo => photo.transferred), 'Извлечённые фотографии не были физически перенесены в Media', { before, after, transferState });
      return { fixture: path.basename(PDF_FIXTURE), before, afterMedia: after.mediaCount };
    });
  } else {
    record(envName, 'Физическая загрузка PDF и «Перенести всё в Медиа»', 'NOT TESTED', {}, 'PDF fixture недоступен');
  }

  await setStep(page, 'media');
  await runCheck(envName, 'Физическая загрузка нескольких фотографий', async () => {
    insist(fs.existsSync(PHOTO_FIXTURE), 'Photo fixture отсутствует', { PHOTO_FIXTURE });
    const beforeMediaCount = await page.evaluate(() => window.NEXESTATE_STANDALONE_TEST?.getState?.().mediaCount || 0);
    await chooseFilesByVisibleLabel(page, '#studioPhotos', [PHOTO_FIXTURE, PLAN_FIXTURE]);
    await page.waitForFunction(previous => {
      const state = window.NEXESTATE_STANDALONE_TEST?.getState?.() || {};
      const cards = document.querySelectorAll('#studioPhotoThumbs .studio-photo-card').length;
      return (state.mediaCount || 0) >= previous + 2 && cards >= previous + 2;
    }, beforeMediaCount, { timeout: 30000 });
    await settle(page, 180);
    const state = await criticalState(page);
    return { beforeMediaCount, mediaCount: state.mediaCount, includedCount: state.includedCount };
  });

  let prePlan = null;
  await runCheck(envName, 'Загрузка планировки не сбрасывает режим/тему/шрифт/страницу/scroll', async () => {
    const byMode = page.locator('#ne62LayoutBy');
    await byMode.scrollIntoViewIfNeeded();
    const byHit = await hitEvidence(byMode);
    insist(byHit.selfOrDescendant, 'Переключатель by NexEstate перекрыт другим элементом', byHit);
    await byMode.click();
    await page.waitForFunction(() => window.NEXESTATE_CRITICAL_REGRESSION_TEST?.inspect?.().layout === 'byNexEstate', null, { timeout: 15000 });
    const theme = page.locator('#ne73BrandTheme');
    if (await theme.isVisible()) {
      const options = await theme.locator('option').evaluateAll(nodes => nodes.map(node => node.value));
      if (options[1]) await theme.selectOption(options[1]);
    }
    const preview = page.locator('.ps-preview-stage');
    await preview.evaluate(node => { node.scrollTop = Math.min(140, node.scrollHeight - node.clientHeight); });
    prePlan = await criticalState(page);
    await chooseFilesByVisibleLabel(page, '#studioFloorPlanInput', PLAN_FIXTURE);
    await page.waitForFunction(() => window.NEXESTATE_CRITICAL_REGRESSION_TEST?.inspect?.().plan === true, null, { timeout: 20000 });
    await page.locator('#ne82PlanPlacementButton:not([hidden])').waitFor({ state: 'visible', timeout: 20000 });
    const postPlan = await criticalState(page);
    for (const key of Object.keys(prePlan.settings)) insist(JSON.stringify(postPlan.settings[key]) === JSON.stringify(prePlan.settings[key]), `Планировка изменила ${key}`, { before: prePlan.settings[key], after: postPlan.settings[key] });
    insist(postPlan.critical?.plan === true && postPlan.critical?.layout === prePlan.critical?.layout, 'Планировка отсутствует или режим сменился', { prePlan, postPlan });
    const placementOverlay = page.locator('#ne82PlanPlacement:not([hidden])');
    const modalOpened = await placementOverlay.isVisible().catch(() => false);
    if (modalOpened) await placementOverlay.locator('[aria-label="Закрыть"]').click();
    return { before: prePlan, after: postPlan, modalOpened };
  });

  let photoCountBeforePlacement = 0;
  await runCheck(envName, 'Планировка: размещение на обложке без удаления фотографий', async () => {
    photoCountBeforePlacement = (await criticalState(page)).mediaCount;
    const placement = await applyPlacement(page, 'cover|cover|0');
    const evidence = await slideEvidence(page);
    const after = await criticalState(page);
    insist(placement.mode === 'cover' && evidence.slides.some(slide => slide.planSlots.includes(0)), 'Планировка не появилась в выбранном слоте обложки', { placement, evidence });
    insist(after.mediaCount === photoCountBeforePlacement, 'Фотография была молча удалена при размещении', { before: photoCountBeforePlacement, after: after.mediaCount });
    return { placement, mediaCount: after.mediaCount, slides: evidence.slides };
  });

  await runCheck(envName, 'Undo/Redo размещения планировки', async () => {
    const undo = page.locator('#dsUndoBtn');
    const redo = page.locator('#dsRedoBtn');
    await undo.click();
    await settle(page, 260);
    const afterUndo = await page.evaluate(() => window.NEXESTATE_CRITICAL_REGRESSION_TEST?.placement?.());
    await redo.click();
    await settle(page, 260);
    const afterRedo = await page.evaluate(() => window.NEXESTATE_CRITICAL_REGRESSION_TEST?.placement?.());
    insist(afterUndo.mode !== afterRedo.mode || afterUndo.slot !== afterRedo.slot, 'Undo/Redo не изменили размещение', { afterUndo, afterRedo });
    insist(afterRedo.mode === 'cover', 'Redo не восстановил размещение на обложке', { afterUndo, afterRedo });
    return { afterUndo, afterRedo };
  });

  await runCheck(envName, 'Планировка: существующая страница и отдельная страница без дублей', async () => {
    await page.locator('#ne62LayoutSingle').click();
    await settle(page, 180);
    const pagePlacement = await applyPlacement(page, 'page|single-content|0');
    const pageSlides = await slideEvidence(page);
    insist(pagePlacement.mode === 'page' && !pageSlides.slides.some(slide => slide.isPlan), 'В режиме существующей страницы появился лишний отдельный слайд', { pagePlacement, pageSlides });
    const separate = await applyPlacement(page, 'separate|floor|0');
    const separateSlides = await slideEvidence(page);
    insist(separate.mode === 'separate' && separateSlides.slides.filter(slide => slide.isPlan).length === 1, 'Отдельная страница планировки отсутствует или продублирована', { separate, separateSlides });
    return { pagePlacement, pageSlides: pageSlides.slides, separate, separateSlides: separateSlides.slides };
  });

  await runCheck(envName, 'Служебное «-- СТРАНИЦА N» отсутствует в state/preview', async () => {
    const injected = await page.evaluate(() => {
      const api = window.NEXESTATE_STANDALONE_TEST, state = api?.getState?.() || {}, settings = structuredClone(state.settings || {}), marker = '-- СТРАНИЦА 3 --';
      settings.features = Array.isArray(settings.features) ? settings.features : [];
      const legacy = settings.features.find(item => item?.type === 'layout');
      if (legacy) Object.assign(legacy, { value: marker, auto: true, manual: false });
      else settings.features.push({ type: 'layout', enabled: true, value: marker, label: 'Планировка', auto: true, manual: false });
      settings.byNexEstateFeatureValues = { ...(settings.byNexEstateFeatureValues || {}), layout: { value: marker, label: 'Планировка', auto: true, manual: false } };
      settings.singlePageFeatureValues = { ...(settings.singlePageFeatureValues || {}), layout: { value: marker, label: 'Планировка', auto: true, manual: false } };
      return { applied: api?.replaceSettings?.(settings) === true, marker };
    });
    insist(injected.applied, 'Не удалось применить тестовое состояние со служебным маркером', injected);
    await settle(page, 180);
    const state = await criticalState(page);
    const evidence = await slideEvidence(page);
    const stateText = JSON.stringify({ data: state.data, features: state.fullSettings.features, values: state.fullSettings.byNexEstateFeatureValues, single: state.fullSettings.singlePageFeatureValues });
    const renderText = evidence.texts.join('\n');
    insist(!/--\s*СТРАНИЦА\s*\d+/i.test(stateText) && !/--\s*СТРАНИЦА\s*\d+/i.test(renderText), 'Служебная ссылка утекла как пользовательский текст', { stateText, renderText });
    return { injected: injected.marker, stateMatch: false, previewMatch: false };
  });

  await runCheck(envName, 'Сравнение, fullscreen и настройки открываются физическими кликами', async () => {
    const result = {};
    await page.locator('#dsCompareBtn').click();
    await settle(page, 140);
    result.compareOn = await page.locator('#dsCompareBtn').getAttribute('aria-pressed');
    await page.locator('.ds-compare-close').click();
    await page.locator('#dsCompare').waitFor({ state: 'hidden' });
    await page.locator('#dsFullscreenBtn').click();
    await settle(page, 140);
    result.fullscreenText = (await page.locator('#dsFullscreenBtn').textContent() || '').trim();
    await page.locator('#dsFullscreenBtn').click();
    const menu = page.locator('#presentationStudio .ne78-head-menu');
    if (!await menu.getAttribute('open')) await menu.locator('summary').click();
    const settings = page.locator('#ne73SettingsTrigger:visible');
    await settings.scrollIntoViewIfNeeded();
    await settings.click();
    result.settingsExpanded = await settings.getAttribute('aria-expanded');
    await page.keyboard.press('Escape');
    insist(result.compareOn === 'true' && /Обычный экран/i.test(result.fullscreenText) && result.settingsExpanded === 'true', 'Одна из панелей не переключилась', result);
    return result;
  });

  await runCheck(envName, 'Шаблон и резервная копия сохраняются физическими действиями', async () => {
    const saveTemplate = page.getByRole('button', { name: 'Сохранить шаблон', exact: true }).last();
    await saveTemplate.scrollIntoViewIfNeeded();
    await saveTemplate.click();
    const overlay = page.locator('#ne73TemplateCreateOverlay:not([hidden])');
    await overlay.waitFor({ state: 'visible' });
    const templateName = `Critical QA ${RUN_ID}`;
    await overlay.locator('#ne73TemplateName').fill(templateName);
    await overlay.getByRole('button', { name: /^Сохранить$/ }).click();
    await overlay.waitFor({ state: 'hidden' });
    const select = page.locator('#dsPresetSelect');
    const options = await select.locator('option').allTextContents();
    insist(options.some(value => value.includes(templateName)), 'Шаблон не появился в списке', { options });
    await page.getByRole('button', { name: 'Резервные копии', exact: true }).last().click();
    const dialog = page.locator('#ne61BackupDialog[open]');
    await dialog.waitFor({ state: 'visible' });
    await dialog.getByRole('button', { name: 'Создать резервную копию сейчас', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    return { templateName, templates: options.length, backupCreated: true };
  });

  await runCheck(envName, 'PDF/PNG экспорт обоих режимов', async () => {
    const downloads = {};
    for (const [selector, mode] of [['#ne62LayoutBy', 'by'], ['#ne62LayoutSingle', 'single']]) {
      await page.locator(selector).click();
      await settle(page, 180);
      console.log(`EXPORT     ${envName} :: ${mode} PDF`);
      downloads[`${mode}Pdf`] = await downloadByClick(page, page.locator('#ne78DownloadPdf'), 'pdf');
    }
    // PNG by NexEstate can emit several files. Run both PDF checks first, then
    // the single-page PNG, and leave the multi-file by export last so its
    // remaining download events cannot be mistaken for a later direct action.
    await page.locator('#ne62LayoutSingle').click();
    await settle(page, 180);
    console.log(`EXPORT     ${envName} :: single PNG`);
    downloads.singlePng = await downloadByClick(page, page.locator('#ne78DownloadPng'), 'png');
    await page.locator('#ne62LayoutBy').click();
    await settle(page, 180);
    console.log(`EXPORT     ${envName} :: by PNG`);
    downloads.byPng = await downloadByClick(page, page.locator('#ne78DownloadPng'), 'png');
    return downloads;
  });

  await runCheck(envName, 'IndexedDB хранит бинарные данные, localStorage остаётся метаданным', async () => {
    const evidence = await page.evaluate(async () => {
      const state = window.NEXESTATE_STANDALONE_TEST.getState();
      const saved = await window.NEXESTATE_STANDALONE_TEST.saveCurrent(false);
      const record = await window.NEXESTATE_STANDALONE_TEST.getProject(state.projectId);
      const localEntries = Object.keys(localStorage).map(key => [key, localStorage.getItem(key) || '']);
      const seen = new WeakSet();
      let blobs = 0, blobBytes = 0;
      const walk = value => {
        if (!value || typeof value !== 'object') return;
        if (value instanceof Blob) { blobs++; blobBytes += value.size; return; }
        if (seen.has(value)) return; seen.add(value);
        if (Array.isArray(value)) value.forEach(walk); else Object.values(value).forEach(walk);
      };
      walk(record);
      return {
        saved,
        projectId: state.projectId,
        blobs,
        blobBytes,
        localBytes: localEntries.reduce((sum, [, value]) => sum + value.length * 2, 0),
        localBinaryKeys: localEntries.filter(([, value]) => /data:(?:image|application\/pdf)|;base64,/i.test(value) || value.length > 1000000).map(([key, value]) => ({ key, length: value.length })),
        storageText: document.querySelector('#ne61Autosave,#ne62Autosave,#dsState')?.textContent || ''
      };
    });
    insist(evidence.saved === true && evidence.blobs > 0 && !evidence.localBinaryKeys.length, 'Хранилище не прошло проверку Blob/metadata', evidence);
    insist(!/не сохран[её]н|ошибка локального/i.test(evidence.storageText), 'Показана ложная ошибка хранения', evidence);
    return evidence;
  });

  await runCheck(envName, 'Reload/reopen сохраняет режим, назначение, планировку и шрифты', async () => {
    const before = await criticalState(page);
    await page.getByRole('button', { name: 'К презентациям' }).click();
    await waitHome(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitHome(page);
    const card = page.locator(`.ns-project-card[data-project-id="${deepProjectId}"]`);
    await card.waitFor({ state: 'visible' });
    await card.getByRole('button', { name: /Открыть презентацию/ }).click();
    await page.locator('#presentationStudio.show').waitFor({ state: 'visible' });
    await settle(page, 400);
    const after = await criticalState(page);
    insist(after.data?.use === before.data?.use, 'После reload потеряно назначение', { before, after });
    insist(after.critical?.placement?.mode === before.critical?.placement?.mode && after.critical?.plan, 'После reload потеряна планировка/размещение', { before, after });
    insist(after.fullSettings.byNexEstateFont === before.fullSettings.byNexEstateFont && after.fullSettings.singlePageFont === before.fullSettings.singlePageFont, 'После reload потеряны шрифты', { before, after });
    return { before: { purpose: before.data?.use, placement: before.critical?.placement, byFont: before.fullSettings.byNexEstateFont, singleFont: before.fullSettings.singlePageFont }, after: { purpose: after.data?.use, placement: after.critical?.placement, byFont: after.fullSettings.byNexEstateFont, singleFont: after.fullSettings.singlePageFont } };
  });

  await runCheck(envName, '«Без логотипов» обратимо работает после reload', async () => {
    const toggle = page.locator('#ne80NoLogos');
    await toggle.scrollIntoViewIfNeeded();
    if (await toggle.isChecked()) await toggle.click();
    const branded = await slideEvidence(page);
    await toggle.click();
    const hidden = await slideEvidence(page);
    await toggle.click();
    const restored = await slideEvidence(page);
    const brandedCount = branded.slides.reduce((sum, slide) => sum + slide.brandBoxes.length, 0);
    const hiddenCount = hidden.slides.reduce((sum, slide) => sum + slide.brandBoxes.length, 0);
    const restoredCount = restored.slides.reduce((sum, slide) => sum + slide.brandBoxes.length, 0);
    insist(brandedCount > 0 && hiddenCount === 0 && restoredCount > 0, 'Обезличивание не обратимо', { brandedCount, hiddenCount, restoredCount });
    return { brandedCount, hiddenCount, restoredCount };
  });

  await page.getByRole('button', { name: 'К презентациям' }).click();
  await waitHome(page);
  await runCheck(envName, 'Клавиатура: Enter открывает «Новая презентация»', async () => {
    const button = page.locator('#nsNewProject');
    await button.focus();
    await page.keyboard.press('Enter');
    const dialog = page.locator('#nsNewDialog[open]');
    await dialog.waitFor({ state: 'visible' });
    await dialog.getByRole('button', { name: /^Отмена$/ }).click();
    return { activeElement: await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName) };
  });

  await runCheck(envName, 'PDF-каталог: выбор проекта, открытие и скачивание', async () => {
    const cards = page.locator('.ns-project-card[data-project-id]');
    insist(await cards.count() >= 1, 'Нет карточек проекта для каталога');
    const readyCards = cards.filter({ has: page.locator('.ns-project-select input[type="checkbox"]') });
    for (let index = 0; index < Math.min(2, await readyCards.count()); index++) {
      const checkbox = readyCards.nth(index).locator('.ns-project-select input[type="checkbox"]');
      if (!await checkbox.isChecked()) await checkbox.check();
    }
    const open = page.locator('#nsOpenCatalog');
    insist(await open.isEnabled(), 'Кнопка каталога не активировалась после выбора');
    await open.click();
    await page.locator('#nsCatalogScreen:not([hidden])').waitFor({ state: 'visible' });
    const download = await downloadByClick(page, page.locator('#nsDownloadCatalog'), 'pdf');
    await page.locator('#nsCatalogBack').click();
    await waitHome(page);
    return download;
  });

  await runCheck(envName, '«К приложениям» использует базовый маршрут', async () => {
    const card = page.locator(`.ns-project-card[data-project-id="${deepProjectId}"]`);
    await card.getByRole('button', { name: /Открыть презентацию/ }).click();
    await page.locator('#presentationStudio.show').waitFor({ state: 'visible' });
    const link = page.locator('#presentationStudio .ne79-header-nav').getByRole('link', { name: 'К приложениям', exact: true });
    await Promise.all([
      page.waitForURL(url => !/apps\/presentation/.test(url.pathname), { waitUntil: 'domcontentloaded', timeout: 20000 }),
      link.click()
    ]);
    const evidence = { url: page.url(), title: await page.locator('h1').first().textContent().catch(() => '') };
    insist(new URL(evidence.url).pathname.endsWith('/') && !/apps\/presentation/.test(new URL(evidence.url).pathname), 'Ссылка не вернула в Hub', evidence);
    return evidence;
  });
}

async function pwaOfflineProbe(context, envName) {
  const page = await context.newPage();
  const url = new URL(`apps/presentation/?offline=${RUN_ID}`, BASE).href;
  await runCheck(envName, 'PWA: service worker и offline reload', async () => {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
    insist(response?.ok(), `HTTP ${response?.status()}`);
    await waitHome(page);
    let online = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker?.ready;
      return { controlled: Boolean(navigator.serviceWorker.controller), scope: registration?.scope || '', script: registration?.active?.scriptURL || '' };
    });
    if (!online.controlled) {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
      await waitHome(page);
      online = await page.evaluate(async () => {
        const registration = await navigator.serviceWorker?.ready;
        return { controlled: Boolean(navigator.serviceWorker.controller), scope: registration?.scope || '', script: registration?.active?.scriptURL || '' };
      });
    }
    insist(online.controlled, 'Страница не контролируется service worker', online);
    await context.setOffline(true);
    try {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
      await waitHome(page);
      const offline = { heading: await page.locator('#nsHomeTitle').textContent(), url: page.url() };
      return { online, offline };
    } finally {
      await context.setOffline(false);
    }
  });
  await page.close();
}

async function runFirefoxSelenium(config) {
  process.env.MOZ_DISABLE_CONTENT_SANDBOX = '1';
  const runtime = process.env.NEX_SELENIUM_RUNTIME || path.join(os.tmpdir(), 'nexestate-firefox-qa-runtime');
  const seleniumRoot = path.join(runtime, 'node_modules', 'selenium-webdriver');
  const { Builder, By, until } = require(seleniumRoot);
  const firefoxDriver = require(path.join(seleniumRoot, 'firefox'));
  const options = new firefoxDriver.Options()
    .setBinary('C:\\Program Files\\Mozilla Firefox\\firefox.exe')
    .addArguments('-headless')
    .setPreference('security.sandbox.content.level', 0);
  if (config.private) options.addArguments('-private');
  const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).build();
  report.environments.push({ name: config.name, browser: config.browser, privacyMode: config.private ? 'private' : 'normal', mobile: false, viewport: config.viewport, driver: 'Selenium WebDriver' });
  const waitCss = async (selector, timeout = 30000) => {
    const element = await driver.wait(until.elementLocated(By.css(selector)), timeout);
    await driver.wait(until.elementIsVisible(element), timeout);
    return element;
  };
  const clickCss = async selector => (await waitCss(selector)).click();
  const hit = element => driver.executeScript(el => {
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2));
    const y = Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / 2));
    const target = document.elementFromPoint(x, y);
    return { rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, target: target ? `${target.tagName}#${target.id || ''}.${target.className || ''}` : '', selfOrDescendant: target === el || el.contains(target) };
  }, element);
  try {
    await driver.manage().setTimeouts({ implicit: 0, pageLoad: 45000, script: 30000 });
    await runCheck(config.name, 'Свежая загрузка приложения', async () => {
      await driver.get(APP);
      await waitCss('#nsNewProject');
      await driver.wait(() => driver.executeScript('return document.readyState==="complete"'), 30000);
      const state = await driver.executeScript('return {url:location.href,ready:document.readyState,v80:window.NEXESTATE_FINAL_FUNCTIONAL_LOADED,v80d:window.NEXESTATE_DATA_RENDER_LOADED,v81:window.NEXESTATE_BRAND_VISIBILITY_LOADED,v82:window.NEXESTATE_CRITICAL_REGRESSION_LOADED,errors:[window.NEXESTATE_FINAL_FUNCTIONAL_ERROR,window.NEXESTATE_DATA_RENDER_ERROR,window.NEXESTATE_BRAND_VISIBILITY_ERROR,window.NEXESTATE_CRITICAL_REGRESSION_ERROR].filter(Boolean)}');
      insist(state.v80 === true && state.v80d === true && state.v81 === true && state.v82 === true, 'Финальные runtime-модули не загрузились', state);
      return state;
    });
    for (const [label, selector] of [
      ['Новая презентация', '#nsNewProject'],
      ['Загрузить PDF', 'button[data-ne79-file-target="nsBulkPdf"]'],
      ['Загрузить текст', 'button[data-ne79-file-target="ne79TextImport"]'],
      ['Загрузить фото', 'button[data-ne79-file-target="ne79PhotoImport"]'],
      ['Импортировать файл проекта', 'button[data-ne79-file-target="nsImportProject"]']
    ]) {
      await runCheck(config.name, `hit-test: ${label}`, async () => {
        const evidence = await hit(await waitCss(selector));
        insist(evidence.selfOrDescendant, `Клик перехватывает ${evidence.target}`, evidence);
        return evidence;
      });
    }
    await runCheck(config.name, 'Физический клик «Новая презентация»', async () => {
      await clickCss('#nsNewProject');
      await waitCss('#nsNewDialog[open]');
      await (await driver.findElement(By.xpath("//dialog[@id='nsNewDialog']//button[normalize-space()='Отмена']"))).click();
      await driver.wait(() => driver.executeScript("return !document.querySelector('#nsNewDialog[open]')"), 10000);
      return { opened: true, closed: true };
    });
    await runCheck(config.name, 'Физический клик «Загрузить текст»', async () => {
      await clickCss('button[data-ne79-file-target="ne79TextImport"]');
      const area = await waitCss('#ne80TextModal:not([hidden]) #ne80TextArea');
      await area.sendKeys(`Аренда офиса Firefox ${RUN_ID}\nМосква, Краснопрудная улица, 3\nОписание объекта\nТестовый текст.`);
      const count = await driver.findElement(By.css('#ne80TextCount')).getText();
      await (await driver.findElement(By.xpath("//*[@id='ne80TextModal']//button[normalize-space()='Отмена']"))).click();
      await driver.wait(() => driver.executeScript("return document.querySelector('#ne80TextModal')?.hidden===true"), 10000);
      return { count };
    });
    for (const [label, target] of [
      ['Загрузить PDF', 'nsBulkPdf'],
      ['Загрузить фото', 'ne79PhotoImport'],
      ['Импортировать файл проекта', 'nsImportProject']
    ]) {
      await runCheck(config.name, `Физический launcher: ${label}`, async () => {
        await driver.executeScript(id => {
          const input = document.getElementById(id);
          if (!input) throw new Error(`Missing file input: ${id}`);
          input.dataset.neQaPhysicalClicks = '0';
          input.addEventListener('click', () => {
            input.dataset.neQaPhysicalClicks = String(Number(input.dataset.neQaPhysicalClicks || 0) + 1);
          }, { once: true });
        }, target);
        await clickCss(`button[data-ne79-file-target="${target}"]`);
        await driver.sleep(120);
        const evidence = await driver.executeScript(id => {
          const input = document.getElementById(id);
          return { inputId: id, type: input?.type || '', accept: input?.accept || '', clicks: Number(input?.dataset.neQaPhysicalClicks || 0) };
        }, target);
        insist(evidence.type === 'file' && evidence.clicks === 1, `Видимый launcher не активировал ${target}`, evidence);
        return evidence;
      });
    }
    await runCheck(config.name, 'Создание пустой презентации и открытие редактора', async () => {
      await clickCss('#nsNewProject');
      await waitCss('#nsNewDialog[open]');
      await (await driver.findElement(By.xpath("//dialog[@id='nsNewDialog']//button[normalize-space()='Создать']"))).click();
      await waitCss('#presentationStudio.show');
      return driver.executeScript('return window.NEXESTATE_STANDALONE_TEST?.getState?.() || {}');
    });
    await runCheck(config.name, 'Вкладки PDF / Данные / Медиа', async () => {
      const states = {};
      for (const step of ['pdf', 'data', 'media']) {
        const tab = await waitCss(`[role="tab"][data-step="${step}"]`);
        await tab.click();
        states[step] = await tab.getAttribute('aria-selected');
        insist(states[step] === 'true', `Вкладка ${step} не стала активной`, states);
      }
      return states;
    });
    await clickCss('[role="tab"][data-step="data"]');
    await runCheck(config.name, 'Настройки шрифтов видимы и интерактивны', async () => {
      const settings = await waitCss('#ne78FontSettings');
      await (await settings.findElement(By.css('summary'))).click();
      const select = await waitCss('#dsFontSelect');
      return { open: await settings.getAttribute('open'), options: (await select.findElements(By.css('option'))).length };
    });
    await runCheck(config.name, 'Физические клики режимов и «Без логотипов»', async () => {
      const result = {};
      for (const selector of ['#ne62LayoutBy', '#ne62LayoutSingle', '#ne80NoLogos']) {
        const element = await waitCss(selector);
        await driver.executeScript('arguments[0].scrollIntoView({block:"center",inline:"center"})', element);
        const evidence = await hit(element);
        insist(evidence.selfOrDescendant, `${selector} перекрыт`, evidence);
        await element.click();
        result[selector] = evidence;
      }
      return result;
    });
    await runCheck(config.name, 'Нижняя панель: высота и отсутствие перекрытий', async () => {
      const geometry = await driver.executeScript('const b=document.querySelector(".ps-bottom-bar");const r=b.getBoundingClientRect();return {height:r.height,overflow:getComputedStyle(b).overflowX,clientWidth:b.clientWidth,scrollWidth:b.scrollWidth}');
      insist(geometry.height <= 64.5, `Высота панели ${geometry.height}`, geometry);
      return geometry;
    });
    await runCheck(config.name, '«К презентациям» возвращает на экран проектов', async () => {
      await (await waitCss('#presentationStudio .ne79-header-nav button')).click();
      await waitCss('#studioHome');
      return { url: await driver.getCurrentUrl() };
    });
    await runCheck(config.name, 'Нет runtime-ошибок загрузки', async () => {
      const state = await driver.executeScript('return {loaded:[window.NEXESTATE_FINAL_FUNCTIONAL_LOADED,window.NEXESTATE_DATA_RENDER_LOADED,window.NEXESTATE_BRAND_VISIBILITY_LOADED,window.NEXESTATE_CRITICAL_REGRESSION_LOADED],errors:[window.NEXESTATE_FINAL_FUNCTIONAL_ERROR,window.NEXESTATE_DATA_RENDER_ERROR,window.NEXESTATE_BRAND_VISIBILITY_ERROR,window.NEXESTATE_CRITICAL_REGRESSION_ERROR].filter(Boolean).map(String)}');
      insist(state.loaded.every(value => value === true) && state.errors.length === 0, 'Обнаружены runtime-ошибки', state);
      return state;
    });
  } finally {
    try { await driver.quit(); } catch (error) { process.stderr.write(`Firefox WebDriver quit warning: ${error.message}\n`); }
  }
}

async function runEnvironment(config) {
  const contextOptions = {
    ...(config.mobile ? devices['Pixel 7'] : { viewport: config.viewport }),
    acceptDownloads: true,
    ...(config.browser === 'Firefox' ? {} : { serviceWorkers: 'allow' })
  };
  const browser = config.persistent ? null : await config.type.launch(config.launch);
  const context = config.persistent
    ? await config.type.launchPersistentContext(path.join(TEMP, `profile-${config.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`), { ...config.launch, ...contextOptions })
    : await browser.newContext(contextOptions);
  const page = await context.newPage();
  const errors = contextErrors(page);
  await installUnhandled(page, errors);
  report.environments.push({ name: config.name, browser: config.browser, privacyMode: config.persistent ? 'normal' : 'private', mobile: Boolean(config.mobile), viewport: config.mobile ? devices['Pixel 7'].viewport : config.viewport });
  try {
    await runCheck(config.name, 'Свежая загрузка приложения', async () => {
      const response = await page.goto(APP, { waitUntil: 'domcontentloaded' });
      insist(response?.ok(), `HTTP ${response?.status()}`);
      await waitHome(page);
      return page.evaluate(() => ({
        url: location.href,
        ready: document.readyState,
        v80: window.NEXESTATE_FINAL_FUNCTIONAL_LOADED,
        v80d: window.NEXESTATE_DATA_RENDER_LOADED,
        v81: window.NEXESTATE_BRAND_VISIBILITY_LOADED,
        v82: window.NEXESTATE_CRITICAL_REGRESSION_LOADED,
        ids: [...document.querySelectorAll('[id]')].map(node => node.id).filter((id, index, all) => all.indexOf(id) !== index),
        cache: performance.getEntriesByType('resource').filter(entry => /service-worker|presentation/.test(entry.name)).map(entry => entry.name)
      }));
    });
    await homeButtonProbe(page, config.name, Boolean(config.mobile));
    if (config.keyboard) await keyboardHomeProbe(page, config.name);
    await tooltipProbe(page, config.name);
    await editorSmoke(page, config.name, Boolean(config.mobile));
    if (config.deep) {
      await deepRegression(page, config.name);
      await pwaOfflineProbe(context, config.name);
    }
    await errors.readUnhandled();
    await runCheck(config.name, 'Нет console/pageerror/unhandled rejection', async () => {
      insist(!errors.console.length && !errors.pageerror.length && !errors.unhandled.length, 'Обнаружены runtime-ошибки', errors);
      return errors;
    });
  } finally {
    await context.close();
    if (browser) await browser.close();
  }
}

async function main() {
  fs.mkdirSync(RESULTS, { recursive: true });
  fs.mkdirSync(TEMP, { recursive: true });
  const requested = new Set(String(process.env.NEX_CRITICAL_BROWSERS || '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean));
  const environments = [
    { name: 'Chrome normal desktop', browser: 'Chrome', type: chromium, launch: { executablePath: CHROME, headless: true }, viewport: { width: 1440, height: 900 }, persistent: true, keyboard: true },
    { name: 'Chrome Incognito desktop', browser: 'Chrome', type: chromium, launch: { executablePath: CHROME, headless: true }, viewport: { width: 1440, height: 900 }, deep: true },
    { name: 'Chrome narrow desktop', browser: 'Chrome', type: chromium, launch: { executablePath: CHROME, headless: true }, viewport: { width: 1024, height: 720 } },
    { name: 'Edge normal desktop', browser: 'Edge', type: chromium, launch: { executablePath: EDGE, headless: true }, viewport: { width: 1440, height: 900 }, persistent: true },
    { name: 'Edge InPrivate desktop', browser: 'Edge', type: chromium, launch: { executablePath: EDGE, headless: true }, viewport: { width: 1440, height: 900 } },
    { name: 'Firefox normal desktop', browser: 'Firefox', type: firefox, launch: { headless: true }, viewport: { width: 1440, height: 900 }, private: false },
    { name: 'Firefox Private desktop', browser: 'Firefox', type: firefox, launch: { headless: true }, viewport: { width: 1440, height: 900 }, private: true },
    { name: 'Chrome Pixel 7 touch', browser: 'Chrome', type: chromium, launch: { executablePath: CHROME, headless: true }, mobile: true }
  ].filter(environment => !requested.size || requested.has(environment.browser.toLowerCase()) || requested.has(environment.name.toLowerCase()));
  for (const environment of environments) {
    try {
      if (environment.browser === 'Firefox') await runFirefoxSelenium(environment);
      else await runEnvironment(environment);
    } catch (error) {
      record(environment.name, 'Среда целиком', 'FAIL', {}, error.stack || error.message);
    }
  }
  report.finishedAt = new Date().toISOString();
  report.summary = report.checks.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`REPORT ${REPORT}\n`);
  process.stdout.write(`SUMMARY ${JSON.stringify(report.summary)}\n`);
  process.exitCode = report.summary.FAIL ? 1 : 0;
}

main().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
