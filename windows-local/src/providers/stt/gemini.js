'use strict';
const { postToGeminiWithFallback } = require('../geminiRequest');

/** Speech to text by asking Gemini to transcribe the WAV. Zero install, uses the same free key. */
class GeminiSttProvider {
  constructor({ apiKey, model, fallbackModels = [], fetchImplementation = fetch, retryDelayMilliseconds = 1000 }) {
    if (!apiKey) throw new Error('GEMINI_API_KEY is missing');
    this.apiKey = apiKey;
    this.modelsToTry = [model, ...fallbackModels].filter(Boolean);
    this.retryDelayMilliseconds = retryDelayMilliseconds;
    this.fetchImplementation = fetchImplementation;
  }

  async transcribe(wavBuffer) {
    return postToGeminiWithFallback({
      apiKey: this.apiKey,
      modelsToTry: this.modelsToTry,
      retryDelayMilliseconds: this.retryDelayMilliseconds,
      body: {
        contents: [{
          role: 'user',
          parts: [
            { text: 'Transcribe this audio exactly. It is a student asking a question about computer science, maths or their screen. Output only the transcript, no commentary. If there is no speech, output nothing.' },
            { inlineData: { mimeType: 'audio/wav', data: Buffer.from(wavBuffer).toString('base64') } },
          ],
        }],
        generationConfig: { temperature: 0 },
      },
      fetchImplementation: this.fetchImplementation,
      readResponse: (responseJson) => {
        const parts = responseJson?.candidates?.[0]?.content?.parts || [];
        return parts.map((part) => part.text || '').join('').trim();
      },
    });
  }
}

module.exports = { GeminiSttProvider };
