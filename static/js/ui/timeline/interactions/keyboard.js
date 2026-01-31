 import { toast } from "../../../utils/dom.js";
 import { AutomationMode, addClip, canPlaceClip, removeSelectedClip, splitSelectedClip } from "../state.js";
 import { openSyncModal } from "./sync.js";

function findPlacementTrack(state, startS, durationS) {
  for (const t of state.tracks) {
    if (canPlaceClip(state, { trackId: t.id, startS, durationS })) return t;
  }
  return null;
}

export function bindKeyboard({ history, requestRender, video, statusEl, getVideoId, audioEngine }) {
  window.addEventListener("keydown", (ev) => {
    const tag = (ev.target?.tagName || "").toLowerCase();
    const inInput = tag === "input" || tag === "textarea";
    if (inInput) return;

    if (ev.code === "Space") {
      ev.preventDefault();
      if (video.paused) {
        const p = video.play();
        if (p && typeof p.catch === "function") p.catch(() => {});
      } else video.pause();
      return;
    }

    if (ev.ctrlKey && (ev.key === "z" || ev.key === "Z")) {
      ev.preventDefault();
      history.undo();
      requestRender();
      return;
    }

    if (ev.ctrlKey && (ev.key === "y" || ev.key === "Y")) {
      ev.preventDefault();
      history.redo();
      requestRender();
      return;
    }

    if (ev.key === "Delete") {
      ev.preventDefault();
      history.commit((s) => removeSelectedClip(s));
      requestRender();
      return;
    }

    if (ev.ctrlKey && (ev.key === "k" || ev.key === "K")) {
      ev.preventDefault();
      history.commit((s) => splitSelectedClip(s, s.playheadS));
      requestRender();
      return;
    }

    if (ev.key === "r" || ev.key === "R") {
      ev.preventDefault();
      history.commit((s) => splitSelectedClip(s, s.playheadS));
      requestRender();
      return;
    }

    if (ev.ctrlKey && (ev.key === "c" || ev.key === "C")) {
      ev.preventDefault();
      const s = history.get();
      const id = s.selection.clipId;
      const clip = s.clips.find((c) => c.id === id);
      if (!clip) return;
      window.__audioEditorClipboard = JSON.parse(JSON.stringify(clip));
      if (statusEl) toast(statusEl, "Copiado.");
      return;
    }

    if (ev.ctrlKey && (ev.key === "x" || ev.key === "X")) {
      ev.preventDefault();
      const s = history.get();
      const id = s.selection.clipId;
      const clip = s.clips.find((c) => c.id === id);
      if (!clip) return;
      window.__audioEditorClipboard = JSON.parse(JSON.stringify(clip));
      history.commit((st) => removeSelectedClip(st));
      requestRender();
      if (statusEl) toast(statusEl, "Recortado.");
      return;
    }

    if (ev.ctrlKey && (ev.key === "v" || ev.key === "V")) {
      ev.preventDefault();
      const clip = window.__audioEditorClipboard ? JSON.parse(JSON.stringify(window.__audioEditorClipboard)) : null;
      if (!clip) return;
      const t = history.get().playheadS;
      history.commit((s) => {
        const durationS = Number(clip.durationS || 1);
        let trackId = null;
        const sel = s.clips.find((c) => c.id === s.selection.clipId);
        if (sel) trackId = sel.trackId;
        if (!trackId) trackId = s.tracks[0]?.id || null;
        if (!trackId) return;

        if (!canPlaceClip(s, { trackId, startS: t, durationS })) {
          const alt = findPlacementTrack(s, t, durationS);
          if (!alt) return;
          trackId = alt.id;
        }

        addClip(s, {
          trackId,
          name: clip.name,
          startS: t,
          durationS,
          sourceOffsetS: clip.sourceOffsetS,
          sourceDurationS: clip.sourceDurationS,
          previewUrl: clip.previewUrl,
          source: clip.source,
          waveformPeaks: clip.waveformPeaks,
        });
      });
      requestRender();
      if (statusEl) toast(statusEl, "Colado no playhead.");
      return;
    }

    if (ev.key === "g" || ev.key === "G") {
      history.commit((s) => {
        s.automationMode = AutomationMode.GAIN;
      });
      requestRender();
      return;
    }

    if (ev.key === "p" || ev.key === "P") {
      history.commit((s) => {
        s.automationMode = AutomationMode.PAN;
      });
      requestRender();
      return;
    }

    if (ev.key === "s" || ev.key === "S") {
      ev.preventDefault();
      openSyncModal({ history, statusEl, getVideoId, audioEngine });
      return;
    }
  });
}
