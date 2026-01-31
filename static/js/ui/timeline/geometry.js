export const UI = Object.freeze({
  GUTTER_W: 150,
  HEADER_H: 22,
  TRACK_H: 44,
  TRACK_GAP: 8,
  CLIP_PAD: 6,
});

export function trackHeight(trackScale = 1) {
  return UI.TRACK_H * trackScale;
}

export function trackGap(trackScale = 1) {
  return UI.TRACK_GAP * trackScale;
}

export function trackTop(trackIndex, trackScale = 1) {
  return UI.HEADER_H + trackIndex * (trackHeight(trackScale) + trackGap(trackScale));
}

export function canvasHeight(trackCount, trackScale = 1) {
  return UI.HEADER_H + trackCount * trackHeight(trackScale) + (trackCount - 1) * trackGap(trackScale) + 20;
}

export function xToTime(x, pixelsPerSecond) {
  return Math.max(0, (x - UI.GUTTER_W) / pixelsPerSecond);
}

export function timeToX(t, pixelsPerSecond) {
  return UI.GUTTER_W + t * pixelsPerSecond;
}

export function yToTrackIndex(y, trackScale = 1) {
  const yy = y - UI.HEADER_H;
  if (yy < 0) return -1;
  const stride = trackHeight(trackScale) + trackGap(trackScale);
  return Math.floor(yy / stride);
}
