/* NEX ESTATE Media Studio — browser-native photo annotation tools. */
(() => {
  'use strict';

  const COLORS = ['#35b84b', '#ef3f3f', '#f1c64b', '#ffffff', '#3d9cff', '#111111'];
  const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, Number(value) || 0));
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const makeId = () => globalThis.crypto?.randomUUID?.() || `photo-tool-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  function ensureRecord(record) {
    if (!Array.isArray(record.photoTools)) record.photoTools = [];
    record.photoTools = record.photoTools.filter(item => item && ['arrow', 'text', 'blur'].includes(item.type));
    return record.photoTools;
  }

  function drawArrow(context, width, height, item) {
    const x1 = clamp(item.x1) * width;
    const y1 = clamp(item.y1) * height;
    const x2 = clamp(item.x2) * width;
    const y2 = clamp(item.y2) * height;
    const lineWidth = Math.max(2, Math.min(width, height) * clamp(item.thickness || 6, 1, 32) / 700);
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const length = Math.max(1, Math.hypot(x2 - x1, y2 - y1));
    const head = Math.min(length * .42, Math.max(lineWidth * 4.6, Math.min(width, height) * .026));
    context.save();
    context.strokeStyle = item.color || '#ef3f3f';
    context.fillStyle = item.color || '#ef3f3f';
    context.lineWidth = lineWidth;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
    context.stroke();
    context.beginPath();
    context.moveTo(x2, y2);
    context.lineTo(x2 - head * Math.cos(angle - Math.PI / 6), y2 - head * Math.sin(angle - Math.PI / 6));
    context.lineTo(x2 - head * Math.cos(angle + Math.PI / 6), y2 - head * Math.sin(angle + Math.PI / 6));
    context.closePath();
    context.fill();
    context.restore();
  }

  function drawText(context, width, height, item) {
    const value = String(item.text || '').trim();
    if (!value) return;
    const size = Math.max(12, clamp(item.size || .055, .018, .22) * width);
    const lines = value.split(/\r?\n/).slice(0, 8);
    const lineHeight = size * 1.16;
    const weight = ['400', '600', '700', '800'].includes(String(item.weight)) ? String(item.weight) : '700';
    context.save();
    context.translate(clamp(item.x, .02, .98) * width, clamp(item.y, .02, .98) * height);
    context.rotate((Number(item.angle) || 0) * Math.PI / 180);
    context.font = `${weight} ${size}px Arial, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineJoin = 'round';
    context.fillStyle = item.color || '#ffffff';
    context.strokeStyle = item.strokeColor || 'rgba(0,0,0,.88)';
    context.lineWidth = Math.max(0, clamp(item.stroke || 0, 0, 12) * Math.min(width, height) / 900);
    const startY = -(lines.length - 1) * lineHeight / 2;
    lines.forEach((line, index) => {
      const y = startY + index * lineHeight;
      if (context.lineWidth > .1) context.strokeText(line, 0, y, width * .9);
      context.fillText(line, 0, y, width * .9);
    });
    context.restore();
  }

  function drawBlur(context, width, height, item, backgroundSource) {
    const x = clamp(item.x, 0, .96);
    const y = clamp(item.y, 0, .96);
    const w = clamp(item.w || .24, .04, 1 - x);
    const h = clamp(item.h || .16, .04, 1 - y);
    const sx = Math.round(x * width), sy = Math.round(y * height);
    const sw = Math.max(2, Math.round(w * width)), sh = Math.max(2, Math.round(h * height));
    const strength = clamp(item.strength || 16, 4, 36);
    const downsample = Math.max(4, Math.round(strength * .82));
    const sample = document.createElement('canvas');
    sample.width = Math.max(2, Math.round(sw / downsample));
    sample.height = Math.max(2, Math.round(sh / downsample));
    const sampleContext = sample.getContext('2d', { alpha: false });
    sampleContext.imageSmoothingEnabled = true;
    sampleContext.imageSmoothingQuality = 'high';
    sampleContext.drawImage(backgroundSource || context.canvas, sx, sy, sw, sh, 0, 0, sample.width, sample.height);
    if (backgroundSource && backgroundSource !== context.canvas) {
      sampleContext.drawImage(context.canvas, sx, sy, sw, sh, 0, 0, sample.width, sample.height);
    }
    context.save();
    context.beginPath();
    context.rect(sx, sy, sw, sh);
    context.clip();
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    if ('filter' in context) context.filter = `blur(${Math.max(1, Math.round(strength * Math.min(width, height) / 1800))}px)`;
    const bleed = Math.max(2, Math.round(strength * Math.min(width, height) / 1200));
    context.drawImage(sample, 0, 0, sample.width, sample.height, sx - bleed, sy - bleed, sw + bleed * 2, sh + bleed * 2);
    context.restore();
    sample.width = 0;
    sample.height = 0;
  }

  function draw(context, width, height, items, options = {}) {
    for (const item of (items || [])) {
      if (item.type === 'arrow') drawArrow(context, width, height, item);
      else if (item.type === 'text') drawText(context, width, height, item);
      else if (item.type === 'blur') drawBlur(context, width, height, item, options.backgroundSource || context.canvas);
    }
  }

  function mount(options) {
    const { chooser, controls, surface, previewSource, record, details, countLabel, onActivate } = options;
    const items = ensureRecord(record);
    const preview = document.createElement('canvas');
    preview.className = 'photo-tool-preview';
    preview.setAttribute('aria-hidden', 'true');
    const objectLayer = document.createElement('div');
    objectLayer.className = 'photo-object-layer';
    objectLayer.setAttribute('aria-label', 'Добавленные инструменты фотографии');
    surface.append(preview, objectLayer);

    let activeId = null;
    let activeSnapshot = null;
    let activeWasNew = false;
    let drag = null;
    let suspended = false;
    let redrawFrame = 0;

    const sourceSize = () => ({
      width: Math.max(1, previewSource.width || 1),
      height: Math.max(1, previewSource.height || 1)
    });
    const activeItem = () => items.find(item => item.id === activeId) || null;
    const pointFromEvent = event => {
      const bounds = surface.getBoundingClientRect();
      return {
        x: clamp((event.clientX - bounds.left) / Math.max(1, bounds.width)),
        y: clamp((event.clientY - bounds.top) / Math.max(1, bounds.height))
      };
    };
    const notify = () => {
      if (countLabel) countLabel.textContent = items.length ? String(items.length) : '';
      options.onChange?.(clone(items));
    };
    const requestRedraw = () => {
      if (redrawFrame) return;
      redrawFrame = requestAnimationFrame(() => {
        redrawFrame = 0;
        redraw();
      });
    };

    function itemBounds(item) {
      if (item.type === 'blur') return { x: clamp(item.x), y: clamp(item.y), w: clamp(item.w, .04, 1), h: clamp(item.h, .04, 1) };
      if (item.type === 'arrow') {
        const pad = .035;
        const left = Math.min(clamp(item.x1), clamp(item.x2));
        const top = Math.min(clamp(item.y1), clamp(item.y2));
        return { x: clamp(left - pad), y: clamp(top - pad), w: Math.max(.08, Math.abs(item.x2 - item.x1) + pad * 2), h: Math.max(.08, Math.abs(item.y2 - item.y1) + pad * 2) };
      }
      const text = String(item.text || 'Текст');
      const width = clamp(Math.max(.12, text.split(/\r?\n/).reduce((max, line) => Math.max(max, line.length), 0) * (item.size || .055) * .56), .12, .88);
      const height = clamp(Math.max(.08, text.split(/\r?\n/).length * (item.size || .055) * 1.3), .08, .65);
      const radius = Math.min(.48, Math.hypot(width, height) / 2);
      return { x: clamp((item.x || .5) - radius), y: clamp((item.y || .5) - radius), w: Math.min(1, radius * 2), h: Math.min(1, radius * 2) };
    }

    function appendHandle(id, kind, x, y, label) {
      const handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'photo-object-handle';
      handle.dataset.toolId = id;
      handle.dataset.toolHandle = kind;
      handle.style.left = `${clamp(x) * 100}%`;
      handle.style.top = `${clamp(y) * 100}%`;
      handle.setAttribute('aria-label', label);
      objectLayer.appendChild(handle);
    }

    function renderOverlay() {
      objectLayer.replaceChildren();
      objectLayer.classList.toggle('is-suspended', suspended);
      items.forEach((item, index) => {
        const bounds = itemBounds(item);
        const hit = document.createElement('button');
        hit.type = 'button';
        hit.className = `photo-object-hit photo-object-${item.type}${item.id === activeId ? ' is-active' : ''}`;
        hit.dataset.toolId = item.id;
        hit.style.left = `${bounds.x * 100}%`;
        hit.style.top = `${bounds.y * 100}%`;
        hit.style.width = `${Math.min(1 - bounds.x, bounds.w) * 100}%`;
        hit.style.height = `${Math.min(1 - bounds.y, bounds.h) * 100}%`;
        hit.setAttribute('aria-label', `${item.type === 'arrow' ? 'Стрелка' : item.type === 'text' ? 'Текст' : 'Область размытия'}, слой ${index + 1}`);
        objectLayer.appendChild(hit);
        if (item.id !== activeId) return;
        if (item.type === 'arrow') {
          appendHandle(item.id, 'arrow-start', item.x1, item.y1, 'Начало стрелки');
          appendHandle(item.id, 'arrow-end', item.x2, item.y2, 'Конец стрелки');
        } else if (item.type === 'blur') {
          appendHandle(item.id, 'blur-nw', item.x, item.y, 'Левый верхний угол размытия');
          appendHandle(item.id, 'blur-se', item.x + item.w, item.y + item.h, 'Правый нижний угол размытия');
        } else {
          appendHandle(item.id, 'text-rotate', item.x, clamp(item.y - Math.max(.08, (item.size || .055) * 1.8)), 'Повернуть текст');
          appendHandle(item.id, 'text-scale', clamp(item.x + .09), clamp(item.y + .09), 'Изменить размер текста');
        }
      });
    }

    function redraw() {
      const { width, height } = sourceSize();
      if (preview.width !== width || preview.height !== height) {
        preview.width = width;
        preview.height = height;
      }
      const context = preview.getContext('2d', { alpha: true });
      context.clearRect(0, 0, width, height);
      draw(context, width, height, items, { backgroundSource: previewSource });
      renderOverlay();
      notify();
    }

    function commitActive() {
      if (!activeId) return;
      activeId = null;
      activeSnapshot = null;
      activeWasNew = false;
      renderControls();
      redraw();
    }

    function cancelActive() {
      if (!activeId) return;
      const index = items.findIndex(item => item.id === activeId);
      if (index >= 0) {
        if (activeWasNew) items.splice(index, 1);
        else if (activeSnapshot) items[index] = clone(activeSnapshot);
      }
      activeId = null;
      activeSnapshot = null;
      activeWasNew = false;
      renderControls();
      redraw();
    }

    function selectItem(id) {
      if (activeId === id) return activeItem();
      if (activeId) commitActive();
      const item = items.find(entry => entry.id === id);
      if (!item) return null;
      activeId = id;
      activeSnapshot = clone(item);
      activeWasNew = false;
      if (details) details.open = true;
      onActivate?.(item.type);
      renderControls();
      redraw();
      return item;
    }

    function addTool(type) {
      if (activeId) commitActive();
      let item;
      if (type === 'arrow') item = { id: makeId(), type, x1: .31, y1: .58, x2: .69, y2: .42, color: '#ef3f3f', thickness: 7 };
      else if (type === 'text') item = { id: makeId(), type, text: 'Введите текст', x: .5, y: .5, size: .055, angle: 0, color: '#ffffff', weight: '700', stroke: 3, strokeColor: 'rgba(0,0,0,.88)' };
      else item = { id: makeId(), type: 'blur', x: .34, y: .38, w: .32, h: .22, strength: 18 };
      items.push(item);
      activeId = item.id;
      activeSnapshot = null;
      activeWasNew = true;
      if (details) details.open = true;
      onActivate?.(type);
      renderControls();
      redraw();
    }

    function field(label, control, className = '') {
      const wrapper = document.createElement('label');
      wrapper.className = `photo-tool-field ${className}`.trim();
      const text = document.createElement('span');
      text.textContent = label;
      wrapper.append(text, control);
      return wrapper;
    }

    function rangeField(label, min, max, step, value, formatter, onInput) {
      const row = document.createElement('label');
      row.className = 'photo-tool-field photo-tool-range';
      const title = document.createElement('span');
      title.textContent = label;
      const output = document.createElement('b');
      output.textContent = formatter(value);
      const input = document.createElement('input');
      input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(value);
      input.setAttribute('aria-label', label);
      input.addEventListener('input', () => {
        const next = Number(input.value);
        output.textContent = formatter(next);
        onInput(next);
        requestRedraw();
      });
      row.append(title, input, output);
      return row;
    }

    function colorField(item) {
      const select = document.createElement('select');
      select.className = 'mark-color-select';
      const names = ['Зелёный', 'Красный', 'Жёлтый', 'Белый', 'Синий', 'Чёрный'];
      COLORS.forEach((color, index) => {
        const option = document.createElement('option'); option.value = color; option.textContent = names[index]; select.appendChild(option);
      });
      select.value = item.color || COLORS[0];
      select.addEventListener('change', () => { item.color = select.value; requestRedraw(); });
      return field('Цвет', select);
    }

    function arrowLength(item) {
      const { width, height } = sourceSize();
      return Math.hypot((item.x2 - item.x1) * width, (item.y2 - item.y1) * height) / Math.min(width, height) * 100;
    }
    function arrowAngle(item) {
      const { width, height } = sourceSize();
      return Math.atan2((item.y2 - item.y1) * height, (item.x2 - item.x1) * width) * 180 / Math.PI;
    }
    function setArrowGeometry(item, lengthPercent, angleDegrees) {
      const { width, height } = sourceSize();
      const cx = (item.x1 + item.x2) / 2, cy = (item.y1 + item.y2) / 2;
      const length = clamp(lengthPercent, 5, 90) / 100 * Math.min(width, height);
      const angle = angleDegrees * Math.PI / 180;
      let dx = Math.cos(angle) * length / width / 2, dy = Math.sin(angle) * length / height / 2;
      const fit = Math.min(1, cx / Math.max(.0001, Math.abs(dx)), (1 - cx) / Math.max(.0001, Math.abs(dx)), cy / Math.max(.0001, Math.abs(dy)), (1 - cy) / Math.max(.0001, Math.abs(dy)));
      dx *= fit; dy *= fit;
      item.x1 = clamp(cx - dx); item.y1 = clamp(cy - dy); item.x2 = clamp(cx + dx); item.y2 = clamp(cy + dy);
    }

    function actionButton(text, className, action) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `photo-action ${className || ''}`.trim();
      button.textContent = text;
      button.addEventListener('click', action);
      return button;
    }

    function renderControls() {
      controls.replaceChildren();
      chooser.querySelectorAll('[data-photo-tool]').forEach(button => button.classList.toggle('active-mark', button.dataset.photoTool === activeItem()?.type));
      const item = activeItem();
      if (items.length) {
        const layers = document.createElement('div');
        layers.className = 'photo-tool-layer-list';
        const label = document.createElement('span');
        label.textContent = 'Слои (сверху вниз)';
        layers.appendChild(label);
        [...items].reverse().forEach((entry, reverseIndex) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = `photo-tool-layer-button${entry.id === activeId ? ' active-mark' : ''}`;
          const title = entry.type === 'arrow' ? 'Стрелка' : entry.type === 'text' ? `Текст: ${String(entry.text || '').split(/\r?\n/)[0].slice(0, 24)}` : 'Размытие';
          button.textContent = `${title} · слой ${items.length - reverseIndex}`;
          button.addEventListener('click', () => selectItem(entry.id));
          layers.appendChild(button);
        });
        controls.appendChild(layers);
      }
      if (!item) {
        controls.classList.toggle('context-hidden', items.length === 0);
        return;
      }
      controls.classList.remove('context-hidden');
      const grid = document.createElement('div');
      grid.className = 'photo-tool-control-grid';
      if (item.type === 'arrow') {
        grid.append(colorField(item));
        grid.append(rangeField('Толщина', 2, 24, 1, item.thickness || 7, value => `${value}`, value => { item.thickness = value; }));
        let length = arrowLength(item), angle = arrowAngle(item);
        grid.append(rangeField('Длина', 5, 90, 1, Math.round(length), value => `${value}%`, value => { length = value; setArrowGeometry(item, length, angle); }));
        grid.append(rangeField('Поворот', -180, 180, 1, Math.round(angle), value => `${value}°`, value => { angle = value; setArrowGeometry(item, length, angle); }));
      } else if (item.type === 'text') {
        const input = document.createElement('textarea');
        input.rows = 2; input.maxLength = 240; input.value = item.text || '';
        input.addEventListener('input', () => { item.text = input.value; requestRedraw(); });
        grid.append(field('Текст', input, 'photo-tool-field-wide'));
        grid.append(colorField(item));
        grid.append(rangeField('Размер', 2, 18, .5, Math.round((item.size || .055) * 1000) / 10, value => `${value}%`, value => { item.size = value / 100; }));
        grid.append(rangeField('Поворот', -180, 180, 1, Number(item.angle) || 0, value => `${value}°`, value => { item.angle = value; }));
        const weight = document.createElement('select');
        [['400', 'Обычный'], ['600', 'Полужирный'], ['700', 'Жирный'], ['800', 'Очень жирный']].forEach(([value, label]) => { const option = document.createElement('option'); option.value = value; option.textContent = label; weight.appendChild(option); });
        weight.value = String(item.weight || '700');
        weight.addEventListener('change', () => { item.weight = weight.value; requestRedraw(); });
        grid.append(field('Начертание', weight));
        grid.append(rangeField('Обводка', 0, 10, 1, Number(item.stroke) || 0, value => `${value}`, value => { item.stroke = value; }));
      } else {
        grid.append(rangeField('Сила размытия', 4, 36, 1, item.strength || 18, value => `${value}`, value => { item.strength = value; }));
        grid.append(rangeField('Ширина', 4, 90, 1, Math.round((item.w || .32) * 100), value => `${value}%`, value => { item.w = Math.min(value / 100, 1 - item.x); }));
        grid.append(rangeField('Высота', 4, 90, 1, Math.round((item.h || .22) * 100), value => `${value}%`, value => { item.h = Math.min(value / 100, 1 - item.y); }));
      }
      const actions = document.createElement('div');
      actions.className = 'photo-tool-actions';
      actions.append(
        actionButton('Применить', 'mark-confirm', commitActive),
        actionButton('Отменить', 'danger', cancelActive),
        actionButton('Слой ниже', '', () => {
          const index = items.findIndex(entry => entry.id === activeId);
          if (index > 0) [items[index - 1], items[index]] = [items[index], items[index - 1]];
          redraw();
        }),
        actionButton('Слой выше', '', () => {
          const index = items.findIndex(entry => entry.id === activeId);
          if (index >= 0 && index < items.length - 1) [items[index + 1], items[index]] = [items[index], items[index + 1]];
          redraw();
        }),
        actionButton('Удалить', 'danger', () => {
          const index = items.findIndex(entry => entry.id === activeId);
          if (index >= 0) items.splice(index, 1);
          activeId = null; activeSnapshot = null; activeWasNew = false;
          renderControls(); redraw();
        })
      );
      controls.append(grid, actions);
    }

    function addChooser(text, type) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'photo-action photo-tool-choice';
      button.dataset.photoTool = type;
      button.textContent = text;
      button.addEventListener('click', () => addTool(type));
      chooser.appendChild(button);
    }
    addChooser('Стрелка', 'arrow');
    addChooser('Текст', 'text');
    addChooser('Размытие / замазка', 'blur');

    objectLayer.addEventListener('pointerdown', event => {
      if (suspended) return;
      const target = event.target.closest?.('[data-tool-id]');
      if (!target) return;
      const item = selectItem(target.dataset.toolId);
      if (!item) return;
      event.preventDefault();
      objectLayer.setPointerCapture?.(event.pointerId);
      drag = {
        pointerId: event.pointerId,
        handle: target.dataset.toolHandle || 'move',
        start: pointFromEvent(event),
        original: clone(item)
      };
    });
    objectLayer.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const item = activeItem();
      if (!item) return;
      event.preventDefault();
      const point = pointFromEvent(event);
      const dx = point.x - drag.start.x, dy = point.y - drag.start.y;
      const original = drag.original;
      if (drag.handle === 'move') {
        if (item.type === 'arrow') {
          const minX = Math.min(original.x1, original.x2), maxX = Math.max(original.x1, original.x2), minY = Math.min(original.y1, original.y2), maxY = Math.max(original.y1, original.y2);
          const safeDx = clamp(dx, -minX, 1 - maxX), safeDy = clamp(dy, -minY, 1 - maxY);
          item.x1 = original.x1 + safeDx; item.x2 = original.x2 + safeDx; item.y1 = original.y1 + safeDy; item.y2 = original.y2 + safeDy;
        } else if (item.type === 'blur') {
          item.x = clamp(original.x + dx, 0, 1 - original.w); item.y = clamp(original.y + dy, 0, 1 - original.h);
        } else {
          item.x = clamp(original.x + dx, .03, .97); item.y = clamp(original.y + dy, .03, .97);
        }
      } else if (drag.handle === 'arrow-start') {
        item.x1 = point.x; item.y1 = point.y;
      } else if (drag.handle === 'arrow-end') {
        item.x2 = point.x; item.y2 = point.y;
      } else if (drag.handle === 'blur-nw') {
        const right = original.x + original.w, bottom = original.y + original.h;
        item.x = Math.min(point.x, right - .04); item.y = Math.min(point.y, bottom - .04); item.w = right - item.x; item.h = bottom - item.y;
      } else if (drag.handle === 'blur-se') {
        item.w = clamp(point.x - original.x, .04, 1 - original.x); item.h = clamp(point.y - original.y, .04, 1 - original.y);
      } else if (drag.handle === 'text-rotate') {
        item.angle = Math.atan2(point.y - item.y, point.x - item.x) * 180 / Math.PI + 90;
      } else if (drag.handle === 'text-scale') {
        const startDistance = Math.max(.01, Math.hypot(drag.start.x - original.x, drag.start.y - original.y));
        const nextDistance = Math.hypot(point.x - original.x, point.y - original.y);
        item.size = clamp(original.size * nextDistance / startDistance, .018, .22);
      }
      requestRedraw();
    });
    const finishDrag = event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      drag = null;
      renderControls();
      redraw();
    };
    objectLayer.addEventListener('pointerup', finishDrag);
    objectLayer.addEventListener('pointercancel', finishDrag);
    objectLayer.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); cancelActive(); }
      if (event.key === 'Enter' && activeId) { event.preventDefault(); commitActive(); }
      if ((event.key === 'Delete' || event.key === 'Backspace') && activeId && !event.target.matches('input,textarea')) {
        event.preventDefault();
        const index = items.findIndex(entry => entry.id === activeId);
        if (index >= 0) items.splice(index, 1);
        activeId = null; activeSnapshot = null; activeWasNew = false;
        renderControls(); redraw();
      }
    });

    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(requestRedraw) : null;
    observer?.observe(surface);
    renderControls();
    redraw();

    return {
      redraw,
      cancelActive,
      setSuspended(value) { suspended = Boolean(value); renderOverlay(); },
      items: () => clone(items),
      select: selectItem,
      add: addTool,
      destroy() {
        observer?.disconnect();
        if (redrawFrame) cancelAnimationFrame(redrawFrame);
        preview.remove();
        objectLayer.remove();
      }
    };
  }

  window.NEXPhotoTools = Object.freeze({ ensureRecord, draw, mount });
})();
