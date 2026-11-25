'use strict';
const { spawn } = require('node:child_process');
const path = require('node:path');

/**
 * Local transcription through a small Python sidecar (sidecar/stt_server.py) running
 * faster-whisper. The sidecar is started on demand and kept warm so the model loads once.
 */
class FasterWhisperSttProvider {
  constructor({ sidecarUrl, pythonBinary, modelName, fetchImplementation = fetch, spawnImplementation = spawn }) {
    this.sidecarUrl = sidecarUrl.replace(/\/$/, '');
    this.pythonBinary = pythonBinary;
    this.modelName = modelName;
    this.fetchImplementation = fetchImplementation;
    this.spawnImplementation = spawnImplementation;
    this.sidecarProcess = null;
  }

  async isSidecarHealthy() {
    try {
      const response = await this.fetchImplementation(`${this.sidecarUrl}/health`, { signal: AbortSignal.timeout(1500) });
      return response.ok;
    } catch (_error) {
      return false;
    }
  }

  async ensureSidecarRunning() {
    if (await this.isSidecarHealthy()) return;
    if (!this.sidecarProcess) {
      const port = new URL(this.sidecarUrl).port || '8765';
      this.sidecarProcess = this.spawnImplementation(
        this.pythonBinary,
        [path.join(__dirname, '..', '..', '..', 'sidecar', 'stt_server.py'), '--port', port, '--model', this.modelName],
        { stdio: 'inherit', windowsHide: true },
      );
      this.sidecarProcess.on('exit', () => { this.sidecarProcess = null; });
    }
    // First start downloads the model, so allow a generous wait.
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (await this.isSidecarHealthy()) return;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error('faster-whisper sidecar did not start. Run: pip install faster-whisper (see README).');
  }

  async transcribe(wavBuffer) {
    await this.ensureSidecarRunning();
    const response = await this.fetchImplementation(`${this.sidecarUrl}/transcribe`, {
      method: 'POST',
      headers: { 'content-type': 'audio/wav' },
      body: wavBuffer,
    });
    if (!response.ok) throw new Error(`Whisper sidecar error ${response.status}`);
    const responseJson = await response.json();
    return String(responseJson.text || '').trim();
  }

  dispose() {
    if (this.sidecarProcess) this.sidecarProcess.kill();
  }
}

module.exports = { FasterWhisperSttProvider };
