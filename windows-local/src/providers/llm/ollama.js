'use strict';
const { RESPONSE_JSON_SCHEMA, parsePlanFromText } = require('../../core/schema');
const { postJson } = require('../http');

/**
 * Fully local path through Ollama (for example qwen3-vl:8b). Experimental: small local
 * models are weaker at precise boxes than Gemini. Ollama accepts a JSON schema in "format".
 */
class OllamaLlmProvider {
  constructor({ host, model, boxOrder = 'yxyx', fetchImplementation = fetch }) {
    this.host = host.replace(/\/$/, '');
    this.model = model;
    this.boxOrder = boxOrder;
    this.fetchImplementation = fetchImplementation;
  }

  buildRequestBody({ systemPrompt, history, userText, screenshots }) {
    const imageLabels = screenshots.map((shot) => shot.label).join('\n');
    return {
      model: this.model,
      stream: false,
      format: RESPONSE_JSON_SCHEMA,
      options: { temperature: 0.3 },
      messages: [
        { role: 'system', content: systemPrompt },
        ...history.map((turn) => ({ role: turn.role, content: turn.text })),
        {
          role: 'user',
          content: `${imageLabels ? `screens in order:\n${imageLabels}\n\n` : ''}${userText}`,
          images: screenshots.map((shot) => shot.base64),
        },
      ],
    };
  }

  async generatePlan(request) {
    const responseJson = await postJson({
      url: `${this.host}/api/chat`,
      headers: {},
      body: this.buildRequestBody(request),
      fetchImplementation: this.fetchImplementation,
      timeoutMilliseconds: 180000,
    });
    return parsePlanFromText(responseJson?.message?.content || '', {
      boxOrder: this.boxOrder,
      screenshotSizes: request.screenshots,
    });
  }
}

module.exports = { OllamaLlmProvider };
