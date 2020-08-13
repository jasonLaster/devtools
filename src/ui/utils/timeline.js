const markerWidth = 7;

// calculate pixel distance from two times
export function getPixelDistance({ to, from, zoom }) {
  const toPos = getVisiblePosition({ time: to, zoom });
  const fromPos = getVisiblePosition({ time: from, zoom });

  return Math.abs((toPos - fromPos) * this.overlayWidth);
}

// Get the position of a time on the visible part of the timeline,
// in the range [0, 1].
export function getVisiblePosition({ time, zoom }) {
  if (!time) {
    return 0;
  }

  if (time <= zoom.startTime) {
    return 0;
  }

  if (time >= zoom.endTime) {
    return 1;
  }

  return (time - zoom.startTime) / (zoom.endTime - zoom.startTime);
}

// Get the pixel offset for a time.
export function getPixelOffset({ time, overlayWidth, zoom }) {
  return getVisiblePosition(time) * overlayWidth;
}

// Get the percent value for the left offset of a message.
export function getLeftOffset({ overlayWidth, message }) {
  const messagePosition = getVisiblePosition(message.executionPointTime) * 100;
  const messageWidth = (markerWidth / overlayWidth) * 100;

  return Math.max(messagePosition - messageWidth / 2, 0);
}
