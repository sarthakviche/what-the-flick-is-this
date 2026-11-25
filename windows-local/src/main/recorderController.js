'use strict';
const { BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');

/**
 * Microphone capture lives in a hidden renderer because getUserMedia only exists there.
 * start() begins recording; stop() resolves with a 16 kHz mono WAV Buffer.
 */
class RecorderController {
  constructor() {
    this.window = null;
    this.pendingResolve = null;
    ipcMain.on('recorder:result', (_event, wavBytes) => {
      if (this.pendingResolve) this.pendingResolve(Buffer.from(wavBytes || []));
      this.pendingResolve = null;
    });
  }

  ensureWindow() {
    if (this.window && !this.window.isDestroyed()) return Promise.resolve();
    this.window = new BrowserWindow({
      show: false,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    this.window.loadFile(path.join(__dirname, '..', 'renderer', 'recorder', 'recorder.html'));
    return new Promise((resolve) => this.window.webContents.once('did-finish-load', resolve));
  }

  async start() {
    await this.ensureWindow();
    this.window.webContents.send('recorder:start');
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.window || this.window.isDestroyed()) { resolve(Buffer.alloc(0)); return; }
      this.pendingResolve = resolve;
      this.window.webContents.send('recorder:stop');
      setTimeout(() => { if (this.pendingResolve === resolve) { this.pendingResolve = null; resolve(Buffer.alloc(0)); } }, 5000);
    });
  }
}

module.exports = { RecorderController };
