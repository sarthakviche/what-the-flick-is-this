'use strict';
const { BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');

/**
 * Plays WAV audio in a hidden renderer, because Chromium's audio stack is already in Electron and
 * tells us exactly when playback ends. play() resolves when the clip finishes or is stopped.
 */
class AudioPlayer {
  constructor() {
    this.window = null;
    this.windowReadyPromise = null;
    this.nextClipId = 1;
    this.resolveByClipId = new Map();
    ipcMain.on('player:ended', (_event, clipId) => {
      this.resolveByClipId.get(clipId)?.();
      this.resolveByClipId.delete(clipId);
    });
  }

  ensureWindow() {
    if (this.window && !this.window.isDestroyed()) return this.windowReadyPromise;
    this.window = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false,
        autoplayPolicy: 'no-user-gesture-required',
      },
    });
    this.window.loadFile(path.join(__dirname, '..', 'renderer', 'player', 'player.html'));
    this.windowReadyPromise = new Promise((resolve) => this.window.webContents.once('did-finish-load', resolve));
    return this.windowReadyPromise;
  }

  async play(wavBuffer) {
    await this.ensureWindow();
    const clipId = this.nextClipId++;
    const playbackFinished = new Promise((resolve) => this.resolveByClipId.set(clipId, resolve));
    this.window.webContents.send('player:play', { clipId, wavBase64: Buffer.from(wavBuffer).toString('base64') });
    return playbackFinished;
  }

  stop() {
    if (this.window && !this.window.isDestroyed()) this.window.webContents.send('player:stop');
    for (const resolve of this.resolveByClipId.values()) resolve();
    this.resolveByClipId.clear();
  }
}

module.exports = { AudioPlayer };
