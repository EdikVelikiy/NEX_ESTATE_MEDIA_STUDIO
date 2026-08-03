const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const JSZip = require('jszip');
const sharp = require('sharp');

const BASE_URL = process.env.NEX_STUDIO_URL || 'http://127.0.0.1:8765/';
const EDGE = process.env.NEX_EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PROJECT_ROOT = path.resolve(__dirname, '..');
const RESULTS_DIR = path.join(__dirname, 'results');
const FFMPEG = path.join(PROJECT_ROOT, 'vendor', 'ffmpeg', 'bin', 'ffmpeg.exe');
const FFPROBE = path.join(PROJECT_ROOT, 'vendor', 'ffmpeg', 'bin', 'ffprobe.exe');
fs.mkdirSync(RESULTS_DIR, { recursive: true });

const report = {
  startedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
  browser: EDGE,
  checks: [],
  console: [],
  dialogs: [],
  downloads: []
};

function assert(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

async function check(name, fn) {
  const started = Date.now();
  process.stdout.write(`CHECK ${name} ... `);
  try {
    const details = await fn();
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

async function canvasDigest(page, selector) {
  return page.locator(selector).evaluate(canvas => {
    const context = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    if (!context || !width || !height) return 'empty';
    const data = context.getImageData(0, 0, width, height).data;
    const stride = Math.max(4, Math.floor(data.length / 12000 / 4) * 4);
    let hash = 2166136261;
    for (let index = 0; index < data.length; index += stride) {
      hash ^= data[index];
      hash = Math.imul(hash, 16777619);
      hash ^= data[index + 1] || 0;
      hash = Math.imul(hash, 16777619);
      hash ^= data[index + 2] || 0;
      hash = Math.imul(hash, 16777619);
      hash ^= data[index + 3] || 0;
      hash = Math.imul(hash, 16777619);
    }
    return `${width}x${height}:${hash >>> 0}`;
  });
}

async function canvasStats(page, selector) {
  return page.locator(selector).evaluate(canvas => {
    const context = canvas.getContext('2d');
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const stride = Math.max(4, Math.floor(data.length / 16000 / 4) * 4);
    let hash = 2166136261;
    let sum = 0;
    let count = 0;
    for (let index = 0; index < data.length; index += stride) {
      sum += (data[index] + data[index + 1] + data[index + 2]) / 3;
      count += 1;
      for (let channel = 0; channel < 3; channel += 1) {
        hash ^= data[index + channel] || 0;
        hash = Math.imul(hash, 16777619);
      }
    }
    return { width: canvas.width, height: canvas.height, mean: sum / Math.max(1, count), digest: hash >>> 0 };
  });
}

async function createImagePayload(page, { name, width, height, type }) {
  const base64 = await page.evaluate(async ({ width, height, type }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#273a53');
    gradient.addColorStop(.34, '#d7c5a3');
    gradient.addColorStop(.68, '#708b69');
    gradient.addColorStop(1, '#f1e7d4');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);

    context.fillStyle = 'rgba(255,255,255,.72)';
    context.fillRect(width * .08, height * .12, width * .38, height * .58);
    context.fillStyle = '#2c3d34';
    context.fillRect(width * .52, height * .2, width * .35, height * .48);
    context.fillStyle = '#d9b56e';
    context.beginPath();
    context.arc(width * .72, height * .42, Math.min(width, height) * .15, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = 'rgba(20,20,20,.65)';
    context.lineWidth = Math.max(4, width / 420);
    for (let index = 0; index < 18; index += 1) {
      const x = width * (.04 + index / 20);
      context.beginPath();
      context.moveTo(x, height * .78);
      context.lineTo(x + width * .035, height * .95);
      context.stroke();
    }
    context.font = `700 ${Math.max(42, Math.round(width / 18))}px Arial`;
    context.fillStyle = '#142018';
    context.fillText('NEX ESTATE QA', width * .08, height * .9);

    let seed = width + height;
    for (let index = 0; index < 360; index += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const x = seed % width;
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const y = seed % height;
      const shade = 60 + (seed % 150);
      context.fillStyle = `rgba(${shade},${Math.max(0, shade - 25)},${Math.min(255, shade + 20)},.14)`;
      context.fillRect(x, y, Math.max(2, width / 500), Math.max(2, height / 500));
    }

    const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Canvas encoding failed')), type, .92));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    const chunk = 0x8000;
    for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
    return btoa(binary);
  }, { width, height, type });
  return { name, mimeType: type, buffer: Buffer.from(base64, 'base64') };
}

async function createVideoPayload(page, { name, width = 640, height = 360, durationMs = 3400, withAudio = true }) {
  const result = await page.evaluate(async ({ width, height, durationMs, withAudio }) => {
    const supported = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm'
    ].find(value => MediaRecorder.isTypeSupported(value));
    if (!supported) throw new Error('WebM MediaRecorder is unavailable');

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    const stream = canvas.captureStream(24);
    let audioContext = null;
    let oscillator = null;
    if (withAudio) {
      audioContext = new AudioContext();
      await audioContext.resume();
      oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const destination = audioContext.createMediaStreamDestination();
      oscillator.type = 'sine';
      oscillator.frequency.value = 330;
      gain.gain.value = .055;
      oscillator.connect(gain).connect(destination);
      destination.stream.getAudioTracks().forEach(track => stream.addTrack(track));
      oscillator.start();
    }

    const chunks = [];
    const recorder = new MediaRecorder(stream, {
      mimeType: supported,
      videoBitsPerSecond: 1_800_000,
      audioBitsPerSecond: 128_000
    });
    recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
    const stopped = new Promise((resolve, reject) => {
      recorder.onstop = resolve;
      recorder.onerror = event => reject(event.error || new Error('Recorder error'));
    });
    const start = performance.now();
    const draw = () => {
      const elapsed = performance.now() - start;
      const progress = Math.min(1, elapsed / durationMs);
      const gradient = context.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, `hsl(${205 + progress * 25} 58% 31%)`);
      gradient.addColorStop(1, `hsl(${38 + progress * 28} 68% 68%)`);
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);
      context.fillStyle = '#f3eee5';
      context.fillRect(width * (.08 + progress * .48), height * .18, width * .24, height * .46);
      context.fillStyle = '#1e4a3a';
      context.beginPath();
      context.arc(width * (.75 - progress * .38), height * (.55 + Math.sin(progress * Math.PI * 4) * .13), Math.min(width, height) * .11, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#ffffff';
      context.font = `700 ${Math.max(22, width / 18)}px Arial`;
      context.fillText(`NEX ${Math.round(progress * 100)}%`, width * .06, height * .9);
    };
    draw();
    recorder.start(200);
    const timer = setInterval(draw, 1000 / 24);
    await new Promise(resolve => setTimeout(resolve, durationMs));
    clearInterval(timer);
    draw();
    recorder.stop();
    await stopped;
    try { oscillator?.stop(); } catch {}
    stream.getTracks().forEach(track => track.stop());
    await audioContext?.close();
    let blob = new Blob(chunks, { type: supported });
    if (window.NEXRepairWebmDuration) blob = await window.NEXRepairWebmDuration(blob, durationMs, { logger: false });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    const chunk = 0x8000;
    for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
    return { base64: btoa(binary), type: supported };
  }, { width, height, durationMs, withAudio });
  return { name, mimeType: result.type, buffer: Buffer.from(result.base64, 'base64') };
}

async function saveDownload(download, fileName) {
  const target = path.join(RESULTS_DIR, fileName || download.suggestedFilename());
  await download.saveAs(target);
  const stats = fs.statSync(target);
  assert(stats.size > 0, `Downloaded file is empty: ${target}`);
  report.downloads.push({ suggestedFilename: download.suggestedFilename(), path: target, size: stats.size });
  return target;
}

function probeMediaFile(filePath) {
  const output = execFileSync(FFPROBE, ['-v', 'error', '-show_format', '-show_streams', '-print_format', 'json', filePath], { encoding: 'utf8' });
  const payload = JSON.parse(output);
  const streams = payload.streams || [];
  return {
    container: payload.format?.format_name || '',
    duration: Number(payload.format?.duration) || null,
    size: Number(payload.format?.size) || fs.statSync(filePath).size,
    video: streams.find(stream => stream.codec_type === 'video') || null,
    audio: streams.find(stream => stream.codec_type === 'audio') || null
  };
}

async function extractFrameStats(filePath, seconds, outputName) {
  const target = path.join(RESULTS_DIR, outputName);
  execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(seconds), '-i', filePath, '-frames:v', '1', target]);
  const image = sharp(target);
  const metadata = await image.metadata();
  const stats = await image.stats();
  return { target, metadata, deviation: Math.max(...stats.channels.slice(0, 3).map(channel => channel.stdev)), mean: stats.channels.slice(0, 3).reduce((sum, channel) => sum + channel.mean, 0) / 3 };
}

