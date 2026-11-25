'use strict';
const path = require('node:path');
const dotenv = require('dotenv');

/** Loads windows-local/.env into process.env (real environment variables win). */
function loadConfiguration() {
  dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
  return process.env;
}

/** "ctrl+alt" -> ['ctrl','alt']. Only modifiers are allowed so the hold gesture never types text. */
function parsePushToTalkKeys(specification) {
  const allowedModifierNames = ['ctrl', 'alt', 'shift'];
  const requestedNames = String(specification || 'ctrl+alt').toLowerCase().split('+').map((name) => name.trim()).filter(Boolean);
  const validNames = [...new Set(requestedNames.filter((name) => allowedModifierNames.includes(name)))];
  return validNames.length >= 2 ? validNames : ['ctrl', 'alt'];
}

module.exports = { loadConfiguration, parsePushToTalkKeys };
