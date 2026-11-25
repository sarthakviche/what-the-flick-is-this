# "What the flick is this": plan and architecture

## Decision (read this first)

**Build a new Electron client in `windows-local/`, free of paid services, and leave the Swift macOS app untouched.**

Why:

1. **The repo has no Windows path.** The Swift app depends on ScreenCaptureKit, `NSPanel`, `CGEvent` taps and AVAudioEngine. Nothing is portable. Porting Swift to Windows is not realistic.
2. **Raynan00/clacky is not a good base.** It is Python and PyQt, and its brain is Claude plus Deepgram (both paid). Its overlay and pointing ideas are useful reference, but reusing its code would mean re-removing paid dependencies and then adding annotation and whiteboard on top.
3. **Electron fits the exact needs.**
   - Transparent, click-through, always-on-top overlay windows per display (`transparent`, `setIgnoreMouseEvents`, `alwaysOnTop: 'screen-saver'`).
   - `desktopCapturer` for multi-monitor screenshots, `setContentProtection` so our own marks are not captured back into the next screenshot.
   - A web view is the natural host for the whiteboard (KaTeX, highlight.js, Mermaid), so lib reuse is trivial.
   - Same language end to end for the overlay, the provider layer and the tests.
   - Tauri was considered: smaller binary, but Rust plus WebView2 transparency and capture are more work and I cannot test either on Windows here. Electron wins on pragmatism.
4. **Keep the repo's ideas**: push-to-talk, screenshot, vision LLM, spoken reply, cursor that flies to elements. The system prompt tone (lowercase, spoken, no markdown, plant a seed at the end) is carried over into `src/core/prompt.js`. The Cloudflare Worker is dropped for local use because keys live in a local `.env`. A distributed binary would need it back.

## Goals and how each is met

| Goal | Approach |
|------|----------|
| No paid dependencies | Provider interfaces for LLM, STT, TTS. Defaults: Gemini free tier, Gemini audio (zero install) or local faster-whisper, Windows SAPI voice (zero install) or Piper. Optional Ollama (Qwen3-VL). |
| Annotation | Model returns JSON steps. A step has `say`, optional `mark` (point, circle, box, arrow, underline, with label) and `board` lines. Marks stay until dismissed. |
| Whiteboard | Separate always-on-top window, docked right. Board lines fill in per step while that step is spoken. Rendered with KaTeX, highlight.js, Mermaid. |
| Windows | Electron, `uiohook-napi` for press and release of Ctrl+Alt (push-to-talk), plus a `globalShortcut` toggle fallback and a text box in the panel. |

## Data flow

```
hold Ctrl+Alt ──> recorder (hidden renderer, 16 kHz WAV)
release ────────> STT provider ──> transcript
                  capture all displays (JPEG, labeled screen1..N)
transcript + screenshots + history ──> LLM provider (JSON schema output)
                                       └─> { steps: [ {say, mark?, board?[]} ] }
for each step (sequential):
    overlay.drawMark(step.mark)      // persists
    whiteboard.append(step.board)    // progressive
    await tts.speak(step.say)
Ctrl+Alt+X (or next question) clears marks
```

## Structured output contract

Coordinates are Gemini style: `[ymin, xmin, ymax, xmax]` for boxes and `[y, x]` for points, all normalized to 0-1000 per screen. Normalized coordinates make multi-monitor and DPI scaling trivial: pixel position = value / 1000 * display DIP size. This replaces the original `[POINT:x,y:label:screenN]` text tag. The tag format is still parsed as a fallback so the original prompt idea keeps working.

```json
{"mode":"annotate|whiteboard|answer",
 "steps":[{"say":"...","screen":1,
           "mark":{"type":"point|circle|box|arrow|underline","box_2d":[..],"point":[y,x],"from":[y,x],"to":[y,x],"label":"..."},
           "board":[{"kind":"heading|text|math|code|diagram","content":"...","lang":"python"}],
           "clear_board":false}]}
```

Tradeoff: we wait for the full JSON before starting playback (simple, robust). Streaming partial JSON would cut latency by about a second or two but needs an incremental parser. Left as a follow-up.

## Provider interfaces

- `LlmProvider.generatePlan({systemPrompt, history, userText, screenshots}) -> Plan`
- `SttProvider.transcribe(wavBuffer) -> string`
- `TtsProvider.speak(text, {signal}) -> Promise<void>` (resolves when audio ends; abortable)

Selected by env (`LLM_PROVIDER`, `STT_PROVIDER`, `TTS_PROVIDER`). Adding a provider is one file plus one line in the index.

## Whiteboard library choice

tldraw and Excalidraw are made for freehand drawing. Exam prep is mostly derivations, code and flow diagrams, which are generated as text. KaTeX (math), highlight.js (code) and Mermaid (diagrams) render those better, are small, and work offline from `node_modules`. Excalidraw can be added later for sketch style output.

## Milestones

1. Core loop: hotkey (or panel text box), screenshot, Gemini, one circle, spoken reply.
2. All mark types, persistence, dismiss.
3. Whiteboard window.
4. Voice input (Gemini audio STT, faster-whisper sidecar).
5. Ollama provider, README.

## Verification limits

Developed on Linux. Pure logic (schema, coordinates, providers with mocked HTTP, orchestrator) is unit tested. Electron windows are exercised under Xvfb if the binary installs. The Windows-only parts (transparent click-through overlay behavior, uiohook hotkey, SAPI speech, WASAPI mic) cannot be run here and are called out in the final summary.

## Status at handoff

Implemented and tested here: schema and coordinate logic, session orchestration (ordered board queue, cancellation), Gemini and Ollama request building (mocked HTTP), Gemini STT, WAV encoder, SAPI script building, provider factory, real screen capture, overlay rendering of all five mark types and the whiteboard (math, code, Mermaid) under Xvfb, app boot and error reporting.

Not run here (no Windows, no network to Google, no audio devices): a live Gemini call, transparent click-through behavior on Windows, `uiohook-napi` hotkey, microphone capture, SAPI and Piper playback, faster-whisper, Ollama. See the final summary for the exact list.
