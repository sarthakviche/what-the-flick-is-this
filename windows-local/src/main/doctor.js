'use strict';
// Run with: npm run doctor. Checks configuration and the Gemini key without starting Electron.
const { loadConfiguration } = require('./config');
const { RESPONSE_JSON_SCHEMA, toGeminiSchema } = require('../core/schema');

(async () => {
  const environment = loadConfiguration();
  const lines = [];
  const report = (isOk, message) => lines.push(`${isOk ? 'OK  ' : 'FAIL'} ${message}`);

  report(true, `LLM_PROVIDER=${environment.LLM_PROVIDER || 'gemini'} STT_PROVIDER=${environment.STT_PROVIDER || 'gemini'} TTS_PROVIDER=${environment.TTS_PROVIDER || 'sapi'}`);

  if ((environment.LLM_PROVIDER || 'gemini') === 'gemini') {
    if (!environment.GEMINI_API_KEY) report(false, 'GEMINI_API_KEY is empty. Put your key in windows-local/.env');
    else {
      const modelName = environment.GEMINI_MODEL || 'gemini-3.8-flash';
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': environment.GEMINI_API_KEY },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: 'Say hi in one step.' }] }],
            generationConfig: { responseMimeType: 'application/json', responseSchema: toGeminiSchema(RESPONSE_JSON_SCHEMA) },
          }),
        });
        const bodyText = await response.text();
        report(response.ok, response.ok
          ? `Gemini model ${modelName} answered with structured output`
          : `Gemini model ${modelName} returned HTTP ${response.status}: ${bodyText.slice(0, 200)}. Check the model id at https://ai.google.dev/gemini-api/docs/models`);
      } catch (error) {
        report(false, `Could not reach Gemini: ${error.message}`);
      }
    }
  }
  if ((environment.TTS_PROVIDER || 'sapi') === 'sapi' && process.platform !== 'win32') report(false, 'TTS_PROVIDER=sapi only works on Windows');
  console.log(lines.join('\n'));
  process.exit(lines.some((line) => line.startsWith('FAIL')) ? 1 : 0);
})();
