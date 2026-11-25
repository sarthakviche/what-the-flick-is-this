'use strict';
/**
 * The structured response contract between the model and the app.
 *
 * Coordinates follow Gemini's convention, normalized 0-1000 per screen:
 *   box_2d = [ymin, xmin, ymax, xmax]
 *   point / from / to = [y, x]
 * Normalized values make multi monitor and Windows DPI scaling trivial.
 */

const MARK_TYPES = ['point', 'circle', 'box', 'arrow', 'underline'];
const BOARD_KINDS = ['heading', 'text', 'math', 'code', 'diagram'];
const RESPONSE_MODES = ['answer', 'annotate', 'whiteboard'];

/** JSON schema (lowercase types). Gemini needs uppercase, see toGeminiSchema. */
const RESPONSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    mode: { type: 'string', enum: RESPONSE_MODES },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          say: { type: 'string', description: 'What is spoken aloud for this step. Plain speech, no markdown.' },
          screen: { type: 'integer', description: 'Screen number the mark refers to. Defaults to 1.' },
          mark: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: MARK_TYPES },
              box_2d: { type: 'array', items: { type: 'integer' }, description: '[ymin,xmin,ymax,xmax] normalized 0-1000' },
              point: { type: 'array', items: { type: 'integer' }, description: '[y,x] normalized 0-1000' },
              from: { type: 'array', items: { type: 'integer' }, description: 'arrow start [y,x]' },
              to: { type: 'array', items: { type: 'integer' }, description: 'arrow end [y,x]' },
              label: { type: 'string', description: 'Short label, 1 to 4 words' },
            },
            required: ['type'],
          },
          board: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                kind: { type: 'string', enum: BOARD_KINDS },
                content: { type: 'string' },
                lang: { type: 'string' },
              },
              required: ['kind', 'content'],
            },
          },
          clear_board: { type: 'boolean' },
        },
        required: ['say'],
      },
    },
  },
  required: ['steps'],
};

/** Converts the lowercase JSON schema to the OpenAPI subset flavour Gemini accepts. */
function toGeminiSchema(schemaNode) {
  if (Array.isArray(schemaNode)) return schemaNode.map(toGeminiSchema);
  if (schemaNode === null || typeof schemaNode !== 'object') return schemaNode;
  const converted = {};
  for (const [key, value] of Object.entries(schemaNode)) {
    if (key === 'type' && typeof value === 'string') converted[key] = value.toUpperCase();
    else if (key === 'properties') {
      converted[key] = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, toGeminiSchema(child)]));
    } else converted[key] = toGeminiSchema(value);
  }
  return converted;
}

function clampToThousand(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.min(1000, Math.max(0, Math.round(numeric)));
}

function cleanPair(rawPair) {
  if (!Array.isArray(rawPair) || rawPair.length !== 2) return null;
  const first = clampToThousand(rawPair[0]);
  const second = clampToThousand(rawPair[1]);
  return first === null || second === null ? null : [first, second];
}

function cleanBox(rawBox, boxOrder) {
  if (!Array.isArray(rawBox) || rawBox.length !== 4) return null;
  const values = rawBox.map(clampToThousand);
  if (values.some((value) => value === null)) return null;
  // Some local models answer [xmin,ymin,xmax,ymax]. Swap into [ymin,xmin,ymax,xmax].
  const [ymin, xmin, ymax, xmax] = boxOrder === 'xyxy' ? [values[1], values[0], values[3], values[2]] : values;
  const normalizedBox = [Math.min(ymin, ymax), Math.min(xmin, xmax), Math.max(ymin, ymax), Math.max(xmin, xmax)];
  const isDegenerate = normalizedBox[2] - normalizedBox[0] < 2 && normalizedBox[3] - normalizedBox[1] < 2;
  return isDegenerate ? null : normalizedBox;
}

/** Returns a clean mark or null when the mark cannot be drawn. */
function normalizeMark(rawMark, options = {}) {
  if (!rawMark || typeof rawMark !== 'object' || !MARK_TYPES.includes(rawMark.type)) return null;
  const label = typeof rawMark.label === 'string' ? rawMark.label.trim().slice(0, 40) : '';
  const box = cleanBox(rawMark.box_2d, options.boxOrder);
  const point = cleanPair(rawMark.point);
  const from = cleanPair(rawMark.from);
  const to = cleanPair(rawMark.to);

  switch (rawMark.type) {
    case 'point':
      if (point) return { type: 'point', point, label };
      if (box) return { type: 'point', point: [Math.round((box[0] + box[2]) / 2), Math.round((box[1] + box[3]) / 2)], label };
      return null;
    case 'circle':
    case 'box':
    case 'underline':
      if (box) return { type: rawMark.type, box_2d: box, label };
      return null;
    case 'arrow': {
      const target = to || point || (box ? [Math.round((box[0] + box[2]) / 2), Math.round((box[1] + box[3]) / 2)] : null);
      if (!target) return null;
      return { type: 'arrow', from, to: target, label };
    }
    default:
      return null;
  }
}

