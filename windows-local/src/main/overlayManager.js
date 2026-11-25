'use strict';
const { BrowserWindow, screen } = require('electron');
const path = require('node:path');

/**
 * One transparent, click-through, always-on-top window per display. Marks persist until clear().
 *
 * Tradeoff: one window per display (not one giant window spanning all) because Windows handles
 * mixed DPI monitors badly in a single window.
 */
class OverlayManager {
  constructor({ excludeFromCapture }) {
    this.excludeFromCapture = excludeFromCapture;
    this.windowsByDisplayId = new Map();
    this.shapesByDisplayId = new Map();
    this.nextShapeNumber = 1;
  }

  start() {
    this.rebuildWindows();
    // Monitors can be plugged in or change resolution while the app runs.
    for (const eventName of ['display-added', 'display-removed', 'display-metrics-changed']) {
      screen.on(eventName, () => this.rebuildWindows());
    }
  }

  rebuildWindows() {
    for (const overlayWindow of this.windowsByDisplayId.values()) overlayWindow.destroy();
    this.windowsByDisplayId.clear();
    for (const display of screen.getAllDisplays()) {
      const overlayWindow = new BrowserWindow({
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height,
        transparent: true,
        frame: false,
        hasShadow: false,
        resizable: false,
        movable: false,
        focusable: false,
        skipTaskbar: true,
        show: false,
        webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
      });
      overlayWindow.setAlwaysOnTop(true, 'screen-saver');
      overlayWindow.setIgnoreMouseEvents(true, { forward: true });
      overlayWindow.setVisibleOnAllWorkspaces(true);
      if (this.excludeFromCapture) overlayWindow.setContentProtection(true);
      overlayWindow.loadFile(path.join(__dirname, '..', 'renderer', 'overlay', 'overlay.html'));
      overlayWindow.once('ready-to-show', () => overlayWindow.showInactive());
      this.windowsByDisplayId.set(display.id, overlayWindow);
      // Replay marks that existed before the rebuild.
      overlayWindow.webContents.once('did-finish-load', () => {
        for (const shapeRecord of this.shapesByDisplayId.get(display.id) || []) overlayWindow.webContents.send('overlay:shape', shapeRecord);
      });
    }
  }

  addShape(displayId, shape, anchor) {
    const shapeRecord = { id: this.nextShapeNumber++, shape, anchor };
    if (!this.shapesByDisplayId.has(displayId)) this.shapesByDisplayId.set(displayId, []);
    this.shapesByDisplayId.get(displayId).push(shapeRecord);
    this.windowsByDisplayId.get(displayId)?.webContents.send('overlay:shape', shapeRecord);
  }

  clearAll() {
    this.shapesByDisplayId.clear();
    for (const overlayWindow of this.windowsByDisplayId.values()) overlayWindow.webContents.send('overlay:clear');
  }

  showStatus(statusPayload) {
    for (const overlayWindow of this.windowsByDisplayId.values()) overlayWindow.webContents.send('overlay:status', statusPayload);
  }

  /** Used when capture exclusion is unavailable: hide while the screenshot is taken. */
  setVisible(isVisible) {
    for (const overlayWindow of this.windowsByDisplayId.values()) {
      if (isVisible) overlayWindow.showInactive();
      else overlayWindow.hide();
    }
  }
}

module.exports = { OverlayManager };