async function inspectVideoBuffer(page, buffer, mimeType) {
  return page.evaluate(async ({ base64, mimeType }) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const blob = new Blob([bytes], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = url;
    document.body.appendChild(video);
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Video metadata timeout')), 10000);
        video.onloadedmetadata = () => { clearTimeout(timer); resolve(); };
        video.onerror = () => { clearTimeout(timer); reject(new Error('Video decode error')); };
      });
      await video.play().catch(() => {});
      await new Promise(resolve => setTimeout(resolve, 180));
      video.pause();
      const seek = Math.min(.7, Math.max(.05, (Number.isFinite(video.duration) ? video.duration : 1) / 2));
      await new Promise(resolve => {
        const timer = setTimeout(resolve, 1200);
        video.onseeked = () => { clearTimeout(timer); resolve(); };
        video.currentTime = seek;
      });
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      context.drawImage(video, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let sum = 0;
      let sumSquares = 0;
      let samples = 0;
      const stride = Math.max(4, Math.floor(data.length / 5000 / 4) * 4);
      for (let index = 0; index < data.length; index += stride) {
        const value = (data[index] + data[index + 1] + data[index + 2]) / 3;
        sum += value;
        sumSquares += value * value;
        samples += 1;
      }
      const mean = sum / samples;
      const variance = sumSquares / samples - mean * mean;
      const audioTracks = typeof video.captureStream === 'function' ? video.captureStream().getAudioTracks().length : null;
      return {
        width: video.videoWidth,
        height: video.videoHeight,
        duration: Number.isFinite(video.duration) ? video.duration : null,
        readyState: video.readyState,
        frameMean: mean,
        frameVariance: variance,
        audioTracks
      };
    } finally {
      video.pause();
      video.remove();
      URL.revokeObjectURL(url);
    }
  }, { base64: buffer.toString('base64'), mimeType });
}

