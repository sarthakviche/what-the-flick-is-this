'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePlan, parsePlanFromText, normalizeMark, toGeminiSchema, RESPONSE_JSON_SCHEMA } = require('../src/core/schema');

test('normalizeMark accepts every mark type', () => {
  assert.deepEqual(normalizeMark({ type: 'circle', box_2d: [100, 200, 300, 400], label: 'run' }), { type: 'circle', box_2d: [100, 200, 300, 400], label: 'run' });
  assert.equal(normalizeMark({ type: 'box', box_2d: [0, 0, 500, 500] }).type, 'box');
  assert.equal(normalizeMark({ type: 'underline', box_2d: [10, 10, 40, 300] }).type, 'underline');
  assert.deepEqual(normalizeMark({ type: 'point', point: [500, 600] }).point, [500, 600]);
  assert.deepEqual(normalizeMark({ type: 'arrow', to: [500, 600] }).to, [500, 600]);
});

test('normalizeMark clamps, reorders and rejects bad geometry', () => {
  assert.deepEqual(normalizeMark({ type: 'box', box_2d: [-5, 1200, 300, 100] }).box_2d, [0, 100, 300, 1000]);
  assert.equal(normalizeMark({ type: 'box', box_2d: [1, 2, 3] }), null);
  assert.equal(normalizeMark({ type: 'box', box_2d: [10, 10, 10, 10] }), null);
  assert.equal(normalizeMark({ type: 'star' }), null);
  assert.equal(normalizeMark({ type: 'circle' }), null);
  assert.equal(normalizeMark({ type: 'point', point: ['a', 2] }), null);
});

test('point falls back to the centre of a box and arrow target falls back too', () => {
  assert.deepEqual(normalizeMark({ type: 'point', box_2d: [0, 0, 100, 200] }).point, [50, 100]);
  assert.deepEqual(normalizeMark({ type: 'arrow', box_2d: [0, 0, 100, 200] }).to, [50, 100]);
});

test('xyxy box order is swapped into ymin,xmin,ymax,xmax', () => {
  const mark = normalizeMark({ type: 'box', box_2d: [100, 20, 300, 60] }, { boxOrder: 'xyxy' });
  assert.deepEqual(mark.box_2d, [20, 100, 60, 300]);
});

test('normalizePlan drops empty steps and unusable marks but keeps speech', () => {
  const plan = normalizePlan({
    mode: 'annotate',
    steps: [
      { say: 'look here', mark: { type: 'circle' } },
      { say: '', board: [] },
      { say: 'second', screen: 2, board: [{ kind: 'math', content: 'x^2' }, { kind: 'bogus', content: 'x' }, { kind: 'text', content: '  ' }], clear_board: true },
    ],
  });
  assert.equal(plan.steps.length, 2);
  assert.equal(plan.steps[0].mark, null);
  assert.equal(plan.steps[1].screen, 2);
  assert.equal(plan.steps[1].board.length, 1);
  assert.equal(plan.steps[1].clearBoard, true);
  assert.equal(plan.mode, 'annotate');
});

test('parsePlanFromText handles fenced JSON, JSON with chatter, plain text and legacy tags', () => {
  const json = '{"steps":[{"say":"hi"}]}';
  assert.equal(parsePlanFromText('```json\n' + json + '\n```').steps[0].say, 'hi');
  assert.equal(parsePlanFromText('Sure! ' + json + ' done').steps[0].say, 'hi');
  assert.equal(parsePlanFromText('just words').steps[0].say, 'just words');
  assert.equal(parsePlanFromText('').steps.length, 0);
  const legacy = parsePlanFromText('click save [POINT:500,250:save button]', { screenshotSizes: [{ width: 1000, height: 500 }] });
  assert.deepEqual(legacy.steps[0].mark.point, [500, 500]);
  assert.equal(legacy.steps[0].say, 'click save');
  assert.equal(parsePlanFromText('no pointing [POINT:none]').steps[0].mark, null);
});

test('toGeminiSchema uppercases types and keeps structure', () => {
  const converted = toGeminiSchema(RESPONSE_JSON_SCHEMA);
  assert.equal(converted.type, 'OBJECT');
  assert.equal(converted.properties.steps.items.properties.say.type, 'STRING');
  assert.equal(converted.properties.steps.items.properties.mark.properties.box_2d.items.type, 'INTEGER');
  assert.deepEqual(converted.required, ['steps']);
});
