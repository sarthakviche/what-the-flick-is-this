// Child process that turns text into speech with Kokoro (82M parameter open model, Apache 2.0).
// It runs outside the Electron main process so generating audio never freezes the app.
// The model (~90 MB) downloads from Hugging Face on first use and is cached after that.
//
// Messages in:  { type: 'generate', requestId, text }  |  { type: 'cancel' }
// Messages out: { type: 'ready' } | { type: 'load-failed', message }
//               { type: 'audio', requestId, wavBase64 } | { type: 'failed', requestId, message }
import { KokoroTTS } from 'kokoro-js';

const voiceName = process.env.KOKORO_VOICE || 'af_heart';
const pendingRequests = [];
let textToSpeech = null;
let isGenerating = false;

async function loadModel() {
  try {
    textToSpeech = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'cpu' });
    // A tiny warm up makes the first real sentence come out faster.
    await textToSpeech.generate('ok.', { voice: voiceName });
    process.send({ type: 'ready' });
    generateNext();
  } catch (error) {
    process.send({ type: 'load-failed', message: error.message });
  }
}

/** Requests are handled strictly in order, which is the order the sentences will be played. */
async function generateNext() {
  if (!textToSpeech || isGenerating || pendingRequests.length === 0) return;
  isGenerating = true;
  const { requestId, text } = pendingRequests.shift();
  try {
    const generatedAudio = await textToSpeech.generate(text, { voice: voiceName });
    const wavBytes = Buffer.from(generatedAudio.toWav());
    process.send({ type: 'audio', requestId, wavBase64: wavBytes.toString('base64') });
  } catch (error) {
    process.send({ type: 'failed', requestId, message: error.message });
  } finally {
    isGenerating = false;
    generateNext();
  }
}

process.on('message', (message) => {
  if (message.type === 'generate') {
    pendingRequests.push({ requestId: message.requestId, text: message.text });
    generateNext();
  } else if (message.type === 'cancel') {
    for (const droppedRequest of pendingRequests.splice(0)) {
      process.send({ type: 'failed', requestId: droppedRequest.requestId, message: 'cancelled' });
    }
  }
});

loadModel();
