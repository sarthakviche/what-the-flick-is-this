'use strict';
const { postJson } = require('../http');

/** Speech to text by asking Gemini to transcribe the WAV. Zero install, uses the same free key. */
class GeminiSttProvider {
  constructor({ apiKey, model, fetchImplementation = fetch }) {
    if (!apiKey) throw new Error('GEMINI_API_KEY is missing');
    this.apiKey = apiKey;
    this.model = model;
    this.fetchImplementation = fetchImplementation;
  }

  async transcribe(wavBuffer) {
    const responseJson = await postJson({
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
      headers: { 'x-goog-api-key': this.apiKey },
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
    });
    const parts = responseJson?.candidates?.[0]?.content?.parts || [];
    return parts.map((part) => part.text || '').join('').trim();
  }
}

module.exports = { GeminiSttProvider };
