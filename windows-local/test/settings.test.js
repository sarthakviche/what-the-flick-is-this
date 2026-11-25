'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeIncomingSettings } = require('../src/main/settingsStore');
const { GroqSttProvider } = require('../src/providers/stt/groq');
const { createSttProvider } = require('../src/providers');

test('settings from the panel keep only editable names and lose line breaks and quotes', () => {
  const sanitized = sanitizeIncomingSettings({ GEMINI_API_KEY: ' AIza"abc\nEVIL=1 ', SOMETHING_ELSE: 'x', STT_PROVIDER: 'groq' });
  assert.deepEqual(sanitized, { GEMINI_API_KEY: 'AIzaabcEVIL=1', STT_PROVIDER: 'groq' });
});

test('groq transcribes with a bearer key and multipart audio', async () => {
  const calls = [];
  const provider = new GroqSttProvider({
    apiKey: 'gsk_test',
    fetchImplementation: async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, text: async () => '{"text":" what is a mutex "}' }; },
  });
  assert.equal(await provider.transcribe(Buffer.from('RIFF')), 'what is a mutex');
  assert.match(calls[0].url, /api\.groq\.com\/openai\/v1\/audio\/transcriptions$/);
  assert.equal(calls[0].init.headers.authorization, 'Bearer gsk_test');
  assert.equal(calls[0].init.body.get('model'), 'whisper-large-v3-turbo');
});

test('groq ears without a groq key explain where to get one', () => {
  assert.throws(() => createSttProvider({ STT_PROVIDER: 'groq' }), /console\.groq\.com/);
});
