'use strict';
const { desktopCapturer, screen } = require('electron');
const { buildScreenLabel } = require('../core/prompt');

const MAXIMUM_IMAGE_WIDTH = 1600;
const JPEG_QUALITY = 75;

/**
 * Captures every display. The array order is the screen numbering used in prompts and marks.
 * Each entry also carries displayId and the DIP size, which the session needs to place marks.
 */
async function captureAllScreens() {
  const orderedDisplays = screen.getAllDisplays();
  const cursorDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const largestPhysicalWidth = Math.max(...orderedDisplays.map((display) => Math.round(display.size.width * display.scaleFactor)));
  const largestPhysicalHeight = Math.max(...orderedDisplays.map((display) => Math.round(display.size.height * display.scaleFactor)));

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: largestPhysicalWidth, height: largestPhysicalHeight },
  });
  if (sources.length === 0) throw new Error('No screen could be captured. Check Windows privacy settings for screen capture.');

  return orderedDisplays.map((display, displayIndex) => {
    // display_id is reliable on Windows; fall back to index order if it is empty.
    const matchingSource = sources.find((source) => source.display_id === String(display.id)) || sources[displayIndex] || sources[0];
    let image = matchingSource.thumbnail;
    const originalSize = image.getSize();
    if (originalSize.width > MAXIMUM_IMAGE_WIDTH) image = image.resize({ width: MAXIMUM_IMAGE_WIDTH, quality: 'good' });
    const finalSize = image.getSize();
    return {
      label: buildScreenLabel(displayIndex + 1, finalSize.width, finalSize.height, display.id === cursorDisplay.id),
      mimeType: 'image/jpeg',
      base64: image.toJPEG(JPEG_QUALITY).toString('base64'),
      width: finalSize.width,
      height: finalSize.height,
      displayId: display.id,
      displaySize: { width: display.bounds.width, height: display.bounds.height },
    };
  });
}

module.exports = { captureAllScreens };
