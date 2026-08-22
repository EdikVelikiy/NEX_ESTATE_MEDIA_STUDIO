const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const BASE = process.env.NEX_PERF_URL || 'http://127.0.0.1:8810/';
const PHASE = (process.argv.find(arg => arg.startsWith('--phase=')) || '--phase=before').split('=')[1];
const RUN_ID = `${PHASE}-${Date.now()}-${process.pid}`;
const APP = new URL(`apps/presentation/?unresolved-performance=${RUN_ID}`, BASE).href;
const RESULTS = path.join(__dirname, 'results', 'unresolved-ui-performance-20260822');
const REPORT_PATH = path.join(RESULTS, `${PHASE}.json`);
const SCREENSHOT_PATH = path.join(RESULTS, `${PHASE}-18-photo-project.png`);
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SOURCE_PHOTO_PATH = 'C:\\Users\\ED\\Downloads\\eed3d213-2adf-4cd6-8c55-1fe83f78169e.jpg';
const SOURCE_PHOTO = SOURCE_PHOTO_PATH;

fs.mkdirSync(RESULTS, { recursive: true });

const report = {
  phase: PHASE,
  runId: RUN_ID,
  startedAt: new Date().toISOString(),
  appUrl: APP,
  browser: 'Google Chrome',
  browserVersion: '',
  viewport: { width: 1440, height: 900 },
  hardware: {
    platform: process.platform,
    arch: process.arch,
    cpu: process.env.PROCESSOR_IDENTIFIER || '',
    logicalProcessors: Number(process.env.NUMBER_OF_PROCESSORS || 0)
  },
  fixture: {
    kind: '18 unique derivatives of a real commercial-property photograph',
    count: 18,
    source: SOURCE_PHOTO
  },
  operations: {},
  finalState: {},
  consoleErrors: [],
  pageErrors: [],
  failures: []
};

function insist(condition, message, evidence = {}) {
  if (condition) return;
  const error = new Error(message);
  error.evidence = evidence;
  throw error;
}

