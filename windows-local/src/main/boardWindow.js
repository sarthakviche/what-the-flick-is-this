'use strict';
const { BrowserWindow, screen } = require('electron');
const path = require('node:path');

/** The whiteboard: a docked, always-on-top window on the right edge of the primary display. */
class BoardWindow {
  constructor({ onUserClosed }) {
    this.onUserClosed = onUserClosed;
    this.window = null;
    this.pendingLines = [];
    this.isRendererReady = false;
  }

  ensureWindow() {
    if (this.window && !this.window.isDestroyed()) return;
    const workArea = screen.getPrimaryDisplay().workArea;
    const boardWidth = Math.min(620, Math.round(workArea.width * 0.4));
    this.window = new BrowserWindow({
      x: workArea.x + workArea.width - boardWidth - 12,
      y: workArea.y + 12,
      width: boardWidth,
      height: workArea.height - 24,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      backgroundColor: '#1f3b2d',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    this.isRendererReady = false;
    this.window.loadFile(path.join(__dirname, '..', 'renderer', 'whiteboard', 'whiteboard.html'));
    this.window.webContents.once('did-finish-load', () => {
      this.isRendererReady = true;
      for (const line of this.pendingLines) this.window.webContents.send('board:append', line);
      this.pendingLines = [];
    });
    this.window.on('closed', () => { this.window = null; this.isRendererReady = false; });
  }

  show() {
    this.ensureWindow();
    this.window.showInactive();
  }

  hide() {
    if (this.window && !this.window.isDestroyed()) this.window.hide();
  }

  toggle() {
    if (this.window && !this.window.isDestroyed() && this.window.isVisible()) this.hide();
    else this.show();
  }

  append(line) {
    this.ensureWindow();
    if (this.isRendererReady) this.window.webContents.send('board:append', line);
    else this.pendingLines.push(line);
  }

  clear() {
    this.pendingLines = [];
    if (this.window && !this.window.isDestroyed() && this.isRendererReady) this.window.webContents.send('board:clear');
  }
}

module.exports = { BoardWindow };
