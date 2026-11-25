'use strict';
const { RESPONSE_JSON_SCHEMA, toGeminiSchema, parsePlanFromText } = require('../../core/schema');
const { postToGeminiWithFallback } = require('../geminiRequest');

/**
 * Gemini via the REST generateContent endpoint. REST instead of an SDK keeps dependencies
 * at zero and makes the request easy to unit test.
 * Free tier keys are rate limited or hit "high demand" 503s, so geminiRequest retries and walks the fallback models.
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
    return postToGeminiWithFallback({
      apiKey: this.apiKey,
      modelsToTry: this.modelsToTry,
      body: this.buildRequestBody(request),
      fetchImplementation: this.fetchImplementation,
      retryDelayMilliseconds: this.retryDelayMilliseconds,
      readResponse: (responseJson) => {
        const candidateParts = responseJson?.candidates?.[0]?.content?.parts || [];
        const responseText = candidateParts.map((part) => part.text || '').join('');
        if (!responseText) {
          const blockReason = responseJson?.promptFeedback?.blockReason || responseJson?.candidates?.[0]?.finishReason;
          throw new Error(`Gemini returned no text${blockReason ? ` (${blockReason})` : ''}`);
        }
        return parsePlanFromText(responseText, { screenshotSizes: request.screenshots });
      },
    });
  }
}

module.exports = { GeminiLlmProvider };
