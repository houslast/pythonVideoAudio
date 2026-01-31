import { toast } from "../../../utils/dom.js";
import { decodeAudio } from "../../../utils/audio.js";
import { addClip, canPlaceClip } from "../state.js";
import { canvasPoint, findTrackAt, timeAtX, trackIndexAtYWithScale } from "./helpers.js";

const waveformCache = new Map();
const waveformInFlight = new Map();

function computePeaks(audioBuffer, bins = 140) {
  const data = audioBuffer.getChannelData(0);
  const n = data.length;
  const out = [];
  const step = Math.max(1, Math.ceil(n / bins));
  for (let i = 0; i < bins; i++) {
    const start = i * step;
    const end = Math.min(n, start + step);
    let m = 0;
    const span = Math.max(1, end - start);
    const stride = Math.max(1, Math.floor(span / 4000));
    for (let k = start; k < end; k += stride) m = Math.max(m, Math.abs(data[k]));
    out.push(m);
  }
  const max = Math.max(...out, 1e-9);
  return out.map((v) => v / max);
}

async function loadWaveform({ history, sourceKey, url, requestRender, statusEl }) {
  try {
    if (!url) return;
    const key = sourceKey || url;
    if (waveformCache.has(key)) {
      const raw = waveformCache.get(key);
      const cached = Array.isArray(raw) ? { peaks: raw, durationS: 0 } : raw;
      history.commit((s) => {
        for (const c of s.clips) {
          const ck = String(c.source?.type) === "freesound" ? String(c.source?.id) : (c.previewUrl || null);
          if (ck !== key) continue;
          if (!c.waveformPeaks) c.waveformPeaks = cached.peaks;
          if (!(Number(c.sourceDurationS || 0) > 0) && Number(cached.durationS || 0) > 0) c.sourceDurationS = cached.durationS;
        }
      });
      requestRender();
      return;
    }

    if (!waveformInFlight.has(key)) {
      waveformInFlight.set(key, (async () => {
        const buf = await decodeAudio(url);
        const peaks = computePeaks(buf, 160);
        const cached = { peaks, durationS: Number(buf.duration || 0) };
        waveformCache.set(key, cached);
        waveformInFlight.delete(key);
        return cached;
      })().catch((e) => {
        waveformInFlight.delete(key);
        throw e;
      }));
    }

    const cached = await waveformInFlight.get(key);
    history.commit((s) => {
      for (const c of s.clips) {
        const ck = String(c.source?.type) === "freesound" ? String(c.source?.id) : (c.previewUrl || null);
        if (ck !== key) continue;
        if (!c.waveformPeaks) c.waveformPeaks = cached.peaks;
        if (!(Number(c.sourceDurationS || 0) > 0) && Number(cached.durationS || 0) > 0) c.sourceDurationS = cached.durationS;
      }
    });
    requestRender();
  } catch {
    toast(statusEl, "Erro ao baixar/ler áudio (waveform).");
  }
}

function findPlacementTrack(state, startS, durationS) {
  for (const t of state.tracks) {
    if (canPlaceClip(state, { trackId: t.id, startS, durationS })) return t;
  }
  return null;
}

export function bindDropSounds({ canvas, overlay, history, statusEl, requestRender, audioEngine }) {
  overlay.addEventListener("dragover", (ev) => {
    const ok = ev.dataTransfer.types.includes("application/x-audio-editor-sound");
    if (ok) ev.preventDefault();
  });

  overlay.addEventListener("drop", (ev) => {
    ev.preventDefault();
    const raw = ev.dataTransfer.getData("application/x-audio-editor-sound");
    if (!raw) return;
    const payload = JSON.parse(raw);
    const st = history.get();
    const p = canvasPoint(canvas, ev);
    const t = timeAtX(st.pixelsPerSecond, p.x);
    const trackIndex = trackIndexAtYWithScale(p.y, Number(st.trackScale || 1));
    const tr = findTrackAt(st, trackIndex);
    if (!tr) return;

    const durationS = Math.max(0.1, Number(payload.duration || 1));
    let createdId = null;
    let hqUrl = null;
    let waveUrl = null;
    history.commit((s) => {
      let trackId = tr.id;
      if (!canPlaceClip(s, { trackId, startS: t, durationS })) {
        const alt = findPlacementTrack(s, t, durationS);
        if (!alt) return;
        trackId = alt.id;
      }
      hqUrl = payload.previewHqUrl || payload.previewUrl || null;
      waveUrl = payload.previewLqUrl || payload.previewUrl || hqUrl || null;
      const clip = addClip(s, {
        trackId,
        name: payload.name || "Sound",
        startS: t,
        durationS,
        sourceDurationS: Number(payload.duration || durationS),
        previewUrl: hqUrl,
        source: { type: "freesound", id: payload.id, username: payload.username },
      });
      createdId = clip.id;
    });
    toast(statusEl, "Clip adicionado na timeline.");
    requestRender();
    if (createdId && (waveUrl || hqUrl)) {
      const sourceKey = payload?.id != null ? String(payload.id) : null;
      loadWaveform({ history, sourceKey, url: waveUrl || hqUrl, requestRender, statusEl });
    }
    if (hqUrl && audioEngine?.prefetch) audioEngine.prefetch(hqUrl);
  });
}
