'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Piper (https://github.com/rhasspy/piper): local neural voice, much nicer than SAPI.
 * Synthesizes to a temp WAV then plays it with System.Media.SoundPlayer (no extra install).
 */
class PiperTtsProvider {
  constructor({ piperExecutable, modelPath, spawnImplementation = spawn }) {
    this.piperExecutable = piperExecutable;
    this.modelPath = modelPath;
    this.spawnImplementation = spawnImplementation;
    this.currentProcess = null;
  }

  runProcess(command, args, stdinText) {
    return new Promise((resolve, reject) => {
      const child = this.spawnImplementation(command, args, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
      this.currentProcess = child;
      let errorOutput = '';
      child.stderr?.on('data', (chunk) => { errorOutput += chunk; });
      child.on('error', reject);
      child.on('exit', (code, signal) => {
        this.currentProcess = null;
        if (signal || code === 0) resolve();
        else reject(new Error(`${path.basename(command)} failed (${code}): ${errorOutput.slice(0, 200)}`));
      });
      child.stdin.end(stdinText ?? '', 'utf8');
    });
  }

  async speak(text) {
    const wavPath = path.join(os.tmpdir(), `flick-tts-${process.pid}-${Date.now()}.wav`);
    try {
      await this.runProcess(this.piperExecutable, ['--model', this.modelPath, '--output_file', wavPath], text);
      const escapedPath = wavPath.replace(/'/g, "''");
      await this.runProcess(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', `(New-Object System.Media.SoundPlayer '${escapedPath}').PlaySync()`],
        '',
      );
    } finally {
      fs.rm(wavPath, { force: true }, () => {});
    }
  }

  stop() {
    if (this.currentProcess) this.currentProcess.kill();
  }
}

module.exports = { PiperTtsProvider };