function normalizeBoardLine(rawLine) {
  if (!rawLine || typeof rawLine !== 'object' || !BOARD_KINDS.includes(rawLine.kind)) return null;
  if (typeof rawLine.content !== 'string' || rawLine.content.trim() === '') return null;
  return { kind: rawLine.kind, content: rawLine.content, lang: typeof rawLine.lang === 'string' ? rawLine.lang : '' };
}

/**
 * Validates and cleans a parsed model response. Never throws on bad model output,
 * it drops the unusable parts so a half good answer is still spoken.
 */
function normalizePlan(rawPlan, options = {}) {
  const rawSteps = rawPlan && Array.isArray(rawPlan.steps) ? rawPlan.steps : [];
  const steps = [];
  for (const rawStep of rawSteps) {
    if (!rawStep || typeof rawStep !== 'object') continue;
    const say = typeof rawStep.say === 'string' ? rawStep.say.trim() : '';
    const mark = normalizeMark(rawStep.mark, options);
    const board = Array.isArray(rawStep.board) ? rawStep.board.map(normalizeBoardLine).filter(Boolean) : [];
    if (say === '' && !mark && board.length === 0) continue;
    const screenNumber = Number.isInteger(rawStep.screen) && rawStep.screen >= 1 ? rawStep.screen : 1;
    steps.push({ say, screen: screenNumber, mark, board, clearBoard: rawStep.clear_board === true });
  }
  const mode = RESPONSE_MODES.includes(rawPlan && rawPlan.mode) ? rawPlan.mode : 'answer';
  return { mode, steps };
}

/**
 * Legacy fallback: the original Clicky text tag [POINT:x,y:label:screenN], in pixel units.
 * Needs the screenshot size to normalize. Returns a plan or null.
 */
function parseLegacyPointTag(text, screenshotSizes) {
  const match = /\[POINT:(?:none|(\d+)\s*,\s*(\d+)(?::([^\]:\s][^\]:]*?))?(?::screen(\d+))?)\]\s*$/.exec(text);
  if (!match) return null;
  const spokenText = text.slice(0, match.index).trim();
  if (match[1] === undefined) return { mode: 'answer', steps: [{ say: spokenText, screen: 1, mark: null, board: [], clearBoard: false }] };
  const screenNumber = match[4] ? Number(match[4]) : 1;
  const size = (screenshotSizes || [])[screenNumber - 1];
  if (!size) return { mode: 'answer', steps: [{ say: spokenText, screen: 1, mark: null, board: [], clearBoard: false }] };
  const pointY = Math.round((Number(match[2]) / size.height) * 1000);
  const pointX = Math.round((Number(match[1]) / size.width) * 1000);
  const mark = normalizeMark({ type: 'point', point: [pointY, pointX], label: match[3] || '' });
  return { mode: 'annotate', steps: [{ say: spokenText, screen: screenNumber, mark, board: [], clearBoard: false }] };
}

/** Parses raw model text into a clean plan. Falls back to plain speech if it is not JSON. */
function parsePlanFromText(rawText, options = {}) {
  const trimmedText = String(rawText || '').trim();
  const withoutFences = trimmedText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return normalizePlan(JSON.parse(withoutFences), options);
  } catch (_ignored) {
    // fall through
  }
  const firstBrace = withoutFences.indexOf('{');
  const lastBrace = withoutFences.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return normalizePlan(JSON.parse(withoutFences.slice(firstBrace, lastBrace + 1)), options);
    } catch (_ignored) {
      // fall through
    }
  }
  const legacyPlan = parseLegacyPointTag(trimmedText, options.screenshotSizes);
  if (legacyPlan) return legacyPlan;
  return { mode: 'answer', steps: trimmedText ? [{ say: trimmedText, screen: 1, mark: null, board: [], clearBoard: false }] : [] };
}

module.exports = {
  MARK_TYPES, BOARD_KINDS, RESPONSE_MODES, RESPONSE_JSON_SCHEMA,
  toGeminiSchema, normalizeMark, normalizePlan, parsePlanFromText, parseLegacyPointTag,
};
