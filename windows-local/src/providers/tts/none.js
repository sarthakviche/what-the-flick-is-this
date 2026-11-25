'use strict';

/** Silent provider: waits roughly as long as speech would take so marks and board pace naturally. */
class SilentTtsProvider {
  constructor({ wordsPerMinute = 330, log = () => {} } = {}) {
    this.wordsPerMinute = wordsPerMinute;
    this.log = log;
    this.timer = null;
    this.pendingResolve = null;
  }

  speak(text) {
    this.log(`[speak] ${text}`);
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    const durationMilliseconds = Math.min(15000, (wordCount / this.wordsPerMinute) * 60000);
    return new Promise((resolve) => {
      this.pendingResolve = resolve;
      this.timer = setTimeout(() => { this.pendingResolve = null; resolve(); }, durationMilliseconds);
    });
  }

  stop() {
    clearTimeout(this.timer);
    if (this.pendingResolve) this.pendingResolve();
    this.pendingResolve = null;
  }
}

module.exports = { SilentTtsProvider };
