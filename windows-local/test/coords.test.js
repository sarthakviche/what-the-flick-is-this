'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { markToShape, shapeAnchor, pickDisplayForScreenNumber } = require('../src/core/coords');

const displaySize = { width: 1920, height: 1080 };

test('circle is centred on the box and padded', () => {
  const shape = markToShape({ type: 'circle', box_2d: [400, 400, 600, 600], label: 'x' }, displaySize);
  assert.equal(shape.kind, 'circle');
  assert.equal(Math.round(shape.cx), 960);
  assert.equal(Math.round(shape.cy), 540);
  assert.ok(shape.rx > 0.1 * 1920 && shape.ry > 0.1 * 1080);
});

test('box and underline geometry in DIP pixels', () => {
  const box = markToShape({ type: 'box', box_2d: [100, 200, 300, 600] }, displaySize);
  assert.deepEqual([box.x, box.y, box.width, box.height], [384, 108, 768, 216]);
  const underline = markToShape({ type: 'underline', box_2d: [100, 200, 150, 600] }, displaySize);
  assert.equal(underline.x1, 384);
  assert.equal(underline.x2, 1152);
  assert.ok(underline.y > 150 * 1.08);
});

test('arrow without tail comes from the upper left and stays on screen', () => {
  const arrow = markToShape({ type: 'arrow', to: [50, 50] }, displaySize);
  assert.ok(arrow.x1 >= 0 && arrow.y1 >= 0);
  assert.ok(arrow.x1 <= arrow.x2 && arrow.y1 <= arrow.y2);
  const withTail = markToShape({ type: 'arrow', from: [900, 900], to: [500, 500] }, displaySize);
  assert.equal(withTail.x1, 1728);
});

test('point maps and anchors', () => {
  const shape = markToShape({ type: 'point', point: [500, 250] }, displaySize);
  assert.deepEqual(shapeAnchor(shape), { x: 480, y: 540 });
  assert.equal(markToShape(null, displaySize), null);
});

test('screen number picks display, out of range falls back to first', () => {
  const displays = [{ id: 1 }, { id: 2 }];
  assert.equal(pickDisplayForScreenNumber(2, displays).id, 2);
  assert.equal(pickDisplayForScreenNumber(9, displays).id, 1);
  assert.equal(pickDisplayForScreenNumber(1, []), null);
});
