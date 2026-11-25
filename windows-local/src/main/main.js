'use strict';
const { app, BrowserWindow, Menu, Tray, globalShortcut, ipcMain, nativeImage, session: electronSession } = require('electron');
const path = require('node:path');

const { loadConfiguration, parsePushToTalkKeys } = require('./config');
const { captureAllScreens } = require('./capture');
const { OverlayManager } = require('./overlayManager');
const { BoardWindow } = require('./boardWindow');
const { RecorderController } = require('./recorderController');
const { startPushToTalk } = require('./hotkey');
const { CompanionSession } = require('../core/session');
const { SYSTEM_PROMPT } = require('../core/prompt');
const { createLlmProvider, createSttProvider, createTtsProvider } = require('../providers');

const MINIMUM_RECORDING_BYTES = 16000 * 2 * 0.4; // ~0.4 s of 16 kHz 16 bit audio, shorter is a mis-press
const environment = loadConfiguration();

let panelWindow = null;
let tray = null;
let companionSession = null;
let speechToText = null;
let overlayManager = null;
let boardWindow = null;
let recorderController = null;
let pushToTalkHandle = null;
let isMicToggledOn = false;
let isQuitting = false;

function log(message) {
  console.log(`[flick] ${message}`);
}

function reportStatus(stateName, detail) {
  log(`${stateName}${detail ? `: ${detail}` : ''}`);
  panelWindow?.webContents.send('panel:status', { stateName, detail });
  overlayManager?.showStatus({ stateName, detail });
}

function createPanelWindow() {
  panelWindow = new BrowserWindow({
    width: 380,
    height: 440,
    title: 'what the flick is this',
    autoHideMenuBar: true,
    backgroundColor: '#12151c',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  panelWindow.setMenu(null);
  panelWindow.loadFile(path.join(__dirname, '..', 'renderer', 'panel', 'panel.html'));
  // Closing the panel hides it to the tray instead of quitting.
  panelWindow.on('close', (event) => {
    if (!isQuitting) { event.preventDefault(); panelWindow.hide(); }
  });
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', 'tray.png')));
  tray.setToolTip('what the flick is this');
  tray.on('click', () => panelWindow.show());
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open panel', click: () => panelWindow.show() },
    { label: 'Toggle whiteboard', click: () => boardWindow.toggle() },
    { label: 'Clear marks', click: () => companionSession.clearMarks() },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
  ]));
}

async function startListening() {
  companionSession.cancelCurrentAnswer();
  reportStatus('listening', 'Release to send');
  try {
    await recorderController.start();
  } catch (error) {
    reportStatus('error', `Microphone failed: ${error.message}`);
  }
}

async function stopListeningAndAnswer() {
  reportStatus('thinking', 'Transcribing');
  const wavBuffer = await recorderController.stop();
  if (wavBuffer.length < MINIMUM_RECORDING_BYTES) { reportStatus('idle', 'Too short, hold the keys while you speak.'); return; }
  if (!speechToText) { reportStatus('error', 'STT_PROVIDER=none, type your question in the panel instead.'); return; }
  try {
    const transcript = await speechToText.transcribe(wavBuffer);
    log(`heard: ${transcript}`);
    await companionSession.ask(transcript);
  } catch (error) {
    reportStatus('error', `Transcription failed: ${error.message}`);
  }
}

async function cancelListening() {
  await recorderController.stop();
  reportStatus('idle', '');
}

function registerIpcHandlers() {
  ipcMain.on('panel:ask', (_event, questionText) => { companionSession.ask(questionText); });
  ipcMain.on('panel:clear-marks', () => companionSession.clearMarks());
  ipcMain.on('panel:toggle-board', () => boardWindow.toggle());
  ipcMain.on('panel:cancel', () => { companionSession.cancelCurrentAnswer(); reportStatus('idle', ''); });
  ipcMain.on('panel:toggle-mic', () => toggleMic());
  ipcMain.on('board:close', () => boardWindow.hide());
  ipcMain.on('board:clear-request', () => boardWindow.clear());
}

function toggleMic() {
  isMicToggledOn = !isMicToggledOn;
  if (isMicToggledOn) startListening();
  else stopListeningAndAnswer();
}

function configureMicrophonePermission() {
  // Only our own bundled pages (file://) may use the microphone.
  const isOwnPage = (url) => String(url).startsWith('file://');
  electronSession.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'media' && isOwnPage(webContents.getURL()));
  });
  electronSession.defaultSession.setPermissionCheckHandler((webContents, permission) => permission === 'media' && (!webContents || isOwnPage(webContents.getURL())));
}

app.whenReady().then(() => {
  configureMicrophonePermission();
  const excludeFromCapture = String(environment.EXCLUDE_OVERLAY_FROM_CAPTURE || 'true').toLowerCase() !== 'false';

  overlayManager = new OverlayManager({ excludeFromCapture });
  boardWindow = new BoardWindow({});
  recorderController = new RecorderController();

  let llmProvider;
  let ttsProvider;
  try {
    llmProvider = createLlmProvider(environment);
    ttsProvider = createTtsProvider(environment, log);
    speechToText = createSttProvider(environment);
  } catch (error) {
    log(`Configuration problem: ${error.message}`);
    createPanelWindow();
    panelWindow.webContents.once('did-finish-load', () => reportStatus('error', error.message));
    return;
  }

  const captureWithOptionalHiding = async () => {
    if (excludeFromCapture) return captureAllScreens();
    overlayManager.setVisible(false);
    await new Promise((resolve) => setTimeout(resolve, 120));
    try { return await captureAllScreens(); } finally { overlayManager.setVisible(true); }
  };

  companionSession = new CompanionSession({
    llm: llmProvider,
    tts: ttsProvider,
    captureScreens: captureWithOptionalHiding,
    overlay: overlayManager,
    board: boardWindow,
    reportStatus,
    systemPrompt: SYSTEM_PROMPT,
  });

  overlayManager.start();
  createPanelWindow();
  createTray();
  registerIpcHandlers();

  globalShortcut.register('Control+Alt+Space', toggleMic);
  globalShortcut.register('Alt+Shift+X', () => companionSession.clearMarks());

  pushToTalkHandle = startPushToTalk({
    modifierNames: parsePushToTalkKeys(environment.PUSH_TO_TALK_KEYS),
    onStart: startListening,
    onStop: stopListeningAndAnswer,
    onCancel: cancelListening,
    log,
  });
  panelWindow.webContents.once('did-finish-load', () => {
    panelWindow.webContents.send('panel:status', {
      stateName: 'idle',
      detail: pushToTalkHandle.available
        ? `Hold ${parsePushToTalkKeys(environment.PUSH_TO_TALK_KEYS).join('+')} to talk. Alt+Shift+X clears marks.`
        : 'Hotkey hook unavailable. Use Ctrl+Alt+Space, the mic button or type.',
    });
  });
});

app.on('before-quit', () => { isQuitting = true; });
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  pushToTalkHandle?.stop();
  speechToText?.dispose?.();
});
// Stay alive in the tray when all windows are hidden.
app.on('window-all-closed', () => {});
