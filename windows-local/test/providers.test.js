'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { GeminiLlmProvider } = require('../src/providers/llm/gemini');
const { OllamaLlmProvider } = require('../src/providers/llm/ollama');
const { GeminiSttProvider } = require('../src/providers/stt/gemini');
const { buildSapiScript } = require('../src/providers/tts/sapi');
const { SilentTtsProvider } = require('../src/providers/tts/none');
const { createLlmProvider, createTtsProvider, createSttProvider } = require('../src/providers');

function fakeResponse(status, bodyObject) {
  return { ok: status < 400, status, text: async () => JSON.stringify(bodyObject) };
}
const sampleRequest = {
  systemPrompt: 'sys',
  history: [{ role: 'user', text: 'a' }, { role: 'assistant', text: 'b' }],
  userText: 'q',
  screenshots: [{ label: 'screen1', mimeType: 'image/jpeg', base64: 'QUJD', width: 100, height: 50 }],
};
const geminiOk = (text) => fakeResponse(200, { candidates: [{ content: { parts: [{ text }] } }] });

test('gemini builds the request with key header, schema, image and history roles', async () => {
  const calls = [];
  const provider = new GeminiLlmProvider({
    apiKey: 'KEY', model: 'm1',
    fetchImplementation: async (url, init) => { calls.push({ url, init }); return geminiOk('{"steps":[{"say":"hello","mark":{"type":"circle","box_2d":[1,2,300,400]}}]}'); },
  });
  const plan = await provider.generatePlan(sampleRequest);
  assert.equal(plan.steps[0].mark.type, 'circle');
  assert.match(calls[0].url, /models\/m1:generateContent$/);
  assert.equal(calls[0].init.headers['x-goog-api-key'], 'KEY');
  assert.ok(!calls[0].url.includes('KEY'), 'key must not be in the URL');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.equal(body.contents[1].role, 'model');
  assert.equal(body.contents.at(-1).parts[1].inlineData.data, 'QUJD');
});

test('gemini moves to the next model on 429', async () => {
  const urls = [];
  const provider = new GeminiLlmProvider({
    apiKey: 'K', model: 'big', fallbackModels: ['small'], retryDelayMilliseconds: 1,
    fetchImplementation: async (url) => {
      urls.push(url);
      return url.includes('big') ? fakeResponse(429, { error: 'quota' }) : geminiOk('{"steps":[{"say":"ok"}]}');
    },
  });
  const plan = await provider.generatePlan(sampleRequest);
  assert.equal(plan.steps[0].say, 'ok');
  assert.equal(urls.filter((url) => url.includes('big')).length, 1);
});

test('gemini does not retry on 400 and requires a key', async () => {
  let callCount = 0;
  const provider = new GeminiLlmProvider({ apiKey: 'K', model: 'm', fetchImplementation: async () => { callCount += 1; return fakeResponse(400, { error: 'bad' }); } });
  await assert.rejects(() => provider.generatePlan(sampleRequest), /HTTP 400/);
  assert.equal(callCount, 1);
  assert.throws(() => new GeminiLlmProvider({ apiKey: '', model: 'm' }), /GEMINI_API_KEY/);
});

test('ollama sends images, schema format and honours box order', async () => {
  let sentBody;
  const provider = new OllamaLlmProvider({
    host: 'http://x:1/', model: 'qwen3-vl:8b', boxOrder: 'xyxy',
    fetchImplementation: async (url, init) => {
      assert.equal(url, 'http://x:1/api/chat');
      sentBody = JSON.parse(init.body);
      return fakeResponse(200, { message: { content: '{"steps":[{"say":"s","mark":{"type":"box","box_2d":[100,20,300,60]}}]}' } });
    },
  });
  const plan = await provider.generatePlan(sampleRequest);
  assert.deepEqual(plan.steps[0].mark.box_2d, [20, 100, 60, 300]);
  assert.deepEqual(sentBody.messages.at(-1).images, ['QUJD']);
  assert.equal(sentBody.format.type, 'object');
  assert.equal(sentBody.stream, false);
});

test('gemini stt sends audio and returns trimmed transcript', async () => {
  let sentBody;
  const provider = new GeminiSttProvider({
    apiKey: 'K', model: 'm',
    fetchImplementation: async (_url, init) => { sentBody = JSON.parse(init.body); return geminiOk('  what is a mutex \n'); },
  });
  assert.equal(await provider.transcribe(Buffer.from('RIFF')), 'what is a mutex');
  assert.equal(sentBody.contents[0].parts[1].inlineData.mimeType, 'audio/wav');
});

test('sapi script never embeds spoken text and escapes voice names', () => {
  const script = buildSapiScript({ rate: 99, voiceName: "Bob's Voice" });
  assert.match(script, /Rate = 10/);
  assert.match(script, /SelectVoice\('Bob''s Voice'\)/);
  assert.match(script, /Console\]::In\.ReadToEnd/);
});

test('silent tts resolves and can be stopped', async () => {
  const logged = [];
  const tts = new SilentTtsProvider({ wordsPerMinute: 600000, log: (message) => logged.push(message) });
  await tts.speak('hello there');
  assert.equal(logged.length, 1);
  const slow = new SilentTtsProvider({ wordsPerMinute: 1 });
  const pending = slow.speak('a b c');
  slow.stop();
  await pending;
});

test('provider factory picks by env and rejects unknown names', () => {
  assert.ok(createLlmProvider({ LLM_PROVIDER: 'ollama' }) instanceof OllamaLlmProvider);
  assert.throws(() => createLlmProvider({ LLM_PROVIDER: 'nope' }), /Unknown LLM_PROVIDER/);
  assert.equal(createSttProvider({ STT_PROVIDER: 'none' }), null);
  assert.ok(createTtsProvider({ TTS_PROVIDER: 'none' }, () => {}) instanceof SilentTtsProvider);
  assert.throws(() => createLlmProvider({ LLM_PROVIDER: 'gemini' }), /GEMINI_API_KEY/);
});

test('gemini survives a 503 "high demand" by moving to the next model, and skips retired (404) models', async () => {
  const urls = [];
  const provider = new GeminiLlmProvider({
    apiKey: 'K', model: 'busy', fallbackModels: ['retired', 'calm'], retryDelayMilliseconds: 1,
    fetchImplementation: async (url) => {
      urls.push(url);
      if (url.includes('busy')) return fakeResponse(503, { error: { message: 'high demand' } });
      if (url.includes('retired')) return fakeResponse(404, { error: 'not found' });
      return geminiOk('{"steps":[{"say":"ok"}]}');
    },
  });
  const plan = await provider.generatePlan(sampleRequest);
  assert.equal(plan.steps[0].say, 'ok');
  assert.equal(urls.filter((url) => url.includes('retired')).length, 1);
});

test('gemini explains in plain words when every model is overloaded', async () => {
  const provider = new GeminiLlmProvider({
    apiKey: 'K', model: 'a', fallbackModels: ['b'], retryDelayMilliseconds: 1,
    fetchImplementation: async () => fakeResponse(503, { error: 'high demand' }),
  });
  await assert.rejects(() => provider.generatePlan(sampleRequest), /overloaded right now \(your key is fine\)/);
});

test('gemini voice input also falls back when the first model is busy', async () => {
  const provider = new GeminiSttProvider({
    apiKey: 'K', model: 'busy', fallbackModels: ['calm'], retryDelayMilliseconds: 1,
    fetchImplementation: async (url) => (url.includes('busy') ? fakeResponse(503, {}) : geminiOk(' hello ')),
  });
  assert.equal(await provider.transcribe(Buffer.from('RIFF')), 'hello');
});
