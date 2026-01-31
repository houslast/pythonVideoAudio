import { UI, xToTime, yToTrackIndex } from "../geometry.js";

export function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

export function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function canvasPoint(canvas, ev) {
  const rect = canvas.getBoundingClientRect();
  return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
}

export function timeAtX(pixelsPerSecond, x) {
  return xToTime(x, pixelsPerSecond);
}

export function trackIndexAtY(y) {
  return yToTrackIndex(y);
}

export function trackIndexAtYWithScale(y, trackScale = 1) {
  return yToTrackIndex(y, trackScale);
}

export function findTrackAt(state, trackIndex) {
  if (trackIndex < 0 || trackIndex >= state.tracks.length) return null;
  return state.tracks[trackIndex];
}

export function clipEdgeHit(rect, x) {
  const left = Math.abs(x - (rect.x + 6)) <= 10;
  const right = Math.abs(x - (rect.x + rect.w - 6)) <= 10;
  if (left) return "left";
  if (right) return "right";
  return null;
}

export function automationPointHit(rect, mode, points, x, y) {
  if (!points?.length) return null;
  const y0 = rect.y + 8;
  const y1 = rect.y + rect.h - 8;
  const x0 = rect.x + 8;
  const x1 = rect.x + rect.w - 8;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const px = x0 + p.t * (x1 - x0);
    const ny = mode === "pan" ? (1 - (p.v + 1) / 2) : 1 - p.v;
    const py = y0 + ny * (y1 - y0);
    const d = Math.hypot(px - x, py - y);
    if (d <= 7) return { index: i, p, x0, x1, y0, y1 };
  }
  return null;
}

export function isOnTimeline(x) {
  return x >= UI.GUTTER_W;
}
