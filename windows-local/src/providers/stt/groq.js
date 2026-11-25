'use strict';
const { HttpError } = require('../http');

const GROQ_TRANSCRIPTION_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

/**
 * Speech to text with Whisper on Groq's free tier. Faster than asking Gemini to transcribe and
 * keeps the Gemini free quota for the actual answers. Optional: only used when STT_PROVIDER=groq.
 */
class GroqSttProvider {
  constructor({ apiKey, model = 'whisper-large-v3-turbo', fetchImplementation = fetch }) {
    if (!apiKey) throw new Error('GROQ_API_KEY is missing. Get a free key at https://console.groq.com/keys or switch "ears" back to gemini.');
    this.apiKey = apiKey;
    this.model = model;
    this.fetchImplementation = fetchImplementation;
  }

  async transcribe(wavBuffer) {
    const multipartForm = new FormData();
    multipartForm.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'question.wav');
    multipartForm.append('model', this.model);
    multipartForm.append('language', 'en');
    multipartForm.append('response_format', 'json');
    let response;
    try {
      response = await this.fetchImplementation(GROQ_TRANSCRIPTION_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiKey}` },
        body: multipartForm,
        signal: AbortSignal.timeout(30000),
      });
    } catch (error) {
      throw new Error('Request to api.groq.com could not connect. Check your internet connection.');
    }
    const responseText = await response.text();
    if (!response.ok) throw new HttpError(`HTTP ${response.status}: ${responseText.slice(0, 300)}`, response.status);
    return String(JSON.parse(responseText).text || '').trim();
  }
}

module.exports = { GroqSttProvider };
