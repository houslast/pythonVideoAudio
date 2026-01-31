import { uuid } from "../../utils/uuid.js";

export const AutomationMode = Object.freeze({
  GAIN: "gain",
  PAN: "pan",
});

export function createInitialState() {
  return {
    version: 1,
    pixelsPerSecond: 100,
    trackScale: 1,
    playheadS: 0,
    isPlaying: false,
    automationMode: AutomationMode.GAIN,
    mix: {
      transitionS: 0.25,
    },
    tracks: Array.from({ length: 5 }, (_, i) => ({
      id: uuid(),
      name: `Faixa ${i + 1}`,
      gain: 0.9,
      pan: 0.0,
    })),
    clips: [],
    selection: { clipId: null, clipIds: [] },
  };
}

export function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

export function timeOverlaps(aStart, aEnd, bStart, bEnd) {
  return Math.max(aStart, bStart) < Math.min(aEnd, bEnd);
}

export function canPlaceClip(state, { trackId, startS, durationS, ignoreClipId = null }) {
  const endS = startS + durationS;
  const transitionS = Math.max(0, Number(state?.mix?.transitionS || 0));

  return !state.clips.some((c) => {
    if (c.id === ignoreClipId) return false;
    if (c.trackId !== trackId) return false;
    const c0 = c.startS;
    const c1 = c.startS + c.durationS;
    if (!timeOverlaps(startS, endS, c0, c1)) return false;

    const ov = Math.min(endS, c1) - Math.max(startS, c0);
    if (!(ov > 0)) return false;
    if (!(transitionS > 0)) return true;
    if (ov > transitionS + 1e-6) return true;

    const contained = (startS >= c0 && endS <= c1) || (c0 >= startS && c1 <= endS);
    if (contained) return true;

    return false;
  });
}

function applyOverlapTransitions(state, trackId) {
  const transitionS = Math.max(0, Number(state?.mix?.transitionS || 0));
  const trackClips = state.clips
    .filter((c) => c.trackId === trackId)
    .slice()
    .sort((a, b) => (a.startS - b.startS) || String(a.id).localeCompare(String(b.id)));
  for (const c of trackClips) {
    c.fadeInS = 0;
    c.fadeOutS = 0;
  }

  if (!(transitionS > 0)) return;

  for (let i = 0; i < trackClips.length - 1; i++) {
    const a = trackClips[i];
    const b = trackClips[i + 1];
    const a0 = a.startS;
    const a1 = a.startS + a.durationS;
    const b0 = b.startS;
    const b1 = b.startS + b.durationS;

    if (!timeOverlaps(a0, a1, b0, b1)) continue;
    const ov = Math.min(a1, b1) - Math.max(a0, b0);
    if (!(ov > 1e-6)) continue;

    const fadeS = Math.max(0, Math.min(transitionS, ov, a.durationS, b.durationS));
    if (!(fadeS > 1e-6)) continue;
    a.fadeOutS = Math.max(a.fadeOutS || 0, fadeS);
    b.fadeInS = Math.max(b.fadeInS || 0, fadeS);
  }
}

export function setTransitionS(state, seconds) {
  if (!state.mix) state.mix = {};
  state.mix.transitionS = Math.max(0, Math.min(5, Number(seconds || 0)));
  for (const t of state.tracks) applyOverlapTransitions(state, t.id);
}

export function addTrack(state) {
  state.tracks.push({
    id: uuid(),
    name: `Faixa ${state.tracks.length + 1}`,
    gain: 0.9,
    pan: 0.0,
  });
}

