/* Float32 PCM chunks -> 16 kHz mono 16 bit WAV bytes. Works in the browser and in Node tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.wavEncoder = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const TARGET_SAMPLE_RATE = 16000;

  function concatenate(chunks) {
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
    return merged;
  }

  /** Linear interpolation resample. Good enough for speech recognition. */
  function resample(samples, inputRate, outputRate) {
    if (inputRate === outputRate) return samples;
    const outputLength = Math.floor(samples.length * outputRate / inputRate);
    const output = new Float32Array(outputLength);
    const ratio = inputRate / outputRate;
    for (let index = 0; index < outputLength; index += 1) {
      const sourcePosition = index * ratio;
      const lowerIndex = Math.floor(sourcePosition);
      const upperIndex = Math.min(lowerIndex + 1, samples.length - 1);
      const fraction = sourcePosition - lowerIndex;
      output[index] = samples[lowerIndex] * (1 - fraction) + samples[upperIndex] * fraction;
    }
    return output;
  }

  function encodeWav(chunks, inputSampleRate) {
    const samples = resample(concatenate(chunks), inputSampleRate, TARGET_SAMPLE_RATE);
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const writeText = (offset, text) => { for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i)); };
    writeText(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeText(8, 'WAVE');
    writeText(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, TARGET_SAMPLE_RATE, true);
    view.setUint32(28, TARGET_SAMPLE_RATE * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeText(36, 'data');
    view.setUint32(40, samples.length * 2, true);
    for (let index = 0; index < samples.length; index += 1) {
      const clamped = Math.max(-1, Math.min(1, samples[index]));
      view.setInt16(44 + index * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    }
    return new Uint8Array(buffer);
  }

  return { encodeWav, resample, TARGET_SAMPLE_RATE };
}));
