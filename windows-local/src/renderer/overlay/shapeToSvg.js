/* Pure function: shape (DIP pixels) -> SVG markup string. Works in the browser and in Node tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.shapeToSvg = factory().shapeToSvg;
}(typeof self !== 'undefined' ? self : this, function () {
  const MARK_COLOR = '#ff3d8b';
  const ARROW_HEAD_LENGTH = 22;

  function escapeXml(text) {
    return String(text).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  }
  function round(value) { return Math.round(value * 10) / 10; }

  function labelSvg(labelText, x, y) {
    if (!labelText) return '';
    const textWidth = Math.max(40, labelText.length * 10 + 24);
    return `<g class="mark-label" transform="translate(${round(x)} ${round(y)})">`
      + `<rect x="0" y="-20" width="${textWidth}" height="30" rx="15" fill="${MARK_COLOR}"/>`
      + `<text x="${textWidth / 2}" y="0" text-anchor="middle" fill="#fff" font-size="22" font-weight="700" font-family="Caveat, Segoe Print, cursive">${escapeXml(labelText)}</text></g>`;
  }

  /** pathLength=1 lets CSS animate stroke-dashoffset 1 -> 0 for a draw-in effect on any shape. */
  const strokeAttributes = `fill="none" stroke="${MARK_COLOR}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" pathLength="1" class="draw"`;

  function shapeToSvg(shape) {
    switch (shape.kind) {
      case 'circle':
        return `<ellipse cx="${round(shape.cx)}" cy="${round(shape.cy)}" rx="${round(shape.rx)}" ry="${round(shape.ry)}" ${strokeAttributes}/>`
          + labelSvg(shape.label, shape.cx - shape.rx, shape.cy - shape.ry - 8);
      case 'box':
        return `<rect x="${round(shape.x)}" y="${round(shape.y)}" width="${round(shape.width)}" height="${round(shape.height)}" rx="8" ${strokeAttributes}/>`
          + labelSvg(shape.label, shape.x, shape.y - 8);
      case 'underline':
        return `<path d="M ${round(shape.x1)} ${round(shape.y)} Q ${round((shape.x1 + shape.x2) / 2)} ${round(shape.y + 6)} ${round(shape.x2)} ${round(shape.y)}" ${strokeAttributes}/>`
          + labelSvg(shape.label, shape.x1, shape.y + 30);
      case 'arrow': {
        const angle = Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1);
        const headPoint = (offset) => `${round(shape.x2 - ARROW_HEAD_LENGTH * Math.cos(angle + offset))} ${round(shape.y2 - ARROW_HEAD_LENGTH * Math.sin(angle + offset))}`;
        return `<path d="M ${round(shape.x1)} ${round(shape.y1)} L ${round(shape.x2)} ${round(shape.y2)} M ${headPoint(0.5)} L ${round(shape.x2)} ${round(shape.y2)} L ${headPoint(-0.5)}" ${strokeAttributes}/>`
          + labelSvg(shape.label, shape.x1, shape.y1 - 8);
      }
      case 'point':
        return `<circle cx="${round(shape.x)}" cy="${round(shape.y)}" r="16" ${strokeAttributes}/>`
          + `<circle cx="${round(shape.x)}" cy="${round(shape.y)}" r="5" fill="${MARK_COLOR}"/>`
          + labelSvg(shape.label, shape.x + 22, shape.y - 18);
      default:
        return '';
    }
  }

  return { shapeToSvg };
}));
