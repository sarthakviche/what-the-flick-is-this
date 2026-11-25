'use strict';
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

/**
 * Settings live in windows-local/.env so the app, `npm run doctor` and power users editing the
 * file by hand all read the same place. The panel's "keys" page reads and writes it through here.
 *
 * Only these keys can be changed from the panel. Everything else in .env is left untouched.
 */
const EDITABLE_SETTING_NAMES = [
  'GEMINI_API_KEY',
  'GROQ_API_KEY',
  'LLM_PROVIDER',
  'STT_PROVIDER',
  'TTS_PROVIDER',
  'GEMINI_MODEL',
  'OLLAMA_MODEL',
  'PUSH_TO_TALK_KEYS',
];

const APP_FOLDER = path.join(__dirname, '..', '..');
const ENV_FILE_PATH = path.join(APP_FOLDER, '.env');
const ENV_EXAMPLE_FILE_PATH = path.join(APP_FOLDER, '.env.example');

function ensureEnvFileExists() {
  if (fs.existsSync(ENV_FILE_PATH)) return;
  if (fs.existsSync(ENV_EXAMPLE_FILE_PATH)) fs.copyFileSync(ENV_EXAMPLE_FILE_PATH, ENV_FILE_PATH);
  else fs.writeFileSync(ENV_FILE_PATH, '');
}

function readEnvFileValues() {
  ensureEnvFileExists();
  return dotenv.parse(fs.readFileSync(ENV_FILE_PATH, 'utf8'));
}

/** Rewrites only the changed `NAME=value` lines and appends names that were missing, keeping comments. */
function writeSettingsToEnvFile(changedSettings) {
  ensureEnvFileExists();
  const originalLines = fs.readFileSync(ENV_FILE_PATH, 'utf8').split(/\r?\n/);
  const settingNamesStillToWrite = new Set(Object.keys(changedSettings));
  const updatedLines = originalLines.map((line) => {
    const lineMatch = line.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (!lineMatch || !settingNamesStillToWrite.has(lineMatch[1])) return line;
    settingNamesStillToWrite.delete(lineMatch[1]);
    return `${lineMatch[1]}=${changedSettings[lineMatch[1]]}`;
  });
  for (const missingSettingName of settingNamesStillToWrite) updatedLines.push(`${missingSettingName}=${changedSettings[missingSettingName]}`);
  fs.writeFileSync(ENV_FILE_PATH, updatedLines.join('\n'));
}

/** Keeps only editable names and strips characters that would break a one-line .env value. */
function sanitizeIncomingSettings(incomingSettings) {
  const sanitizedSettings = {};
  for (const settingName of EDITABLE_SETTING_NAMES) {
    if (!(settingName in (incomingSettings || {}))) continue;
    sanitizedSettings[settingName] = String(incomingSettings[settingName] ?? '').replace(/[\r\n"'`]/g, '').trim();
  }
  return sanitizedSettings;
}

/**
 * Saves the panel's settings to .env and into process.env so providers can be rebuilt without a restart.
 * Returns the full merged environment.
 */
function saveSettings(incomingSettings, liveEnvironment) {
  const sanitizedSettings = sanitizeIncomingSettings(incomingSettings);
  writeSettingsToEnvFile(sanitizedSettings);
  Object.assign(liveEnvironment, sanitizedSettings);
  return liveEnvironment;
}

/** What the panel shows. Keys are sent back so the user can see and edit them; the panel is local only. */
function readSettingsForPanel(liveEnvironment) {
  const fileValues = readEnvFileValues();
  const panelSettings = {};
  for (const settingName of EDITABLE_SETTING_NAMES) panelSettings[settingName] = liveEnvironment[settingName] ?? fileValues[settingName] ?? '';
  return panelSettings;
}

module.exports = { EDITABLE_SETTING_NAMES, ENV_FILE_PATH, ensureEnvFileExists, saveSettings, readSettingsForPanel, sanitizeIncomingSettings };
