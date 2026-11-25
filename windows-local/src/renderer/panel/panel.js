'use strict';
const questionBox = document.getElementById('question');
const stateElement = document.getElementById('state');
const detailElement = document.getElementById('detail');

function submitQuestion() {
  const questionText = questionBox.value.trim();
  if (!questionText) return;
  window.flick.send('panel:ask', questionText);
  questionBox.value = '';
}

document.getElementById('ask').addEventListener('click', submitQuestion);
questionBox.addEventListener('keydown', (event) => { if (event.key === 'Enter' && (event.ctrlKey || !event.shiftKey)) { event.preventDefault(); submitQuestion(); } });
document.getElementById('mic').addEventListener('click', () => window.flick.send('panel:toggle-mic'));
document.getElementById('stop').addEventListener('click', () => window.flick.send('panel:cancel'));
document.getElementById('clearMarks').addEventListener('click', () => window.flick.send('panel:clear-marks'));
document.getElementById('board').addEventListener('click', () => window.flick.send('panel:toggle-board'));

window.flick.on('panel:status', ({ stateName, detail }) => {
  stateElement.textContent = stateName;
  stateElement.className = stateName === 'error' ? 'error' : '';
  detailElement.textContent = detail || '';
});
