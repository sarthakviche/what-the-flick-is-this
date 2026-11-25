# what the flick is this (Windows, free, local)

A hotkey-triggered, screen-aware study buddy for Windows. Hold a key, ask a question out loud, and it looks at your screen, answers out loud, **circles, boxes, underlines and points arrows at things on your screen**, and can **write step-by-step derivations and code walkthroughs on a whiteboard** while it talks.

It is built on the idea of [Clicky](../README.md) (push to talk, screenshot, vision model, spoken answer, flying cursor), but it runs on Windows and costs nothing: no Claude, AssemblyAI, ElevenLabs or Cloudflare Worker.

Design decisions and tradeoffs are in [`../docs/PLAN.md`](../docs/PLAN.md).

## What you need

| Thing | Cost | Why |
|---|---|---|
| Windows 10 (2004 or newer) or 11, x64 | free | the app targets this |
| [Node.js LTS](https://nodejs.org) (v20 or newer) | free | runs the app |
| A free Gemini API key | free | the brain (vision + reasoning) and, by default, speech to text |
| Microphone, speakers | | |

Everything else (voice output) uses Windows' built in voices by default.

## Run it: exact steps

1. **Install Node.js LTS** from https://nodejs.org (accept the defaults). Open a new **PowerShell** window and check:
   ```powershell
   node -v
   ```
   It should print v20 or higher.

2. **Get the code.** Either `git clone` this repo, or download the ZIP from GitHub and extract it. Then go to the app folder:
   ```powershell
   cd path\to\clicky\windows-local
   ```

3. **Get a free Gemini key.** Open https://aistudio.google.com/apikey, sign in, click **Create API key**, and copy it.

4. **Create your config file** (the `.env` file is git-ignored, so your key is never committed):
   ```powershell
   copy .env.example .env
   notepad .env
   ```
   Paste your key after `GEMINI_API_KEY=` and save. Leave everything else as it is for now.

5. **Install dependencies** (downloads Electron, about 100 MB, takes a minute or two):
   ```powershell
   npm install
   ```

6. **Check your setup:**
   ```powershell
   npm run doctor
   ```
   You want `OK` for Gemini. If it says the model returned HTTP 404, the model id in `.env` is out of date: open https://ai.google.dev/gemini-api/docs/models, pick a current Flash model that your key can use, and put it in `GEMINI_MODEL`.

7. **Start it:**
   ```powershell
   npm start
   ```
   A small panel opens and a blue icon appears in the system tray. Closing the panel keeps the app running in the tray. Quit from the tray menu.

8. **Use it.**
   - **Hold `Ctrl+Alt`**, speak, release. (Or press `Ctrl+Alt+Space` to start and again to stop, or click **Mic on/off**, or type in the panel.)
   - **`Alt+Shift+X`** clears all marks from the screen. Marks stay until you clear them or ask a new question.
   - Try: *"what does this line of code do?"* with some code on screen, *"which button runs the program?"*, *"derive the quotient rule on the whiteboard"*, *"explain this circuit diagram step by step"*, *"explain how a B tree insert works with a diagram"*.

Windows may show a Firewall prompt the first time (it is only for the local speech helper and web calls). Allow it on private networks.

## How marks and the whiteboard work

The model returns JSON steps. Each step has what to say, an optional mark (`point`, `circle`, `box`, `arrow`, `underline`, with a label) and optional whiteboard lines (`heading`, `text`, `math` as LaTeX, `code`, `diagram` as Mermaid). The app draws the mark on a transparent click-through overlay, writes the board lines one at a time, and speaks the step. Boxes use Gemini's `box_2d` format `[ymin, xmin, ymax, xmax]` normalized 0 to 1000, which keeps multi monitor and Windows display scaling simple.

## Options

All in `.env`. See `.env.example` for every setting.

### Better local speech to text (faster-whisper)

The default sends your recorded question to Gemini for transcription (nothing to install). For fully local transcription:
```powershell
pip install faster-whisper
```
then set `STT_PROVIDER=faster-whisper` (and `PYTHON_BIN=python` or `py`). The first question downloads the `small.en` model (about 250 MB) and the app starts a small local helper on 127.0.0.1.

### Nicer voice (Piper)

1. Download Piper for Windows from https://github.com/rhasspy/piper/releases and a voice (`.onnx` and its `.onnx.json`) from https://huggingface.co/rhasspy/piper-voices.
2. Put them in `C:\piper\` and set in `.env`:
   ```
   TTS_PROVIDER=piper
   PIPER_EXE=C:\piper\piper\piper.exe
   PIPER_MODEL=C:\piper\en_US-lessac-medium.onnx
   ```
Built in Windows voices: set `SAPI_VOICE` to one from Settings > Time & language > Speech, and `SAPI_RATE` (-10 to 10).

### Fully local brain (Ollama, experimental)

```powershell
winget install Ollama.Ollama
ollama pull qwen3-vl:8b
```
In `.env`: `LLM_PROVIDER=ollama`. Nothing leaves your laptop. Expect slower answers and less precise circles than Gemini, especially without a GPU. If marks land in the wrong place, try `OLLAMA_BOX_ORDER=xyxy`. Pair it with `STT_PROVIDER=faster-whisper` for a fully offline setup.

## Privacy

Every question sends screenshots of **all your displays** to the model provider. With the Gemini free tier, Google's terms say content may be used to improve their products, so close anything private (banking, messages, personal documents) before asking, or use the Ollama path. Keys are read from `.env` only and sent only to Google in a request header.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Panel says `Hotkey hook unavailable` | `uiohook-napi` did not install. Run `npm install` again. Use `Ctrl+Alt+Space` or the mic button meanwhile. |
| HTTP 429 | Free tier rate limit. The app retries and tries `GEMINI_FALLBACK_MODELS`. Wait a minute. |
| HTTP 404 on the model | Model id is stale. See step 6. |
| No voice | Run `TTS_PROVIDER=none` to confirm the rest works, then check Windows sound output. |
| Marks hidden behind a full screen game or video | Exclusive fullscreen hides all overlays. Use borderless windowed. |
| Our marks show up in screenshots | Needs Windows 10 2004+. Otherwise set `EXCLUDE_OVERLAY_FROM_CAPTURE=false` and the app hides them briefly during each capture. |
| `Ctrl+Alt` conflicts with a keyboard layout (AltGr) | Set `PUSH_TO_TALK_KEYS=ctrl+shift` in `.env`. |

## Develop

```powershell
npm test            # unit tests (no Electron or network needed)
npm run doctor      # config and Gemini check
```
Layout:
```
src/core/        pure logic: response schema, coordinate math, prompt, session orchestrator
src/providers/   llm/ stt/ tts/ implementations behind small interfaces, selected in providers/index.js
src/main/        Electron main process: windows, capture, hotkey, recorder
src/renderer/    overlay, whiteboard, panel, recorder pages
sidecar/         optional faster-whisper helper (Python)
test/            node:test unit tests; test/e2e/smoke-main.js is a manual Electron smoke test
```
Add a provider by writing one file that implements `generatePlan`, `transcribe` or `speak`, then adding one line in `src/providers/index.js`.
