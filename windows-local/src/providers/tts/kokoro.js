'use strict';

const WAIT_FOR_MODEL_MILLISECONDS = 15000;

/**
 * Splits an answer step into sentences. Kokoro takes roughly as long to generate a sentence as it
 * takes to say it, so we generate sentence two while sentence one is playing.
 */
function splitIntoSentences(text) {
  const sentences = String(text || '').match(/[^.!?]+[.!?]*\s*/g) || [];
  return sentences.map((sentence) => sentence.trim()).filter(Boolean);
}

/**
 * Natural sounding local voice (Kokoro), free and offline after the first model download.
 * If the model is not ready yet (first download) or fails to load, it speaks with the fallback
 * voice (Windows SAPI) so the answer is never silent.
 *
 * Collaborators are injected so this file has no Electron imports:
 *   startWorker() -> child process with send/on('message')
 *   playWav(wavBuffer) -> Promise resolved when playback ends
 *   stopPlayback()
 */
class KokoroTtsProvider {
  constructor({ startWorker, playWav, stopPlayback, fallbackProvider, log = () => {} }) {
    this.playWav = playWav;
    this.stopPlayback = stopPlayback;
    this.fallbackProvider = fallbackProvider;
    this.log = log;
    this.isModelReady = false;
    this.hasModelFailed = false;
    this.nextRequestId = 1;
    this.pendingAudioByRequestId = new Map();
    this.preparedSentenceAudioByText = new Map();
    this.speechRunNumber = 0;

    this.modelReadyPromise = new Promise((resolve) => { this.resolveModelReady = resolve; });
    this.worker = startWorker();
    this.worker.on('message', (message) => this.handleWorkerMessage(message));
    this.worker.on('exit', () => {
      if (!this.isModelReady) this.markModelFailed('voice worker exited');
    });
  }

  handleWorkerMessage(message) {
    if (message.type === 'ready') {
      this.isModelReady = true;
      this.resolveModelReady(true);
      this.log('Kokoro voice ready');
    } else if (message.type === 'load-failed') {
      this.markModelFailed(message.message);
    } else if (message.type === 'audio' || message.type === 'failed') {
      const pendingAudio = this.pendingAudioByRequestId.get(message.requestId);
      if (!pendingAudio) return;
      this.pendingAudioByRequestId.delete(message.requestId);
      if (message.type === 'audio') pendingAudio.resolve(Buffer.from(message.wavBase64, 'base64'));
      else pendingAudio.reject(new Error(message.message));
    }
  }

  markModelFailed(reason) {
    this.hasModelFailed = true;
    this.resolveModelReady(false);
    this.log(`Kokoro voice unavailable, using the Windows voice instead (${reason})`);
  }

  requestSentenceAudio(sentence) {
    const requestId = this.nextRequestId++;
    const audioPromise = new Promise((resolve, reject) => this.pendingAudioByRequestId.set(requestId, { resolve, reject }));
    audioPromise.catch(() => {}); // a cancelled prefetch must not become an unhandled rejection
    this.worker.send({ type: 'generate', requestId, text: sentence });
    return audioPromise;
  }

  /** Starts generating a step's audio early so it is ready when the step is reached. */
  prepare(text) {
    if (!this.isModelReady) return;
    for (const sentence of splitIntoSentences(text)) {
      if (!this.preparedSentenceAudioByText.has(sentence)) this.preparedSentenceAudioByText.set(sentence, this.requestSentenceAudio(sentence));
    }
  }

  takeSentenceAudio(sentence) {
    const preparedAudio = this.preparedSentenceAudioByText.get(sentence);
    this.preparedSentenceAudioByText.delete(sentence);
    return preparedAudio || this.requestSentenceAudio(sentence);
  }

  async isUsable() {
    if (this.hasModelFailed) return false;
    if (this.isModelReady) return true;
    const timeout = new Promise((resolve) => setTimeout(() => resolve(false), WAIT_FOR_MODEL_MILLISECONDS));
    return Promise.race([this.modelReadyPromise, timeout]);
  }

  async speak(text) {
    const runNumberAtStart = this.speechRunNumber;
    if (!(await this.isUsable())) return this.fallbackProvider.speak(text);
    const sentences = splitIntoSentences(text);
    // Ask for every sentence now; the worker makes them in order while earlier ones play.
    const sentenceAudioPromises = sentences.map((sentence) => this.takeSentenceAudio(sentence));
    for (const sentenceAudioPromise of sentenceAudioPromises) {
      if (runNumberAtStart !== this.speechRunNumber) return undefined;
      let wavBuffer;
      try {
        wavBuffer = await sentenceAudioPromise;
      } catch (error) {
        if (error.message === 'cancelled') return undefined;
        throw error;
      }
      if (runNumberAtStart !== this.speechRunNumber) return undefined;
      await this.playWav(wavBuffer);
    }
    return undefined;
  }

  stop() {
    this.speechRunNumber += 1;
    this.preparedSentenceAudioByText.clear();
    this.worker.send({ type: 'cancel' });
    this.stopPlayback();
    this.fallbackProvider.stop();
  }

  dispose() {
    this.worker.kill();
  }
}

module.exports = { KokoroTtsProvider, splitIntoSentences };
