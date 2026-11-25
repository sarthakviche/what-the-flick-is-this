'use strict';
const { RESPONSE_JSON_SCHEMA, toGeminiSchema } = require('../core/schema');
const { buildModelsToTry, postToGeminiWithFallback } = require('../providers/geminiRequest');
const { HttpError } = require('../providers/http');

/** Turns a Gemini/Groq error status into a sentence a non-developer can act on. */
function explainHttpStatus(serviceName, status, bodyText) {
  if (status === 400 && /API_KEY_INVALID|API key not valid/i.test(bodyText)) return `${serviceName} says this key is not valid. Copy it again, the whole thing.`;
  if (status === 401 || status === 403) return `${serviceName} rejected the key (HTTP ${status}). Copy it again or make a new one.`;
  if (status === 404) return `${serviceName} does not know that model id. Clear the model box to use the default.`;
  if (status === 429) return `The key works, but ${serviceName} says you are rate limited right now. Wait a minute.`;
  return `${serviceName} returned HTTP ${status}: ${bodyText.slice(0, 160)}`;
}

/**
 * One tiny structured-output call, the same shape the real app uses, with the same model fallbacks.
 * 503 "high demand" and 429 mean Google accepted the key and is only busy, so they count as a working key.
 */
async function checkGeminiKey({ apiKey, modelName }) {
  if (!apiKey) return { isOk: false, message: 'No Gemini key yet. Follow the steps below to get a free one.' };
  try {
    const answeringModel = await postToGeminiWithFallback({
      apiKey,
      modelsToTry: buildModelsToTry(modelName),
      body: {
        contents: [{ role: 'user', parts: [{ text: 'Say hi in one step.' }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: toGeminiSchema(RESPONSE_JSON_SCHEMA) },
      },
      readResponse: (_responseJson, respondingModelName) => respondingModelName,
      retryDelayMilliseconds: 800,
      timeoutMilliseconds: 30000,
    });
    return { isOk: true, message: `Gemini key works (model ${answeringModel}).` };
  } catch (error) {
    if (error instanceof HttpError) return { isOk: false, message: explainHttpStatus('Gemini', error.status, error.message) };
    if (/overloaded|free tier limit/.test(error.message)) return { isOk: true, message: `your key is accepted, but ${error.message.charAt(0).toLowerCase()}${error.message.slice(1)}` };
    return { isOk: false, message: `Could not reach Gemini: ${error.message}` };
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