async function installInstrumentation(page) {
  await page.addInitScript(() => {
    const counters = () => ({
      fileReaderArrayBuffer: 0,
      fileReaderDataUrl: 0,
      fileReaderText: 0,
      createImageBitmap: 0,
      imageDecode: 0,
      canvasToDataUrl: 0,
      canvasToBlob: 0,
      indexedDbPut: 0,
      indexedDbAdd: 0,
      indexedDbDelete: 0,
      localStorageWrite: 0,
      renderPasses: 0,
      previewMutations: 0
    });
    const perf = window.__NEX_PERF = {
      counts: counters(),
      longTasks: [],
      active: null,
      original: {},
      reset() {
        this.counts = counters();
        this.longTasks.length = 0;
        this.active = null;
      },
      markWork(kind) {
        const operation = this.active;
        if (!operation || operation.workStartAt != null) return;
        operation.workStartAt = performance.now();
        operation.firstWorkKind = kind;
      },
      begin(label, selector) {
        const button = document.querySelector(selector);
        const operation = this.active = {
          label,
          selector,
          setupAt: performance.now(),
          clickAt: null,
          activeStateAt: null,
          workStartAt: null,
          firstWorkKind: '',
          stableAt: null,
          initialText: button?.textContent || '',
          initialPressed: button?.getAttribute('aria-pressed') || ''
        };
        const click = event => {
          if (event.target === button || button?.contains(event.target)) operation.clickAt = performance.now();
        };
        document.addEventListener('click', click, true);
        operation.removeClickListener = () => document.removeEventListener('click', click, true);
        const sample = () => {
          if (this.active !== operation || operation.activeStateAt != null) return;
          const changed = button && (
            button.disabled ||
            button.getAttribute('aria-busy') === 'true' ||
            button.getAttribute('data-operation-state') === 'running' ||
            button.classList.contains('loading') ||
            button.textContent !== operation.initialText ||
            button.getAttribute('aria-pressed') !== operation.initialPressed
          );
          if (operation.clickAt != null && changed) operation.activeStateAt = performance.now();
          else requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
        return operation;
      },
      end() {
        const operation = this.active;
        if (!operation) return null;
        operation.stableAt = performance.now();
        operation.removeClickListener?.();
        delete operation.removeClickListener;
        const clickAt = operation.clickAt == null ? operation.setupAt : operation.clickAt;
        const result = {
          label: operation.label,
          clickToActiveMs: operation.activeStateAt == null ? null : +(operation.activeStateAt - clickAt).toFixed(2),
          clickToWorkMs: operation.workStartAt == null ? null : +(operation.workStartAt - clickAt).toFixed(2),
          clickToStableMs: +(operation.stableAt - clickAt).toFixed(2),
          firstWorkKind: operation.firstWorkKind,
          counts: { ...this.counts },
          longTasks: this.longTasks.map(item => ({ ...item })),
          longTaskCount: this.longTasks.length,
          longTaskTotalMs: +this.longTasks.reduce((sum, item) => sum + item.duration, 0).toFixed(2),
          longestTaskMs: +Math.max(0, ...this.longTasks.map(item => item.duration)).toFixed(2)
        };
        this.active = null;
        return result;
      }
    };

    const count = (name, kind) => {
      perf.counts[name]++;
      perf.markWork(kind || name);
    };

    for (const [method, key] of [['readAsArrayBuffer', 'fileReaderArrayBuffer'], ['readAsDataURL', 'fileReaderDataUrl'], ['readAsText', 'fileReaderText']]) {
      const original = FileReader.prototype[method];
      if (typeof original === 'function') FileReader.prototype[method] = function(...args) {
        count(key);
        return original.apply(this, args);
      };
    }

    if (typeof window.createImageBitmap === 'function') {
      const original = window.createImageBitmap.bind(window);
      window.createImageBitmap = (...args) => {
        count('createImageBitmap');
        return original(...args);
      };
    }

    if (typeof HTMLImageElement.prototype.decode === 'function') {
      const original = HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode = function(...args) {
        count('imageDecode');
        return original.apply(this, args);
      };
    }

    for (const [method, key] of [['toDataURL', 'canvasToDataUrl'], ['toBlob', 'canvasToBlob']]) {
      const original = HTMLCanvasElement.prototype[method];
      if (typeof original === 'function') HTMLCanvasElement.prototype[method] = function(...args) {
        count(key, key === 'canvasToDataUrl' ? 'base64' : key);
        return original.apply(this, args);
      };
    }

    try {
      for (const [method, key] of [['put', 'indexedDbPut'], ['add', 'indexedDbAdd'], ['delete', 'indexedDbDelete']]) {
        const original = IDBObjectStore.prototype[method];
        IDBObjectStore.prototype[method] = function(...args) {
          count(key, 'indexedDB');
          return original.apply(this, args);
        };
      }
    } catch (_) {}

    try {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function(...args) {
        count('localStorageWrite', 'localStorage');
        return original.apply(this, args);
      };
    } catch (_) {}

    try {
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          if (entry.duration > 50) perf.longTasks.push({
            startTime: +entry.startTime.toFixed(2),
            duration: +entry.duration.toFixed(2),
            name: entry.name || 'longtask'
          });
        }
      }).observe({ type: 'longtask', buffered: true });
    } catch (_) {}
  });
}

async function createProject(page) {
  await page.locator('#nsNewProject').click();
  const dialog = page.locator('#nsNewDialog[open]');
  await dialog.waitFor({ state: 'visible', timeout: 30000 });
  await dialog.getByRole('button', { name: /^Создать$/ }).click();
  await page.locator('#presentationStudio').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#ne72OpenOverlay').waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
  await page.waitForFunction(() => document.querySelector('#presentationStudio')?.classList.contains('ne83-footer-toolbar'));
  await page.waitForFunction(() => window.NEXESTATE_REMAINING_VISUAL_HOTFIX_TEST?.version === '84.0-remaining-visual-hotfix');
}

async function installPreviewCounter(page) {
  await page.evaluate(() => {
    const perf = window.__NEX_PERF;
    const host = document.getElementById('studioPresoDeck');
    if (!perf || !host || host.__nexPerfObserver) return;
    let wasBusy = host.getAttribute('aria-busy') === 'true';
    const observer = new MutationObserver(records => {
      perf.counts.previewMutations += records.length;
      const busy = host.getAttribute('aria-busy') === 'true';
      if (!busy && wasBusy) {
        perf.counts.renderPasses++;
        perf.markWork('preview-render');
      }
      wasBusy = busy;
    });
    observer.observe(host, { attributes: true, attributeFilter: ['aria-busy'], childList: true, subtree: true });
    host.__nexPerfObserver = observer;
  });
}

