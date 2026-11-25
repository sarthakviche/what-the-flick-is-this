'use strict';
const { HttpError, RETRYABLE_STATUSES, postJson, sleep } = require('./http');

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
// Google's "latest" aliases follow the current Flash models. The pinned ids are extra fallbacks;
// if Google retires one it answers 404 and we skip it.
const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';
const DEFAULT_GEMINI_FALLBACK_MODELS = ['gemini-flash-lite-latest', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
const ATTEMPTS_PER_MODEL = 2;

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
 * Free tier Gemini often answers 503 "high demand" or 429. For each model we retry once after a
 * short wait, then move to the next model. A 404 means the model id is retired, so we skip it.
 * readResponse(responseJson, modelName) turns the JSON into the caller's result.
 */
async function postToGeminiWithFallback({ apiKey, modelsToTry, body, readResponse, fetchImplementation = fetch, retryDelayMilliseconds = 1500, timeoutMilliseconds }) {
  let lastError = null;
  for (const modelName of modelsToTry) {
    for (let attemptNumber = 0; attemptNumber < ATTEMPTS_PER_MODEL; attemptNumber += 1) {
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
        if (isRetiredModel) { lastError = lastError || error; break; }
        if (!isRetryable) throw error;
        lastError = error;
        if (attemptNumber < ATTEMPTS_PER_MODEL - 1) await sleep(retryDelayMilliseconds);
      }
    }
  }
  throw describeFinalFailure(lastError);
}

module.exports = {
  GEMINI_BASE_URL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_FALLBACK_MODELS,
  parseModelList,
  buildModelsToTry,
  postToGeminiWithFallback,
};
