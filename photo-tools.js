/* NEX ESTATE Media Studio — browser-native photo annotation and brush tools. */
(() => {
  'use strict';

  const COLORS = ['#35b84b', '#ef3f3f', '#f1c64b', '#ffffff', '#3d9cff', '#111111'];
  const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, Number(value) || 0));
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const makeId = () => globalThis.crypto?.randomUUID?.() || `photo-tool-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  function shade(hex, amount) {
    const value = String(hex || '').match(/^#([0-9a-f]{6})$/i)?.[1];
    if (!value) return amount < 0 ? '#162219' : '#ffffff';
    const channels = [0, 2, 4].map(index => parseInt(value.slice(index, index + 2), 16));
    const mixed = channels.map(channel => {
      const target = amount < 0 ? 0 : 255;
      return Math.round(channel + (target - channel) * Math.abs(amount)).toString(16).padStart(2, '0');
    });
    return `#${mixed.join('')}`;
  }

  function ensureRecord(record) {
    if (!Array.isArray(record.photoTools)) record.photoTools = [];
    record.photoTools = record.photoTools.filter(item => item && ['arrow', 'text', 'blur'].includes(item.type));
    record.photoTools.forEach(item => {
      if (!item.id) item.id = makeId();
      if (item.type !== 'blur') return;
      item.size = clamp(item.size || .09, .02, .24);
      item.strength = clamp(item.strength || 18, 4, 36);
      if (!Array.isArray(item.strokes)) item.strokes = [];
      item.strokes = item.strokes
        .filter(stroke => stroke && Array.isArray(stroke.points) && stroke.points.length)
        .map(stroke => ({
          points: stroke.points.map(point => ({ x: clamp(point.x), y: clamp(point.y) })),
          size: clamp(stroke.size || item.size, .02, .24),
          strength: clamp(stroke.strength || item.strength, 4, 36)
        }));
    });
    return record.photoTools;
  }

  function drawArrow(context, width, height, item) {
    const x1 = clamp(item.x1) * width;
    const y1 = clamp(item.y1) * height;
    const x2 = clamp(item.x2) * width;
    const y2 = clamp(item.y2) * height;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const length = Math.max(1, Math.hypot(x2 - x1, y2 - y1));
    const color = item.color || '#ef3f3f';
    const bodyWidth = Math.max(5, Math.min(width, height) * clamp(item.thickness || 7, 2, 24) / 260);
    const bodyHalf = bodyWidth / 2;
    const headLength = Math.min(length * .44, Math.max(bodyWidth * 2.35, Math.min(width, height) * .052));
    const headHalf = Math.min(length * .32, Math.max(bodyWidth * 1.42, Math.min(width, height) * .032));
    const neck = Math.max(bodyWidth, length - headLength);
    context.save();
    context.translate(x1, y1);
    context.rotate(angle);
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.shadowColor = 'rgba(0,0,0,.34)';
    context.shadowBlur = Math.max(3, bodyWidth * .55);
    context.shadowOffsetY = Math.max(2, bodyWidth * .18);
    context.beginPath();
    context.moveTo(0, -bodyHalf);
    context.lineTo(neck, -bodyHalf);
    context.lineTo(neck, -headHalf);
    context.lineTo(length, 0);
    context.lineTo(neck, headHalf);
    context.lineTo(neck, bodyHalf);
    context.lineTo(0, bodyHalf);
    context.closePath();
    context.fillStyle = color;
    context.fill();
    context.shadowColor = 'transparent';
    context.strokeStyle = shade(color, -.44);
    context.lineWidth = Math.max(1.5, bodyWidth * .11);
    context.stroke();
    context.strokeStyle = 'rgba(255,255,255,.42)';
    context.lineWidth = Math.max(1.2, bodyWidth * .12);
    context.beginPath();
    context.moveTo(Math.min(bodyWidth, length * .08), -bodyHalf * .48);
    context.lineTo(neck - bodyWidth * .16, -bodyHalf * .48);
    context.lineTo(neck + headLength * .17, -headHalf * .55);
    context.stroke();
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

  function paintBrushMask(context, stroke, width, height) {
    const points = stroke.points || [];
    if (!points.length) return;
    const brush = clamp(stroke.size || .09, .02, .24) * Math.min(width, height);
    context.strokeStyle = '#fff';
    context.fillStyle = '#fff';
    context.lineWidth = Math.max(2, brush);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    if (points.length === 1) {
      context.beginPath();
      context.arc(clamp(points[0].x) * width, clamp(points[0].y) * height, brush / 2, 0, Math.PI * 2);
      context.fill();
      return;
    }
    context.beginPath();
    points.forEach((point, index) => {
      const x = clamp(point.x) * width, y = clamp(point.y) * height;
      if (index) context.lineTo(x, y); else context.moveTo(x, y);
    });
    context.stroke();
  }

  function drawBlur(context, width, height, item, backgroundSource) {
    const strokes = Array.isArray(item.strokes) ? item.strokes.filter(stroke => stroke?.points?.length) : [];
    if (!strokes.length) return;
    const source = document.createElement('canvas');
    source.width = width;
    source.height = height;
    const sourceContext = source.getContext('2d', { alpha: true });
    sourceContext.imageSmoothingEnabled = true;
    sourceContext.imageSmoothingQuality = 'high';
    sourceContext.drawImage(backgroundSource || context.canvas, 0, 0, width, height);
    if (backgroundSource && backgroundSource !== context.canvas) sourceContext.drawImage(context.canvas, 0, 0, width, height);

    const groups = new Map();
    strokes.forEach(stroke => {
      const strength = Math.round(clamp(stroke.strength || item.strength || 18, 4, 36));
      if (!groups.has(strength)) groups.set(strength, []);
      groups.get(strength).push(stroke);
    });
    groups.forEach((group, strength) => {
      const effect = document.createElement('canvas');
      effect.width = width;
      effect.height = height;
      const effectContext = effect.getContext('2d', { alpha: true });
      group.forEach(stroke => paintBrushMask(effectContext, stroke, width, height));
      effectContext.globalCompositeOperation = 'source-in';
      effectContext.imageSmoothingEnabled = true;
      effectContext.imageSmoothingQuality = 'high';
      if ('filter' in effectContext) {
        const radius = Math.max(2, strength * Math.min(width, height) / 700);
        effectContext.filter = `blur(${radius.toFixed(2)}px)`;
        effectContext.drawImage(source, 0, 0);
        effectContext.filter = 'none';
      } else {
        const scale = Math.max(4, Math.round(strength * .7));
        const sample = document.createElement('canvas');
        sample.width = Math.max(2, Math.round(width / scale));
        sample.height = Math.max(2, Math.round(height / scale));
        const sampleContext = sample.getContext('2d', { alpha: true });
        sampleContext.imageSmoothingEnabled = true;
        sampleContext.drawImage(source, 0, 0, sample.width, sample.height);
        effectContext.drawImage(sample, 0, 0, sample.width, sample.height, 0, 0, width, height);
        sample.width = 0;
        sample.height = 0;
      }
      context.save();
      context.globalCompositeOperation = 'source-over';
      context.drawImage(effect, 0, 0);
      context.restore();
      effect.width = 0;
      effect.height = 0;
    });
    source.width = 0;
    source.height = 0;
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
    const brushCursor = document.createElement('div');
    brushCursor.className = 'photo-blur-cursor';
    brushCursor.setAttribute('aria-hidden', 'true');
    brushCursor.hidden = true;
    surface.append(preview, objectLayer);

    let activeId = null;
    let activeSnapshot = null;
    let activeWasNew = false;
    let drag = null;
    let brushStroke = null;
    let cursorPoint = null;
    let suspended = false;
    let redrawFrame = 0;
    const measureContext = document.createElement('canvas').getContext('2d');

    const sourceSize = () => ({
      width: Math.max(1, previewSource.width || 1),
      height: Math.max(1, previewSource.height || 1)
    });
    const previewSize = () => {
      const source = sourceSize();
      const bounds = surface.getBoundingClientRect();
      const density = Math.min(2, Math.max(1, globalThis.devicePixelRatio || 1));
      const available = bounds.width > 1 ? bounds.width * density : Math.min(source.width, 1200);
      const scale = Math.min(1, available / source.width);
      return {
        width: Math.max(1, Math.round(source.width * scale)),
        height: Math.max(1, Math.round(source.height * scale))
      };
    };
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

    function textBox(item) {
      const { width, height } = sourceSize();
      const size = Math.max(12, clamp(item.size || .055, .018, .22) * width);
      const lines = String(item.text || 'Текст').split(/\r?\n/).slice(0, 8);
      const weight = ['400', '600', '700', '800'].includes(String(item.weight)) ? String(item.weight) : '700';
      measureContext.font = `${weight} ${size}px Arial, sans-serif`;
      const measuredWidth = Math.max(size * 1.6, ...lines.map(line => measureContext.measureText(line || ' ').width));
      const boxWidth = Math.min(width * .9, measuredWidth) / width;
      const boxHeight = Math.min(height * .9, lines.length * size * 1.16) / height;
      const angle = (Number(item.angle) || 0) * Math.PI / 180;
      return {
        width: boxWidth,
        height: boxHeight,
        halfX: Math.abs(Math.cos(angle)) * boxWidth / 2 + Math.abs(Math.sin(angle)) * boxHeight / 2,
        halfY: Math.abs(Math.sin(angle)) * boxWidth / 2 + Math.abs(Math.cos(angle)) * boxHeight / 2
      };
    }

    function keepTextInside(item) {
      const box = textBox(item);
      const limitX = Math.min(.48, box.halfX + .012);
      const limitY = Math.min(.48, box.halfY + .012);
      item.x = clamp(item.x || .5, limitX, 1 - limitX);
      item.y = clamp(item.y || .5, limitY, 1 - limitY);
    }

    function arrowInsets(item) {
      const { width, height } = sourceSize();
      const minimum = Math.min(width, height);
      const body = Math.max(5, minimum * clamp(item.thickness || 7, 2, 24) / 260);
      const reach = Math.max(body * 1.7, minimum * .04) + body * .24;
      return { x: clamp(reach / width, .025, .22), y: clamp(reach / height, .025, .22) };
    }

    function keepArrowInside(item) {
      const inset = arrowInsets(item);
      item.x1 = clamp(item.x1, inset.x, 1 - inset.x);
      item.y1 = clamp(item.y1, inset.y, 1 - inset.y);
      item.x2 = clamp(item.x2, inset.x, 1 - inset.x);
      item.y2 = clamp(item.y2, inset.y, 1 - inset.y);
    }

    function objectLabel(item) {
      if (item.type === 'text') {
        const value = String(item.text || 'Текст').replace(/\s+/g, ' ').trim().slice(0, 26);
        return value ? `Текст «${value}»` : 'Текст';
      }
      if (item.type === 'blur') return 'Размытие кистью';
      const names = { '#35b84b': 'зелёная', '#ef3f3f': 'красная', '#f1c64b': 'жёлтая', '#ffffff': 'белая', '#3d9cff': 'синяя', '#111111': 'чёрная' };
      return `Стрелка${names[item.color] ? ` — ${names[item.color]}` : ''}`;
    }

    function updateBrushCursor() {
      const item = activeItem();
      const visible = !suspended && item?.type === 'blur' && cursorPoint;
      brushCursor.hidden = !visible;
      if (!visible) return;
      const { width, height } = sourceSize();
      const diameter = clamp(item.size || .09, .02, .24) * Math.min(width, height);
      brushCursor.style.left = `${clamp(cursorPoint.x) * 100}%`;
      brushCursor.style.top = `${clamp(cursorPoint.y) * 100}%`;
      brushCursor.style.width = `${diameter / width * 100}%`;
      brushCursor.style.height = `${diameter / height * 100}%`;
    }

    function itemBounds(item) {
      if (item.type === 'blur') {
        const points = (item.strokes || []).flatMap(stroke => stroke.points || []);
        if (!points.length) return { x: .44, y: .44, w: .12, h: .12 };
        const pad = clamp(item.size || .09, .02, .24) / 2;
        const xs = points.map(point => clamp(point.x)), ys = points.map(point => clamp(point.y));
        const x = clamp(Math.min(...xs) - pad), y = clamp(Math.min(...ys) - pad);
        return { x, y, w: Math.min(1 - x, Math.max(.06, Math.max(...xs) - Math.min(...xs) + pad * 2)), h: Math.min(1 - y, Math.max(.06, Math.max(...ys) - Math.min(...ys) + pad * 2)) };
      }
      if (item.type === 'arrow') {
        const inset = arrowInsets(item);
        const left = Math.min(clamp(item.x1), clamp(item.x2));
        const top = Math.min(clamp(item.y1), clamp(item.y2));
        return { x: clamp(left - inset.x), y: clamp(top - inset.y), w: Math.max(.08, Math.abs(item.x2 - item.x1) + inset.x * 2), h: Math.max(.08, Math.abs(item.y2 - item.y1) + inset.y * 2) };
      }
      const box = textBox(item);
      return {
        x: clamp((item.x || .5) - box.halfX),
        y: clamp((item.y || .5) - box.halfY),
        w: Math.min(1, box.halfX * 2),
        h: Math.min(1, box.halfY * 2)
      };
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
      const brushMode = !suspended && activeItem()?.type === 'blur';
      objectLayer.classList.toggle('is-brush-mode', brushMode);
      items.forEach(item => {
        if (item.type === 'blur') return;
        const bounds = itemBounds(item);
        const hit = document.createElement('button');
        hit.type = 'button';
        hit.className = `photo-object-hit photo-object-${item.type}${item.id === activeId ? ' is-active' : ''}`;
        hit.dataset.toolId = item.id;
        hit.style.left = `${bounds.x * 100}%`;
        hit.style.top = `${bounds.y * 100}%`;
        hit.style.width = `${Math.min(1 - bounds.x, bounds.w) * 100}%`;
        hit.style.height = `${Math.min(1 - bounds.y, bounds.h) * 100}%`;
        hit.setAttribute('aria-label', item.type === 'arrow' ? 'Стрелка на фотографии' : 'Текст на фотографии');
        objectLayer.appendChild(hit);
        if (item.id !== activeId) return;
        if (item.type === 'arrow') {
          appendHandle(item.id, 'arrow-start', item.x1, item.y1, 'Повернуть и изменить начало стрелки');
          appendHandle(item.id, 'arrow-end', item.x2, item.y2, 'Повернуть и изменить размер стрелки');
        } else {
          const box = textBox(item);
          appendHandle(item.id, 'text-rotate', item.x, clamp(item.y - box.halfY - .055), 'Повернуть текст');
          appendHandle(item.id, 'text-scale', clamp(item.x + box.halfX + .035), clamp(item.y + box.halfY + .035), 'Изменить размер текста');
        }
      });
      if (brushMode) {
        objectLayer.appendChild(brushCursor);
        updateBrushCursor();
      }
    }

    function redraw() {
      const source = sourceSize();
      const { width, height } = previewSize();
      surface.style.aspectRatio = `${source.width} / ${source.height}`;
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
      const item = activeItem();
      if (item?.type === 'blur' && !(item.strokes || []).length) {
        const index = items.findIndex(entry => entry.id === activeId);
        if (index >= 0) items.splice(index, 1);
      }
      activeId = null;
      activeSnapshot = null;
      activeWasNew = false;
      brushStroke = null;
      cursorPoint = null;
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
      brushStroke = null;
      cursorPoint = null;
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
      if (type === 'blur') {
        const existing = [...items].reverse().find(item => item.type === 'blur');
        if (existing) {
          selectItem(existing.id);
          return;
        }
      }
      if (activeId) commitActive();
      let item;
      if (type === 'arrow') item = { id: makeId(), type, x1: .36, y1: .55, x2: .64, y2: .45, color: '#35b84b', thickness: 7 };
      else if (type === 'text') item = { id: makeId(), type, text: 'Введите текст', x: .5, y: .5, size: .055, angle: 0, color: '#ffffff', weight: '700', stroke: 3, strokeColor: 'rgba(0,0,0,.88)' };
      else item = { id: makeId(), type: 'blur', strokes: [], size: .09, strength: 18 };
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
      select.addEventListener('change', () => { item.color = select.value; renderControls(); requestRedraw(); });
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
      const length = clamp(lengthPercent, 15, 85) / 100 * Math.min(width, height);
      const angle = angleDegrees * Math.PI / 180;
      let dx = Math.cos(angle) * length / width / 2, dy = Math.sin(angle) * length / height / 2;
      const inset = arrowInsets(item);
      const fit = Math.min(1, (cx - inset.x) / Math.max(.0001, Math.abs(dx)), (1 - inset.x - cx) / Math.max(.0001, Math.abs(dx)), (cy - inset.y) / Math.max(.0001, Math.abs(dy)), (1 - inset.y - cy) / Math.max(.0001, Math.abs(dy)));
      dx *= fit; dy *= fit;
      item.x1 = cx - dx; item.y1 = cy - dy; item.x2 = cx + dx; item.y2 = cy + dy;
      keepArrowInside(item);
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
        const picker = document.createElement('label');
        picker.className = 'photo-tool-object-picker';
        const label = document.createElement('span');
        label.textContent = 'Выбранный объект';
        const select = document.createElement('select');
        select.setAttribute('aria-label', 'Выбранный объект фотографии');
        const empty = document.createElement('option');
        empty.value = '';
        empty.textContent = 'Выберите объект';
        select.appendChild(empty);
        [...items].reverse().forEach(entry => {
          const option = document.createElement('option');
          option.value = entry.id;
          option.textContent = objectLabel(entry);
          select.appendChild(option);
        });
        select.value = activeId || '';
        select.addEventListener('change', () => { if (select.value) selectItem(select.value); });
        picker.append(label, select);
        controls.appendChild(picker);
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
        grid.append(rangeField('Толщина', 2, 24, 1, item.thickness || 7, value => `${value}`, value => { item.thickness = value; keepArrowInside(item); }));
        let length = arrowLength(item), angle = arrowAngle(item);
        grid.append(rangeField('Масштаб', 15, 85, 1, Math.round(length), value => `${value}%`, value => { length = value; setArrowGeometry(item, length, angle); }));
        grid.append(rangeField('Поворот', -180, 180, 1, Math.round(angle), value => `${value}°`, value => { angle = value; setArrowGeometry(item, length, angle); }));
      } else if (item.type === 'text') {
        const input = document.createElement('textarea');
        input.rows = 2; input.maxLength = 240; input.value = item.text || '';
        input.addEventListener('input', () => { item.text = input.value; keepTextInside(item); requestRedraw(); });
        input.addEventListener('blur', renderControls);
        grid.append(field('Текст', input, 'photo-tool-field-wide'));
        grid.append(colorField(item));
        grid.append(rangeField('Размер', 2, 18, .5, Math.round((item.size || .055) * 1000) / 10, value => `${value}%`, value => { item.size = value / 100; keepTextInside(item); }));
        grid.append(rangeField('Поворот', -180, 180, 1, Number(item.angle) || 0, value => `${value}°`, value => { item.angle = value; keepTextInside(item); }));
        const weight = document.createElement('select');
        [['400', 'Обычный'], ['600', 'Полужирный'], ['700', 'Жирный'], ['800', 'Очень жирный']].forEach(([value, label]) => { const option = document.createElement('option'); option.value = value; option.textContent = label; weight.appendChild(option); });
        weight.value = String(item.weight || '700');
        weight.addEventListener('change', () => { item.weight = weight.value; keepTextInside(item); requestRedraw(); });
        grid.append(field('Начертание', weight));
        grid.append(rangeField('Обводка', 0, 10, 1, Number(item.stroke) || 0, value => `${value}`, value => { item.stroke = value; }));
      } else {
        grid.append(rangeField('Размер кисти', 2, 24, 1, Math.round((item.size || .09) * 100), value => `${value}%`, value => { item.size = value / 100; updateBrushCursor(); }));
        grid.append(rangeField('Интенсивность', 4, 36, 1, item.strength || 18, value => `${value}`, value => { item.strength = value; }));
      }
      const actions = document.createElement('div');
      actions.className = 'photo-tool-actions';
      actions.append(
        actionButton('Применить', 'mark-confirm', commitActive),
        actionButton('Отменить', 'danger', cancelActive),
        actionButton('На слой ниже', '', () => {
          const index = items.findIndex(entry => entry.id === activeId);
          if (index > 0) [items[index - 1], items[index]] = [items[index], items[index - 1]];
          renderControls(); redraw();
        }),
        actionButton('На слой выше', '', () => {
          const index = items.findIndex(entry => entry.id === activeId);
          if (index >= 0 && index < items.length - 1) [items[index + 1], items[index]] = [items[index], items[index + 1]];
          renderControls(); redraw();
        }),
        actionButton('Удалить', 'danger', () => {
          const index = items.findIndex(entry => entry.id === activeId);
          if (index >= 0) items.splice(index, 1);
          activeId = null; activeSnapshot = null; activeWasNew = false; brushStroke = null; cursorPoint = null;
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

    const appendBrushPoint = (stroke, point) => {
      const last = stroke.points[stroke.points.length - 1];
      if (!last) { stroke.points.push(point); return; }
      const bounds = surface.getBoundingClientRect();
      const distance = Math.hypot((point.x - last.x) * bounds.width, (point.y - last.y) * bounds.height);
      if (distance >= 2) stroke.points.push(point);
    };

    objectLayer.addEventListener('pointerdown', event => {
      if (suspended) return;
      const selected = activeItem();
      if (selected?.type === 'blur') {
        if (event.button !== 0) return;
        event.preventDefault();
        cursorPoint = pointFromEvent(event);
        const stroke = { points: [cursorPoint], size: selected.size || .09, strength: selected.strength || 18 };
        selected.strokes.push(stroke);
        brushStroke = { pointerId: event.pointerId, stroke };
        objectLayer.setPointerCapture?.(event.pointerId);
        updateBrushCursor();
        requestRedraw();
        return;
      }
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
      const item = activeItem();
      if (item?.type === 'blur' && !suspended) {
        cursorPoint = pointFromEvent(event);
        updateBrushCursor();
        if (brushStroke && event.pointerId === brushStroke.pointerId) {
          event.preventDefault();
          appendBrushPoint(brushStroke.stroke, cursorPoint);
          requestRedraw();
        }
        return;
      }
      if (!drag || event.pointerId !== drag.pointerId || !item) return;
      event.preventDefault();
      const point = pointFromEvent(event);
      const dx = point.x - drag.start.x, dy = point.y - drag.start.y;
      const original = drag.original;
      if (drag.handle === 'move') {
        if (item.type === 'arrow') {
          const minX = Math.min(original.x1, original.x2), maxX = Math.max(original.x1, original.x2), minY = Math.min(original.y1, original.y2), maxY = Math.max(original.y1, original.y2);
          const inset = arrowInsets(item);
          const safeDx = clamp(dx, inset.x - minX, 1 - inset.x - maxX), safeDy = clamp(dy, inset.y - minY, 1 - inset.y - maxY);
          item.x1 = original.x1 + safeDx; item.x2 = original.x2 + safeDx; item.y1 = original.y1 + safeDy; item.y2 = original.y2 + safeDy;
        } else {
          item.x = original.x + dx; item.y = original.y + dy; keepTextInside(item);
        }
      } else if (drag.handle === 'arrow-start') {
        item.x1 = point.x; item.y1 = point.y; keepArrowInside(item);
      } else if (drag.handle === 'arrow-end') {
        item.x2 = point.x; item.y2 = point.y; keepArrowInside(item);
      } else if (drag.handle === 'text-rotate') {
        const { width, height } = sourceSize();
        item.angle = Math.atan2((point.y - item.y) * height, (point.x - item.x) * width) * 180 / Math.PI + 90;
        keepTextInside(item);
      } else if (drag.handle === 'text-scale') {
        const { width, height } = sourceSize();
        const startDistance = Math.max(1, Math.hypot((drag.start.x - original.x) * width, (drag.start.y - original.y) * height));
        const nextDistance = Math.hypot((point.x - original.x) * width, (point.y - original.y) * height);
        item.size = clamp(original.size * nextDistance / startDistance, .018, .22);
        keepTextInside(item);
      }
      requestRedraw();
    });
    const finishPointer = event => {
      if (brushStroke && event.pointerId === brushStroke.pointerId) {
        cursorPoint = pointFromEvent(event);
        appendBrushPoint(brushStroke.stroke, cursorPoint);
        brushStroke = null;
        requestRedraw();
        return;
      }
      if (!drag || event.pointerId !== drag.pointerId) return;
      drag = null;
      renderControls();
      redraw();
    };
    objectLayer.addEventListener('pointerup', finishPointer);
    objectLayer.addEventListener('pointercancel', event => {
      if (brushStroke?.pointerId === event.pointerId) brushStroke = null;
      if (drag?.pointerId === event.pointerId) drag = null;
      requestRedraw();
    });
    objectLayer.addEventListener('pointerleave', () => {
      if (!brushStroke) { cursorPoint = null; updateBrushCursor(); }
    });
    objectLayer.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); cancelActive(); }
      if (event.key === 'Enter' && activeId) { event.preventDefault(); commitActive(); }
      if ((event.key === 'Delete' || event.key === 'Backspace') && activeId && !event.target.matches('input,textarea')) {
        event.preventDefault();
        const index = items.findIndex(entry => entry.id === activeId);
        if (index >= 0) items.splice(index, 1);
        activeId = null; activeSnapshot = null; activeWasNew = false; brushStroke = null; cursorPoint = null;
        renderControls(); redraw();
      }
    });

    const handleDetailsToggle = () => {
      if (details && !details.open && activeItem()?.type === 'blur') commitActive();
    };
    details?.addEventListener('toggle', handleDetailsToggle);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(requestRedraw) : null;
    observer?.observe(surface);
    renderControls();
    redraw();

    return {
      redraw,
      cancelActive,
      setSuspended(value) {
        suspended = Boolean(value);
        if (suspended) { brushStroke = null; cursorPoint = null; }
        renderOverlay();
      },
      items: () => clone(items),
      select: selectItem,
      add: addTool,
      destroy() {
        observer?.disconnect();
        details?.removeEventListener('toggle', handleDetailsToggle);
        if (redrawFrame) cancelAnimationFrame(redrawFrame);
        preview.remove();
        objectLayer.remove();
      }
    };
  }

  window.NEXPhotoTools = Object.freeze({ ensureRecord, draw, mount });
})();