async function seedEighteenRealPhotos(page) {
  const sourceBase64 = fs.readFileSync(SOURCE_PHOTO_PATH).toString('base64');
  return page.evaluate(async sourceBase64 => {
    const binary = atob(sourceBase64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    const sourceBlob = new Blob([bytes], { type: 'image/jpeg' });
    const source = await createImageBitmap(sourceBlob);
    const sizes = [
      [720, 480], [480, 720], [560, 560], [360, 760], [760, 360], [640, 480],
      [480, 640], [600, 600], [340, 720], [720, 340], [700, 500], [500, 700],
      [620, 620], [320, 700], [700, 320], [680, 460], [460, 680], [540, 540]
    ];
    const digest = async blob => {
      const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
      return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    };
    const photos = [];
    for (let index = 0; index < sizes.length; index++) {
      const [width, height] = sizes[index];
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      const scale = Math.max(width / source.width, height / source.height);
      const sourceWidth = width / scale;
      const sourceHeight = height / scale;
      const maxX = Math.max(0, source.width - sourceWidth);
      const maxY = Math.max(0, source.height - sourceHeight);
      const sx = maxX * ((index % 6) / 5);
      const sy = maxY * ((Math.floor(index / 6) % 3) / 2);
      ctx.drawImage(source, sx, sy, sourceWidth, sourceHeight, 0, 0, width, height);
      ctx.fillStyle = `rgba(${20 + index * 7},${90 + index * 5},${150 + index * 3},0.32)`;
      ctx.fillRect(0, height - 3, Math.min(width, 14 + index), 3);
      const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Fixture encode failed')), 'image/jpeg', 0.9));
      photos.push({
        blob,
        mime: 'image/jpeg',
        ext: 'jpg',
        page: Math.floor(index / 3) + 1,
        number: (index % 3) + 1,
        width,
        height,
        hash: await digest(blob),
        transferred: false,
        sourceKind: 'qa-real-photo'
      });
    }
    source.close?.();
    window.NE53_STATE.pdf.fileName = 'qa-real-project-18-photos.pdf';
    window.NE53_STATE.pdf.pageCount = 6;
    window.NE53_STATE.pdf.extractedPhotos = photos;
    window.NE53_STATE.pdf.stats = { extracted: photos.length, blank: 0 };
    window.NEXESTATE_V54_TEST?.renderPdfState?.();
    return photos.map(photo => ({ width: photo.width, height: photo.height, size: photo.blob.size, hash: photo.hash }));
  }, sourceBase64);
}

async function waitStablePreview(page) {
  await page.waitForFunction(() => {
    const host = document.getElementById('studioPresoDeck');
    const media = [...(host?.querySelectorAll(':scope>.ps-canvas-page>img,:scope>.ps-canvas-page>canvas') || [])];
    return host?.getAttribute('aria-busy') === 'false' && media.length > 0 && media.every(node => node instanceof HTMLCanvasElement ? node.width > 1 && node.height > 1 : node.complete && node.naturalWidth > 0);
  }, null, { timeout: 90000 });
  await page.waitForTimeout(250);
}

async function beginOperation(page, label, selector) {
  await page.evaluate(({ label, selector }) => {
    window.__NEX_PERF.reset();
    window.__NEX_PERF.begin(label, selector);
  }, { label, selector });
}

async function endOperation(page) {
  return page.evaluate(() => window.__NEX_PERF.end());
}

async function measureTransfer(page) {
  const selector = '#ne53TransferAll';
  await page.locator(selector).waitFor({ state: 'visible', timeout: 30000 });
  await beginOperation(page, 'transfer-all-18', selector);
  await page.locator(selector).click();
  await page.waitForFunction(() => {
    const mediaCount = window.NEXESTATE_STANDALONE_TEST?.getState?.()?.mediaCount ||
      window.ne53UnifiedMedia?.snapshot?.()?.items?.filter(item => item.type === 'photo')?.length || 0;
    const photos = window.NE53_STATE?.pdf?.extractedPhotos || [];
    return mediaCount === 18 && photos.length === 18 && photos.every(photo => photo.transferred === true);
  }, null, { timeout: 180000 });
  await waitStablePreview(page);
  return endOperation(page);
}

async function measureMode(page, selector, expectedLayout, label) {
  const button = page.locator(selector);
  await button.waitFor({ state: 'visible', timeout: 30000 });
  await button.scrollIntoViewIfNeeded();
  await beginOperation(page, label, selector);
  await button.click();
  await page.waitForFunction(expected => {
    const inspect = window.NEXESTATE_CRITICAL_REGRESSION_TEST?.inspect?.();
    const by = document.getElementById('ne62LayoutBy')?.getAttribute('aria-pressed') === 'true';
    const single = document.getElementById('ne62LayoutSingle')?.getAttribute('aria-pressed') === 'true';
    return inspect?.layout === expected || (expected === 'singlePage' ? single : by);
  }, expectedLayout, { timeout: 90000 });
  await waitStablePreview(page);
  return endOperation(page);
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  report.browserVersion = browser.version();
  const context = await browser.newContext({ viewport: report.viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('console', message => {
    if (message.type() === 'error') report.consoleErrors.push({ text: message.text(), location: message.location() });
  });
  page.on('pageerror', error => report.pageErrors.push(String(error.stack || error)));
  try {
    await installInstrumentation(page);
    await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.locator('#studioHome').waitFor({ state: 'visible', timeout: 30000 });
    await createProject(page);
    await installPreviewCounter(page);
    report.fixture.items = await seedEighteenRealPhotos(page);
    insist(report.fixture.items.length === 18, '18-photo fixture was not created', { count: report.fixture.items.length });
    report.operations.transfer = await measureTransfer(page);
    report.operations.toSinglePage = await measureMode(page, '#ne62LayoutSingle', 'singlePage', 'mode-to-single-page');
    report.operations.toByNexEstate = await measureMode(page, '#ne62LayoutBy', 'byNexEstate', 'mode-to-by-nexestate');
    report.finalState = await page.evaluate(() => ({
      layout: window.NEXESTATE_CRITICAL_REGRESSION_TEST?.inspect?.()?.layout || null,
      mediaCount: window.NEXESTATE_STANDALONE_TEST?.getState?.()?.mediaCount ||
        window.ne53UnifiedMedia?.snapshot?.()?.items?.filter(item => item.type === 'photo')?.length || 0,
      extractedCount: window.NE53_STATE?.pdf?.extractedPhotos?.length || 0,
      transferredCount: window.NE53_STATE?.pdf?.extractedPhotos?.filter(photo => photo.transferred)?.length || 0,
      previewBusy: document.getElementById('studioPresoDeck')?.getAttribute('aria-busy') || '',
      previewPages: document.querySelectorAll('#studioPresoDeck>.ps-canvas-page').length
    }));
    insist(report.finalState.mediaCount === 18, 'Final media count is not 18', report.finalState);
    insist(report.finalState.previewBusy === 'false', 'Preview did not settle', report.finalState);
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
    report.screenshot = SCREENSHOT_PATH;
  } catch (error) {
    report.finalState = await page.evaluate(() => ({
      layout: window.NEXESTATE_CRITICAL_REGRESSION_TEST?.inspect?.()?.layout || null,
      mediaCount: window.NEXESTATE_STANDALONE_TEST?.getState?.()?.mediaCount ||
        window.ne53UnifiedMedia?.snapshot?.()?.items?.filter(item => item.type === 'photo')?.length || 0,
      extractedCount: window.NE53_STATE?.pdf?.extractedPhotos?.length || 0,
      transferredCount: window.NE53_STATE?.pdf?.extractedPhotos?.filter(photo => photo.transferred)?.length || 0,
      previewBusy: document.getElementById('studioPresoDeck')?.getAttribute('aria-busy') || '',
      status: document.getElementById('studioPdfStatus')?.textContent?.trim() || '',
      transferDisabled: document.getElementById('ne53TransferAll')?.disabled || false,
      counters: window.__NEX_PERF?.counts || null
    })).catch(() => ({}));
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true }).catch(() => {});
    report.screenshot = SCREENSHOT_PATH;
    report.failures.push({ message: String(error.message || error), stack: String(error.stack || ''), evidence: error.evidence || {} });
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    await browser.close();
  }
}

main().then(() => {
  process.stdout.write(`${JSON.stringify({ phase: PHASE, report: REPORT_PATH, operations: report.operations }, null, 2)}\n`);
}).catch(error => {
  process.stderr.write(`${error.stack || error}\nReport: ${REPORT_PATH}\n`);
  process.exitCode = 1;
});
