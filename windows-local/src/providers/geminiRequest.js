'use strict';
const { HttpError, RETRYABLE_STATUSES, postJson, sleep } = require('./http');

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
// Free tier daily quotas are per model and Flash-Lite's is far larger than Flash's (reported around
// 500 vs 20 requests a day in late 2026), so Flash-Lite answers by default and Flash is the backup.
// The "latest" aliases follow Google's current models; a retired id answers 404 and is skipped.
const DEFAULT_GEMINI_MODEL = 'gemini-flash-lite-latest';
const DEFAULT_GEMINI_FALLBACK_MODELS = ['gemini-flash-latest'];
const ATTEMPTS_PER_MODEL = 2; // rounds through the model list
// Every attempt, failed or not, counts against the free quota, so one question never makes more than this.
const MAXIMUM_ATTEMPTS_PER_QUESTION = 3;

let notifyRequestSent = () => {};
/** Lets the app count Gemini requests (shown in the panel as "gemini calls today"). */
function setGeminiRequestListener(listener) {
  notifyRequestSent = typeof listener === 'function' ? listener : () => {};
}

function parseModelList(commaSeparatedModels) {
  return String(commaSeparatedModels || '').split(',').map((modelName) => modelName.trim()).filter(Boolean);
}

/** Main model first, then the user's fallbacks, then our defaults, without duplicates. */
function buildModelsToTry(mainModel, userFallbackModels = []) {
  return [...new Set([mainModel || DEFAULT_GEMINI_MODEL, ...userFallbackModels, ...DEFAULT_GEMINI_FALLBACK_MODELS])];
}

/** Explains the last failure in words a student can act on. */
function describeFinalFailure(lastError) {
  if (lastError instanceof HttpError && (lastError.status === 503 || lastError.status === 500)) {
    return new Error('Google\'s Gemini servers are overloaded right now (your key is fine). Wait a minute and ask again.');
  }
  if (lastError instanceof HttpError && lastError.status === 429) {
    return new Error('You hit the Gemini free tier limit for now. Wait a minute and ask again.');
  }
  return lastError;
}

/**
 * Free tier Gemini often answers 503 "high demand" or 429. We wait briefly and move to the next
 * model, with at most MAXIMUM_ATTEMPTS_PER_QUESTION failed tries in total. A 404 means the model id
 * is retired, so we skip it for the rest of the question.
 * readResponse(responseJson, modelName) turns the JSON into the caller's result.
 */
async function postToGeminiWithFallback({ apiKey, modelsToTry, body, readResponse, fetchImplementation = fetch, retryDelayMilliseconds = 1500, timeoutMilliseconds }) {
  let lastError = null;
  let attemptsMade = 0;
  const retiredModels = new Set();
  // Busy servers are usually busy per model, so a 503 moves straight to the next model. If every
  // model was busy we go round once more, until the per question cap is reached.
  for (let roundNumber = 0; roundNumber < ATTEMPTS_PER_MODEL; roundNumber += 1) {
    for (const modelName of modelsToTry) {
      if (retiredModels.has(modelName)) continue;
      if (attemptsMade >= MAXIMUM_ATTEMPTS_PER_QUESTION) throw describeFinalFailure(lastError);
      notifyRequestSent(modelName);
      try {
        const responseJson = await postJson({
          url: `${GEMINI_BASE_URL}/models/${encodeURIComponent(modelName)}:generateContent`,
          headers: { 'x-goog-api-key': apiKey },
          body,
          fetchImplementation,
          timeoutMilliseconds,
        });
        return await readResponse(responseJson, modelName);
      } catch (error) {
        const isRetiredModel = error instanceof HttpError && error.status === 404;
        const isRetryable = error instanceof HttpError && RETRYABLE_STATUSES.has(error.status);
        if (isRetiredModel) {
          // An unknown model id uses no quota, so it does not count towards the cap.
          retiredModels.add(modelName);
          lastError = lastError || error;
          continue;
        }
        if (!isRetryable) throw error;
        attemptsMade += 1;
        lastError = error;
        await sleep(retryDelayMilliseconds);
      }
    }
  }
  throw describeFinalFailure(lastError);
}

module.exports = {
  GEMINI_BASE_URL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_FALLBACK_MODELS,
  MAXIMUM_ATTEMPTS_PER_QUESTION,
  setGeminiRequestListener,
  parseModelList,
  buildModelsToTry,
  postToGeminiWithFallback,
};
