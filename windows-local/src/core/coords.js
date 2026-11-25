'use strict';
/**
 * Turns normalized (0-1000) marks into drawable shapes in DIP pixels local to one display.
 * DIP (device independent pixels) is what Electron window coordinates use, so the overlay
 * needs no knowledge of Windows display scaling.
 */

const NORMALIZED_RANGE = 1000;
const DEFAULT_ARROW_LENGTH_FRACTION = 0.12;

function toPixels(normalizedValue, extentInPixels) {
  return (normalizedValue / NORMALIZED_RANGE) * extentInPixels;
}

/**
 * @param {object} mark a normalized mark from schema.normalizeMark
 * @param {{width:number,height:number}} displaySize DIP size of the target display
 * @returns {object|null} a shape: {kind, ...geometry, label}
 */
function markToShape(mark, displaySize) {
  if (!mark) return null;
  const { width, height } = displaySize;
  const label = mark.label || '';

  if (mark.type === 'point') {
    const [pointY, pointX] = mark.point;
    return { kind: 'point', x: toPixels(pointX, width), y: toPixels(pointY, height), label };
  }

  if (mark.type === 'arrow') {
    const targetX = toPixels(mark.to[1], width);
    const targetY = toPixels(mark.to[0], height);
    let startX;
    let startY;
    if (mark.from) {
      startX = toPixels(mark.from[1], width);
      startY = toPixels(mark.from[0], height);
    } else {
      // No tail given: draw it coming in from the upper left so it stays readable.
      const tailLength = Math.min(width, height) * DEFAULT_ARROW_LENGTH_FRACTION * 1.5;
      startX = Math.max(0, targetX - tailLength);
      startY = Math.max(0, targetY - tailLength);
    }
    return { kind: 'arrow', x1: startX, y1: startY, x2: targetX, y2: targetY, label };
  }

  const [ymin, xmin, ymax, xmax] = mark.box_2d;
  const left = toPixels(xmin, width);
  const top = toPixels(ymin, height);
  const boxWidth = toPixels(xmax - xmin, width);
  const boxHeight = toPixels(ymax - ymin, height);

  if (mark.type === 'box') return { kind: 'box', x: left, y: top, width: boxWidth, height: boxHeight, label };
  if (mark.type === 'circle') {
    // Pad so the ellipse encloses the element instead of cutting through its corners.
    const padding = 1.25;
    return {
      kind: 'circle',
      cx: left + boxWidth / 2,
      cy: top + boxHeight / 2,
      rx: Math.max(14, (boxWidth / 2) * padding),
      ry: Math.max(14, (boxHeight / 2) * padding),
      label,
    };
  }
  if (mark.type === 'underline') {
    return { kind: 'underline', x1: left, x2: left + boxWidth, y: top + boxHeight + 3, label };
  }
  return null;
}

/** The spot the buddy cursor flies to for a given shape. */
function shapeAnchor(shape) {
  switch (shape.kind) {
    case 'point': return { x: shape.x, y: shape.y };
    case 'arrow': return { x: shape.x2, y: shape.y2 };
    case 'circle': return { x: shape.cx, y: shape.cy };
    case 'box': return { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
    case 'underline': return { x: (shape.x1 + shape.x2) / 2, y: shape.y };
    default: return { x: 0, y: 0 };
  }
}

/**
 * Picks the display for a 1 based screen number. Out of range falls back to the first display.
 * @param {Array<{id:number,bounds:object}>} orderedDisplays same order as the screenshots sent to the model
 */
function pickDisplayForScreenNumber(screenNumber, orderedDisplays) {
  return orderedDisplays[screenNumber - 1] || orderedDisplays[0] || null;
}

module.exports = { markToShape, shapeAnchor, pickDisplayForScreenNumber, toPixels };
