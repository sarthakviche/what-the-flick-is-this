'use strict';
const { RESPONSE_JSON_SCHEMA, toGeminiSchema, parsePlanFromText } = require('../../core/schema');
const { HttpError, RETRYABLE_STATUSES, postJson, sleep } = require('../http');

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Gemini via the REST generateContent endpoint. REST instead of an SDK keeps dependencies
 * at zero and makes the request easy to unit test.
 * Free tier keys are rate limited, so on 429/503 we retry once, then walk the fallback models.
 */
class GeminiLlmProvider {
  constructor({ apiKey, model, fallbackModels = [], fetchImplementation = fetch, retryDelayMilliseconds = 1500 }) {
    if (!apiKey) throw new Error('GEMINI_API_KEY is missing. Get a free key at https://aistudio.google.com/apikey');
    this.apiKey = apiKey;
    this.modelsToTry = [model, ...fallbackModels].filter(Boolean);
    this.fetchImplementation = fetchImplementation;
    this.retryDelayMilliseconds = retryDelayMilliseconds;
  }

  buildRequestBody({ systemPrompt, history, userText, screenshots }) {
    const historyContents = history.map((turn) => ({
      role: turn.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: turn.text }],
    }));
    const currentParts = [];
    for (const screenshot of screenshots) {
      currentParts.push({ text: screenshot.label });
      currentParts.push({ inlineData: { mimeType: screenshot.mimeType, data: screenshot.base64 } });
    }
    currentParts.push({ text: userText });
    return {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [...historyContents, { role: 'user', parts: currentParts }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: toGeminiSchema(RESPONSE_JSON_SCHEMA),
        temperature: 0.4,
      },
    };
  }

  async generatePlan(request) {
    const body = this.buildRequestBody(request);
    let lastError = null;
    for (const modelName of this.modelsToTry) {
      for (let attemptNumber = 0; attemptNumber < 2; attemptNumber += 1) {
        try {
          const responseJson = await postJson({
            url: `${GEMINI_BASE_URL}/models/${encodeURIComponent(modelName)}:generateContent`,
            headers: { 'x-goog-api-key': this.apiKey },
            body,
            fetchImplementation: this.fetchImplementation,
          });
          const candidateParts = responseJson?.candidates?.[0]?.content?.parts || [];
          const responseText = candidateParts.map((part) => part.text || '').join('');
          if (!responseText) {
            const blockReason = responseJson?.promptFeedback?.blockReason || responseJson?.candidates?.[0]?.finishReason;
            throw new Error(`Gemini returned no text${blockReason ? ` (${blockReason})` : ''}`);
          }
          return parsePlanFromText(responseText, { screenshotSizes: request.screenshots });
        } catch (error) {
          lastError = error;
          const isRetryable = error instanceof HttpError && RETRYABLE_STATUSES.has(error.status);
          if (!isRetryable) throw error;
          if (attemptNumber === 0) await sleep(this.retryDelayMilliseconds);
        }
      }
    }
    throw lastError;
  }
}

module.exports = { GeminiLlmProvider };
