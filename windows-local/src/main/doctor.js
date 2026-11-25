'use strict';
// Run with: npm run doctor. Checks configuration and the Gemini key without starting Electron.
const { loadConfiguration } = require('./config');
const { checkGeminiKey } = require('./keyCheck');

(async () => {
  const environment = loadConfiguration();
  const lines = [];
  const report = (isOk, message) => lines.push(`${isOk ? 'OK  ' : 'FAIL'} ${message}`);

  report(true, `LLM_PROVIDER=${environment.LLM_PROVIDER || 'gemini'} STT_PROVIDER=${environment.STT_PROVIDER || 'gemini'} TTS_PROVIDER=${environment.TTS_PROVIDER || 'sapi'}`);

  if ((environment.LLM_PROVIDER || 'gemini') === 'gemini') {
    if (!environment.GEMINI_API_KEY) report(false, 'GEMINI_API_KEY is empty. Put your key in windows-local/.env');
    else {
      const checkResult = await checkGeminiKey({ apiKey: environment.GEMINI_API_KEY, modelName: environment.GEMINI_MODEL });
      report(checkResult.isOk, checkResult.message);
    }
  }
  if ((environment.TTS_PROVIDER || 'sapi') === 'sapi' && process.platform !== 'win32') report(false, 'TTS_PROVIDER=sapi only works on Windows');
  console.log(lines.join('\n'));
  process.exit(lines.some((line) => line.startsWith('FAIL')) ? 1 : 0);
})();
