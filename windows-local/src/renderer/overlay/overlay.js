'use strict';
const marksLayer = document.getElementById('marks');
const buddy = document.getElementById('buddy');
const statusPill = document.getElementById('status');
let buddyPosition = { x: -50, y: -50 };
let statusHideTimer = null;

/** Buddy cursor flies along a quadratic bezier arc, same idea as the original Clicky cursor. */
function flyBuddyTo(target) {
  const start = { ...buddyPosition };
  const control = { x: (start.x + target.x) / 2, y: Math.min(start.y, target.y) - 80 };
  const durationMilliseconds = 700;
  const startTime = performance.now();
  buddy.style.display = 'block';
  function frame(now) {
    const progress = Math.min(1, (now - startTime) / durationMilliseconds);
    const eased = 1 - Math.pow(1 - progress, 3);
    const inverse = 1 - eased;
    const x = inverse * inverse * start.x + 2 * inverse * eased * control.x + eased * eased * target.x;
    const y = inverse * inverse * start.y + 2 * inverse * eased * control.y + eased * eased * target.y;
    buddy.style.transform = `translate(${x - 9}px, ${y - 4}px) rotate(-35deg)`;
    if (progress < 1) requestAnimationFrame(frame);
    else buddyPosition = target;
  }
  requestAnimationFrame(frame);
}

window.flick.on('overlay:shape', ({ shape, anchor }) => {
  marksLayer.insertAdjacentHTML('beforeend', window.shapeToSvg(shape));
  flyBuddyTo(anchor);
});

window.flick.on('overlay:clear', () => {
  marksLayer.innerHTML = '';
  buddy.style.display = 'none';
  buddyPosition = { x: -50, y: -50 };
});

window.flick.on('overlay:status', ({ stateName, detail }) => {
  clearTimeout(statusHideTimer);
  const labels = { listening: 'listening...', thinking: 'thinking...', speaking: '', error: 'problem', warning: 'warning' };
  if (!(stateName in labels)) { statusPill.classList.remove('visible'); return; }
  const text = stateName === 'speaking' ? '' : (labels[stateName] + (detail && stateName !== 'thinking' ? ` ${detail}` : ''));
  if (!text) { statusPill.classList.remove('visible'); return; }
  statusPill.innerHTML = '<span class="dot"></span>';
  statusPill.appendChild(document.createTextNode(text));
  statusPill.classList.add('visible');
  if (stateName === 'error' || stateName === 'warning') statusHideTimer = setTimeout(() => statusPill.classList.remove('visible'), 6000);
});
