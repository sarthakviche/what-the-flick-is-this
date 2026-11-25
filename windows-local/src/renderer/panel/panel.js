'use strict';
const questionBox = document.getElementById('question');
const stateElement = document.getElementById('state');
const detailElement = document.getElementById('detail');
const SETTING_FIELD_IDS = ['GEMINI_API_KEY', 'GROQ_API_KEY', 'LLM_PROVIDER', 'STT_PROVIDER', 'TTS_PROVIDER', 'KOKORO_VOICE', 'PUSH_TO_TALK_KEYS', 'GEMINI_MODEL', 'OLLAMA_MODEL'];
const DEFAULT_SELECT_VALUES = { LLM_PROVIDER: 'gemini', STT_PROVIDER: 'auto', TTS_PROVIDER: 'kokoro', KOKORO_VOICE: 'af_heart', PUSH_TO_TALK_KEYS: 'ctrl+alt' };

/* ---------- pages ---------- */
function showPage(pageName) {
  for (const navButton of document.querySelectorAll('nav button')) navButton.classList.toggle('active', navButton.dataset.page === pageName);
  for (const pageElement of document.querySelectorAll('.page')) pageElement.classList.toggle('active', pageElement.id === `page-${pageName}`);
  if (pageName === 'keys') loadSettingsIntoForm();
}
for (const navButton of document.querySelectorAll('nav button')) navButton.addEventListener('click', () => showPage(navButton.dataset.page));
window.flick.on('panel:show-page', showPage);

/* ---------- ask ---------- */
function sendQuestion(questionText) {
  const trimmedQuestion = String(questionText || '').trim();
  if (!trimmedQuestion) return;
  window.flick.send('panel:ask', trimmedQuestion);
}

function submitTypedQuestion() {
  sendQuestion(questionBox.value);
  questionBox.value = '';
}

document.getElementById('ask').addEventListener('click', submitTypedQuestion);
questionBox.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submitTypedQuestion(); } });
for (const quickQuestionChip of document.querySelectorAll('.chips button')) {
  quickQuestionChip.addEventListener('click', () => sendQuestion(quickQuestionChip.dataset.question));
}
document.getElementById('mic').addEventListener('click', () => window.flick.send('panel:toggle-mic'));
document.getElementById('stop').addEventListener('click', () => window.flick.send('panel:cancel'));
document.getElementById('clearMarks').addEventListener('click', () => window.flick.send('panel:clear-marks'));
document.getElementById('board').addEventListener('click', () => window.flick.send('panel:toggle-board'));

window.flick.on('panel:status', ({ stateName, detail }) => {
  const friendlyStateNames = { idle: 'ready when you are', setup: 'one tiny setup step' };
  stateElement.textContent = friendlyStateNames[stateName] || stateName;
  stateElement.className = stateName;
  detailElement.textContent = detail || '';
});

// Free tier quotas are per model per day and Google resets them at midnight Pacific time.
window.flick.on('panel:usage', ({ totalRequestsToday, requestCountByModel }) => {
  const perModelText = Object.entries(requestCountByModel).map(([modelName, count]) => `${modelName.replace('gemini-', '')} ${count}`).join(', ');
  document.getElementById('usage').textContent = `gemini calls today: ${totalRequestsToday}${perModelText ? ` (${perModelText})` : ''}`;
});

/* ---------- keys ---------- */
function showResult(resultElementId, { isOk, message }) {
  const resultElement = document.getElementById(resultElementId);
  resultElement.textContent = isOk ? `yep! ${message}` : message;
  resultElement.className = `result ${isOk ? 'ok' : 'bad'}`;
}

async function loadSettingsIntoForm() {
  const { settings } = await window.flick.invoke('settings:get');
  for (const fieldId of SETTING_FIELD_IDS) {
    document.getElementById(fieldId).value = settings[fieldId] || DEFAULT_SELECT_VALUES[fieldId] || '';
  }
  // Open the tutorial straight away when the required key is still missing.
  document.getElementById('geminiHowTo').open = !settings.GEMINI_API_KEY;
}

function readSettingsFromForm() {
  const formSettings = {};
  for (const fieldId of SETTING_FIELD_IDS) formSettings[fieldId] = document.getElementById(fieldId).value.trim();
  return formSettings;
}

for (const revealButton of document.querySelectorAll('[data-reveal]')) {
  revealButton.addEventListener('click', () => {
    const keyInput = document.getElementById(revealButton.dataset.reveal);
    keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
    revealButton.textContent = keyInput.type === 'password' ? 'show' : 'hide';
  });
}

for (const externalLink of document.querySelectorAll('[data-link]')) {
  externalLink.addEventListener('click', () => window.flick.invoke('settings:open-link', externalLink.dataset.link));
}

document.getElementById('testGemini').addEventListener('click', async () => {
  showResult('geminiResult', { isOk: true, message: 'checking...' });
  const checkResult = await window.flick.invoke('settings:test-gemini', {
    apiKey: document.getElementById('GEMINI_API_KEY').value.trim(),
    modelName: document.getElementById('GEMINI_MODEL').value.trim(),
  });
  showResult('geminiResult', checkResult);
});

document.getElementById('testGroq').addEventListener('click', async () => {
  showResult('groqResult', { isOk: true, message: 'checking...' });
  const checkResult = await window.flick.invoke('settings:test-groq', { apiKey: document.getElementById('GROQ_API_KEY').value.trim() });
  showResult('groqResult', checkResult);
});

document.getElementById('save').addEventListener('click', async () => {
  const { setupProblem } = await window.flick.invoke('settings:save', readSettingsFromForm());
  if (setupProblem) {
    showResult('saveResult', { isOk: false, message: `saved, but: ${setupProblem}` });
    return;
  }
  showResult('saveResult', { isOk: true, message: 'saved. go ask something!' });
  setTimeout(() => showPage('ask'), 1200);
});
