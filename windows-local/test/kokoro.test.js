'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { KokoroTtsProvider, splitIntoSentences } = require('../src/providers/tts/kokoro');

/** Fake worker: answers each generate request with the text as "audio" after the given delay. */
function createFakeWorker({ isReady = true, delayMilliseconds = 5 } = {}) {
  const worker = new EventEmitter();
  worker.sentMessages = [];
  worker.send = (message) => {
    worker.sentMessages.push(message);
    if (message.type === 'generate') {
      setTimeout(() => worker.emit('message', { type: 'audio', requestId: message.requestId, wavBase64: Buffer.from(message.text).toString('base64') }), delayMilliseconds);
    }
  };
  worker.kill = () => {};
  if (isReady) setImmediate(() => worker.emit('message', { type: 'ready' }));
  else setImmediate(() => worker.emit('message', { type: 'load-failed', message: 'no internet' }));
  return worker;
}

test('sentences are split for streaming playback', () => {
  assert.deepEqual(splitIntoSentences('so this is a neuron. it adds things up! cool?'), ['so this is a neuron.', 'it adds things up!', 'cool?']);
  assert.deepEqual(splitIntoSentences('no punctuation here'), ['no punctuation here']);
});

test('kokoro plays sentences in order', async () => {
  const played = [];
  const provider = new KokoroTtsProvider({
    startWorker: () => createFakeWorker(),
    playWav: async (wavBuffer) => { played.push(wavBuffer.toString()); },
    stopPlayback: () => {},
    fallbackProvider: { speak: async () => { throw new Error('should not fall back'); }, stop: () => {} },
  });
  await provider.speak('one. two. three.');
  assert.deepEqual(played, ['one.', 'two.', 'three.']);
});

test('kokoro falls back to the windows voice when the model cannot load', async () => {
  const fallbackSpoken = [];
  const provider = new KokoroTtsProvider({
    startWorker: () => createFakeWorker({ isReady: false }),
    playWav: async () => { throw new Error('should not play'); },
    stopPlayback: () => {},
    fallbackProvider: { speak: async (text) => { fallbackSpoken.push(text); }, stop: () => {} },
  });
  await provider.speak('hello there.');
  assert.deepEqual(fallbackSpoken, ['hello there.']);
});

test('prepared audio is reused instead of generated twice', async () => {
  let worker;
  const provider = new KokoroTtsProvider({
    startWorker: () => { worker = createFakeWorker(); return worker; },
    playWav: async () => {},
    stopPlayback: () => {},
    fallbackProvider: { speak: async () => {}, stop: () => {} },
  });
  await new Promise((resolve) => setImmediate(resolve));
  provider.prepare('first step.');
  await provider.speak('first step.');
  assert.equal(worker.sentMessages.filter((message) => message.type === 'generate').length, 1);
});
