/* NEX ESTATE Media Studio — adaptive local photo engine.
   The engine is deliberately dependency-free: it analyses a small sample, then
   applies white-balance, tonal recovery, colour correction, light denoising and
   restrained local detail enhancement to the real output pixels. */
(() => {
  'use strict';

  const cache = new WeakMap();
  const LEGACY_MODES = {
    classic: 'auto', balanced: 'auto', sharp: 'sharp-plus', premium: 'premium-boost'
  };
  const PROFILES = {
    auto:               { exposure: .74, exposureBias: .20, minExposure: .18, contrast: .92, contrastBias: .04, saturation: .88, saturationBias: .04, shadows: 1.05, shadowBias: .018, highlights: 1.12, clarity: .64, clarityBias: .012, sharpnessBias: .012, denoise: .50, warmth: 0 },
    natural:            { exposure: .58, exposureBias: .025, minExposure: -.07, contrast: .66, contrastBias: .01, saturation: .62, saturationBias: .01, shadows: .78, highlights: .92, clarity: .38, denoise: .48, warmth: 1 },
    bright:             { exposure: .60, exposureBias: .18, minExposure: .12, contrast: .56, contrastBias: .015, saturation: .72, saturationBias: .045, shadows: 1.24, shadowBias: .035, highlights: 1.30, clarity: .40, denoise: .42, warmth: 1 },
    professional:       { exposure: .66, exposureBias: .075, minExposure: .02, contrast: 1.08, contrastBias: .085, saturation: .72, saturationBias: .035, shadows: .92, highlights: 1.22, clarity: .78, clarityBias: .025, sharpnessBias: .018, denoise: .54, warmth: 0 },
    interior:           { exposure: .58, exposureBias: .17, minExposure: .11, contrast: .72, contrastBias: .025, saturation: .62, saturationBias: .025, shadows: 1.34, shadowBias: .05, highlights: 1.38, clarity: .52, clarityBias: .012, denoise: .62, warmth: -2 },
    exterior:           { exposure: .56, exposureBias: .065, minExposure: .015, contrast: 1.06, contrastBias: .09, saturation: .88, saturationBias: .085, shadows: .76, highlights: 1.44, clarity: .74, clarityBias: .02, sharpnessBias: .016, denoise: .38, warmth: 1 },
    soft:               { exposure: .48, exposureBias: .07, minExposure: .015, contrast: .48, contrastBias: -.045, saturation: .55, saturationBias: .015, shadows: .96, highlights: 1.18, clarity: .14, denoise: .78, warmth: 2 },
    detail:             { exposure: .54, exposureBias: .04, minExposure: -.01, contrast: 1.14, contrastBias: .10, saturation: .66, saturationBias: .02, shadows: .72, highlights: 1.08, clarity: 1.16, clarityBias: .04, sharpnessBias: .045, denoise: .40, warmth: 0 },
    vivid:              { exposure: .55, exposureBias: .075, minExposure: .025, contrast: 1.02, contrastBias: .11, saturation: 1.18, saturationBias: .19, shadows: .86, highlights: 1.20, clarity: .72, clarityBias: .025, sharpnessBias: .018, denoise: .38, warmth: 1 },
    contrast:           { exposure: .46, exposureBias: .045, minExposure: 0, contrast: 1.22, contrastBias: .18, saturation: .78, saturationBias: .055, shadows: .62, highlights: 1.16, clarity: .88, clarityBias: .035, sharpnessBias: .02, denoise: .36, warmth: 0 },
    crisp:              { exposure: .50, exposureBias: .06, minExposure: .02, contrast: 1.16, contrastBias: .13, saturation: .76, saturationBias: .04, shadows: .72, highlights: 1.16, clarity: 1.22, clarityBias: .055, sharpnessBias: .06, denoise: .30, warmth: 0 },
    commercial:         { exposure: .52, exposureBias: .13, minExposure: .085, contrast: 1.08, contrastBias: .11, saturation: .92, saturationBias: .115, shadows: 1.02, shadowBias: .025, highlights: 1.30, clarity: .86, clarityBias: .03, sharpnessBias: .025, denoise: .42, warmth: 1 },
    listing:            { exposure: .54, exposureBias: .15, minExposure: .10, contrast: .92, contrastBias: .07, saturation: .86, saturationBias: .08, shadows: 1.18, shadowBias: .045, highlights: 1.34, clarity: .72, clarityBias: .02, sharpnessBias: .018, denoise: .46, warmth: 0 },
    'interior-bright':  { exposure: .54, exposureBias: .23, minExposure: .17, contrast: .68, contrastBias: .035, saturation: .66, saturationBias: .045, shadows: 1.42, shadowBias: .065, highlights: 1.50, clarity: .58, clarityBias: .018, sharpnessBias: .012, denoise: .58, warmth: -1 },
    'exterior-bright':  { exposure: .52, exposureBias: .16, minExposure: .105, contrast: 1.00, contrastBias: .085, saturation: .98, saturationBias: .12, shadows: .90, shadowBias: .018, highlights: 1.50, clarity: .80, clarityBias: .025, sharpnessBias: .02, denoise: .34, warmth: 1 },
    'premium-boost':    { exposure: .54, exposureBias: .105, minExposure: .055, contrast: 1.16, contrastBias: .14, saturation: .98, saturationBias: .13, shadows: .88, highlights: 1.32, clarity: .98, clarityBias: .04, sharpnessBias: .035, denoise: .46, warmth: 1 },
    'sharp-plus':       { exposure: .48, exposureBias: .05, minExposure: .01, contrast: 1.18, contrastBias: .14, saturation: .72, saturationBias: .035, shadows: .68, highlights: 1.12, clarity: 1.34, clarityBias: .07, sharpnessBias: .085, denoise: .24, warmth: 0 },
    'bright-selling':   { exposure: .54, exposureBias: .25, minExposure: .18, contrast: .90, contrastBias: .075, saturation: .92, saturationBias: .125, shadows: 1.34, shadowBias: .06, highlights: 1.48, clarity: .72, clarityBias: .025, sharpnessBias: .02, denoise: .42, warmth: 1 },
    'saturated-selling':{ exposure: .50, exposureBias: .12, minExposure: .075, contrast: 1.08, contrastBias: .12, saturation: 1.28, saturationBias: .24, shadows: .96, shadowBias: .025, highlights: 1.34, clarity: .86, clarityBias: .035, sharpnessBias: .028, denoise: .34, warmth: 1 }
  };

  const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
  const yieldToUI = () => new Promise(resolve => setTimeout(resolve, 0));
  const abortIfNeeded = signal => {
    if (signal?.aborted) throw new DOMException('Операция отменена', 'AbortError');
  };

  function percentile(histogram, total, fraction) {
    const target = total * fraction;
    let sum = 0;
    for (let i = 0; i < histogram.length; i++) {
      sum += histogram[i];
      if (sum >= target) return i;
    }
    return 255;
  }

  function analyse(source) {
    const sample = document.createElement('canvas');
    const size = 128;
    sample.width = size;
    sample.height = size;
    const context = sample.getContext('2d', { alpha: false, willReadFrequently: true });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, 0, 0, size, size);
    const pixels = context.getImageData(0, 0, size, size).data;
    const histogram = new Uint32Array(256);
    let red = 0, green = 0, blue = 0, count = 0;
    let neutralRed = 0, neutralGreen = 0, neutralBlue = 0, neutralCount = 0;
    let colourSpread = 0, noise = 0, noiseCount = 0;
    const luma = new Uint8Array(size * size);

    for (let i = 0, p = 0; i < pixels.length; i += 4, p++) {
      const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
      const y = Math.round(.2126 * r + .7152 * g + .0722 * b);
      luma[p] = y;
      histogram[y]++;
      red += r; green += g; blue += b; count++;
      const high = Math.max(r, g, b), low = Math.min(r, g, b);
      colourSpread += high - low;
      if (high - low < 22 && y > 42 && y < 235) {
        neutralRed += r; neutralGreen += g; neutralBlue += b; neutralCount++;
      }
    }

    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        const i = y * size + x;
        const local = Math.abs(luma[i] - luma[i - 1]) + Math.abs(luma[i] - luma[i - size]);
        if (local < 18) {
          noise += Math.abs(luma[i] * 2 - luma[i - 1] - luma[i + 1]);
          noiseCount++;
        }
      }
    }

    const p10 = percentile(histogram, count, .10);
    const p50 = percentile(histogram, count, .50);
    const p90 = percentile(histogram, count, .90);
    const nr = neutralCount > count * .025 ? neutralRed / neutralCount : red / count;
    const ng = neutralCount > count * .025 ? neutralGreen / neutralCount : green / count;
    const nb = neutralCount > count * .025 ? neutralBlue / neutralCount : blue / count;
    const neutralMean = (nr + ng + nb) / 3 || 1;

    return {
      p10, p50, p90,
      averageLuma: (.2126 * red + .7152 * green + .0722 * blue) / Math.max(1, count),
      dynamicRange: p90 - p10,
      colourSpread: colourSpread / Math.max(1, count),
      noise: noise / Math.max(1, noiseCount),
      whiteBalance: {
        r: clamp(neutralMean / Math.max(1, nr), .90, 1.11),
        g: clamp(neutralMean / Math.max(1, ng), .94, 1.06),
        b: clamp(neutralMean / Math.max(1, nb), .90, 1.11)
      }
    };
  }

  function settingsFor(mode, analysis, adjustments = {}) {
    const normalizedMode = LEGACY_MODES[mode] || mode || 'auto';
    const profile = PROFILES[normalizedMode] || PROFILES.auto;
    const median = analysis.p50 / 255;
    const darkBias = clamp((.51 - median) / .32, -1, 1);
    const flatBias = clamp((112 - analysis.dynamicRange) / 100, -.35, .65);
    const paleBias = clamp((27 - analysis.colourSpread) / 45, -.25, .45);
    const manual = key => clamp(Number(adjustments[key] || 0) / 100, -1, 1);

    const exposureFloor = Number.isFinite(profile.minExposure) ? profile.minExposure : -.38;
    const exposure = clamp(darkBias * .32 * profile.exposure + (profile.exposureBias || 0) + manual('exposure') * .75, exposureFloor, .62);
    const contrast = clamp(1 + flatBias * .18 * profile.contrast + (profile.contrastBias || 0) + manual('contrast') * .28, .78, 1.44);
    const saturation = clamp(1 + paleBias * .21 * profile.saturation + (profile.saturationBias || 0) + manual('saturation') * .38, .78, 1.52);
    const shadows = clamp((.055 + Math.max(0, darkBias) * .16) * profile.shadows + (profile.shadowBias || 0) + manual('shadows') * .12, -.05, .34);
    const highlights = clamp((analysis.p90 > 222 ? .18 : .08) * profile.highlights - manual('highlights') * .12, -.04, .28);
    const noiseFactor = clamp((analysis.noise - 1.6) / 8, 0, 1);
    const denoise = clamp((.025 + noiseFactor * .18) * profile.denoise + Math.max(0, manual('denoise')) * .20, 0, .25);
    const clarity = clamp((.075 + flatBias * .04) * profile.clarity + (profile.clarityBias || 0) + manual('clarity') * .12, 0, .30);
    const sharpness = clamp((.035 + noiseFactor * -.018) * profile.clarity + (profile.sharpnessBias || 0) + manual('sharpness') * .10, 0, .22);
    const warmth = clamp((profile.warmth + Number(adjustments.temperature || 0) / 10) / 100, -.09, .09);
    const wbStrength = normalizedMode === 'soft' ? .54 : normalizedMode === 'bright' ? .66 : .78;

    return {
      mode: normalizedMode,
      exposure, contrast, saturation, shadows, highlights, denoise, clarity, sharpness, warmth,
      wb: {
        r: 1 + (analysis.whiteBalance.r - 1) * wbStrength + warmth,
        g: 1 + (analysis.whiteBalance.g - 1) * wbStrength,
        b: 1 + (analysis.whiteBalance.b - 1) * wbStrength - warmth
      }
    };
  }

  function basePixel(r, g, b, settings) {
    let rr = r / 255 * settings.wb.r;
    let gg = g / 255 * settings.wb.g;
    let bb = b / 255 * settings.wb.b;
    const before = .2126 * rr + .7152 * gg + .0722 * bb;
    const exposure = Math.pow(2, settings.exposure);
    rr *= exposure; gg *= exposure; bb *= exposure;

    const luma = .2126 * rr + .7152 * gg + .0722 * bb;
    const shadowLift = settings.shadows * Math.pow(1 - clamp(luma), 2);
    // Recover only the brightest part of the range. The previous curve started
    // at midtones and could make an already bright interior visibly darker.
    const highlightPull = settings.highlights * .55 * Math.pow(clamp((luma - .72) / .28), 1.55);
    const toneDelta = shadowLift - highlightPull;
    rr += toneDelta; gg += toneDelta; bb += toneDelta;

    rr = (rr - .5) * settings.contrast + .5;
    gg = (gg - .5) * settings.contrast + .5;
    bb = (bb - .5) * settings.contrast + .5;
    const after = .2126 * rr + .7152 * gg + .0722 * bb;
    rr = after + (rr - after) * settings.saturation;
    gg = after + (gg - after) * settings.saturation;
    bb = after + (bb - after) * settings.saturation;

    // A gentle highlight shoulder prevents the automatic exposure correction
    // from clipping bright walls and windows.
    const shoulder = value => value > .94 ? .94 + Math.tanh((value - .94) / .06) * .06 : value;
    rr = shoulder(rr); gg = shoulder(gg); bb = shoulder(bb);
    if (before < .025) { rr *= .92; gg *= .92; bb *= .92; }
    return [clamp(rr) * 255, clamp(gg) * 255, clamp(bb) * 255];
  }

  async function processCanvas(canvas, settings, { onProgress, signal } = {}) {
    const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true });
    const width = canvas.width, height = canvas.height;
    const pixels = width * height;
    const stripeHeight = pixels > 18_000_000 ? 40 : pixels > 8_000_000 ? 56 : 88;
    const localStrength = pixels > 28_000_000 ? .55 : pixels > 18_000_000 ? .75 : 1;

    for (let y = 0; y < height; y += stripeHeight) {
      abortIfNeeded(signal);
      const from = Math.max(0, y - 1);
      const to = Math.min(height, y + stripeHeight + 1);
      const rows = to - from;
      const image = context.getImageData(0, from, width, rows);
      const data = image.data;
      const transformed = new Float32Array(rows * width * 3);

      for (let p = 0, q = 0; p < data.length; p += 4, q += 3) {
        const next = basePixel(data[p], data[p + 1], data[p + 2], settings);
        transformed[q] = next[0]; transformed[q + 1] = next[1]; transformed[q + 2] = next[2];
      }

      const outputTop = y - from;
      const outputRows = Math.min(stripeHeight, height - y);
      const output = context.createImageData(width, outputRows);
      const target = output.data;
      const detailStrength = (settings.clarity + settings.sharpness) * localStrength;
      const denoise = settings.denoise * localStrength;

      for (let row = 0; row < outputRows; row++) {
        const sourceRow = row + outputTop;
        for (let x = 0; x < width; x++) {
          const sourceIndex = (sourceRow * width + x) * 3;
          const targetIndex = (row * width + x) * 4;
          const left = (sourceRow * width + Math.max(0, x - 1)) * 3;
          const right = (sourceRow * width + Math.min(width - 1, x + 1)) * 3;
          const up = (Math.max(0, sourceRow - 1) * width + x) * 3;
          const down = (Math.min(rows - 1, sourceRow + 1) * width + x) * 3;
          for (let channel = 0; channel < 3; channel++) {
            const centre = transformed[sourceIndex + channel];
            const neighbours = (transformed[left + channel] + transformed[right + channel] + transformed[up + channel] + transformed[down + channel]) * .25;
            const smoothed = centre * (1 - denoise) + neighbours * denoise;
            target[targetIndex + channel] = clamp(smoothed + (centre - neighbours) * detailStrength, 0, 255);
          }
          target[targetIndex + 3] = data[((sourceRow * width + x) * 4) + 3];
        }
      }
      context.putImageData(output, 0, y);
      onProgress?.(Math.min(100, Math.round((y + outputRows) / height * 100)));
      if (pixels > 2_000_000) await yieldToUI();
    }
    return canvas;
  }

  async function getEnhancedCanvas(source, width, height, options = {}) {
    const mode = LEGACY_MODES[options.mode] || options.mode || 'auto';
    const adjustments = options.adjustments || {};
    const adjustmentKey = Object.keys(adjustments).sort().map(key => `${key}:${adjustments[key]}`).join('|');
    const key = `${width}x${height}:${mode}:${adjustmentKey}`;
    const cached = cache.get(source);
    if (cached?.key === key && cached.canvas?.width === width && cached.canvas?.height === height) {
      options.onProgress?.(100);
      return cached.canvas;
    }

    abortIfNeeded(options.signal);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    options.onProgress?.(2);

    const analysis = analyse(source);
    const settings = settingsFor(mode, analysis, adjustments);
    await processCanvas(canvas, settings, {
      signal: options.signal,
      onProgress: value => options.onProgress?.(2 + value * .98)
    });
    cache.set(source, { key, canvas, analysis, settings });
    return canvas;
  }

  function clear(source) {
    if (source) cache.delete(source);
  }

  let webPSupport;
  function supportsWebP() {
    if (webPSupport !== undefined) return webPSupport;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    webPSupport = canvas.toDataURL('image/webp').startsWith('data:image/webp');
    return webPSupport;
  }

  function toBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('Браузер не смог закодировать изображение.')),
      type,
      quality
    ));
  }

  function comparisonReference(canvas, maxDimension = 640) {
    const scale = Math.min(1, maxDimension / Math.max(canvas.width, canvas.height));
    const sample = document.createElement('canvas');
    sample.width = Math.max(1, Math.round(canvas.width * scale));
    sample.height = Math.max(1, Math.round(canvas.height * scale));
    const context = sample.getContext('2d', { alpha: false, willReadFrequently: true });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(canvas, 0, 0, sample.width, sample.height);
    return { canvas: sample, pixels: context.getImageData(0, 0, sample.width, sample.height).data };
  }

  async function decodedBlob(blob) {
    if (typeof createImageBitmap === 'function') {
      try {
        const bitmap = await createImageBitmap(blob);
        return { source: bitmap, close: () => bitmap.close?.() };
      } catch (_) {}
    }
    const url = URL.createObjectURL(blob);
    const image = new Image();
    try {
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('Не удалось проверить закодированное изображение.'));
        image.src = url;
      });
      return { source: image, close: () => URL.revokeObjectURL(url) };
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
  }

  async function scoreEncodedImage(blob, reference) {
    const decoded = await decodedBlob(blob);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = reference.canvas.width;
      canvas.height = reference.canvas.height;
      const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
      const candidate = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const original = reference.pixels;
      let squared = 0, absolute = 0, samples = 0, edgeError = 0, edgeSamples = 0;
      const stride = Math.max(1, Math.floor(Math.max(canvas.width, canvas.height) / 480));
      const luma = (pixels, index) => .2126 * pixels[index] + .7152 * pixels[index + 1] + .0722 * pixels[index + 2];
      for (let y = 0; y < canvas.height; y += stride) {
        for (let x = 0; x < canvas.width; x += stride) {
          const index = (y * canvas.width + x) * 4;
          for (let channel = 0; channel < 3; channel++) {
            const delta = original[index + channel] - candidate[index + channel];
            squared += delta * delta;
            absolute += Math.abs(delta);
            samples++;
          }
          if (x >= stride && y >= stride) {
            const left = index - stride * 4, up = index - stride * canvas.width * 4;
            const originalEdge = Math.abs(luma(original, index) - luma(original, left)) + Math.abs(luma(original, index) - luma(original, up));
            const candidateEdge = Math.abs(luma(candidate, index) - luma(candidate, left)) + Math.abs(luma(candidate, index) - luma(candidate, up));
            edgeError += Math.abs(originalEdge - candidateEdge) * .5;
            edgeSamples++;
          }
        }
      }
      canvas.width = 0; canvas.height = 0;
      const mse = squared / Math.max(1, samples);
      return {
        psnr: mse === 0 ? 99 : 10 * Math.log10(65025 / mse),
        meanError: absolute / Math.max(1, samples),
        edgeError: edgeError / Math.max(1, edgeSamples)
      };
    } finally {
      decoded.close();
    }
  }

  async function smartEncode(canvas, options = {}) {
    const requested = options.format || 'auto';
    if (requested === 'png') {
      const blob = await toBlob(canvas, 'image/png');
      return { blob, format: 'png', extension: 'png', type: 'image/png', quality: null, assessment: 'lossless-png', metrics: null };
    }

    const mode = ['original', 'high', 'small'].includes(options.mode) ? options.mode : 'high';
    const thresholds = {
      original: { psnr: 40.5, meanError: 2.8, edgeError: 5.2, qualities: [.90, .94, .97, .985] },
      high: { psnr: 38.5, meanError: 3.8, edgeError: 7.0, qualities: [.84, .88, .92, .95] },
      small: { psnr: 36.0, meanError: 5.2, edgeError: 9.5, qualities: [.74, .79, .84, .89] }
    };
    const target = thresholds[mode];
    const formats = requested === 'auto'
      ? (supportsWebP() ? ['webp', 'jpeg', 'png'] : ['jpeg', 'png'])
      : [requested === 'webp' && supportsWebP() ? 'webp' : 'jpeg'];
    const reference = comparisonReference(canvas);
    const results = [];
    let completed = 0;
    try {
      for (const format of formats) {
        if (format === 'png') {
          const blob = await toBlob(canvas, 'image/png');
          const metrics = await scoreEncodedImage(blob, reference);
          results.push({ blob, format: 'png', extension: 'png', type: 'image/png', quality: null, metrics, assessment: 'lossless-png', passes: true });
          completed += target.qualities.length;
          options.onProgress?.(Math.min(96, Math.round(completed / (formats.length * target.qualities.length) * 96)));
          await yieldToUI();
          continue;
        }
        let fallback = null, accepted = null;
        for (const quality of target.qualities) {
          abortIfNeeded(options.signal);
          const type = format === 'webp' ? 'image/webp' : 'image/jpeg';
          const blob = await toBlob(canvas, type, quality);
          const metrics = await scoreEncodedImage(blob, reference);
          const passes = metrics.psnr >= target.psnr && metrics.meanError <= target.meanError && metrics.edgeError <= target.edgeError;
          fallback = { blob, format, extension: format === 'jpeg' ? 'jpg' : 'webp', type, quality, metrics, assessment: passes ? 'visually-lossless' : 'best-available', passes };
          completed++;
          options.onProgress?.(Math.min(96, Math.round(completed / (formats.length * target.qualities.length) * 96)));
          if (passes) { accepted = fallback; break; }
          await yieldToUI();
        }
        results.push(accepted || fallback);
      }
      const passing = results.filter(result => result?.passes);
      const selected = passing.length
        ? passing.sort((a, b) => a.blob.size - b.blob.size)[0]
        : results.filter(Boolean).sort((a, b) => b.metrics.psnr - a.metrics.psnr || a.blob.size - b.blob.size)[0];
      if (!selected) throw new Error('Не удалось подобрать безопасный режим сжатия изображения.');
      options.onProgress?.(100);
      return selected;
    } finally {
      reference.canvas.width = 0;
      reference.canvas.height = 0;
    }
  }

  window.NEXPhotoEngine = Object.freeze({
    profiles: Object.keys(PROFILES),
    analyse,
    getEnhancedCanvas,
    clear,
    supportsWebP,
    toBlob,
    smartEncode
  });
})();
