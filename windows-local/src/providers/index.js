'use strict';
const { GeminiLlmProvider } = require('./llm/gemini');
const { OllamaLlmProvider } = require('./llm/ollama');
const { GeminiSttProvider } = require('./stt/gemini');
const { FasterWhisperSttProvider } = require('./stt/fasterWhisper');
const { GroqSttProvider } = require('./stt/groq');
const { SapiTtsProvider } = require('./tts/sapi');
const { KokoroTtsProvider } = require('./tts/kokoro');
const { PiperTtsProvider } = require('./tts/piper');
const { SilentTtsProvider } = require('./tts/none');

const { DEFAULT_GEMINI_MODEL, parseModelList, buildModelsToTry } = require('./geminiRequest');

/** Provider factories. To add a provider: write one file implementing the interface and add one line here. */
function createLlmProvider(env) {
  const providerName = (env.LLM_PROVIDER || 'gemini').toLowerCase();
  if (providerName === 'gemini') {
    return new GeminiLlmProvider({
      apiKey: env.GEMINI_API_KEY,
      model: env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
      fallbackModels: buildModelsToTry(env.GEMINI_MODEL, parseModelList(env.GEMINI_FALLBACK_MODELS)).slice(1),
    });
  }
  if (providerName === 'ollama') {
    return new OllamaLlmProvider({
      host: env.OLLAMA_HOST || 'http://127.0.0.1:11434',
      model: env.OLLAMA_MODEL || 'qwen3-vl:8b',
      boxOrder: env.OLLAMA_BOX_ORDER || 'yxyx',
    });
  }
  throw new Error(`Unknown LLM_PROVIDER "${providerName}". Use gemini or ollama.`);
}

/** "auto" uses Groq's free Whisper when a Groq key exists, so voice input does not spend Gemini quota. */
function resolveSttProviderName(env) {
  const requestedName = (env.STT_PROVIDER || 'auto').toLowerCase();
  if (requestedName !== 'auto') return requestedName;
  return env.GROQ_API_KEY ? 'groq' : 'gemini';
}

function createSttProvider(env) {
  const providerName = resolveSttProviderName(env);
  if (providerName === 'none') return null;
  if (providerName === 'gemini') {
    const sttModel = env.GEMINI_STT_MODEL || env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
    return new GeminiSttProvider({
      apiKey: env.GEMINI_API_KEY,
      model: sttModel,
      fallbackModels: buildModelsToTry(sttModel, parseModelList(env.GEMINI_FALLBACK_MODELS)).slice(1),
    });
  }
  if (providerName === 'groq') return new GroqSttProvider({ apiKey: env.GROQ_API_KEY });
  if (providerName === 'faster-whisper') {
    return new FasterWhisperSttProvider({
      sidecarUrl: env.WHISPER_SIDECAR_URL || 'http://127.0.0.1:8765',
      pythonBinary: env.PYTHON_BIN || 'python',
      modelName: env.WHISPER_MODEL || 'small.en',
    });
  }
  throw new Error(`Unknown STT_PROVIDER "${providerName}". Use auto, gemini, groq, faster-whisper or none.`);
}

/**
 * kokoroCollaborators ({ startWorker, playWav, stopPlayback }) come from the Electron main process.
 * Without them (tests, doctor) "kokoro" falls back to the Windows voice.
 */
function createTtsProvider(env, log, kokoroCollaborators = null) {
  const providerName = (env.TTS_PROVIDER || 'kokoro').toLowerCase();
  const windowsVoice = () => new SapiTtsProvider({ rate: Number(env.SAPI_RATE || 1), voiceName: env.SAPI_VOICE || '' });
  if (providerName === 'none') return new SilentTtsProvider({ log });
  if (providerName === 'sapi') return windowsVoice();
  if (providerName === 'kokoro') {
    if (!kokoroCollaborators) return windowsVoice();
    return new KokoroTtsProvider({ ...kokoroCollaborators, fallbackProvider: windowsVoice(), log });
  }
  if (providerName === 'piper') return new PiperTtsProvider({ piperExecutable: env.PIPER_EXE, modelPath: env.PIPER_MODEL });
  throw new Error(`Unknown TTS_PROVIDER "${providerName}". Use kokoro, sapi, piper or none.`);
}

module.exports = { DEFAULT_GEMINI_MODEL, resolveSttProviderName, createLlmProvider, createSttProvider, createTtsProvider };
