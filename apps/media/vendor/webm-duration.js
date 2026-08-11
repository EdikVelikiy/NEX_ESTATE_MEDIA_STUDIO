/*
 * WebM duration metadata repair for MediaRecorder output.
 * Adapted from fix-webm-duration 1.0.6 by Yury Sitnikov (MIT).
 * The distribution license is retained in webm-duration-LICENSE.txt.
 */
(function installWebmDurationRepair(global) {
  'use strict';

  const TYPES = {
    0x0a45dfa3: 'container', // EBML
    0x08538067: 'container', // Segment
    0x0549a966: 'container', // Info
    0x0ad7b1: 'uint',        // TimecodeScale
    0x0489: 'float'         // Duration
  };

  function inherit(child, parent) {
    child.prototype = Object.create(parent.prototype);
    child.prototype.constructor = child;
  }

  function Element(type) {
    this.type = type || 'binary';
    this.source = new Uint8Array(0);
    this.data = null;
  }
  Element.prototype.setSource = function setSource(source) {
    this.source = source;
    this.read();
  };
  Element.prototype.setData = function setData(data) {
    this.data = data;
    this.write();
  };
  Element.prototype.read = function read() {};
  Element.prototype.write = function write() {};

  function UintElement() {
    Element.call(this, 'uint');
  }
  inherit(UintElement, Element);
  UintElement.prototype.read = function readUintElement() {
    let hex = '';
    for (let index = 0; index < this.source.length; index += 1) {
      const part = this.source[index].toString(16);
      hex += part.length % 2 ? `0${part}` : part;
    }
    this.data = hex;
  };
  UintElement.prototype.write = function writeUintElement() {
    const length = this.data.length / 2;
    this.source = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) {
      this.source[index] = parseInt(this.data.slice(index * 2, index * 2 + 2), 16);
    }
  };
  UintElement.prototype.value = function uintValue() {
    return parseInt(this.data || '0', 16);
  };
  UintElement.prototype.setValue = function setUintValue(value) {
    let hex = Math.max(0, Number(value) || 0).toString(16);
    if (hex.length % 2) hex = `0${hex}`;
    this.setData(hex);
  };

  function FloatElement() {
    Element.call(this, 'float');
  }
  inherit(FloatElement, Element);
  FloatElement.prototype.read = function readFloatElement() {
    const copy = this.source.slice().reverse();
    const View = copy.length === 4 ? Float32Array : Float64Array;
    this.data = new View(copy.buffer)[0];
  };
  FloatElement.prototype.write = function writeFloatElement() {
    const View = this.source?.length === 4 ? Float32Array : Float64Array;
    this.source = new Uint8Array(new View([this.data]).buffer).reverse();
  };
  FloatElement.prototype.value = function floatValue() {
    return this.data;
  };
  FloatElement.prototype.setValue = function setFloatValue(value) {
    this.setData(Number(value));
  };

  function Container() {
    Element.call(this, 'container');
    this.offset = 0;
  }
  inherit(Container, Element);
  Container.prototype.readByte = function readByte() {
    return this.source[this.offset++];
  };
  Container.prototype.readVariableInteger = function readVariableInteger() {
    const first = this.readByte();
    if (!Number.isFinite(first)) throw new Error('Unexpected end of EBML data.');
    const bytes = 8 - first.toString(2).length;
    let value = first - (1 << (7 - bytes));
    for (let index = 0; index < bytes; index += 1) value = value * 256 + this.readByte();
    return value;
  };
  Container.prototype.read = function readContainer() {
    this.data = [];
    for (this.offset = 0; this.offset < this.source.length;) {
      const id = this.readVariableInteger();
      const length = this.readVariableInteger();
      const end = Math.min(this.offset + length, this.source.length);
      if (!Number.isFinite(end) || end < this.offset) throw new Error('Invalid EBML section length.');
      const source = this.source.slice(this.offset, end);
      const type = TYPES[id] || 'binary';
      const Child = type === 'container' ? Container : type === 'uint' ? UintElement : type === 'float' ? FloatElement : Element;
      const child = new Child(type);
      child.setSource(source);
      this.data.push({ id, child });
      this.offset = end;
    }
  };
  Container.prototype.writeVariableInteger = function writeVariableInteger(value, draft) {
    let bytes = 1;
    let flag = 0x80;
    while (value >= flag && bytes < 8) {
      bytes += 1;
      flag *= 0x80;
    }
    if (!draft) {
      let encoded = flag + value;
      for (let index = bytes - 1; index >= 0; index -= 1) {
        const byte = encoded % 256;
        this.source[this.offset + index] = byte;
        encoded = (encoded - byte) / 256;
      }
    }
    this.offset += bytes;
  };
  Container.prototype.writeSections = function writeSections(draft) {
    this.offset = 0;
    for (const section of this.data) {
      const content = section.child.source;
      this.writeVariableInteger(section.id, draft);
      this.writeVariableInteger(content.length, draft);
      if (!draft) this.source.set(content, this.offset);
      this.offset += content.length;
    }
    return this.offset;
  };
  Container.prototype.write = function writeContainer() {
    this.source = new Uint8Array(this.writeSections(true));
    this.writeSections(false);
  };
  Container.prototype.section = function section(id) {
    return this.data.find(item => item.id === id)?.child || null;
  };

  function WebmFile(source) {
    Container.call(this);
    this.setSource(source);
  }
  inherit(WebmFile, Container);
  WebmFile.prototype.repair = function repair(durationMs, force) {
    const segment = this.section(0x08538067);
    const info = segment?.section?.(0x0549a966);
    const timecodeScale = info?.section?.(0x0ad7b1);
    if (!segment || !info || !timecodeScale) return false;

    let duration = info.section(0x0489);
    if (duration && Number.isFinite(duration.value()) && duration.value() > 0 && !force) return false;
    if (!duration) {
      duration = new FloatElement();
      duration.setValue(durationMs);
      info.data.push({ id: 0x0489, child: duration });
    } else {
      duration.setValue(durationMs);
    }
    timecodeScale.setValue(1_000_000);
    info.write();
    segment.write();
    this.write();
    return true;
  };

  async function repairWebmDuration(blob, durationMs, options = {}) {
    if (!(blob instanceof Blob) || !/webm/i.test(blob.type || '')) return blob;
    if (!Number.isFinite(durationMs) || durationMs <= 0) return blob;
    try {
      const file = new WebmFile(new Uint8Array(await blob.arrayBuffer()));
      if (!file.repair(durationMs, options.force === true)) return blob;
      return new Blob([file.source], { type: blob.type || 'video/webm' });
    } catch (error) {
      if (options.logger) options.logger(`WebM duration repair skipped: ${error?.message || error}`);
      return blob;
    }
  }

  global.NEXRepairWebmDuration = repairWebmDuration;
})(window);
