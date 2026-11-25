'use strict';
const boardElement = document.getElementById('board');
let diagramCounter = 0;

mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' });

function scrollToBottom() {
  boardElement.scrollTo({ top: boardElement.scrollHeight, behavior: 'smooth' });
}

function renderMath(latexSource) {
  const mathElement = document.createElement('div');
  mathElement.className = 'math';
  try {
    katex.render(latexSource, mathElement, { displayMode: true, throwOnError: false, trust: false });
  } catch (error) {
    mathElement.textContent = latexSource;
  }
  return mathElement;
}

function renderCode(sourceCode, languageName) {
  const preElement = document.createElement('pre');
  const codeElement = document.createElement('code');
  const hasLanguage = languageName && hljs.getLanguage(languageName);
  const highlighted = hasLanguage ? hljs.highlight(sourceCode, { language: languageName }) : hljs.highlightAuto(sourceCode);
  // highlight.js escapes the source before adding its own span tags, so innerHTML is safe here.
  codeElement.innerHTML = highlighted.value;
  codeElement.className = 'hljs';
  preElement.appendChild(codeElement);
  return preElement;
}

async function renderDiagram(mermaidSource) {
  const container = document.createElement('div');
  container.className = 'diagram';
  try {
    diagramCounter += 1;
    const { svg } = await mermaid.render(`diagram-${diagramCounter}`, mermaidSource);
    container.innerHTML = svg;
  } catch (error) {
    container.className = 'error';
    container.textContent = 'could not draw this diagram';
  }
  return container;
}

async function appendLine({ kind, content, lang }) {
  let lineElement;
  if (kind === 'heading') { lineElement = document.createElement('div'); lineElement.className = 'heading'; lineElement.textContent = content; }
  else if (kind === 'math') lineElement = renderMath(content);
  else if (kind === 'code') lineElement = renderCode(content, lang);
  else if (kind === 'diagram') lineElement = await renderDiagram(content);
  else { lineElement = document.createElement('div'); lineElement.textContent = content; }
  const wrapper = document.createElement('div');
  wrapper.className = `line ${kind}`;
  wrapper.appendChild(lineElement);
  boardElement.appendChild(wrapper);
  scrollToBottom();
}

// Lines are chained so async diagrams cannot reorder behind faster lines.
let appendQueue = Promise.resolve();
window.flick.on('board:append', (line) => { appendQueue = appendQueue.then(() => appendLine(line)).catch(() => {}); });
window.flick.on('board:clear', () => { appendQueue = appendQueue.then(() => { boardElement.innerHTML = ''; }); });
document.getElementById('clear').addEventListener('click', () => { boardElement.innerHTML = ''; });
document.getElementById('close').addEventListener('click', () => window.flick.send('board:close'));
