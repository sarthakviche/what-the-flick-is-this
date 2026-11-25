'use strict';
const { app, BrowserWindow, Menu, Tray, globalShortcut, ipcMain, nativeImage, shell, session: electronSession } = require('electron');
const path = require('node:path');
const { fork } = require('node:child_process');

const { loadConfiguration, parsePushToTalkKeys } = require('./config');
const { ensureEnvFileExists, saveSettings, readSettingsForPanel } = require('./settingsStore');
const { checkGeminiKey, checkGroqKey } = require('./keyCheck');
const { captureAllScreens } = require('./capture');
const { OverlayManager } = require('./overlayManager');
const { BoardWindow } = require('./boardWindow');
const { RecorderController } = require('./recorderController');
const { AudioPlayer } = require('./audioPlayer');
const { UsageCounter } = require('./usageCounter');
const { startPushToTalk } = require('./hotkey');
const { CompanionSession } = require('../core/session');
const { SYSTEM_PROMPT } = require('../core/prompt');
const { createLlmProvider, createSttProvider, createTtsProvider } = require('../providers');
const { SilentTtsProvider } = require('../providers/tts/none');
const { setGeminiRequestListener } = require('../providers/geminiRequest');

const MINIMUM_RECORDING_BYTES = 16000 * 2 * 0.4; // ~0.4 s of 16 kHz 16 bit audio, shorter is a mis-press
const APP_ICON_PATH = path.join(__dirname, '..', '..', 'assets', 'icon.png');
const KOKORO_WORKER_PATH = path.join(__dirname, '..', 'providers', 'tts', 'kokoroWorker.mjs');
// The keys page may only open these sites, so a compromised page can never launch arbitrary URLs.
const ALLOWED_EXTERNAL_LINK_PREFIXES = [
  'https://aistudio.google.com/',
  'https://console.groq.com/',
  'https://ai.google.dev/',
  'https://ollama.com/',
];

ensureEnvFileExists();
const environment = loadConfiguration();

let panelWindow = null;
let tray = null;
let companionSession = null;
let speechToText = null;
let overlayManager = null;
let boardWindow = null;
let recorderController = null;
let audioPlayer = null;
let usageCounter = null;
let currentTtsProvider = null;
let currentTtsSettingsKey = '';
let pushToTalkHandle = null;
let isMicToggledOn = false;
let isQuitting = false;
let providerSetupProblem = '';

function log(message) {
  console.log(`[flick] ${message}`);
}

function reportStatus(stateName, detail) {
  log(`${stateName}${detail ? `: ${detail}` : ''}`);
  panelWindow?.webContents.send('panel:status', { stateName, detail });
  overlayManager?.showStatus({ stateName, detail });
}

function showPanelPage(pageName) {
  panelWindow.show();
  panelWindow.webContents.send('panel:show-page', pageName);
}

/** Stand-in brain used until the user adds a key, so asking explains what to do instead of crashing. */
function createMissingKeyLlm(problemMessage) {
  return {
    async generatePlan() {
      showPanelPage('keys');
      throw new Error(problemMessage);
    },
  };
}

/**
 * Builds the brain, ears and voice from the current settings. Called at startup and every time the
 * keys page saves, so new keys work without restarting the app.
 */
function rebuildProviders() {
  providerSetupProblem = '';
  let llmProvider;
  try {
    llmProvider = createLlmProvider(environment);
  } catch (error) {
    providerSetupProblem = error.message;
    llmProvider = createMissingKeyLlm(error.message);
  }
  const ttsProvider = rebuildVoiceIfSettingsChanged();
  speechToText?.dispose?.();
  try {
    speechToText = createSttProvider(environment);
  } catch (error) {
    speechToText = null;
    providerSetupProblem = providerSetupProblem || error.message;
  }
  if (companionSession) {
    companionSession.cancelCurrentAnswer();
    companionSession.llm = llmProvider;
    companionSession.tts = ttsProvider;
  }
  return { llmProvider, ttsProvider };
}

