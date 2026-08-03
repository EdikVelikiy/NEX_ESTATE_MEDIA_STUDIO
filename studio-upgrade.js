/* NEX ESTATE Media Studio 2.2 — targeted media export and workflow fixes. */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const create = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const studio = window.NEXStudio = window.NEXStudio || {};
  let toastRegion;
  studio.toast = (message, tone = 'info', timeout = 4200) => {
    if (!toastRegion) {
      toastRegion = create('div', 'studio-toast-region');
      toastRegion.setAttribute('aria-live', 'polite');
      toastRegion.setAttribute('aria-atomic', 'false');
      document.body.appendChild(toastRegion);
    }
    const text = String(message || '');
    [...toastRegion.children].filter(node => node.dataset.message === text).forEach(node => node.remove());
    while (toastRegion.children.length >= 3) toastRegion.firstElementChild?.remove();
    const toast = create('div', `studio-toast toast-${tone}`);toast.dataset.message = text;
    const copy = create('span', '', text);
    const close = create('button', 'toast-close', 'Закрыть');
    close.type = 'button';
    close.onclick = () => toast.remove();
    toast.append(copy, close);toastRegion.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    if (timeout) setTimeout(() => { toast.classList.remove('show');setTimeout(() => toast.remove(), 220); }, timeout);
    return toast;
  };
  window.drawLiveOverlay = () => window.NEXVideoPreview?.draw?.();

  function rangeControl({ id, label, min = -100, max = 100, value = 0, step = 1, unit = '' }) {
    const wrap = create('label', 'studio-range-control');
    const heading = create('span', 'studio-range-heading');
    const title = create('span', '', label);
    const output = create('output', '', `${value}${unit}`);output.htmlFor = id;
    const input = create('input');input.type = 'range';input.id = id;input.min = String(min);input.max = String(max);input.step = String(step);input.value = String(value);input.dataset.unit = unit;
    heading.append(title, output);wrap.append(heading, input);
    input.addEventListener('input', () => { output.textContent = `${input.value}${unit}`; });
    return wrap;
  }

  function field(label, control) {
    const wrap = create('label', 'studio-field');
    wrap.append(create('span', '', label), control);
    return wrap;
  }

  function select(id, options, value) {
    const element = create('select', 'mark-color-select');element.id = id;
    options.forEach(([optionValue, label]) => {
      const option = create('option', '', label);option.value = optionValue;if (optionValue === value) option.selected = true;element.appendChild(option);
    });
    return element;
  }

  function debounce(callback, wait = 120) {
    let timer;
    return (...args) => { clearTimeout(timer);timer = setTimeout(() => callback(...args), wait); };
  }

  function installPhotoControls() {
    const panel = $('photoEnhancePanel');
    if (panel && !$('photoManualAdjustments')) {
      const section = create('div', 'studio-adjustments pro-only-upgrade');section.id = 'photoManualAdjustments';
      section.append(create('strong', 'studio-section-title', 'Точная коррекция'));
      const grid = create('div', 'studio-adjustment-grid');
      [
        ['photoAdjustExposure', 'Экспозиция'], ['photoAdjustTemperature', 'Температура'],
        ['photoAdjustContrast', 'Контраст'], ['photoAdjustSaturation', 'Насыщенность'],
        ['photoAdjustShadows', 'Тени'], ['photoAdjustHighlights', 'Светлые участки'],
        ['photoAdjustClarity', 'Локальный контраст'], ['photoAdjustDenoise', 'Шумоподавление'],
        ['photoAdjustSharpness', 'Резкость']
      ].forEach(([id, label]) => grid.appendChild(rangeControl({ id, label })));
      const reset = create('button', 'mini-action adjustment-reset', 'Сбросить ручную коррекцию');reset.type = 'button';
      reset.onclick = () => { grid.querySelectorAll('input[type="range"]').forEach(input => { input.value = '0';input.dispatchEvent(new Event('input', { bubbles: true })); }); };
      const status = create('small', 'processing-inline-status', 'Автоанализ выполняется локально в браузере.');status.id = 'photoProcessingStatus';
      section.append(grid, reset, status);panel.appendChild(section);

      const rerender = debounce(() => { if (typeof window.render === 'function') window.render(); }, 150);
      grid.addEventListener('input', rerender);
    }

    if (!$('photoOutputMetrics')) {
      const metrics = create('div', 'output-metrics photo-output-metrics');metrics.id = 'photoOutputMetrics';metrics.setAttribute('aria-live', 'polite');
      $('progressBox')?.insertAdjacentElement('afterend', metrics);
    }
    const webpButton = document.querySelector('#fmt button[data-f="webp"]');
    if (webpButton && !window.NEXPhotoEngine?.supportsWebP?.()) {
      webpButton.disabled = true;webpButton.title = 'Этот браузер не кодирует WebP через Canvas.';
    }
  }

  function installVideoEnhancementControls() {
    const panel = $('vxEnhancePanel');
    if (!panel || $('videoManualAdjustments')) return;
    const section = create('div', 'studio-adjustments pro-only-upgrade');section.id = 'videoManualAdjustments';
    section.append(create('strong', 'studio-section-title', 'Точная коррекция видео'));
    const grid = create('div', 'studio-adjustment-grid');
    [
      ['vxAdjustExposure', 'Экспозиция'], ['vxAdjustTemperature', 'Температура'],
      ['vxAdjustContrast', 'Контраст'], ['vxAdjustSaturation', 'Насыщенность'],
      ['vxAdjustShadows', 'Тени'], ['vxAdjustHighlights', 'Светлые участки'],
      ['vxAdjustSharpness', 'Детализация'], ['vxAdjustDenoise', 'Шумоподавление']
    ].forEach(([id, label]) => grid.appendChild(rangeControl({ id, label })));
    const actions = create('div', 'studio-inline-actions');
    const compare = create('button', 'mini-action compare-original', 'Удерживайте: оригинал');compare.type = 'button';compare.id = 'vxCompareOriginal';
    const reset = create('button', 'mini-action adjustment-reset', 'Сбросить коррекцию');reset.type = 'button';
    actions.append(compare, reset);section.append(grid, actions);panel.appendChild(section);

    const refresh = debounce(() => window.NEXVideoRuntime?.redraw?.(), 40);
    grid.addEventListener('input', refresh);
    reset.onclick = () => { grid.querySelectorAll('input[type="range"]').forEach(input => { input.value = '0';input.dispatchEvent(new Event('input', { bubbles: true })); }); };
    const showOriginal = event => { event.preventDefault();const video = $('vxVideo');if (video) video.style.setProperty('filter', 'none', 'important');compare.classList.add('on'); };
    const restore = () => { compare.classList.remove('on');window.NEXVideoRuntime?.redraw?.(); };
    compare.addEventListener('pointerdown', showOriginal);compare.addEventListener('pointerup', restore);compare.addEventListener('pointercancel', restore);compare.addEventListener('pointerleave', restore);
    compare.addEventListener('keydown', event => { if (event.key === ' ' || event.key === 'Enter') showOriginal(event); });
    compare.addEventListener('keyup', restore);compare.addEventListener('blur', restore);
  }

  function installStabilizationControls() {
    const checkbox = $('vxStabilize');const label = checkbox?.closest('label');
    if (!label || $('vxStabilizeLevel')) return;
    const wrap = create('div', 'stabilization-level-wrap pro-only-upgrade');
    const level = select('vxStabilizeLevel', [['light', 'Лёгкая'], ['standard', 'Стандартная'], ['strong', 'Сильная']], 'standard');
    const warning = create('small', 'stabilization-warning', 'Стандартный уровень: баланс коррекции и кадрирования.');warning.id = 'vxStabilizeWarning';
    wrap.append(field('Уровень стабилизации', level), warning);label.insertAdjacentElement('afterend', wrap);
    const sync = () => {
      const messages = {
        light: 'Лёгкая: минимальное кадрирование, корректируются небольшие колебания.',
        standard: 'Стандартная: баланс коррекции и кадрирования.',
        strong: 'Сильная: заметнее устраняет дрожание, но кадрируется примерно до 12% по краям.'
      };
      warning.textContent = messages[level.value];warning.classList.toggle('warning-strong', level.value === 'strong');
      checkbox.checked = true;checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    };
    level.addEventListener('change', sync);
  }

  function installCoverControls() {
    const group = $('vxCoverGroup');if (!group || $('vxCoverAspect')) return;
    const grid = create('div', 'cover-tool-grid');
    const aspect = select('vxCoverAspect', [['source', 'Как в исходнике'], ['16:9', '16:9'], ['9:16', '9:16'], ['1:1', '1:1'], ['4:5', '4:5']], 'source');
    const smart = create('button', 'mini-action', 'Найти удачные кадры');smart.type = 'button';smart.id = 'vxCoverSuggest';
    grid.append(field('Соотношение обложки', aspect), smart);
    const candidates = create('div', 'cover-candidates');candidates.id = 'vxCoverCandidates';candidates.setAttribute('aria-live', 'polite');
    group.insertBefore(grid, $('vxMakeCover'));group.insertBefore(candidates, $('vxMakeCover'));
    smart.onclick = async () => {
      smart.disabled = true;
      try { const result = await window.NEXVideoRuntime?.generateCoverCandidates?.();if (result?.length) studio.toast(`Найдено ${result.length} подходящих кадров.`, 'success'); }
      catch (error) { studio.toast(error?.message || error, 'error'); }
      finally { smart.disabled = false; }
    };
  }

  function installVideoQualityControls() {
    const options = $('vxVideoQualityMode');if (!options || $('vxVideoCustomControls')) return;
    const customButton = create('button', 'quality-option');customButton.type = 'button';customButton.dataset.vq = 'custom';
    customButton.innerHTML = '<b>Пользовательские настройки</b><span>Разрешение, FPS и битрейт вручную.</span><small>Доступно в Pro. Разрешение никогда не увеличивается выше исходного.</small>';
    options.appendChild(customButton);
    const controls = create('div', 'video-custom-controls context-hidden');controls.id = 'vxVideoCustomControls';
    const resolution = select('vxCustomResolution', [['source', 'Исходное'], ['2160', 'До 2160p'], ['1440', 'До 1440p'], ['1080', 'До 1080p'], ['720', 'До 720p'], ['480', 'До 480p']], '1080');
    const fps = select('vxCustomFps', [['source', 'Как в исходнике'], ['30', '30 FPS'], ['25', '25 FPS'], ['24', '24 FPS'], ['15', '15 FPS']], 'source');
    controls.append(field('Разрешение', resolution), field('Частота кадров', fps), rangeControl({ id: 'vxCustomBitrate', label: 'Видеобитрейт', min: 1, max: 36, value: 10, step: 1, unit: ' Мбит/с' }));
    options.insertAdjacentElement('afterend', controls);

    const refresh = () => {
      const custom = window.NEXVideoRuntime?.quality?.() === 'custom';controls.classList.toggle('context-hidden', !custom);updateVideoEstimate();
    };
    customButton.onclick = () => { options.querySelectorAll('.quality-option').forEach(button => button.classList.toggle('on', button === customButton));window.NEXVideoRuntime?.setQuality?.('custom');refresh(); };
    options.addEventListener('click', event => { if (event.target.closest('.quality-option')) setTimeout(refresh, 0); });
    controls.addEventListener('input', updateVideoEstimate);controls.addEventListener('change', updateVideoEstimate);
    refresh();

    if (!$('vxOutputMetrics')) {
      const metrics = create('div', 'output-metrics video-output-metrics');metrics.id = 'vxOutputMetrics';metrics.setAttribute('aria-live', 'polite');
      $('vxMeta')?.insertAdjacentElement('afterend', metrics);
    }
  }

  function updateVideoEstimate() {
    const meta = window.NEXVideoRuntime?.metadata?.();if (!meta?.width) return;
    const dimensions = window.NEXVideoRuntime?.dimensions?.() || [meta.width, meta.height];
    const bitrate = window.NEXVideoRuntime?.bitrate?.() || 0;
    const fps = window.NEXVideoRuntime?.fps?.() || 30;
    const expected = bitrate && meta.duration ? bitrate / 8 * meta.duration * 1.03 : 0;
    const badge = $('vxMeta');if (!badge) return;
    badge.innerHTML = `<b>${meta.name}</b><span>Исходник: ${meta.width}×${meta.height} · ${meta.duration.toFixed(1)} с · ${formatBytes(meta.size)}</span><span>Выход: ${dimensions[0]}×${dimensions[1]} · до ${fps} FPS${expected ? ` · около ${formatBytes(expected)}` : ''}</span>`;
  }

  function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} Б`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} КБ`;
    return `${(value / 1024 / 1024).toFixed(value < 10 * 1024 * 1024 ? 2 : 1)} МБ`;
  }

  function installFrameControls() {
    const fields = document.querySelector('#vxFramesPanel .frame-range-fields');if (!fields || $('vxFramesAdvanced')) return;
    const format = select('vxFramesFormat', [['jpeg', 'JPG'], ['webp', 'WebP'], ['png', 'PNG']], 'jpeg');
    const quality = select('vxFramesQuality', [['97', 'Максимальная'], ['92', 'Высокая'], ['82', 'Компактная']], '92');
    const resolution = select('vxFramesResolution', [['0', 'Исходное'], ['2160', 'До 2160p'], ['1080', 'До 1080p'], ['720', 'До 720p']], '0');
    const advanced = create('details', 'frame-advanced-options');advanced.id = 'vxFramesAdvanced';
    const summary = create('summary', '', 'Дополнительные настройки');
    const advancedGrid = create('div', 'frame-advanced-grid');
    [field('Формат', format), field('Качество', quality), field('Разрешение', resolution)].forEach(node => advancedGrid.appendChild(node));
    advanced.append(summary, advancedGrid);
    fields.insertAdjacentElement('afterend', advanced);
    const cancel = create('button', 'mini-action danger context-hidden', 'Отменить создание кадров');cancel.type = 'button';cancel.id = 'vxFramesCancel';fields.appendChild(cancel);
    cancel.onclick = () => window.NEXVideoRuntime?.cancelFrames?.();
    const update = () => {
      const duration = window.NEXVideoRuntime?.metadata?.().duration || 0;
      const plan = duration ? window.NEXVideoRuntime?.framePlan?.(duration) : null;
      const status = $('vxFramesStatus');
      if (status) status.textContent = plan
        ? `Длительность ${duration.toFixed(1)} сек. Будет создано ${plan.count} кадров с интервалом ${plan.interval.toFixed(2)} сек. Безопасный лимит — ${plan.safeLimit}.`
        : 'После загрузки видео будет показано ожидаемое количество кадров.';
    };
    fields.parentElement?.addEventListener('input', update);$('vxVideo')?.addEventListener('loadedmetadata', update);update();
  }

  function installSpeechControls() {
    const actions = document.querySelector('#vxRecognizeRun')?.parentElement;if (!actions || $('vxSubtitleSource')) return;
    const source = select('vxSubtitleSource', [['original', 'Исходное видео'], ['narration', 'Записанная речь'], ['both', 'Обе отдельно'], ['mix', 'Итоговый микс']], 'original');
    source.title = 'Источник речи для распознавания';
    const language = select('vxWhisperLanguage', [['ru', 'Русский'], ['en', 'English']], 'ru');
    language.title = 'Язык распознавания';
    const cancel = create('button', 'mini-action danger context-hidden', 'Отменить');cancel.type = 'button';cancel.id = 'vxRecognizeCancel';
    actions.insertBefore(source, $('vxWhisperQuality'));actions.insertBefore(language, $('vxRecognizeRun'));actions.appendChild(cancel);
    const note = create('small', 'speech-source-note', 'Whisper работает локально в браузере после загрузки бесплатной модели.');actions.insertAdjacentElement('afterend', note);
    source.onchange = () => {
      note.textContent = source.value === 'both'
        ? 'Дорожки распознаются отдельно и сводятся по времени. При одновременной речи Whisper не выполняет разделение говорящих — выберите основную дорожку или итоговый микс.'
        : source.value === 'mix'
          ? 'Перед распознаванием создаётся реальный микс с текущей громкостью обеих дорожек.'
          : 'Whisper работает локально в браузере после загрузки бесплатной модели.';
    };
    cancel.onclick = () => window.NEXVideoRuntime?.cancelWhisper?.();

    const style = $('vxSubtitleStyle');
    [['youtube', 'YouTube'], ['premium', 'Premium'], ['clean', 'Clean'], ['business', 'Business'], ['real-estate', 'Real Estate'], ['elegant', 'Elegant'], ['news', 'News'], ['luxury', 'Luxury']].forEach(([value, label]) => {
      if (!style.querySelector(`option[value="${value}"]`)) { const option = create('option', '', label);option.value = value;style.appendChild(option); }
    });
    const motion = $('vxSubtitleMotion');
    [['typewriter', 'Печатная строка'], ['soft-scale', 'Мягкое увеличение'], ['reveal', 'Постепенно по словам'], ['key-word', 'Акцент текущего слова']].forEach(([value, label]) => {
      if (!motion.querySelector(`option[value="${value}"]`)) { const option = create('option', '', label);option.value = value;motion.appendChild(option); }
    });

    const subtitleBox = $('vxWhisperText')?.closest('.whisper-box');
    if (subtitleBox && !$('vxSubtitleFineControls')) {
      const fine = create('div', 'subtitle-fine-controls');fine.id = 'vxSubtitleFineControls';
      const position = select('vxSubtitlePosition', [['bottom', 'Снизу'], ['middle', 'По центру'], ['top', 'Сверху']], 'bottom');
      const colour = create('input');colour.type = 'color';colour.id = 'vxSubtitleColor';colour.value = '#ffffff';
      const background = create('input');background.type = 'color';background.id = 'vxSubtitleBackground';background.value = '#000000';
      const outlineColour = create('input');outlineColour.type = 'color';outlineColour.id = 'vxSubtitleOutlineColor';outlineColour.value = '#000000';
      fine.append(
        field('Положение', position),
        rangeControl({ id: 'vxSubtitleSize', label: 'Размер', min: 65, max: 150, value: 100, unit: '%' }),
        field('Цвет текста', colour), field('Цвет фона', background),
        rangeControl({ id: 'vxSubtitleBackgroundOpacity', label: 'Фон', min: 0, max: 100, value: 68, unit: '%' }),
        field('Цвет обводки', outlineColour),
        rangeControl({ id: 'vxSubtitleOutline', label: 'Обводка', min: 0, max: 8, value: 2 }),
        rangeControl({ id: 'vxSubtitleLines', label: 'Строк одновременно', min: 1, max: 3, value: 3 }),
        rangeControl({ id: 'vxSubtitleWords', label: 'Слов одновременно', min: 1, max: 8, value: 3 })
      );
      subtitleBox.appendChild(fine);
      fine.addEventListener('input', () => window.NEXVideoPreview?.draw?.());fine.addEventListener('change', () => window.NEXVideoPreview?.draw?.());
    }
  }

  function improveSemantics() {
    document.querySelectorAll('button:not([type])').forEach(button => button.type = 'button');
    document.querySelectorAll('.pos-grid button').forEach((button, index) => { if (!button.getAttribute('aria-label')) button.setAttribute('aria-label', `Положение логотипа ${index + 1}`); });
    $('file')?.setAttribute('aria-label', 'Загрузить фотографии');$('folder')?.setAttribute('aria-label', 'Загрузить папку с фотографиями');$('vxFile')?.setAttribute('aria-label', 'Загрузить видео');
    document.querySelectorAll('.theme-popover').forEach(menu => menu.setAttribute('role', 'menu'));
    document.querySelectorAll('.theme-popover button').forEach(button => button.setAttribute('role', 'menuitem'));
    document.querySelector('.foot').textContent = 'NEX ESTATE Media Studio by Эдик Великий · Version 2.2 Professional PWA';
  }

  function bindGlobalRuntime() {
    $('vxVideo')?.addEventListener('loadedmetadata', () => { updateVideoEstimate();setTimeout(updateVideoEstimate, 50); });
    $('vxVideoQualityMode')?.addEventListener('click', () => setTimeout(updateVideoEstimate, 0));
    $('vxAspect')?.addEventListener('click', () => setTimeout(updateVideoEstimate, 0));
    $('vxStabilizeLevel')?.addEventListener('change', updateVideoEstimate);
    $('vxEnhanceMode')?.addEventListener('change', () => window.NEXVideoRuntime?.redraw?.());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) window.NEXVideoPreview?.draw?.(); });
    window.addEventListener('unhandledrejection', event => {
      const message = event.reason?.message || '';
      if (message && !message.startsWith('__')) studio.toast(`Операция не завершена: ${message}`, 'error', 6500);
    });
  }

  function init() {
    installPhotoControls();installVideoEnhancementControls();installStabilizationControls();installCoverControls();installVideoQualityControls();installFrameControls();installSpeechControls();improveSemantics();bindGlobalRuntime();
    document.documentElement.classList.add('studio-upgrade-ready');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
