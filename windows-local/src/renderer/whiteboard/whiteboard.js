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

/** A zoomed piece of the user's screen, framed like a photo taped to the board. */
function renderSnapshot(imageDataUrl, captionText) {
  const figureElement = document.createElement('figure');
  figureElement.className = 'snapshot';
  const imageElement = document.createElement('img');
  // Only data:image URLs made by the app itself are allowed in here.
  if (String(imageDataUrl).startsWith('data:image/')) imageElement.src = imageDataUrl;
  figureElement.appendChild(imageElement);
  if (captionText) {
    const captionElement = document.createElement('figcaption');
    captionElement.textContent = captionText;
    figureElement.appendChild(captionElement);
  }
  return figureElement;
}

/** "word: meaning" -> the word highlighted, then its meaning. */
function renderTerm(termAndMeaning) {
  const termElement = document.createElement('div');
  const separatorIndex = termAndMeaning.indexOf(':');
  const wordElement = document.createElement('span');
  wordElement.className = 'term-word';
  wordElement.textContent = separatorIndex > 0 ? termAndMeaning.slice(0, separatorIndex).trim() : termAndMeaning;
  termElement.appendChild(wordElement);
  if (separatorIndex > 0) termElement.appendChild(document.createTextNode(` ${termAndMeaning.slice(separatorIndex + 1).trim()}`));
  return termElement;
}

async function appendLine({ kind, content, lang, caption }) {
  let lineElement;
  if (kind === 'snapshot') lineElement = renderSnapshot(content, caption);
  else if (kind === 'term') lineElement = renderTerm(content);
  else if (kind === 'heading') { lineElement = document.createElement('div'); lineElement.className = 'heading'; lineElement.textContent = content; }
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
