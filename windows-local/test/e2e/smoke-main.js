'use strict';
// Manual smoke test: xvfb-run -a npx electron --no-sandbox test/e2e/smoke-main.js
// Drives the REAL overlay, board and capture code with a fake model and silent voice, then saves screenshots.
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { OverlayManager } = require('../../src/main/overlayManager');
const { BoardWindow } = require('../../src/main/boardWindow');
const { captureAllScreens } = require('../../src/main/capture');
const { CompanionSession } = require('../../src/core/session');
const { SilentTtsProvider } = require('../../src/providers/tts/none');

const outputDirectory = process.env.SMOKE_OUT || '/tmp/smoke';
fs.mkdirSync(outputDirectory, { recursive: true });
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const fakePlan = {
  mode: 'whiteboard',
  steps: [
    { say: 'this circle is around the middle of the screen', screen: 1, mark: { type: 'circle', box_2d: [400, 400, 520, 560], label: 'main thing' }, board: [{ kind: 'heading', content: 'Integration by parts', lang: '' }], clearBoard: true },
    { say: 'now a box and an underline', screen: 1, mark: { type: 'box', box_2d: [100, 100, 250, 450], label: 'a box' }, board: [{ kind: 'math', content: '\\int u\\,dv = uv - \\int v\\,du', lang: '' }, { kind: 'text', content: 'pick u so that du gets simpler', lang: '' }], clearBoard: false },
    { say: 'underline and arrow', screen: 1, mark: { type: 'underline', box_2d: [700, 100, 740, 500], label: 'key line' }, board: [{ kind: 'code', content: 'def f(n):\n    return n * f(n - 1) if n else 1', lang: 'python' }, { kind: 'diagram', content: 'flowchart LR\n A[question] --> B[answer]', lang: '' }], clearBoard: false },
    { say: 'arrow', screen: 1, mark: { type: 'arrow', to: [300, 800], label: 'look here' }, board: [], clearBoard: false },
  ],
};

app.whenReady().then(async () => {
  const overlay = new OverlayManager({ excludeFromCapture: false });
  const board = new BoardWindow({});
  overlay.start();
  const statuses = [];
  const session = new CompanionSession({
    llm: { generatePlan: async () => fakePlan },
    tts: new SilentTtsProvider({ wordsPerMinute: 6000 }),
    captureScreens: async () => { const shots = await captureAllScreens(); statuses.push(`captured ${shots.length} screen(s), ${shots[0].width}x${shots[0].height}, jpeg ${Math.round(shots[0].base64.length / 1024)}KB`); return shots; },
    overlay, board,
    reportStatus: (state, detail) => statuses.push(`${state}:${detail}`),
    systemPrompt: 'x',
  });
  await wait(1500);
  await session.ask('what is this?');
  await wait(4500); // board lines reveal + mermaid render
  const overlayWindow = [...overlay.windowsByDisplayId.values()][0];
  fs.writeFileSync(path.join(outputDirectory, 'overlay.png'), (await overlayWindow.webContents.capturePage()).toPNG());
  fs.writeFileSync(path.join(outputDirectory, 'board.png'), (await board.window.webContents.capturePage()).toPNG());
  fs.writeFileSync(path.join(outputDirectory, 'status.txt'), statuses.join('\n'));
  session.clearMarks();
  await wait(300);
  const svgCountAfterClear = await overlayWindow.webContents.executeJavaScript("document.querySelectorAll('#marks > *').length");
  fs.appendFileSync(path.join(outputDirectory, 'status.txt'), `\nmarks after clear: ${svgCountAfterClear}\n`);
  app.exit(0);
});
