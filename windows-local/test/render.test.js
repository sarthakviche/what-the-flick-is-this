'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { shapeToSvg } = require('../src/renderer/overlay/shapeToSvg');
const { encodeWav, resample } = require('../src/renderer/recorder/wavEncoder');

test('every shape kind renders SVG and labels are escaped', () => {
  assert.match(shapeToSvg({ kind: 'circle', cx: 10, cy: 10, rx: 20, ry: 10, label: '' }), /<ellipse/);
  assert.match(shapeToSvg({ kind: 'box', x: 1, y: 2, width: 3, height: 4, label: '' }), /<rect/);
  assert.match(shapeToSvg({ kind: 'underline', x1: 0, x2: 50, y: 20, label: '' }), /<path/);
  assert.match(shapeToSvg({ kind: 'arrow', x1: 0, y1: 0, x2: 50, y2: 50, label: '' }), /<path/);
  assert.match(shapeToSvg({ kind: 'point', x: 5, y: 5, label: '' }), /<circle/);
  assert.equal(shapeToSvg({ kind: 'nope' }), '');
  const svg = shapeToSvg({ kind: 'box', x: 0, y: 0, width: 5, height: 5, label: '<img onerror=x>' });
  assert.ok(!svg.includes('<img'));
  assert.ok(svg.includes('&lt;img'));
});

test('wav encoder writes a valid 16 kHz mono header and resamples', () => {
  const oneSecondAt48k = new Float32Array(48000).fill(0.5);
  const wav = encodeWav([oneSecondAt48k], 48000);
  const view = new DataView(wav.buffer);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...wav.slice(8, 12)), 'WAVE');
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(40, true), 16000 * 2);
  assert.ok(Math.abs(view.getInt16(44, true) - 0.5 * 0x7fff) <= 1);
  assert.equal(resample(new Float32Array(10), 16000, 16000).length, 10);
});
