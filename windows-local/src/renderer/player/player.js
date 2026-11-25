'use strict';
let currentAudio = null;
let currentClipId = null;

function finishCurrentClip() {
  if (currentClipId !== null) window.flick.send('player:ended', currentClipId);
  currentAudio = null;
  currentClipId = null;
}

window.flick.on('player:play', ({ clipId, wavBase64 }) => {
  if (currentAudio) { currentAudio.pause(); finishCurrentClip(); }
  currentAudio = new Audio(`data:audio/wav;base64,${wavBase64}`);
  currentClipId = clipId;
  currentAudio.addEventListener('ended', finishCurrentClip);
  currentAudio.addEventListener('error', finishCurrentClip);
  currentAudio.play().catch(finishCurrentClip);
});

window.flick.on('player:stop', () => {
  if (currentAudio) currentAudio.pause();
  finishCurrentClip();
});