async function main() {
  let browser;
  let page;
  try {
    browser = await chromium.launch({
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
    const context = await browser.newContext({
      acceptDownloads: true,
      viewport: { width: 1440, height: 1000 },
      permissions: ['microphone'],
      serviceWorkers: 'block'
    });
    await context.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.setDefaultNavigationTimeout(30000);
    page.on('console', message => {
      const entry = { type: message.type(), text: message.text(), location: message.location() };
      report.console.push(entry);
    });
    page.on('pageerror', error => report.console.push({ type: 'pageerror', text: error.message, stack: error.stack }));
    page.on('dialog', async dialog => {
      report.dialogs.push({ type: dialog.type(), message: dialog.message() });
      await dialog.accept();
    });

    await check('Стартовая загрузка, режимы и доступность основных контролов', async () => {
      const response = await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
      assert(response?.ok(), `HTTP error: ${response?.status()}`);
      await page.waitForFunction(() => document.documentElement.classList.contains('studio-upgrade-ready'));
      const data = await page.evaluate(() => {
        const ids = [...document.querySelectorAll('[id]')].map(node => node.id);
        const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
        return {
          title: document.title,
          ready: document.documentElement.classList.contains('studio-upgrade-ready'),
          light: document.getElementById('editionLiteBtn')?.textContent.trim(),
          pro: document.getElementById('editionProBtn')?.textContent.trim(),
          photoEngine: !!window.NEXPhotoEngine,
          videoRuntime: !!window.NEXVideoRuntime,
          duplicates,
          styles: document.querySelectorAll('#vxSubtitleStyle option').length,
          motions: document.querySelectorAll('#vxSubtitleMotion option').length,
          releaseMarkers: (document.documentElement.outerHTML.match(new RegExp('be' + 'ta', 'gi')) || []).length,
          language: document.getElementById('vxWhisperLanguage')?.value,
          languageOptions: [...document.querySelectorAll('#vxWhisperLanguage option')].map(option => option.value),
          outputFormat: document.getElementById('vxOutputFormat')?.value,
          framePanel: {
            hidden: document.getElementById('vxFramesPanel')?.hidden,
            display: getComputedStyle(document.getElementById('vxFramesPanel')).display,
            safeLimit: window.NEXVideoRuntime?.frameSafeLimit,
            obsoleteInputs: ['vxFramesStart', 'vxFramesEnd', 'vxFramesInterval', 'vxFramesLimit'].filter(id => document.getElementById(id))
          },
          speechValidation: {
            russian: window.NEXVideoRuntime?.whisperTextIsValid?.('Светлая квартира рядом с парком', 'ru'),
            english: window.NEXVideoRuntime?.whisperTextIsValid?.('A bright apartment near the park', 'en'),
            repeated: window.NEXVideoRuntime?.whisperTextIsValid?.('I am I am I am I am I am I am', 'en'),
            wrongLanguage: window.NEXVideoRuntime?.whisperTextIsValid?.('This text must not pass Russian recognition', 'ru')
          }
        };
      });
      assert(data.ready && data.photoEngine && data.videoRuntime, 'Upgrade runtimes did not initialize', data);
      assert(data.light === 'Light' && data.pro === 'Pro', 'Light/Pro modes are missing', data);
      assert(data.duplicates.length === 0, 'Duplicate element ids found', data.duplicates);
      assert(data.styles >= 16 && data.motions >= 16, 'Subtitle style or motion catalogue is incomplete', data);
      assert(data.releaseMarkers === 0, 'A pre-release marker remains in the rendered application', data);
      assert(data.language === 'ru' && data.languageOptions.join(',') === 'ru,en', 'Russian is not the default or unreliable language choice remains', data);
      assert(data.outputFormat === 'auto', 'Safe automatic video container is not the default', data);
      assert(data.framePanel.hidden && data.framePanel.display === 'none', 'Frame extraction panel is not truly collapsed by default', data.framePanel);
      assert(data.framePanel.safeLimit === 60 && data.framePanel.obsoleteInputs.length === 0, 'Frame extraction still exposes a manual range/limit or has the wrong safety limit', data.framePanel);
      assert(data.speechValidation.russian && data.speechValidation.english && !data.speechValidation.repeated && !data.speechValidation.wrongLanguage, 'Speech garbage/language validation is ineffective', data.speechValidation);
      return data;
    });

    const photoFiles = [];
    await check('Создание разнообразного набора тестовых фотографий', async () => {
      photoFiles.push(await createImagePayload(page, { name: 'Квартира — очень длинное русское имя.jpg', width: 2400, height: 1600, type: 'image/jpeg' }));
      photoFiles.push(await createImagePayload(page, { name: 'Квартира — очень длинное русское имя.png', width: 1200, height: 2000, type: 'image/png' }));
      photoFiles.push(await createImagePayload(page, { name: 'Фасад и участок.webp', width: 1024, height: 768, type: 'image/webp' }));
      for (const file of photoFiles) assert(file.buffer.length > 1000, `Synthetic image is unexpectedly small: ${file.name}`);
      return photoFiles.map(file => ({ name: file.name, bytes: file.buffer.length, mimeType: file.mimeType }));
    });

    await check('Загрузка трёх фото без перезагрузки и реальный Light-автоулучшатель', async () => {
      await page.locator('#file').setInputFiles(photoFiles[0]);
      await page.waitForFunction(() => window.NEXPhotoState?.count?.() === 1);
      const firstId = (await page.evaluate(() => window.NEXPhotoState.ids()))[0];
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.locator('.photo-add-action').click()
      ]);
      await chooser.setFiles([photoFiles[1], photoFiles[2], photoFiles[0]]);
      await page.waitForFunction(() => window.NEXPhotoState?.count?.() === 3 && document.querySelector('.photo-canvas-surface canvas')?.width > 0, null, { timeout: 30000 });
      await page.waitForFunction(() => document.querySelector('.studio-toast')?.textContent.includes('1'));
      const uploadState = await page.evaluate(() => ({ ids: window.NEXPhotoState.ids(), addVisible: getComputedStyle(document.querySelector('.photo-add-action')).display !== 'none' }));
      assert(new Set(uploadState.ids).size === 3 && uploadState.ids.includes(firstId), 'Repeated upload did not preserve unique photo records', uploadState);
      assert(uploadState.addVisible, 'Visible add-photo action disappeared after the first upload', uploadState);
      const before = await canvasStats(page, '.photo-canvas-surface canvas');
      await page.getByRole('button', { name: /Улучшить фото/ }).click();
      await page.waitForFunction(() => document.getElementById('litePhotoEnhanceBtn')?.textContent.includes('включено'));
      await page.waitForFunction(previous => {
        const canvas = document.querySelector('.photo-canvas-surface canvas');
        if (!canvas?.width) return false;
        const context = canvas.getContext('2d');
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const stride = Math.max(4, Math.floor(data.length / 16000 / 4) * 4);
        let hash = 2166136261;
        for (let index = 0; index < data.length; index += stride) {
          for (let channel = 0; channel < 3; channel += 1) {
            hash ^= data[index + channel] || 0;
            hash = Math.imul(hash, 16777619);
          }
        }
        return (hash >>> 0) !== previous;
      }, before.digest, { timeout: 30000 });
      const after = await canvasStats(page, '.photo-canvas-surface canvas');
      assert(before.digest !== after.digest, 'Light enhancement did not alter output pixels', { before, after });
      assert(after.mean > before.mean, 'Light enhancement made the photograph darker', { before, after });
      return { count: 3, firstId, uploadState, before, after };
    });

    await check('Все Pro-профили фото меняют реальные пиксели и отличаются друг от друга', async () => {
      const source = photoFiles[0].buffer.toString('base64');
      const data = await page.evaluate(async base64 => {
        const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
        const image = new Image();
        image.src = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
        await image.decode();
        const width = 640;
        const height = Math.round(width * image.naturalHeight / image.naturalWidth);
        const originalCanvas = document.createElement('canvas');
        originalCanvas.width = width;
        originalCanvas.height = height;
        originalCanvas.getContext('2d').drawImage(image, 0, 0, width, height);
        const stats = canvas => {
          const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
          const stride = Math.max(4, Math.floor(pixels.length / 12000 / 4) * 4);
          let sum = 0, count = 0, hash = 2166136261;
          for (let index = 0; index < pixels.length; index += stride) {
            sum += (pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3;
            count += 1;
            for (let channel = 0; channel < 3; channel += 1) {
              hash ^= pixels[index + channel] || 0;
              hash = Math.imul(hash, 16777619);
            }
          }
          return { mean: sum / count, digest: hash >>> 0 };
        };
        const modes = {};
        for (const mode of window.NEXPhotoEngine.profiles) {
          modes[mode] = stats(await window.NEXPhotoEngine.getEnhancedCanvas(image, width, height, { mode }));
        }
        URL.revokeObjectURL(image.src);
        return { original: stats(originalCanvas), profiles: window.NEXPhotoEngine.profiles, modes };
      }, source);
      const unique = new Set(Object.values(data.modes).map(mode => mode.digest));
      assert(data.profiles.length >= 19, 'Expanded photo profile catalogue is incomplete', data.profiles);
      assert(unique.size >= data.profiles.length - 1, 'Photo profiles do not create distinct output pixels', { profiles: data.profiles.length, unique: unique.size, modes: data.modes });
      assert(data.modes.auto.mean > data.original.mean, 'Automatic Light profile does not brighten the source', { original: data.original, auto: data.modes.auto });
      return { profiles: data.profiles, unique: unique.size, original: data.original, auto: data.modes.auto };
    });

    await check('Pro-коррекция фото и девять ручных параметров', async () => {
      await page.getByRole('button', { name: 'Pro', exact: true }).click();
      assert(await page.locator('body.studio-pro').count() === 1, 'Pro mode class was not enabled');
      await page.locator('.group:has(#photoEnhanceToggle) > h4').click();
      await page.locator('#photoEnhanceToggle').click();
      await page.locator('#photoEnhanceMode').selectOption('interior');
      const before = await canvasDigest(page, '.photo-canvas-surface canvas');
      const ranges = page.locator('#photoManualAdjustments input[type="range"]');
      assert(await ranges.count() === 9, 'Expected nine manual photo adjustment sliders');
      await page.locator('#photoAdjustExposure').evaluate(input => {
        input.value = '28';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.waitForFunction(previous => {
        const canvas = document.querySelector('.photo-canvas-surface canvas');
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        const stride = Math.max(4, Math.floor(data.length / 12000 / 4) * 4);
        let hash = 2166136261;
        for (let index = 0; index < data.length; index += stride) {
          hash ^= data[index]; hash = Math.imul(hash, 16777619);
          hash ^= data[index + 1]; hash = Math.imul(hash, 16777619);
          hash ^= data[index + 2]; hash = Math.imul(hash, 16777619);
          hash ^= data[index + 3]; hash = Math.imul(hash, 16777619);
        }
        return `${canvas.width}x${canvas.height}:${hash >>> 0}` !== previous;
      }, before, { timeout: 30000 });
      const after = await canvasDigest(page, '.photo-canvas-surface canvas');
      assert(before !== after, 'Manual exposure adjustment did not alter preview pixels');
      return { ranges: await ranges.count(), preset: await page.locator('#photoEnhanceMode').inputValue(), before, after };
    });

    await check('Быстрое выделение: одиночный клик, полная протяжка, применение и отмена', async () => {
      const surface = page.locator('.photo-canvas-surface');
      const box = await surface.boundingBox();
      assert(box && box.width > 250 && box.height > 160, 'Photo editing surface is not measurable', box);
      await page.locator('[data-selection-tool="quick"]').click();
      await page.mouse.click(box.x + box.width * .5, box.y + box.height * .48);
      const clickState = await page.evaluate(() => ({
        visible: document.querySelector('.photo-selection-layer')?.classList.contains('show'),
        handles: document.querySelectorAll('.selection-handle').length,
        applyVisible: getComputedStyle(document.querySelector('.mark-confirm')).display !== 'none'
      }));
      assert(clickState.visible && clickState.handles === 0 && clickState.applyVisible, 'Simple-click quick selection is not stable', clickState);
      await page.getByRole('button', { name: 'Применить', exact: true }).click();
      assert((await page.evaluate(() => window.NEXPhotoState.marks().length)) === 1, 'Quick click selection did not apply');
      await page.getByRole('button', { name: 'Назад', exact: true }).click();
      assert((await page.evaluate(() => window.NEXPhotoState.marks().length)) === 0, 'Quick selection undo failed');

      await page.locator('[data-selection-tool="quick"]').click();
      await page.mouse.move(box.x + box.width * .18, box.y + box.height * .20);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * .78, box.y + box.height * .72, { steps: 10 });
      await page.mouse.up();
      const drag = await page.locator('.selection-polygon').evaluate(polygon => {
        const points = polygon.getAttribute('points').trim().split(/\s+/).map(value => value.split(',').map(Number));
        const xs = points.map(point => point[0]);
        const ys = points.map(point => point[1]);
        return { width: (Math.max(...xs) - Math.min(...xs)) / 100, height: (Math.max(...ys) - Math.min(...ys)) / 100 };
      });
      assert(drag.width > .55 && drag.height > .45, 'Quick selection stopped before the pointer destination', drag);
      await page.getByRole('button', { name: 'Отменить', exact: true }).click();
      assert((await page.evaluate(() => window.NEXPhotoState.marks().length)) === 0, 'Quick cancel changed applied marks');
      return { clickState, drag };
    });

    await check('Редактируемый четырёхугольник: углы, стороны, поворот, толщина, undo/redo и отмена', async () => {
      await page.locator('[data-selection-tool="flexible"]').click();
      const surface = page.locator('.photo-canvas-surface');
      const box = await surface.boundingBox();
      assert(box && box.width > 250 && box.height > 160, 'Photo editing surface is not measurable', box);
      await page.mouse.move(box.x + box.width * .22, box.y + box.height * .24);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * .68, box.y + box.height * .70, { steps: 8 });
      await page.mouse.up();
      await page.waitForFunction(() => document.querySelector('.photo-selection-layer')?.classList.contains('show'));
      assert(await page.locator('.selection-corner').count() === 4, 'Editable selection does not expose four corner handles');
      assert(await page.locator('.selection-side').count() === 4, 'Editable selection does not expose four side handles');
      assert(await page.locator('.selection-rotate').count() === 1, 'Rotation handle is missing');
      const handleState = await page.evaluate(() => {
        const surface = document.querySelector('.photo-canvas-surface').getBoundingClientRect();
        const handles = [...document.querySelectorAll('.selection-handle')];
        const positions = handles.map(handle => ({
          left: parseFloat(handle.style.left),
          top: parseFloat(handle.style.top),
          colour: getComputedStyle(handle).backgroundColor,
          rotate: handle.classList.contains('selection-rotate'),
          side: handle.classList.contains('selection-side')
        }));
        const rotation = positions.find(point => point.rotate);
        const closestSide = Math.min(...positions.filter(point => point.side).map(point => Math.hypot((point.left - rotation.left) / 100 * surface.width, (point.top - rotation.top) / 100 * surface.height)));
        return {
          count: handles.length,
          unique: new Set(positions.map(point => `${point.left.toFixed(4)}:${point.top.toFixed(4)}`)).size,
          white: positions.every(point => point.colour === 'rgb(255, 255, 255)'),
          closestSide,
          dash: getComputedStyle(document.querySelector('.selection-polygon')).strokeDasharray
        };
      });
      assert(handleState.count === 9 && handleState.unique === 9 && handleState.white, 'Selection points are duplicated or do not use one white control each', handleState);
      assert(handleState.closestSide >= 28 && handleState.dash === 'none', 'Rotation point overlaps another handle or boundary is not solid', handleState);

      const polygon = page.locator('.selection-polygon');
      const pointsBefore = await polygon.getAttribute('points');
      await page.getByLabel('Толщина линии выделения').evaluate(input => {
        input.value = '9';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      assert((await polygon.evaluate(node => node.style.strokeWidth)) === '9px', 'Thickness was not updated live');

      const firstCorner = page.locator('.selection-corner[data-corner="0"]');
      const cornerBox = await firstCorner.boundingBox();
      await page.mouse.move(cornerBox.x + cornerBox.width / 2, cornerBox.y + cornerBox.height / 2);
      await page.mouse.down();
      const activeHandle = await page.evaluate(() => ({
        count: document.querySelectorAll('.selection-handle').length,
        active: document.querySelectorAll('.selection-handle.is-active').length,
        colour: getComputedStyle(document.querySelector('.selection-handle.is-active')).backgroundColor
      }));
      assert(activeHandle.count === 9 && activeHandle.active === 1 && activeHandle.colour === 'rgb(53, 184, 75)', 'Dragged control did not become the single green active point', activeHandle);
      await page.mouse.move(cornerBox.x + 34, cornerBox.y + 24, { steps: 5 });
      await page.mouse.up();
      assert(await page.locator('.selection-handle').count() === 9 && await page.locator('.selection-handle.is-active').count() === 0, 'Selection controls accumulated after dragging');
      const pointsAfterCorner = await polygon.getAttribute('points');
      assert(pointsAfterCorner !== pointsBefore, 'Corner drag did not change the quadrilateral');

      const side = page.locator('.selection-side[data-side="1"]');
      const sideBox = await side.boundingBox();
      await page.mouse.move(sideBox.x + sideBox.width / 2, sideBox.y + sideBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(sideBox.x + 38, sideBox.y + 20, { steps: 5 });
      await page.mouse.up();
      const pointsAfterSide = await polygon.getAttribute('points');
      assert(pointsAfterSide !== pointsAfterCorner, 'Side drag did not deform the quadrilateral');

      const rotate = page.locator('.selection-rotate');
      const rotateBox = await rotate.boundingBox();
      await page.mouse.move(rotateBox.x + rotateBox.width / 2, rotateBox.y + rotateBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(rotateBox.x + 44, rotateBox.y + 12, { steps: 6 });
      await page.mouse.up();
      const pointsAfterRotate = await polygon.getAttribute('points');
      assert(pointsAfterRotate !== pointsAfterSide, 'Rotation drag did not alter selection points');

      await page.getByRole('button', { name: 'Применить' }).click();
      let marks = await page.evaluate(() => window.NEXPhotoState.marks());
      assert(marks.length === 1 && marks[0].points.length === 4 && marks[0].thickness === 9, 'Applied selection data is incomplete', marks);
      await page.getByRole('button', { name: 'Назад' }).click();
      assert((await page.evaluate(() => window.NEXPhotoState.marks().length)) === 0, 'Undo did not remove the applied mark');
      await page.getByRole('button', { name: 'Повторить' }).click();
      assert((await page.evaluate(() => window.NEXPhotoState.marks().length)) === 1, 'Redo did not restore the mark');

      await page.locator('[data-selection-tool="flexible"]').click();
      await page.mouse.move(box.x + box.width * .1, box.y + box.height * .12);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * .28, box.y + box.height * .32, { steps: 4 });
      await page.mouse.up();
      await page.getByRole('button', { name: 'Отменить' }).click();
      marks = await page.evaluate(() => window.NEXPhotoState.marks());
      assert(marks.length === 1, 'Cancel unexpectedly changed applied selections', marks);

      await page.getByLabel('Масштаб рабочей области').evaluate(input => {
        input.value = '160';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      assert((await surface.evaluate(node => node.style.width)) === '160%', 'Workspace zoom did not update');
      const zoomedBox = await surface.boundingBox();
      await page.locator('[data-selection-tool="quick"]').click();
      await page.mouse.click(zoomedBox.x + zoomedBox.width * .42, zoomedBox.y + zoomedBox.height * .4);
      assert(await page.locator('.mark-confirm').isVisible(), 'Selection did not remain usable after zooming');
      await page.getByRole('button', { name: 'Отменить', exact: true }).click();
      await page.getByLabel('Масштаб рабочей области').evaluate(input => {
        input.value = '100';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      return { marks: marks.length, points: pointsAfterRotate, thickness: marks[0].thickness, handleState, activeHandle };
    });

    await check('Выделения сохраняются отдельно на нескольких фотографиях', async () => {
      await page.locator('.thumbs .t').nth(1).click();
      await page.waitForFunction(() => window.NEXPhotoState.current() === 1);
      const surface = page.locator('.photo-canvas-surface');
      const box = await surface.boundingBox();
      await page.locator('[data-selection-tool="quick"]').click();
      await page.mouse.click(box.x + box.width * .56, box.y + box.height * .45);
      await page.getByRole('button', { name: 'Применить', exact: true }).click();
      const second = await page.evaluate(() => window.NEXPhotoState.marks().length);
      await page.locator('.thumbs .t').nth(0).click();
      await page.waitForFunction(() => window.NEXPhotoState.current() === 0);
      const first = await page.evaluate(() => window.NEXPhotoState.marks().length);
      assert(first === 1 && second === 1, 'Marks leaked between photographs or disappeared', { first, second });
      return { first, second };
    });

    await check('Контраст всех светлых и нейтральных тем в фото- и видеоконтролах', async () => {
      const themes = ['classic', 'paper', 'mist'];
      const results = {};
      await page.evaluate(() => applyBgTheme('dark'));
      const darkBefore = await page.evaluate(() => ({
        body: getComputedStyle(document.body).backgroundImage + getComputedStyle(document.body).backgroundColor,
        panel: getComputedStyle(document.querySelector('.panel')).backgroundColor,
        text: getComputedStyle(document.querySelector('.brand')).color
      }));
      for (const theme of themes) {
        results[theme] = await page.evaluate(name => {
          applyBgTheme(name);
          const rgba = value => {
            const numbers = value.match(/[\d.]+/g)?.map(Number) || [];
            return [numbers[0] || 0, numbers[1] || 0, numbers[2] || 0, numbers[3] ?? 1];
          };
          const background = element => {
            for (let node = element; node; node = node.parentElement) {
              const colour = rgba(getComputedStyle(node).backgroundColor);
              if (colour[3] > .98) return colour;
            }
            return [255, 255, 255, 1];
          };
          const luminance = colour => colour.slice(0, 3)
            .map(value => value / 255)
            .map(value => value <= .04045 ? value / 12.92 : Math.pow((value + .055) / 1.055, 2.4))
            .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
          return ['.brand', 'label.row b', '.header-theme-btn', '.hint', '.photo-action:not(.active-mark)', '.quality-option:not(.on) b', '.whisper-head', '.v-pills button:not(.on)']
            .map(selector => {
              const element = document.querySelector(selector);
              if (!element) return null;
              const foreground = rgba(getComputedStyle(element).color);
              const back = background(element);
              const a = luminance(foreground), b = luminance(back);
              return { selector, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), foreground: getComputedStyle(element).color, background: `rgb(${back[0]}, ${back[1]}, ${back[2]})` };
            }).filter(Boolean);
        }, theme);
        const failures = results[theme].filter(sample => sample.ratio < 4.5);
        assert(failures.length === 0, `Insufficient text contrast in ${theme}`, failures);
        await page.waitForTimeout(220);
        await page.screenshot({ path: path.join(RESULTS_DIR, `theme-${theme}-photo.png`), fullPage: true });
      }
      await page.evaluate(() => applyBgTheme('dark'));
      const darkAfter = await page.evaluate(() => ({
        body: getComputedStyle(document.body).backgroundImage + getComputedStyle(document.body).backgroundColor,
        panel: getComputedStyle(document.querySelector('.panel')).backgroundColor,
        text: getComputedStyle(document.querySelector('.brand')).color
      }));
      assert(JSON.stringify(darkBefore) === JSON.stringify(darkAfter), 'Dark theme styles changed after switching through light themes', { darkBefore, darkAfter });
      return results;
    });

    await check('Графит + Кобальт: единая система основных, вторичных и отключённых кнопок', async () => {
      await page.evaluate(() => { applyBgTheme('dark');applyUiTheme('blue'); });
      await page.locator('.brand').hover();
      await page.locator('.photo-add-action').evaluate(button => Promise.all(button.getAnimations().map(animation => animation.finished.catch(() => {}))));
      const controls = await page.evaluate(() => {
        const read = selector => {
          const style = getComputedStyle(document.querySelector(selector));
          return { background: style.backgroundColor, color: style.color, border: style.borderColor, radius: style.borderRadius };
        };
        return {
          body: document.body.className,
          add: read('.photo-add-action'),
          enhance: read('.photo-light-enhance-action'),
          download: read('.photo-download-primary'),
          all: read('.actions .btn.gold')
        };
      });
      assert(controls.body.includes('bg-dark') && controls.body.includes('ui-blue'), 'Graphite/Cobalt classes were not applied', controls.body);
      assert(controls.download.background === 'rgb(91, 168, 255)', 'Primary photo action does not use the Cobalt accent', controls.download);
      assert(controls.add.background === controls.enhance.background && controls.add.background === controls.all.background, 'Secondary photo actions are visually inconsistent', controls);
      await page.locator('.photo-download-primary').evaluate(button => { button.disabled = true; });
      const disabled = await page.locator('.photo-download-primary').evaluate(button => ({ opacity: getComputedStyle(button).opacity, cursor: getComputedStyle(button).cursor }));
      await page.locator('.photo-download-primary').evaluate(button => { button.disabled = false; });
      assert(Number(disabled.opacity) <= .55 && disabled.cursor === 'not-allowed', 'Disabled primary action has no clear state', disabled);
      const screenshot = path.join(RESULTS_DIR, 'v2-2-graphite-cobalt-photo.png');
      await page.screenshot({ path: screenshot, fullPage: true });
      return { controls, disabled, screenshot };
    });

    await check('Реальные планы экспорта фото: максимальное качество и минимальный размер', async () => {
      await page.locator('.group:has(#qualityMode) > h4').click();
      await page.locator('.group:has(#fmt) > h4').click();
      await page.locator('#qualityMode [data-q="small"]').click();
      await page.locator('#fmt [data-f="auto"]').click();
      const compact = await page.evaluate(async () => {
        const result = await window.NEXPhotoState.exportOne(0);
        return { size: result.blob.size, plan: result.plan, name: result.name };
      });
      assert(Math.max(compact.plan.width, compact.plan.height) === 1920, 'Minimum-size mode did not enforce the 1920px cap', compact);
      assert(compact.size > 0, 'Compact photo export is empty', compact);

      await page.locator('#qualityMode [data-q="original"]').click();
      await page.locator('#fmt [data-f="png"]').click();
      const maximum = await page.evaluate(async () => {
        const result = await window.NEXPhotoState.exportOne(0);
        return { size: result.blob.size, plan: result.plan, name: result.name };
      });
      assert(maximum.plan.width === 2400 && maximum.plan.height === 1600, 'Maximum mode did not preserve source resolution', maximum);
      assert(maximum.plan.type === 'image/png' && maximum.size > 0, 'PNG export is invalid', maximum);
      return { compact, maximum };
    });

    await check('Скачивание одного обработанного фото и проверка декодирования', async () => {
      await page.locator('#qualityMode [data-q="small"]').click();
      await page.locator('#fmt [data-f="webp"]').click();
      const downloadPromise = page.waitForEvent('download', { timeout: 90000 });
      await page.getByRole('button', { name: 'Скачать это фото' }).click();
      const download = await downloadPromise;
      const target = await saveDownload(download, 'photo-single.webp');
      const metadata = await sharp(target).metadata();
      assert(metadata.width === 1920 && metadata.height === 1280 && metadata.format === 'webp', 'Single photo download has wrong format or dimensions', metadata);
      return metadata;
    });

    await check('Пакетный ZIP: защита от повторного запуска, CRC, имена и три декодируемых обработанных файла', async () => {
      const downloadEventsBefore = report.downloads.length;
      const allButton = page.getByRole('button', { name: /Скачать все \(3\)/ });
      const downloadPromise = page.waitForEvent('download', { timeout: 120000 });
      await allButton.click();
      await page.waitForFunction(() => document.querySelector('.actions .btn.gold')?.disabled === true);
      await page.evaluate(() => document.querySelector('.actions .btn.gold')?.click());
      const download = await downloadPromise;
      const target = await saveDownload(download, 'photos-batch.zip');
      const zip = await JSZip.loadAsync(fs.readFileSync(target), { checkCRC32: true });
      const files = Object.values(zip.files).filter(entry => !entry.dir);
      assert(files.length === 3, 'Batch ZIP does not contain all photos', files.map(file => file.name));
      const names = files.map(file => file.name);
      assert(new Set(names.map(name => name.toLocaleLowerCase('ru'))).size === 3, 'Batch ZIP contains duplicate names', names);
      assert(names.some(name => /_2\.webp$/i.test(name)), 'Duplicate source basenames were not safely disambiguated', names);
      const decoded = [];
      for (const entry of files) {
        const buffer = await entry.async('nodebuffer');
        const metadata = await sharp(buffer).metadata();
        assert(metadata.width > 0 && metadata.height > 0, `ZIP image cannot be decoded: ${entry.name}`, metadata);
        decoded.push({ name: entry.name, width: metadata.width, height: metadata.height, bytes: buffer.length });
      }
      await page.waitForFunction(() => document.querySelector('.actions .btn.gold')?.disabled === false);
      const secondPromise = page.waitForEvent('download', { timeout: 120000 });
      await allButton.click();
      const secondDownload = await secondPromise;
      const secondTarget = await saveDownload(secondDownload, 'photos-batch-second.zip');
      const secondZip = await JSZip.loadAsync(fs.readFileSync(secondTarget), { checkCRC32: true });
      const secondFiles = Object.values(secondZip.files).filter(entry => !entry.dir);
      for (const entry of secondFiles) {
        const buffer = await entry.async('nodebuffer');
        const metadata = await sharp(buffer).metadata();
        assert(metadata.width > 0 && metadata.height > 0, `Second ZIP image cannot be decoded: ${entry.name}`, metadata);
      }
      await page.waitForFunction(() => document.querySelector('.actions .btn.gold')?.disabled === false);
      assert(report.downloads.length === downloadEventsBefore + 2, 'Batch ZIP did not complete exactly twice', report.downloads.slice(downloadEventsBefore));
      assert(secondFiles.length === 3, 'Second batch ZIP lost files', secondFiles.map(entry => entry.name));
      return { names, decoded, secondNames: secondFiles.map(entry => entry.name) };
    });

    await check('Удалённое фото можно добавить повторно, остальные записи и настройки сохраняются', async () => {
      const before = await page.evaluate(() => ({ current: window.NEXPhotoState.current(), ids: window.NEXPhotoState.ids(), pos: state.pos }));
      const removedFile = photoFiles[before.current];
      const removedId = before.ids[before.current];
      await page.locator('.photo-close').click();
      await page.waitForFunction(() => window.NEXPhotoState.count() === 2);
      const afterRemove = await page.evaluate(() => ({ ids: window.NEXPhotoState.ids(), pos: state.pos }));
      assert(!afterRemove.ids.includes(removedId) && before.ids.filter(id => id !== removedId).every(id => afterRemove.ids.includes(id)), 'Removing one photo changed another record', { before, afterRemove });
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.photo-add-action').click()]);
      await chooser.setFiles(removedFile);
      await page.waitForFunction(() => window.NEXPhotoState.count() === 3);
      const afterReadd = await page.evaluate(() => ({ ids: window.NEXPhotoState.ids(), pos: state.pos }));
      assert(afterReadd.ids.length === 3 && !afterReadd.ids.includes(removedId) && new Set(afterReadd.ids).size === 3, 'Re-added photo did not receive a new unique id', { removedId, afterReadd });
      assert(afterReadd.pos === before.pos, 'Repeated upload reset editor settings', { before, afterReadd });
      return { removedId, afterRemove, afterReadd };
    });

    let sourceVideo;
    await check('Создание короткого горизонтального WebM со звуком для реального видеоконвейера', async () => {
      sourceVideo = await createVideoPayload(page, { name: 'Тестовый объект — горизонтальное видео.webm', width: 640, height: 360, durationMs: 3400, withAudio: true });
      assert(sourceVideo.buffer.length > 20_000, 'Synthetic video is unexpectedly small', sourceVideo.buffer.length);
      const sourceMetadata = await inspectVideoBuffer(page, sourceVideo.buffer, sourceVideo.mimeType);
      assert(sourceMetadata.width === 640 && sourceMetadata.height === 360, 'Synthetic video has wrong dimensions', sourceMetadata);
      assert(sourceMetadata.duration && sourceMetadata.duration > 2.5, 'Synthetic video duration is invalid', sourceMetadata);
      assert(sourceMetadata.frameVariance > 80, 'Synthetic video appears blank', sourceMetadata);
      return { bytes: sourceVideo.buffer.length, mimeType: sourceVideo.mimeType, sourceMetadata };
    });

    await check('Загрузка видео, Light-улучшение и переход в Pro без потери состояния', async () => {
      await page.getByRole('button', { name: 'Видео', exact: true }).click();
      await page.getByRole('button', { name: 'Light', exact: true }).click();
      await page.locator('#vxFile').setInputFiles(sourceVideo);
      await page.waitForFunction(() => {
        const metadata = window.NEXVideoRuntime?.metadata?.();
        return metadata?.width === 640 && metadata?.height === 360 && metadata?.duration > 2;
      }, null, { timeout: 30000 });
      await page.getByRole('button', { name: /Улучшить видео/ }).click();
      await page.waitForFunction(() => document.getElementById('vxEnhanceMode')?.value === 'auto' && document.getElementById('vxEnhance')?.checked);
      const filter = await page.locator('#vxVideo').evaluate(video => video.style.filter);
      assert(filter && filter !== 'none', 'Light video enhancement did not activate a real preview filter', filter);
      await page.getByRole('button', { name: 'Pro', exact: true }).click();
      const metadata = await page.evaluate(() => window.NEXVideoRuntime.metadata());
      assert(metadata.width === 640 && metadata.duration > 2, 'Video state was lost when switching to Pro', metadata);
      assert(await page.locator('#videoManualAdjustments input[type="range"]').count() === 8, 'Expected eight manual video adjustment sliders');
      return { metadata, filter };
    });

    await check('Pro-видео: пресет, ручная коррекция, стабилизация и пользовательское качество', async () => {
      await page.locator('.group:has(#vxEnhanceToggle) > h4').click();
      await page.locator('#vxEnhanceToggle').click();
      await page.locator('#vxControls > h4').first().click();
      await page.locator('#vxEnhanceMode').selectOption('interior');
      await page.locator('#vxAdjustExposure').evaluate(input => {
        input.value = '18';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.locator('#vxStabilizeLevel').selectOption('strong');
      assert(await page.locator('#vxStabilize').isChecked(), 'Selecting a stabilization level did not enable stabilization');
      const warning = await page.locator('#vxStabilizeWarning').textContent();
      assert(/12%/.test(warning), 'Strong stabilization warning is not explicit', warning);
      await page.locator('#vxVideoQualityMode [data-vq="custom"]').click();
      await page.locator('#vxCustomResolution').selectOption('480');
      await page.locator('#vxCustomFps').selectOption('15');
      await page.locator('#vxCustomBitrate').evaluate(input => {
        input.value = '2';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.locator('#vxOutputFormat').selectOption('mp4');
      const settings = await page.evaluate(() => ({
        quality: window.NEXVideoRuntime.quality(),
        dimensions: window.NEXVideoRuntime.dimensions(),
        bitrate: window.NEXVideoRuntime.bitrate(),
        fps: window.NEXVideoRuntime.fps()
      }));
      assert(settings.quality === 'custom' && settings.fps === 15, 'Custom video settings were not applied', settings);
      assert(Math.max(...settings.dimensions) <= 480 && settings.bitrate === 2_000_000, 'Custom resolution/bitrate is incorrect', settings);
      return settings;
    });

    await check('Восемь ключевых видеопрофилей дают различимую цветокоррекцию', async () => {
      const modes = ['light', 'warm', 'contrast', 'vivid', 'premium', 'soft', 'evening', 'selling'];
      const filters = {};
      for (const mode of modes) {
        await page.locator('#vxEnhanceMode').selectOption(mode);
        await page.waitForTimeout(35);
        filters[mode] = await page.locator('#vxVideo').evaluate(video => video.style.filter);
      }
      const unique = new Set(Object.values(filters));
      assert(unique.size === modes.length, 'Key video profiles produce duplicate preview filters', filters);
      assert(Object.values(filters).every(filter => filter && filter !== 'none'), 'A video profile did not activate real correction', filters);
      return filters;
    });

    await check('Светлые темы остаются читаемыми в загруженном видео-режиме', async () => {
      const states = [];
      for (const theme of ['classic', 'paper', 'mist']) {
        await page.evaluate(name => applyBgTheme(name), theme);
        await page.waitForTimeout(220);
        const state = await page.evaluate(() => ({
          brand: getComputedStyle(document.querySelector('.brand')).color,
          toolbar: getComputedStyle(document.getElementById('vxCaptureFrame')).color,
          toolbarBackground: getComputedStyle(document.getElementById('vxCaptureFrame')).backgroundColor,
          field: getComputedStyle(document.getElementById('vxEnhanceMode')).color,
          fieldBackground: getComputedStyle(document.getElementById('vxEnhanceMode')).backgroundColor,
          panelText: getComputedStyle(document.querySelector('.voice-mix-box label')).color
        }));
        assert(state.brand !== 'rgb(255, 255, 255)' && state.panelText !== 'rgb(255, 255, 255)', `Video labels stayed white in ${theme}`, state);
        await page.screenshot({ path: path.join(RESULTS_DIR, `theme-${theme}-video.png`), fullPage: true });
        states.push({ theme, state });
      }
      await page.evaluate(() => applyBgTheme('dark'));
      return states;
    });

    await check('Умный выбор кадров обложки и скачивание квадратной обложки', async () => {
      await page.locator('#vxCoverAspect').selectOption('1:1');
      await page.getByRole('button', { name: 'Найти удачные кадры' }).click();
      await page.waitForFunction(() => document.querySelectorAll('#vxCoverCandidates .cover-candidate').length >= 2, null, { timeout: 60000 });
      const candidateCount = await page.locator('#vxCoverCandidates .cover-candidate').count();
      const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
      await page.getByRole('button', { name: 'Создать и скачать обложку' }).click();
      const download = await downloadPromise;
      const target = await saveDownload(download, 'video-cover.jpg');
      const metadata = await sharp(target).metadata();
      assert(metadata.width === metadata.height && metadata.width > 300, 'Cover does not honor 1:1 aspect ratio', metadata);
      return { candidateCount, metadata };
    });

    await check('Фото каждую секунду: весь короткий ролик, реальный WebP ZIP и галерея результатов', async () => {
      const before = await page.locator('#vxFramesPanel').evaluate(panel => ({ hidden: panel.hidden, display: getComputedStyle(panel).display }));
      assert(before.hidden && before.display === 'none', 'Frame extraction panel did not stay collapsed until requested', before);
      await page.locator('#vxFramesToggle').click();
      await page.locator('#vxFramesPanel').waitFor({ state: 'visible' });
      await page.locator('#vxFramesAdvanced > summary').click();
      await page.locator('#vxFramesFormat').selectOption('webp');
      await page.locator('#vxFramesQuality').selectOption('92');
      await page.locator('#vxFramesResolution').selectOption('720');
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 90000 }),
        page.locator('#vxFramesEverySecond').click()
      ]);
      const target = await saveDownload(download, 'video-frames.zip');
      const zip = await JSZip.loadAsync(fs.readFileSync(target), { checkCRC32: true });
      const files = Object.values(zip.files).filter(entry => !entry.dir);
      assert(files.length === 4, 'A 3.4-second video should yield frames at 0, 1, 2 and 3 seconds', files.map(file => file.name));
      const frames = [];
      for (const entry of files) {
        const buffer = await entry.async('nodebuffer');
        const metadata = await sharp(buffer).stats();
        const info = await sharp(buffer).metadata();
        const channelDeviation = Math.max(...metadata.channels.map(channel => channel.stdev));
        assert(info.format === 'webp' && info.width === 640 && info.height === 360, `Frame format or dimensions are incorrect: ${entry.name}`, info);
        assert(channelDeviation > 8, `Extracted frame appears black or blank: ${entry.name}`, metadata.channels);
        frames.push({ name: entry.name, width: info.width, height: info.height, deviation: channelDeviation });
      }
      const state = await page.evaluate(() => ({ gallery: document.querySelectorAll('.frame-result').length, results: window.NEXVideoRuntime.frameResults(), plan: window.NEXVideoRuntime.framePlan(document.getElementById('vxVideo').duration) }));
      assert(state.gallery === 4 && state.results.length === 4 && state.plan.interval === 1, 'Frame gallery or one-second plan is incorrect', state);
      return { before, frames, state };
    });

    await check('Лимит кадров 60: предупреждение до запуска, автоинтервал, восемь пакетов и CRC', async () => {
      const longSource = path.join(RESULTS_DIR, 'video-source-65s.mp4');
      execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=5', '-t', '65.2', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-pix_fmt', 'yuv420p', longSource]);
      await page.locator('#vxFile').setInputFiles(longSource);
      await page.waitForFunction(() => window.NEXVideoRuntime.metadata().duration > 65, null, { timeout: 30000 });
      const dialogsBefore = report.dialogs.length;
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 120000 }),
        page.locator('#vxFramesEverySecond').click()
      ]);
      const target = await saveDownload(download, 'video-frames-safe-limit.zip');
      const zip = await JSZip.loadAsync(fs.readFileSync(target), { checkCRC32: true });
      const files = Object.values(zip.files).filter(entry => !entry.dir);
      const state = await page.evaluate(() => ({ plan: window.NEXVideoRuntime.framePlan(document.getElementById('vxVideo').duration), gallery: document.querySelectorAll('.frame-result').length, status: document.getElementById('vxFramesStatus').textContent }));
      const warning = report.dialogs.slice(dialogsBefore).map(item => item.message).join(' ');
      assert(files.length === 60 && state.gallery === 60, 'Automatic safety limit did not produce exactly 60 verified frames', { files: files.length, state });
      assert(state.plan.safeLimit === 60 && state.plan.adjusted && state.plan.interval > 1 && state.plan.batches === 8, 'Automatic frame plan is incorrect', state.plan);
      assert(/60/.test(warning) && /интервал/i.test(warning), 'Safety warning was not shown before the long extraction', warning);
      for (const entry of [files[0], files.at(-1)]) {
        const buffer = await entry.async('nodebuffer');
        const info = await sharp(buffer).metadata();
        assert(info.width === 160 && info.height === 90, `Long-video frame is invalid: ${entry.name}`, info);
      }
      await page.locator('#vxFile').setInputFiles(sourceVideo);
      await page.waitForFunction(() => window.NEXVideoRuntime.metadata().width === 640 && window.NEXVideoRuntime.metadata().duration > 3, null, { timeout: 30000 });
      return { warning, files: files.length, state, first: files[0].name, last: files.at(-1).name };
    });

    await check('Запись речи с разрешённым микрофоном, пауза, сохранение и выбор источников субтитров', async () => {
      await page.getByRole('button', { name: /Запись речи/ }).click();
      await page.waitForFunction(() => document.body.classList.contains('voice-recording'), null, { timeout: 15000 });
      await page.waitForTimeout(900);
      await page.getByRole('button', { name: /Стоп \/ пауза/ }).click();
      await page.waitForFunction(() => document.body.classList.contains('voice-paused'), null, { timeout: 15000 });
      await page.getByRole('button', { name: /Сохранить/ }).click();
      await page.waitForFunction(() => document.getElementById('vxVoiceStatus')?.textContent.includes('Озвучка сохранена'), null, { timeout: 15000 });
      assert(await page.locator('#vxVoiceMix').isVisible(), 'Audio mix controls did not appear after saving narration');
      await page.getByRole('button', { name: /Работа с субтитрами/ }).click();
      const language = await page.locator('#vxWhisperLanguage').inputValue();
      const languageOptions = await page.locator('#vxWhisperLanguage option').evaluateAll(options => options.map(option => option.value));
      assert(language === 'ru' && languageOptions.join(',') === 'ru,en', 'Speech language controls regressed', { language, languageOptions });
      await page.locator('#vxSubtitleSource').selectOption('both');
      const note = await page.locator('.speech-source-note').textContent();
      assert(/одновременн.+Whisper не выполняет разделение говорящих/i.test(note), 'Overlap limitation is not explained for two tracks', note);
      await page.locator('#vxSubtitleSource').selectOption('mix');
      assert(/реальный микс/.test(await page.locator('.speech-source-note').textContent()), 'Mix source explanation is missing');
      await page.evaluate(() => window.NEXVideoRuntime.cancelWhisper());
      assert(/Отмена распознавания/.test(await page.locator('#vxRecognizeStatus').textContent()), 'Whisper cancellation state did not update');
      return { savedStatus: await page.locator('#vxVoiceStatus').textContent(), overlapNote: note, language, languageOptions };
    });

    await check('Стили/анимации субтитров реально меняют отрисовку и поддерживают длинный русский текст', async () => {
      const srt = '1\n00:00:00,000 --> 00:00:02,900\nПремиальная сверхдлинноесловодляпроверкипереноса квартира — уютно, светло и рядом парк 🏡';
      await page.locator('#vxWhisperText').evaluate((textarea, value) => {
        textarea.value = value;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }, srt);
      await page.locator('#vxSubtitleStyle').selectOption('real-estate');
      await page.locator('#vxSubtitleMotion').selectOption('key-word');
      await page.locator('#vxSubtitleLines').evaluate(input => { input.value = '3'; input.dispatchEvent(new Event('input', { bubbles: true })); });
      await page.locator('#vxSubtitleWords').evaluate(input => { input.value = '4'; input.dispatchEvent(new Event('input', { bubbles: true })); });
      await page.evaluate(async () => {
        const video = document.getElementById('vxVideo');
        await new Promise(resolve => {
          const timer = setTimeout(resolve, 1200);
          video.addEventListener('seeked', () => { clearTimeout(timer); resolve(); }, { once: true });
          video.currentTime = .9;
        });
        window.NEXVideoPreview.draw();
      });
      const first = await canvasDigest(page, '#vxLiveOverlay');
      await page.locator('#vxSubtitleStyle').selectOption('news');
      await page.locator('#vxSubtitleMotion').selectOption('typewriter');
      await page.evaluate(() => window.NEXVideoPreview.draw());
      const second = await canvasDigest(page, '#vxLiveOverlay');
      assert(first !== second, 'Changing subtitle style/motion did not alter overlay pixels', { first, second });
      assert((await page.locator('#vxSubtitleStyle option').count()) >= 16, 'Subtitle style list regressed');
      assert((await page.locator('#vxSubtitleMotion option').count()) >= 16, 'Subtitle animation list regressed');
      return { first, second, styles: await page.locator('#vxSubtitleStyle option').count(), motions: await page.locator('#vxSubtitleMotion option').count() };
    });

    let exportedVideoPath;
    await check('Финальный MP4 H.264/AAC со стабилизацией, цветом, логотипом, звуком и встроенными субтитрами', async () => {
      const dialogsBefore = report.dialogs.length;
      const downloadPromise = page.waitForEvent('download', { timeout: 180000 });
      await page.getByRole('button', { name: 'Обработать и скачать видео' }).click();
      await page.waitForFunction(() => document.getElementById('vxExport')?.disabled === true);
      await page.evaluate(() => document.getElementById('vxExport')?.click());
      const download = await downloadPromise;
      exportedVideoPath = await saveDownload(download, 'video-export.mp4');
      await page.waitForFunction(() => document.getElementById('vxExport')?.disabled === false, null, { timeout: 30000 });
      assert(report.dialogs.length === dialogsBefore, 'Video export displayed an error dialog', report.dialogs.slice(dialogsBefore));
      const buffer = fs.readFileSync(exportedVideoPath);
      const signature = buffer.subarray(4, 8).toString('ascii');
      const metadata = await inspectVideoBuffer(page, buffer, 'video/mp4');
      const probe = probeMediaFile(exportedVideoPath);
      assert(metadata.width === 480 && metadata.height === 270, 'Exported video has wrong custom dimensions', metadata);
      assert(metadata.duration && Math.abs(metadata.duration - 3.4) < .9, 'Exported video duration is incorrect', metadata);
      assert(metadata.frameVariance > 80 && metadata.frameMean > 5, 'Exported video contains a black/blank frame', metadata);
      assert(signature === 'ftyp' && /mp4|mov/.test(probe.container), 'Downloaded .mp4 does not contain a real ISO BMFF/MP4 container', { signature, probe });
      assert(probe.video?.codec_name === 'h264' && probe.audio?.codec_name === 'aac', 'Final MP4 is missing H.264/AAC tracks', probe);
      const firstFrame = await extractFrameStats(exportedVideoPath, .08, 'video-export-first.png');
      const subtitleFrame = await extractFrameStats(exportedVideoPath, .9, 'video-export-subtitles.png');
      const lastFrame = await extractFrameStats(exportedVideoPath, Math.max(.1, probe.duration - .18), 'video-export-last.png');
      for (const frame of [firstFrame, subtitleFrame, lastFrame]) assert(frame.mean > 5 && frame.deviation > 5, 'Exported stabilized frame is blank or black', frame);
      const runtime = await page.evaluate(() => ({
        output: window.NEXVideoRuntime.output() && { container: window.NEXVideoRuntime.output().container, metadata: window.NEXVideoRuntime.output().metadata },
        stages: window.NEXVideoRuntime.processingStages().map(stage => stage.text)
      }));
      assert(runtime.output?.container === 'mp4' && runtime.output.metadata.videoCodec === 'h264' && runtime.output.metadata.audioCodec === 'aac', 'Runtime verification did not confirm MP4 H.264/AAC', runtime.output);
      assert(runtime.stages.some(text => /субтитр/i.test(text)) && runtime.stages.some(text => /стабилиз/i.test(text)), 'Real processing stages did not include subtitles and stabilization', runtime.stages);
      assert(!runtime.stages.some(text => /Браузер не создал выходной видеофайл/.test(text)), 'Legacy empty-recorder failure reappeared', runtime.stages);
      const metrics = await page.locator('#vxOutputMetrics').textContent();
      assert(/Итоговый файл проверен/.test(metrics), 'Output verification metrics were not displayed', metrics);
      return { bytes: buffer.length, signature, metadata, probe, firstFrame, subtitleFrame, lastFrame, runtime, metrics };
    });

    await check('Повторная загрузка экспортированного файла определяется как видео', async () => {
      const buffer = fs.readFileSync(exportedVideoPath);
      await page.locator('#vxFile').setInputFiles({ name: 'повторная-проверка.mp4', mimeType: 'video/mp4', buffer });
      await page.waitForFunction(() => {
        const metadata = window.NEXVideoRuntime?.metadata?.();
        return metadata?.width === 480 && metadata?.height === 270 && metadata?.duration > 2;
      }, null, { timeout: 30000 });
      const metadata = await page.evaluate(() => window.NEXVideoRuntime.metadata());
      assert(metadata.width > 0 && metadata.height > 0, 'Re-uploaded output has no video dimensions', metadata);
      return metadata;
    });

    await check('Отмена повторного видеоэкспорта и восстановление готовности интерфейса', async () => {
      const downloadsBefore = report.downloads.length;
      await page.getByRole('button', { name: 'Обработать и скачать видео' }).click();
      await page.waitForFunction(() => !document.getElementById('vxCancelExport')?.classList.contains('context-hidden'));
      await page.getByRole('button', { name: /Отменить обработку/ }).click();
      await page.waitForFunction(() => document.getElementById('vxExport')?.disabled === false, null, { timeout: 30000 });
      await page.waitForTimeout(900);
      assert(report.downloads.length === downloadsBefore, 'Cancelled export unexpectedly created a download');
      assert(!(await page.locator('#vxExport').isDisabled()), 'Export button remained disabled after cancellation');
      return { progress: await page.locator('#vxProgressText').textContent() };
    });

    await check('Вертикальное увеличенное видео: улучшение, экспорт, декодирование и повторная загрузка', async () => {
      const vertical = await createVideoPayload(page, { name: 'Вертикальный объект — увеличенный тест.webm', width: 360, height: 640, durationMs: 8200, withAudio: true });
      await page.locator('#vxFile').setInputFiles(vertical);
      await page.waitForFunction(() => {
        const metadata = window.NEXVideoRuntime?.metadata?.();
        return metadata?.width === 360 && metadata?.height === 640 && metadata?.duration > 7;
      }, null, { timeout: 30000 });
      if (await page.locator('#vxStabilize').isChecked()) await page.locator('#vxStabilize').uncheck();
      await page.locator('#vxEnhanceMode').selectOption('selling');
      await page.locator('#vxVideoQualityMode [data-vq="smart"]').click();
      await page.locator('#vxOutputFormat').selectOption('webm');
      const downloadPromise = page.waitForEvent('download', { timeout: 180000 });
      await page.getByRole('button', { name: 'Обработать и скачать видео' }).click();
      const download = await downloadPromise;
      const target = await saveDownload(download, 'video-vertical-extended.webm');
      await page.waitForFunction(() => document.getElementById('vxExport')?.disabled === false, null, { timeout: 30000 });
      const buffer = fs.readFileSync(target);
      const decoded = await inspectVideoBuffer(page, buffer, 'video/webm');
      assert(decoded.width === 360 && decoded.height === 640, 'Vertical export lost its orientation or dimensions', decoded);
      assert(decoded.duration && Math.abs(decoded.duration - 8.2) < 1.1, 'Extended video duration is incorrect', decoded);
      assert(decoded.frameVariance > 80 && decoded.frameMean > 5, 'Vertical export has no usable video frame', decoded);
      await page.locator('#vxFile').setInputFiles({ name: 'vertical-reupload.webm', mimeType: 'video/webm', buffer });
      await page.waitForFunction(() => window.NEXVideoRuntime?.metadata?.().width === 360 && window.NEXVideoRuntime?.metadata?.().height === 640, null, { timeout: 30000 });
      return { bytes: buffer.length, decoded, reuploaded: await page.evaluate(() => window.NEXVideoRuntime.metadata()) };
    });

    await check('Адаптивность: телефон в портретной и горизонтальной ориентации', async () => {
      const states = [];
      for (const viewport of [{ width: 390, height: 844, name: 'portrait' }, { width: 844, height: 390, name: 'landscape' }]) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.waitForFunction(() => document.documentElement.clientWidth > 0);
        const geometry = await page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          headerWidth: document.querySelector('header')?.getBoundingClientRect().width,
          stageWidth: document.getElementById('stage')?.getBoundingClientRect().width,
          minText: Math.min(...[...document.querySelectorAll('button, label, small')].filter(node => {
            const style = getComputedStyle(node);
            const box = node.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
          }).map(node => parseFloat(getComputedStyle(node).fontSize)).filter(Number.isFinite))
        }));
        assert(geometry.scrollWidth <= geometry.clientWidth + 2, `Horizontal overflow in ${viewport.name}`, geometry);
        assert(geometry.stageWidth > 300, `Editor stage is too narrow in ${viewport.name}`, geometry);
        assert(geometry.minText >= 9.5, `Unreadably small text in ${viewport.name}`, geometry);
        const screenshotPath = path.join(RESULTS_DIR, `responsive-${viewport.name}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        states.push({ viewport, geometry, screenshotPath });
      }
      return states;
    });

    await check('Service worker, версия кэша и офлайн-загрузка оболочки', async () => {
      const swContext = await browser.newContext({ viewport: { width: 1100, height: 760 }, serviceWorkers: 'allow' });
      const swPage = await swContext.newPage();
      const swErrors = [];
      swPage.on('pageerror', error => swErrors.push(error.message));
      swPage.on('console', message => { if (message.type() === 'error') swErrors.push(message.text()); });
      try {
        await swPage.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
        const state = await swPage.evaluate(async () => {
          const registration = await navigator.serviceWorker.ready;
          if (!navigator.serviceWorker.controller) {
            await new Promise(resolve => {
              const timer = setTimeout(resolve, 3000);
              navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(timer); resolve(); }, { once: true });
            });
          }
          const cacheNames = await caches.keys();
          const cached = [];
          for (const name of cacheNames) {
            const cache = await caches.open(name);
            cached.push(...(await cache.keys()).map(request => request.url));
          }
          return { active: !!registration.active, scope: registration.scope, controlled: !!navigator.serviceWorker.controller, cacheNames, cached };
        });
        assert(state.active && state.controlled, 'Service worker is not active/controlling the page', state);
        assert(state.cacheNames.includes('nex-estate-media-studio-v2-2-media-fixes'), 'Expected v2.2 cache is missing', state.cacheNames);
        assert(!state.cacheNames.some(name => /v2-1/.test(name)), 'Old v2.1 cache was not removed', state.cacheNames);
        for (const asset of ['index.html', 'photo-engine.js', 'studio-upgrade.js', 'studio-upgrade.css']) {
          assert(state.cached.some(url => url.endsWith(asset)), `Service worker did not cache ${asset}`, state.cached);
        }
        await swContext.setOffline(true);
        await swPage.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
        await swPage.waitForFunction(() => document.documentElement.classList.contains('studio-upgrade-ready'));
        assert((await swPage.getByRole('button', { name: 'Фото', exact: true }).count()) === 1, 'Offline app shell did not render');
        assert(swErrors.length === 0, 'Service worker/offline run emitted errors', swErrors);
        return state;
      } finally {
        await swContext.setOffline(false).catch(() => {});
        await swContext.close();
      }
    });

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: path.join(RESULTS_DIR, 'final-desktop-video.png'), fullPage: true });
    const unexpectedConsole = report.console.filter(entry => entry.type === 'error' || entry.type === 'pageerror');
    await check('Нет необработанных ошибок JavaScript/console', async () => {
      assert(unexpectedConsole.length === 0, 'Unexpected browser errors were captured', unexpectedConsole);
      return { messages: report.console.length, errors: unexpectedConsole.length };
    });

    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.failure = { message: error.message, stack: error.stack, details: error.details || null };
    if (page) {
      try { await page.screenshot({ path: path.join(RESULTS_DIR, 'failure.png'), fullPage: true }); } catch {}
    }
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    report.projectRoot = PROJECT_ROOT;
    fs.writeFileSync(path.join(RESULTS_DIR, 'e2e-report.json'), JSON.stringify(report, null, 2), 'utf8');
    await browser?.close();
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