/**
 * Kokoro runs in a child process (forked with Electron's own Node) and plays through a hidden
 * renderer. The voice is only rebuilt when voice settings change, because starting Kokoro
 * reloads its model.
 */
function rebuildVoiceIfSettingsChanged() {
  const ttsSettingsKey = [environment.TTS_PROVIDER, environment.KOKORO_VOICE, environment.SAPI_VOICE, environment.SAPI_RATE, environment.PIPER_MODEL].join('|');
  if (currentTtsProvider && ttsSettingsKey === currentTtsSettingsKey) return currentTtsProvider;
  currentTtsProvider?.stop?.();
  currentTtsProvider?.dispose?.();
  const kokoroCollaborators = {
    startWorker: () => fork(KOKORO_WORKER_PATH, [], {
      env: { ...process.env, KOKORO_VOICE: environment.KOKORO_VOICE || 'af_heart' },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    }),
    playWav: (wavBuffer) => audioPlayer.play(wavBuffer),
    stopPlayback: () => audioPlayer.stop(),
  };
  try {
    currentTtsProvider = createTtsProvider(environment, log, kokoroCollaborators);
  } catch (error) {
    log(`Voice problem, staying silent: ${error.message}`);
    currentTtsProvider = new SilentTtsProvider({ log });
  }
  currentTtsSettingsKey = ttsSettingsKey;
  return currentTtsProvider;
}

/** Cuts the region a step talks about out of the screenshot, for the whiteboard snapshot. */
function cropScreenshotToDataUrl(screenshot, cropRectangle) {
  const fullImage = nativeImage.createFromBuffer(Buffer.from(screenshot.base64, 'base64'));
  const croppedImage = fullImage.crop(cropRectangle);
  return `data:image/jpeg;base64,${croppedImage.toJPEG(88).toString('base64')}`;
}

function sendUsageToPanel() {
  if (usageCounter) panelWindow?.webContents.send('panel:usage', usageCounter.summary());
}

function idleHint() {
  if (providerSetupProblem) return `Add your free key on the keys page first. ${providerSetupProblem}`;
  const pushToTalkKeys = parsePushToTalkKeys(environment.PUSH_TO_TALK_KEYS).join(' + ');
  return pushToTalkHandle?.available
    ? `Open your slides, hold ${pushToTalkKeys} and ask away. Answers show up on the whiteboard.`
    : 'Hotkey hook unavailable. Use Ctrl+Alt+Space, the mic button or type.';
}

