'use strict';
let audioContext = null;
let mediaStream = null;
let processorNode = null;
let recordedChunks = [];

async function startRecording() {
  recordedChunks = [];
  mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  audioContext = new AudioContext();
  const sourceNode = audioContext.createMediaStreamSource(mediaStream);
  // ScriptProcessor is deprecated but works everywhere in Electron and needs no extra worklet file.
  processorNode = audioContext.createScriptProcessor(4096, 1, 1);
  processorNode.onaudioprocess = (event) => recordedChunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
  sourceNode.connect(processorNode);
  processorNode.connect(audioContext.destination);
}

async function stopRecording() {
  const sampleRate = audioContext ? audioContext.sampleRate : 48000;
  processorNode?.disconnect();
  mediaStream?.getTracks().forEach((track) => track.stop());
  await audioContext?.close();
  audioContext = null; mediaStream = null; processorNode = null;
  const wavBytes = recordedChunks.length ? window.wavEncoder.encodeWav(recordedChunks, sampleRate) : new Uint8Array(0);
  recordedChunks = [];
  window.flick.send('recorder:result', wavBytes);
}

window.flick.on('recorder:start', () => { startRecording().catch((error) => { console.error(error); window.flick.send('recorder:result', new Uint8Array(0)); }); });
window.flick.on('recorder:stop', () => { stopRecording(); });