export function addClip(state, clip) {
  const c = {
    id: uuid(),
    trackId: clip.trackId,
    name: clip.name || "Clip",
    startS: clip.startS || 0,
    durationS: clip.durationS || 1,
    sourceOffsetS: clip.sourceOffsetS || 0,
    sourceDurationS: clip.sourceDurationS || clip.durationS || 0,
    previewUrl: clip.previewUrl || null,
    source: clip.source || null,
    waveformPeaks: clip.waveformPeaks || null,
    timeWarpSegments: clip.timeWarpSegments || null,
    fadeInS: 0.0,
    fadeOutS: 0.0,
    gainAutomation: [
      { t: 0, v: 1.0 },
      { t: 1, v: 1.0 },
    ],
    panAutomation: [
      { t: 0, v: 0.0 },
      { t: 1, v: 0.0 },
    ],
    rateAutomation: [
      { t: 0, v: 1.0 },
      { t: 1, v: 1.0 },
    ],
  };
  state.clips.push(c);
  state.selection.clipId = c.id;
  state.selection.clipIds = [c.id];
  applyOverlapTransitions(state, c.trackId);
  return c;
}

export function removeSelectedClip(state) {
  const ids = Array.isArray(state.selection.clipIds) && state.selection.clipIds.length ? state.selection.clipIds : (state.selection.clipId ? [state.selection.clipId] : []);
  if (!ids.length) return;
  const affectedTrackIds = new Set(state.clips.filter((c) => ids.includes(c.id)).map((c) => c.trackId));
  state.clips = state.clips.filter((c) => !ids.includes(c.id));
  state.selection.clipId = null;
  state.selection.clipIds = [];
  for (const tid of affectedTrackIds) applyOverlapTransitions(state, tid);
}

export function moveClip(state, clipId, { trackId, startS }) {
  const clip = state.clips.find((c) => c.id === clipId);
  if (!clip) return false;
  if (!canPlaceClip(state, { trackId, startS, durationS: clip.durationS, ignoreClipId: clipId })) return false;
  const prevTrackId = clip.trackId;
  clip.trackId = trackId;
  clip.startS = Math.max(0, startS);
  applyOverlapTransitions(state, prevTrackId);
  applyOverlapTransitions(state, clip.trackId);
  return true;
}

export function forceMoveClip(state, clipId, { trackId, startS }) {
  const clip = state.clips.find((c) => c.id === clipId);
  if (!clip) return false;
  const prevTrackId = clip.trackId;
  clip.trackId = trackId;
  clip.startS = Math.max(0, startS);
  applyOverlapTransitions(state, prevTrackId);
  applyOverlapTransitions(state, clip.trackId);
  return true;
}

export function splitSelectedClip(state, atS) {
  const id = state.selection.clipId;
  if (!id) return false;
  const clip = state.clips.find((c) => c.id === id);
  if (!clip) return false;
  const rel = atS - clip.startS;
  if (rel <= 0.05 || rel >= clip.durationS - 0.05) return false;

  const leftDur = rel;
  const rightDur = clip.durationS - rel;

  clip.durationS = leftDur;
  clip.fadeOutS = Math.min(clip.fadeOutS, leftDur);

  const right = {
    ...JSON.parse(JSON.stringify(clip)),
    id: uuid(),
    startS: clip.startS + leftDur,
    durationS: rightDur,
    fadeInS: Math.min(clip.fadeInS, rightDur),
    sourceOffsetS: Math.max(0, Number(clip.sourceOffsetS || 0)) + leftDur,
  };
  state.clips.push(right);
  state.selection.clipId = right.id;
  state.selection.clipIds = [right.id];
  applyOverlapTransitions(state, clip.trackId);
  return true;
}

export function setTrackGain(state, trackId, gain) {
  const t = state.tracks.find((x) => x.id === trackId);
  if (!t) return;
  t.gain = Math.min(1, Math.max(0, gain));
}

export function setTrackPan(state, trackId, pan) {
  const t = state.tracks.find((x) => x.id === trackId);
  if (!t) return;
  t.pan = Math.min(1, Math.max(-1, pan));
}

export function setTrackName(state, trackId, name) {
  const t = state.tracks.find((x) => x.id === trackId);
  if (!t) return;
  t.name = String(name || "").slice(0, 80);
}