function createPanelWindow() {
  panelWindow = new BrowserWindow({
    width: 440,
    height: 680,
    minWidth: 380,
    minHeight: 520,
    title: 'what the flick is this?',
    icon: APP_ICON_PATH,
    autoHideMenuBar: true,
    backgroundColor: '#fdf8ec',
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
  tray = new Tray(nativeImage.createFromPath(APP_ICON_PATH).resize({ width: 16, height: 16, quality: 'best' }));
  tray.setToolTip('what the flick is this?');
  tray.on('click', () => panelWindow.show());
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open panel', click: () => showPanelPage('ask') },
    { label: 'API keys', click: () => showPanelPage('keys') },
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
  if (!speechToText) {
    reportStatus('error', providerSetupProblem || 'Voice input is off. Type your question in the panel instead.');
    return;
  }
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
  ipcMain.on('panel:clear-marks', () => { companionSession.clearMarks(); boardWindow.clear(); });
  ipcMain.on('panel:toggle-board', () => boardWindow.toggle());
  ipcMain.on('panel:cancel', () => { companionSession.cancelCurrentAnswer(); reportStatus('idle', ''); });
  ipcMain.on('panel:toggle-mic', () => toggleMic());
  ipcMain.on('board:close', () => boardWindow.hide());
  ipcMain.on('board:clear-request', () => boardWindow.clear());

  ipcMain.handle('settings:get', () => ({ settings: readSettingsForPanel(environment), setupProblem: providerSetupProblem }));
  ipcMain.handle('settings:save', (_event, incomingSettings) => {
    const previousPushToTalkKeys = environment.PUSH_TO_TALK_KEYS;
    saveSettings(incomingSettings, environment);
    rebuildProviders();
    if (environment.PUSH_TO_TALK_KEYS !== previousPushToTalkKeys) restartPushToTalk();
    reportStatus(providerSetupProblem ? 'setup' : 'idle', idleHint());
    return { setupProblem: providerSetupProblem };
  });
  ipcMain.handle('settings:test-gemini', (_event, { apiKey, modelName }) => checkGeminiKey({ apiKey, modelName }));
  ipcMain.handle('settings:test-groq', (_event, { apiKey }) => checkGroqKey({ apiKey }));
  ipcMain.handle('settings:open-link', (_event, linkUrl) => {
    if (ALLOWED_EXTERNAL_LINK_PREFIXES.some((prefix) => String(linkUrl).startsWith(prefix))) shell.openExternal(linkUrl);
  });
}

function toggleMic() {
  isMicToggledOn = !isMicToggledOn;
  if (isMicToggledOn) startListening();
  else stopListeningAndAnswer();
}

function restartPushToTalk() {
  pushToTalkHandle?.stop();
  pushToTalkHandle = startPushToTalk({
    modifierNames: parsePushToTalkKeys(environment.PUSH_TO_TALK_KEYS),
    onStart: startListening,
    onStop: stopListeningAndAnswer,
    onCancel: cancelListening,
    log,
  });
}

function configureMicrophonePermission() {
  // Only our own bundled pages (file://) may use the microphone.
  const isOwnPage = (url) => String(url).startsWith('file://');
  electronSession.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'media' && isOwnPage(webContents.getURL()));
  });
  electronSession.defaultSession.setPermissionCheckHandler((webContents, permission) => permission === 'media' && (!webContents || isOwnPage(webContents.getURL())));
}

// Clicking the desktop shortcut twice should bring the panel back, not start a second copy.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => panelWindow?.show());
  app.setAppUserModelId('what.the.flick.is.this');

  app.whenReady().then(() => {
    configureMicrophonePermission();
    const excludeFromCapture = String(environment.EXCLUDE_OVERLAY_FROM_CAPTURE || 'true').toLowerCase() !== 'false';

    overlayManager = new OverlayManager({ excludeFromCapture });
    boardWindow = new BoardWindow({});
    recorderController = new RecorderController();
    audioPlayer = new AudioPlayer();
    usageCounter = new UsageCounter({ storageFolder: app.getPath('userData'), onChange: sendUsageToPanel });
    setGeminiRequestListener((modelName) => usageCounter.recordRequest(modelName));

    const { llmProvider, ttsProvider } = rebuildProviders();

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
      cropScreenshot: cropScreenshotToDataUrl,
      // 'card' (default) puts zoomed snapshots on the whiteboard; 'overlay' draws on the real screen.
      annotationMode: (environment.ANNOTATION_MODE || 'card').toLowerCase() === 'overlay' ? 'overlay' : 'card',
    });

    overlayManager.start();
    createPanelWindow();
    createTray();
    registerIpcHandlers();

    globalShortcut.register('Control+Alt+Space', toggleMic);
    globalShortcut.register('Alt+Shift+X', () => companionSession.clearMarks());

    restartPushToTalk();
    panelWindow.webContents.once('did-finish-load', () => {
      // First run: no key yet, so open straight on the keys page with the tutorial.
      if (providerSetupProblem) showPanelPage('keys');
      reportStatus(providerSetupProblem ? 'setup' : 'idle', idleHint());
      sendUsageToPanel();
    });
  });
}

app.on('before-quit', () => { isQuitting = true; });
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  pushToTalkHandle?.stop();
  speechToText?.dispose?.();
  currentTtsProvider?.dispose?.();
});
// Stay alive in the tray when all windows are hidden.
app.on('window-all-closed', () => {});
