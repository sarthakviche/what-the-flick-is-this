'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Only these channels cross the bridge. Renderers never get raw ipcRenderer.
const CHANNELS_FROM_MAIN = new Set([
  'overlay:shape', 'overlay:clear', 'overlay:status',
  'board:append', 'board:clear',
  'panel:status',
  'recorder:start', 'recorder:stop',
]);
const CHANNELS_TO_MAIN = new Set([
  'panel:ask', 'panel:toggle-mic', 'panel:clear-marks', 'panel:toggle-board', 'panel:cancel',
  'board:close', 'board:clear-request', 'recorder:result',
]);

contextBridge.exposeInMainWorld('flick', {
  on(channel, callback) {
    if (!CHANNELS_FROM_MAIN.has(channel)) throw new Error(`blocked channel ${channel}`);
    ipcRenderer.on(channel, (_event, payload) => callback(payload));
  },
  send(channel, payload) {
    if (!CHANNELS_TO_MAIN.has(channel)) throw new Error(`blocked channel ${channel}`);
    ipcRenderer.send(channel, payload);
  },
});
