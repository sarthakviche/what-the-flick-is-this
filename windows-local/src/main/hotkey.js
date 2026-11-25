'use strict';

/**
 * Push to talk. Windows has no "key up" in Electron's globalShortcut, so we use uiohook-napi
 * (a native low level hook with prebuilt Windows binaries) to see modifiers go down and up.
 * If it fails to load we report it, and the toggle shortcut plus the panel mic button still work.
 *
 * Holding the configured modifiers starts recording. Releasing any of them stops it.
 * Pressing a normal key while held means the user is doing a real shortcut, so we cancel.
 */
function startPushToTalk({ modifierNames, onStart, onStop, onCancel, log }) {
  let uiohookModule;
  try {
    uiohookModule = require('uiohook-napi');
  } catch (error) {
    log(`Push to talk hook unavailable (${error.message}). Use Ctrl+Alt+Space or the mic button.`);
    return { available: false, stop() {} };
  }
  const { uIOhook, UiohookKey } = uiohookModule;
  const keycodesByModifier = {
    ctrl: [UiohookKey.Ctrl, UiohookKey.CtrlRight],
    alt: [UiohookKey.Alt, UiohookKey.AltRight],
    shift: [UiohookKey.Shift, UiohookKey.ShiftRight],
  };
  const allModifierKeycodes = new Set(Object.values(keycodesByModifier).flat());
  const heldModifiers = new Set();
  let isRecording = false;

  function modifierNameForKeycode(keycode) {
    return Object.keys(keycodesByModifier).find((name) => keycodesByModifier[name].includes(keycode));
  }
  const allRequiredHeld = () => modifierNames.every((name) => heldModifiers.has(name));

  uIOhook.on('keydown', (event) => {
    const modifierName = modifierNameForKeycode(event.keycode);
    if (modifierName) {
      heldModifiers.add(modifierName);
      if (!isRecording && allRequiredHeld()) { isRecording = true; onStart(); }
    } else if (isRecording && !allModifierKeycodes.has(event.keycode)) {
      isRecording = false;
      onCancel();
    }
  });
  uIOhook.on('keyup', (event) => {
    const modifierName = modifierNameForKeycode(event.keycode);
    if (!modifierName) return;
    heldModifiers.delete(modifierName);
    if (isRecording && !allRequiredHeld()) { isRecording = false; onStop(); }
  });
  uIOhook.start();
  // removeAllListeners so changing the keys in settings and restarting does not double the handlers.
  return { available: true, stop() { uIOhook.stop(); uIOhook.removeAllListeners('keydown'); uIOhook.removeAllListeners('keyup'); } };
}

module.exports = { startPushToTalk };
