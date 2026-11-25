'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CompanionSession } = require('../src/core/session');

function buildHarness(plan, overrides = {}) {
  const events = [];
  const screenshots = [
    { label: 'screen1', displayId: 10, displaySize: { width: 1000, height: 500 }, width: 1000, height: 500, mimeType: 'image/jpeg', base64: 'AA' },
    { label: 'screen2', displayId: 20, displaySize: { width: 2000, height: 1000 }, width: 2000, height: 1000, mimeType: 'image/jpeg', base64: 'BB' },
  ];
  const session = new CompanionSession({
    llm: { generatePlan: async (request) => { events.push(['llm', request.userText, request.history.length]); return plan; } },
    tts: { speak: async (text) => { events.push(['speak', text]); }, stop: () => events.push(['stop']) },
    captureScreens: async () => screenshots,
    overlay: { addShape: (displayId, shape) => events.push(['shape', displayId, shape.kind]), clearAll: () => events.push(['clearMarks']) },
    board: { clear: () => events.push(['boardClear']), show: () => events.push(['boardShow']), append: (line) => events.push(['boardLine', line.content]) },
    reportStatus: (state) => events.push(['status', state]),
    systemPrompt: 'sys',
    ...overrides,
  });
  return { session, events };
}

const samplePlan = {
  mode: 'whiteboard',
  steps: [
    { say: 'first', screen: 1, mark: { type: 'circle', box_2d: [100, 100, 300, 300], label: '' }, board: [], clearBoard: false },
    { say: 'second', screen: 2, mark: { type: 'box', box_2d: [0, 0, 500, 500], label: '' }, board: [{ kind: 'math', content: 'a+b', lang: '' }], clearBoard: true },
  ],
};

test('plays steps in order, draws on the right display, fills board', async () => {
  const { session, events } = buildHarness(samplePlan);
  await session.ask('what is this');
  await new Promise((resolve) => setTimeout(resolve, 600)); // board lines reveal on a timed queue
  const names = events.map((event) => event.slice(0, 3).join(':'));
  assert.ok(names.indexOf('shape:10:circle') < names.indexOf('speak:first'));
  assert.ok(names.indexOf('speak:first') < names.indexOf('shape:20:box'));
  assert.ok(names.includes('boardClear'));
  assert.ok(events.some((event) => event[0] === 'boardLine' && event[1] === 'a+b'));
  assert.ok(events.some((event) => event[0] === 'status' && event[1] === 'idle'));
});

test('history is remembered and trimmed', async () => {
  const { session, events } = buildHarness(samplePlan);
  await session.ask('one');
  await session.ask('two');
  const llmCalls = events.filter((event) => event[0] === 'llm');
  assert.equal(llmCalls[1][2], 2);
  session.maxHistoryTurns = 1;
  await session.ask('three');
  assert.equal(session.conversationHistory.length, 2);
});

test('empty question does nothing, errors are reported not thrown', async () => {
  const { session, events } = buildHarness(samplePlan);
  assert.equal(await session.ask('   '), null);
  assert.equal(events.filter((event) => event[0] === 'llm').length, 0);
  const failing = buildHarness(samplePlan, { llm: { generatePlan: async () => { throw new Error('boom'); } } });
  await failing.session.ask('x');
  assert.deepEqual(failing.events.at(-1), ['status', 'error']);
});

test('a broken voice does not block marks or later steps', async () => {
  const { session, events } = buildHarness(samplePlan, {
    tts: { speak: async () => { throw new Error('no voice'); }, stop: () => {} },
  });
  await session.ask('x');
  assert.ok(events.some((event) => event[0] === 'shape' && event[1] === 20));
  assert.ok(events.some((event) => event[0] === 'status' && event[1] === 'warning'));
});

test('a new question cancels the previous answer', async () => {
  let releaseFirstSpeech;
  let hasHeldFirstSpeech = false;
  const events = [];
  const { session } = buildHarness(samplePlan, {
    tts: {
      speak: (text) => { events.push(text); if (text === 'first' && !hasHeldFirstSpeech) { hasHeldFirstSpeech = true; return new Promise((resolve) => { releaseFirstSpeech = resolve; }); } return Promise.resolve(); },
      stop: () => { if (releaseFirstSpeech) releaseFirstSpeech(); },
    },
  });
  const firstAnswer = session.ask('one');
  await new Promise((resolve) => setTimeout(resolve, 20));
  const secondAnswer = session.ask('two');
  await Promise.all([firstAnswer, secondAnswer]);
  assert.equal(events.filter((text) => text === 'second').length, 1, 'first answer must not continue to its second step');
});

test('board lines stay in order across steps even when speech is instant', async () => {
  const lines = [];
  const plan = { mode: 'whiteboard', steps: [
    { say: 'a', screen: 1, mark: null, clearBoard: true, board: [{ kind: 'text', content: '1' }, { kind: 'text', content: '2' }, { kind: 'text', content: '3' }] },
    { say: 'b', screen: 1, mark: null, clearBoard: false, board: [{ kind: 'text', content: '4' }, { kind: 'text', content: '5' }] },
  ] };
  const { session } = buildHarness(plan, {
    board: { clear: () => lines.push('clear'), show: () => {}, append: (line) => lines.push(line.content) },
  });
  await session.ask('x');
  await new Promise((resolve) => setTimeout(resolve, 450 * 5 + 100));
  assert.deepEqual(lines, ['clear', '1', '2', '3', '4', '5']);
});
