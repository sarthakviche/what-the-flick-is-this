'use strict';
const { RESPONSE_JSON_SCHEMA, toGeminiSchema } = require('../core/schema');
const { DEFAULT_GEMINI_MODEL } = require('../providers');

/** Turns a Gemini/Groq error status into a sentence a non-developer can act on. */
function explainHttpStatus(serviceName, status, bodyText) {
  if (status === 400 && /API_KEY_INVALID|API key not valid/i.test(bodyText)) return `${serviceName} says this key is not valid. Copy it again, the whole thing.`;
  if (status === 401 || status === 403) return `${serviceName} rejected the key (HTTP ${status}). Copy it again or make a new one.`;
  if (status === 404) return `${serviceName} does not know that model id. Clear the model box to use the default.`;
  if (status === 429) return `The key works, but ${serviceName} says you are rate limited right now. Wait a minute.`;
  return `${serviceName} returned HTTP ${status}: ${bodyText.slice(0, 160)}`;
}

/** One tiny structured-output call, the same shape the real app uses. */
async function checkGeminiKey({ apiKey, modelName }) {
  if (!apiKey) return { isOk: false, message: 'No Gemini key yet. Follow the steps below to get a free one.' };
  const modelToCheck = modelName || DEFAULT_GEMINI_MODEL;
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelToCheck)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Say hi in one step.' }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: toGeminiSchema(RESPONSE_JSON_SCHEMA) },
      }),
      signal: AbortSignal.timeout(30000),
    });
    const bodyText = await response.text();
    if (response.ok) return { isOk: true, message: `Gemini key works (model ${modelToCheck}).` };
    return { isOk: response.status === 429, message: explainHttpStatus('Gemini', response.status, bodyText) };
  } catch (error) {
    return { isOk: false, message: `Could not reach Gemini: ${error.message}. Check your internet.` };
  }
}

/** Groq keys are checked by listing models, which costs nothing. */
async function checkGroqKey({ apiKey }) {
  if (!apiKey) return { isOk: false, message: 'No Groq key. That is fine, it is optional.' };
  try {
    const response = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(20000),
    });
    const bodyText = await response.text();
    if (response.ok) return { isOk: true, message: 'Groq key works.' };
    return { isOk: false, message: explainHttpStatus('Groq', response.status, bodyText) };
  } catch (error) {
    return { isOk: false, message: `Could not reach Groq: ${error.message}` };
  }
}

module.exports = { checkGeminiKey, checkGroqKey };
