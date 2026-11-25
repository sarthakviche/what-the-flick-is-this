'use strict';
const { spawn } = require('node:child_process');

/**
 * Windows built in voices through System.Speech. Zero install. Text goes in via stdin,
 * never on the command line, so quotes in the answer cannot break or inject into the script.
 */
function buildSapiScript({ rate, voiceName }) {
  const safeRate = Math.max(-10, Math.min(10, Number.isFinite(rate) ? Math.round(rate) : 1));
  const voiceLine = voiceName ? `$speaker.SelectVoice('${String(voiceName).replace(/'/g, "''")}')` : '';
  return [
    '[Console]::InputEncoding = [System.Text.Encoding]::UTF8',
    'Add-Type -AssemblyName System.Speech',
    '$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    `$speaker.Rate = ${safeRate}`,
    voiceLine,
    '$spokenText = [Console]::In.ReadToEnd()',
    '$speaker.Speak($spokenText)',
  ].filter(Boolean).join('; ');
}

class SapiTtsProvider {
  constructor({ rate = 1, voiceName = '', spawnImplementation = spawn } = {}) {
    this.rate = rate;
    this.voiceName = voiceName;
    this.spawnImplementation = spawnImplementation;
    this.currentProcess = null;
  }

  speak(text) {
    return new Promise((resolve, reject) => {
      const child = this.spawnImplementation(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', buildSapiScript({ rate: this.rate, voiceName: this.voiceName })],
        { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] },
      );
      this.currentProcess = child;
      let errorOutput = '';
      child.stderr?.on('data', (chunk) => { errorOutput += chunk; });
      child.on('error', reject);
      child.on('exit', (code, signal) => {
        this.currentProcess = null;
        if (signal || code === 0) resolve();
        else reject(new Error(`SAPI speech failed (${code}): ${errorOutput.slice(0, 200)}`));
      });
      child.stdin.end(text, 'utf8');
    });
  }

  stop() {
    if (this.currentProcess) this.currentProcess.kill();
  }
}

module.exports = { SapiTtsProvider, buildSapiScript };
