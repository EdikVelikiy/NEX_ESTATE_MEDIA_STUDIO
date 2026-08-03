const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const BASE_URL = process.env.NEX_STUDIO_URL || 'http://127.0.0.1:8765/';
const EDGE = process.env.NEX_EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SOURCE = path.resolve(PROJECT_ROOT, '..', '..', 'diagnostics', 'qa-source-3s.mp4');
const RESULT = path.join(__dirname, 'results', 'audio-stabilization-export.mp4');
const REPORT = path.join(__dirname, 'results', 'audio-stabilization-report.json');
const FFPROBE = path.join(PROJECT_ROOT, 'vendor', 'ffmpeg', 'bin', 'ffprobe.exe');

function probe(filePath) {
  const payload = JSON.parse(execFileSync(FFPROBE, [
    '-v', 'error', '-show_format', '-show_streams', '-print_format', 'json', filePath
  ], { encoding: 'utf8' }));
  return {
    duration: Number(payload.format?.duration) || 0,
    format: payload.format?.format_name || '',
    video: payload.streams?.find(stream => stream.codec_type === 'video')?.codec_name || '',
    audio: payload.streams?.find(stream => stream.codec_type === 'audio')?.codec_name || ''
  };
}

async function main() {
  fs.mkdirSync(path.dirname(RESULT), { recursive: true });
  const browser = await chromium.launch({
    executablePath: EDGE,
    headless: true,
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding'
    ]
  });
  const consoleErrors = [];
  try {
    const context = await browser.newContext({
      acceptDownloads: true,
      viewport: { width: 1440, height: 1000 },
      permissions: ['microphone'],
      serviceWorkers: 'block'
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', error => consoleErrors.push(error.message));

    const response = await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    if (!response?.ok()) throw new Error(`HTTP ${response?.status()}`);
    await page.waitForFunction(() => document.documentElement.classList.contains('studio-upgrade-ready'));
    await page.getByRole('button', { name: 'Видео', exact: true }).click();
    await page.getByRole('button', { name: 'Pro', exact: true }).click();
    await page.locator('#vxFile').setInputFiles(SOURCE);
    await page.waitForFunction(() => {
      const metadata = window.NEXVideoRuntime?.metadata?.();
      return metadata?.width === 640 && metadata?.height === 360 && metadata?.duration > 3;
    });

    await page.locator('#vxStabilizeLevel').evaluate(select => {
      select.value = 'strong';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.locator('#vxOutputFormat').evaluate(select => {
      select.value = 'mp4';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await page.getByRole('button', { name: /Запись речи/ }).click();
    await page.waitForFunction(() => document.body.classList.contains('voice-recording'));
    await page.waitForTimeout(900);
    await page.getByRole('button', { name: /Стоп \/ пауза/ }).click();
    await page.waitForFunction(() => document.body.classList.contains('voice-paused'));
    await page.getByRole('button', { name: /Сохранить/ }).click();
    await page.waitForFunction(() => document.getElementById('vxVoiceStatus')?.textContent.includes('Озвучка сохранена'));

    await page.getByRole('button', { name: /Работа с субтитрами/ }).click();
    await page.locator('#vxWhisperText').evaluate(textarea => {
      textarea.value = '1\n00:00:00,000 --> 00:00:02,900\nСветлая квартира рядом с парком';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const downloadPromise = page.waitForEvent('download', { timeout: 180000 });
    const errorPromise = page.waitForFunction(() => {
      const text = document.getElementById('vxProgressText')?.textContent || '';
      return /^Ошибка/.test(text) ? text : false;
    }, null, { timeout: 180000 }).then(handle => handle.jsonValue().then(text => {
      throw new Error(text);
    }));
    await page.getByRole('button', { name: 'Обработать и скачать видео' }).click();
    const download = await Promise.race([downloadPromise, errorPromise]);
    await download.saveAs(RESULT);
    await page.waitForFunction(() => document.getElementById('vxExport')?.disabled === false);

    const source = probe(SOURCE);
    const output = probe(RESULT);
    const signature = fs.readFileSync(RESULT).subarray(4, 8).toString('ascii');
    const durationDelta = Math.abs(output.duration - source.duration);
    const runtime = await page.evaluate(() => ({
      output: window.NEXVideoRuntime.output(),
      stages: window.NEXVideoRuntime.processingStages().map(stage => stage.text),
      metrics: document.getElementById('vxOutputMetrics')?.textContent || ''
    }));
    const report = { source, output, signature, durationDelta, runtime, consoleErrors };
    fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));

    if (signature !== 'ftyp' || !/mp4|mov/.test(output.format)) throw new Error('Файл не является настоящим MP4');
    if (output.video !== 'h264' || output.audio !== 'aac') throw new Error(`Кодеки: ${output.video}/${output.audio}`);
    if (durationDelta >= 0.9) throw new Error(`Расхождение длительности ${durationDelta.toFixed(3)} с`);
    if (!runtime.stages.some(text => /стабилиз/i.test(text)) || !runtime.stages.some(text => /субтитр/i.test(text))) {
      throw new Error('Нет подтверждения стадий стабилизации/субтитров');
    }
    if (!/Итоговый файл проверен/.test(runtime.metrics)) throw new Error('Нет итоговой проверки файла');
    if (consoleErrors.length) throw new Error(`Ошибки консоли: ${consoleErrors.join(' | ')}`);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\nPASS\n`);
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
