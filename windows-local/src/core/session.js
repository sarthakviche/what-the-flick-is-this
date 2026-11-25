'use strict';
const { markToShape, shapeAnchor, pickDisplayForScreenNumber } = require('./coords');

const BOARD_LINE_REVEAL_DELAY_MILLISECONDS = 450;

/**
 * Orchestrates one question: capture, ask the model, then play the steps in order
 * (draw mark, write board lines, speak). All side effects are injected so this file has
 * no Electron imports and is unit tested with fakes.
 *
 * Injected collaborators:
 *   llm.generatePlan(request) -> plan
 *   tts.speak(text) / tts.stop()
 *   captureScreens() -> [{label, mimeType, base64, width, height, displayId, displaySize}]
 *   overlay.addShape(displayId, shape, anchor) / overlay.clearAll()
 *   board.clear() / board.show() / board.append(line)
 *   reportStatus(stateName, detail)
 */
class CompanionSession {
  constructor({ llm, tts, captureScreens, overlay, board, reportStatus, systemPrompt, maxHistoryTurns = 12 }) {
    this.llm = llm;
    this.tts = tts;
    this.captureScreens = captureScreens;
    this.overlay = overlay;
    this.board = board;
    this.reportStatus = reportStatus;
    this.systemPrompt = systemPrompt;
    this.maxHistoryTurns = maxHistoryTurns;
    this.conversationHistory = [];
    this.currentRunNumber = 0;
    // Board writes go through one ordered queue so a short spoken step can never let its
    // lines overtake the unfinished lines of the previous step.
    this.boardQueue = [];
    this.isDrainingBoardQueue = false;
    this.pendingRevealTimers = new Set();
  }

  /** Stops speech and board reveals of the current answer. Marks stay until clearMarks. */
  cancelCurrentAnswer() {
    this.currentRunNumber += 1;
    this.tts.stop();
    for (const timer of this.pendingRevealTimers) clearTimeout(timer);
    this.pendingRevealTimers.clear();
    this.boardQueue = [];
  }

  clearMarks() {
    this.overlay.clearAll();
  }

  async ask(userText) {
    const trimmedQuestion = String(userText || '').trim();
    if (!trimmedQuestion) {
      this.reportStatus('idle', 'I did not catch that.');
      return null;
    }
    this.cancelCurrentAnswer();
    const runNumber = this.currentRunNumber;
    // New question means old marks are stale. The user can also dismiss them manually.
    this.overlay.clearAll();

    try {
      this.reportStatus('thinking', trimmedQuestion);
      const screenshots = await this.captureScreens();
      const plan = await this.llm.generatePlan({
        systemPrompt: this.systemPrompt,
        history: this.conversationHistory,
        userText: trimmedQuestion,
        screenshots,
      });
      if (runNumber !== this.currentRunNumber) return plan;

      this.rememberTurn(trimmedQuestion, plan);
      await this.playPlan(plan, screenshots, runNumber);
      if (runNumber === this.currentRunNumber) this.reportStatus('idle', '');
      return plan;
    } catch (error) {
      if (runNumber === this.currentRunNumber) this.reportStatus('error', error.message);
      return null;
    }
  }

  rememberTurn(userText, plan) {
    const assistantText = plan.steps.map((step) => step.say).filter(Boolean).join(' ');
    this.conversationHistory.push({ role: 'user', text: userText }, { role: 'assistant', text: assistantText });
    const maximumEntries = this.maxHistoryTurns * 2;
    if (this.conversationHistory.length > maximumEntries) {
      this.conversationHistory.splice(0, this.conversationHistory.length - maximumEntries);
    }
  }

  async playPlan(plan, screenshots, runNumber) {
    if (plan.steps.length === 0) {
      this.reportStatus('idle', 'The model returned nothing to say.');
      return;
    }
    for (const step of plan.steps) {
      if (runNumber !== this.currentRunNumber) return;
      this.reportStatus('speaking', step.say);

      if (step.mark) this.drawMark(step, screenshots);
      if (step.clearBoard) this.boardQueue.push({ isClear: true });
      if (step.board.length > 0) {
        this.board.show();
        for (const line of step.board) this.boardQueue.push({ line });
      }
      if (this.boardQueue.length > 0) this.drainBoardQueue(runNumber);
      if (step.say) {
        try {
          await this.tts.speak(step.say);
        } catch (error) {
          // A broken voice must not block the visual answer. Report and keep going.
          this.reportStatus('warning', `Speech failed: ${error.message}`);
        }
      }
    }
  }

  drawMark(step, screenshots) {
    const targetDisplay = pickDisplayForScreenNumber(step.screen, screenshots);
    if (!targetDisplay) return;
    const shape = markToShape(step.mark, targetDisplay.displaySize);
    if (shape) this.overlay.addShape(targetDisplay.displayId, shape, shapeAnchor(shape));
  }

  /** Writes queued board items one by one so the board fills in while the answer is spoken. */
  async drainBoardQueue(runNumber) {
    if (this.isDrainingBoardQueue) return;
    this.isDrainingBoardQueue = true;
    try {
      while (this.boardQueue.length > 0 && runNumber === this.currentRunNumber) {
        const queuedItem = this.boardQueue.shift();
        if (queuedItem.isClear) this.board.clear();
        else this.board.append(queuedItem.line);
        if (this.boardQueue.length === 0) break;
        await new Promise((resolve) => {
          const timer = setTimeout(() => { this.pendingRevealTimers.delete(timer); resolve(); }, BOARD_LINE_REVEAL_DELAY_MILLISECONDS);
          this.pendingRevealTimers.add(timer);
        });
      }
    } finally {
      this.isDrainingBoardQueue = false;
      // A new answer may have queued items while we were stopping.
      if (this.boardQueue.length > 0 && runNumber !== this.currentRunNumber) this.drainBoardQueue(this.currentRunNumber);
    }
  }
}

module.exports = { CompanionSession };
