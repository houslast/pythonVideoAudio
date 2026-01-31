import { apiPostJson } from "../../../api/client.js";
import { detectTransientTimes, decodeAudio } from "../../../utils/audio.js";
import { el, toast } from "../../../utils/dom.js";
import { addClip, canPlaceClip, removeSelectedClip } from "../state.js";
import { median } from "./helpers.js";

export async function syncClipToMotion({ history, statusEl, getVideoId, clipId, frameAnalysis = true, motionModel = "default", smoothWin = 5, blurKsize = 7, roiX = 0.10, roiY = 0.55, roiW = 0.80, roiH = 0.43 }) {
  const st = history.get();
  const clip = st.clips.find((c) => c.id === clipId);
  const videoId = getVideoId();
  if (!clip || !videoId) {
    toast(statusEl, "Erro: selecione um clipe e importe um vídeo.");
    return;
  }

  toast(statusEl, "Sincronizando por movimento…");

  try {
    const motion = await apiPostJson("/api/sync/motion", {
      video_id: videoId,
      start_s: clip.startS,
      duration_s: clip.durationS,
      max_events: 12,
      frame_analysis: Boolean(frameAnalysis),
      model: String(motionModel || "default"),
      smooth_win: Math.max(1, Number(smoothWin || 5)),
      blur_ksize: Math.max(1, Number(blurKsize || 7)),
      roi_x: Math.max(0, Math.min(1, Number(roiX || 0.10))),
      roi_y: Math.max(0, Math.min(1, Number(roiY || 0.55))),
      roi_w: Math.max(0, Math.min(1, Number(roiW || 0.80))),
      roi_h: Math.max(0, Math.min(1, Number(roiH || 0.43))),
    });

    const buf = clip.previewUrl ? await decodeAudio(clip.previewUrl) : null;
    if (!buf) throw new Error("Sem preview de áudio para analisar.");

    const trans = detectTransientTimes(buf, 12);
    const moves = (motion.events || []).map((e) => e.t_s);
    const n = Math.min(trans.length, moves.length, 8);
    if (n < 1) throw new Error("Sem eventos suficientes para sincronizar.");

    const deltas = [];
    for (let i = 0; i < n; i++) deltas.push(moves[i] - trans[i]);
    const delta = n === 1 ? deltas[0] : median(deltas);
    const targetStart = Math.max(0, clip.startS + delta);

    const tryTracks = [clip.trackId, ...st.tracks.map((t) => t.id).filter((id) => id !== clip.trackId)];
    let placed = false;
    history.commit((s) => {
      const c = s.clips.find((x) => x.id === clip.id);
      if (!c) return;
      for (const tid of tryTracks) {
        if (canPlaceClip(s, { trackId: tid, startS: targetStart, durationS: c.durationS, ignoreClipId: c.id })) {
          c.trackId = tid;
          c.startS = targetStart;
          placed = true;
          break;
        }
      }
    });

    if (placed) toast(statusEl, `Sincronizado (Δ ${delta.toFixed(3)}s).`);
    else toast(statusEl, "Erro: não foi possível encaixar sem sobrepor clipes.");
  } catch (e) {
    toast(statusEl, `Erro: ${String(e.message || e)}`);
  }
}

function isPulsating(trans) {
  if (!trans?.length || trans.length < 3) return false;
  const gaps = [];
  for (let i = 1; i < trans.length; i++) gaps.push(trans[i] - trans[i - 1]);
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const varg = gaps.reduce((a, b) => a + (b - avg) * (b - avg), 0) / gaps.length;
  return varg < Math.max(0.005, avg * 0.15);
}

function computeEnvelope(audioBuffer) {
  const data = audioBuffer.getChannelData(0);
  const sr = audioBuffer.sampleRate;
  const win = Math.max(16, Math.floor(sr * 0.01));
  const hop = Math.max(8, Math.floor(win / 2));
  const env = [];
  for (let i = 0; i + win < data.length; i += hop) {
    let sum = 0;
    for (let j = 0; j < win; j++) sum += Math.abs(data[i + j]);
    env.push(sum / win);
  }
  const smooth = [];
  const k = 6;
  for (let i = 0; i < env.length; i++) {
    let s = 0;
    for (let j = -k; j <= k; j++) s += env[Math.min(env.length - 1, Math.max(0, i + j))];
    smooth.push(s / (2 * k + 1));
  }
  return { env: smooth, hopS: hop / sr, durationS: audioBuffer.duration };
}

function findActiveWindow({ env, hopS, durationS, tAbs, threshold, maxLeftS = 0.45, maxRightS = 0.75, minPreS = 0.025, minPostS = 0.09, maxLenS = 1.6 }) {
  if (!env?.length || !hopS) {
    const start = Math.max(0, tAbs - minPreS);
    const end = Math.min(durationS, tAbs + minPostS);
    return { startS: start, endS: Math.max(start + 0.02, end) };
  }
  const idx0 = Math.max(0, Math.min(env.length - 1, Math.round(tAbs / hopS)));
  const leftSteps = Math.max(1, Math.round(maxLeftS / hopS));
  const rightSteps = Math.max(1, Math.round(maxRightS / hopS));

  let li = idx0;
  let quiet = 0;
  for (let s = 0; s < leftSteps; s++) {
    const ni = li - 1;
    if (ni <= 0) break;
    li = ni;
    if (env[li] < threshold) quiet += 1;
    else quiet = 0;
    if (quiet >= 3) break;
  }

  let ri = idx0;
  quiet = 0;
  for (let s = 0; s < rightSteps; s++) {
    const ni = ri + 1;
    if (ni >= env.length - 1) break;
    ri = ni;
    if (env[ri] < threshold) quiet += 1;
    else quiet = 0;
    if (quiet >= 3) break;
  }

  const leftS = li * hopS;
  const rightS = Math.min(durationS, ri * hopS);
  let startS = Math.max(0, Math.min(leftS, tAbs - minPreS));
  let endS = Math.min(durationS, Math.max(rightS, tAbs + minPostS));
  if (endS - startS > maxLenS) endS = startS + maxLenS;
  if (endS <= startS + 0.02) endS = Math.min(durationS, startS + 0.02);
  return { startS, endS };
}

export async function syncClipSegmented({ history, statusEl, getVideoId, clipId, repeatIfFew = true, frameAnalysis = true, motionModel = "default", smoothWin = 5, blurKsize = 7, roiX = 0.10, roiY = 0.55, roiW = 0.80, roiH = 0.43 }) {
  const st = history.get();
  const clip = st.clips.find((c) => c.id === clipId);
  const videoId = getVideoId();
  if (!clip || !videoId) {
    toast(statusEl, "Erro: selecione um clipe e importe um vídeo.");
    return;
  }

  toast(statusEl, "Sincronizando em segmentos…");

  try {
    const motion = await apiPostJson("/api/sync/motion", {
      video_id: videoId,
      start_s: clip.startS,
      duration_s: clip.durationS,
      max_events: 20,
      frame_analysis: Boolean(frameAnalysis),
      model: String(motionModel || "default"),
      smooth_win: Math.max(1, Number(smoothWin || 5)),
      blur_ksize: Math.max(1, Number(blurKsize || 7)),
      roi_x: Math.max(0, Math.min(1, Number(roiX || 0.10))),
      roi_y: Math.max(0, Math.min(1, Number(roiY || 0.55))),
      roi_w: Math.max(0, Math.min(1, Number(roiW || 0.80))),
      roi_h: Math.max(0, Math.min(1, Number(roiH || 0.43))),
    });

    const buf = clip.previewUrl ? await decodeAudio(clip.previewUrl) : null;
    if (!buf) throw new Error("Sem preview de áudio para analisar.");

    const trans = detectTransientTimes(buf, 24);
    const moves = (motion.events || []).map((e) => e.t_s);
    if (!moves.length) throw new Error("Sem eventos de movimento detectados.");
    const pulses = isPulsating(trans);

    const chosenTrans = [...trans];
    if (repeatIfFew && chosenTrans.length < moves.length && chosenTrans.length > 0) {
      const reps = [];
      for (let i = 0; i < moves.length; i++) reps.push(chosenTrans[i % chosenTrans.length]);
      chosenTrans.splice(0, chosenTrans.length, ...reps);
    }

    const defaultLen = pulses ? 0.18 : 0.30;
    const margin = 0.01;
    const fadeFrac = pulses ? 0.20 : 0.12;

    history.commit((s) => {
      const base = s.clips.find((x) => x.id === clip.id);
      if (!base) return;
      const trackId = base.trackId;
      const name = base.name;
      const previewUrl = base.previewUrl;
      const source = base.source;

      s.clips = s.clips.filter((c) => c.id !== base.id);

      function findPlacementTrackAt(startS, durationS, preferredTrackId) {
        const order = s.tracks.map((t) => t.id);
        const startIdx = Math.max(0, order.indexOf(preferredTrackId));
        for (let di = 0; di < order.length; di++) {
          const tid = order[(startIdx + di) % order.length];
          if (canPlaceClip(s, { trackId: tid, startS, durationS })) return tid;
        }
        return null;
      }

      const areaStart = base.startS;
      const areaEnd = base.startS + base.durationS;
      const placed = [];

      for (let i = 0; i < moves.length; i++) {
        const targetStart = areaStart + moves[i];
        const nextTarget = i < moves.length - 1 ? areaStart + moves[i + 1] : areaEnd;
        const gap = Math.max(margin, nextTarget - targetStart - margin);
        const len = Math.min(defaultLen, gap);
        const srcOff = Math.max(0, Number(chosenTrans[i] || 0));
        const tid = findPlacementTrackAt(targetStart, len, trackId);
        if (!tid) continue;
        const c = addClip(s, {
          trackId: tid,
          name,
          startS: targetStart,
          durationS: len,
          sourceOffsetS: srcOff,
          sourceDurationS: base.sourceDurationS,
          previewUrl,
          source,
          waveformPeaks: base.waveformPeaks,
        });
        c.fadeInS = Math.min(0.08, Math.max(0.01, c.durationS * fadeFrac));
        c.fadeOutS = Math.min(0.08, Math.max(0.01, c.durationS * fadeFrac));
        placed.push({ start: c.startS, end: c.startS + c.durationS });
      }

      function coverageEnd() {
        if (!placed.length) return areaStart;
        return Math.max(...placed.map((p) => p.end));
      }

      let covEnd = coverageEnd();
      let ri = 0;
      while (covEnd + margin < areaEnd && ri < chosenTrans.length * 20) {
        const startS = covEnd + margin;
        const nextEnd = Math.min(areaEnd, startS + defaultLen);
        const len = Math.max(margin, nextEnd - startS);
        const srcOff = Math.max(0, Number(chosenTrans[ri % chosenTrans.length] || 0));
        const tid = findPlacementTrackAt(startS, len, trackId);
        if (!tid) {
          ri++;
          continue;
        }
        const c = addClip(s, {
          trackId: tid,
          name,
          startS,
          durationS: len,
          sourceOffsetS: srcOff,
          sourceDurationS: base.sourceDurationS,
          previewUrl,
          source,
          waveformPeaks: base.waveformPeaks,
        });
        c.fadeInS = Math.min(0.08, Math.max(0.01, c.durationS * fadeFrac));
        c.fadeOutS = Math.min(0.08, Math.max(0.01, c.durationS * fadeFrac));
        placed.push({ start: c.startS, end: c.startS + c.durationS });
        covEnd = coverageEnd();
        ri++;
      }
    });

    toast(statusEl, "Sincronização segmentada concluída.");
  } catch (e) {
    toast(statusEl, `Erro: ${String(e.message || e)}`);
  }
}

export async function syncClipTimeAdjust({ history, statusEl, getVideoId, clipId, frameAnalysis = true, motionModel = "default", smoothWin = 5, blurKsize = 7, roiX = 0.10, roiY = 0.55, roiW = 0.80, roiH = 0.43 }) {
  const st = history.get();
  const clip = st.clips.find((c) => c.id === clipId);
  const videoId = getVideoId();
  if (!clip || !videoId) {
    toast(statusEl, "Erro: selecione um clipe e importe um vídeo.");
    return;
  }
  toast(statusEl, "Ajustando tempo dinamicamente…");
  try {
    const motion = await apiPostJson("/api/sync/motion", {
      video_id: videoId,
      start_s: clip.startS,
      duration_s: clip.durationS,
      max_events: 20,
      frame_analysis: Boolean(frameAnalysis),
      model: String(motionModel || "default"),
      smooth_win: Math.max(1, Number(smoothWin || 5)),
      blur_ksize: Math.max(1, Number(blurKsize || 7)),
      roi_x: Math.max(0, Math.min(1, Number(roiX || 0.10))),
      roi_y: Math.max(0, Math.min(1, Number(roiY || 0.55))),
      roi_w: Math.max(0, Math.min(1, Number(roiW || 0.80))),
      roi_h: Math.max(0, Math.min(1, Number(roiH || 0.43))),
    });
    const buf = clip.previewUrl ? await decodeAudio(clip.previewUrl) : null;
    if (!buf) throw new Error("Sem preview de áudio para analisar.");
    const trans = detectTransientTimes(buf, 24);
    const moves = (motion.events || []).map((e) => e.t_s);
    const n = Math.min(trans.length, moves.length);
    if (n < 2) {
      await syncClipToMotion({ history, statusEl, getVideoId, clipId, frameAnalysis, motionModel, smoothWin, blurKsize, roiX, roiY, roiW, roiH });
      return;
    }
    const localTrans = [];
    const startOff = Math.max(0, Number(clip.sourceOffsetS || 0));
    const endOff = startOff + Math.max(0.001, Number(clip.durationS || 0));
    for (const t of trans) if (t >= startOff && t <= endOff) localTrans.push(t - startOff);
    const m = Math.min(localTrans.length, moves.length);
    if (m < 2) {
      await syncClipToMotion({ history, statusEl, getVideoId, clipId, frameAnalysis, motionModel, smoothWin, blurKsize, roiX, roiY, roiW, roiH });
      return;
    }
    const envData = computeEnvelope(buf);
    const hopS = envData.hopS;
    const env = envData.env;

    const e0 = Math.max(0, Math.min(env.length - 1, Math.floor(startOff / hopS)));
    const e1 = Math.max(e0 + 1, Math.min(env.length, Math.ceil(endOff / hopS)));
    const envSlice = env.slice(e0, e1);
    const maxEnv = envSlice.length ? Math.max(...envSlice) : 0;
    const medEnv = envSlice.length ? median(envSlice) : 0;
    const threshold = Math.max(maxEnv * 0.06, medEnv * 2.0, 1e-6);

    history.commit((s) => {
      const base = s.clips.find((x) => x.id === clip.id);
      if (!base) return;
      const sourceDurationS = Number(base.sourceDurationS || 0) > 0 ? Number(base.sourceDurationS) : Number(buf.duration || 0);

      const desired = [];
      let minStart = Infinity;

      for (let i = 0; i < m; i++) {
        const tAbs = startOff + localTrans[i];
        const w = findActiveWindow({ env, hopS, durationS: envData.durationS, tAbs, threshold });
        const segStartAbs = Math.max(startOff, Math.min(endOff, w.startS));
        const segEndAbs = Math.max(segStartAbs + 0.02, Math.min(endOff, w.endS));
        const segDur = segEndAbs - segStartAbs;
        if (segDur < 0.03) continue;
        const transientOffset = Math.max(0, tAbs - segStartAbs);
        const outStartAbs = (base.startS + moves[i]) - transientOffset;
        minStart = Math.min(minStart, outStartAbs);
        desired.push({ outStartAbs, durationS: segDur, sourceOffsetS: segStartAbs });
      }

      if (!desired.length) return;

      desired.sort((a, b) => a.outStartAbs - b.outStartAbs);

      const newStart = Math.max(0, minStart);
      const shift = newStart - minStart;
      for (const seg of desired) seg.outStartAbs += shift;

      let lastEnd = newStart;
      for (const seg of desired) {
        if (seg.outStartAbs < lastEnd + 0.001) seg.outStartAbs = lastEnd + 0.001;
        lastEnd = seg.outStartAbs + seg.durationS;
      }

      base.startS = newStart;
      base.durationS = Math.max(0.05, lastEnd - newStart);
      base.sourceDurationS = sourceDurationS;
      base.timeWarpSegments = desired.map((seg) => ({
        startS: seg.outStartAbs - newStart,
        durationS: seg.durationS,
        sourceOffsetS: seg.sourceOffsetS,
      }));
      base.fadeInS = Math.min(base.durationS, Math.max(0, Number(base.fadeInS || 0)));
      base.fadeOutS = Math.min(base.durationS, Math.max(0, Number(base.fadeOutS || 0)));
    });

    toast(statusEl, "Ajuste de tempo aplicado (sem pitch, sem quebrar o clipe).");
  } catch (e) {
    toast(statusEl, `Erro: ${String(e.message || e)}`);
  }
}

export function openSyncModal({ history, statusEl, getVideoId, audioEngine }) {
  const st = history.get();
  const id = st.selection.clipId;
  const clip = st.clips.find((c) => c.id === id);
  if (!clip) {
    toast(statusEl, "Selecione um clipe para sincronizar.");
    return;
  }

  const backdrop = document.createElement("div");
  backdrop.className = "modalBackdrop";

  const modal = document.createElement("div");
  modal.className = "modal";

  const header = el("div", { class: "modalHeader" }, [
    el("div", { class: "modalTitle", text: "Sincronização (IA)" }),
    el("button", { class: "btn", text: "Fechar", onclick: () => backdrop.remove() }),
  ]);

  const body = el("div", { class: "modalBody" });
  const statusLine = el("div", { style: "color: var(--muted); font-size: 12px; margin-bottom: 8px;", text: "" });
  const actions = el("div", { class: "actionsRow" });
  const precision = el("div", { class: "modalSectionTitle", text: "Precisão" });
  const rowFrame = el("div", { class: "formRow" }, [
    el("div", { class: "formLabel", text: "Análise de frames" }),
    el("input", { type: "checkbox", id: "frameAnalysis", checked: true }),
  ]);
  const rowModel = el("div", { class: "formRow" }, [
    el("div", { class: "formLabel", text: "Modelo de predição de movimento" }),
    el("select", { id: "motionModel" }, [
      el("option", { value: "default", text: "Padrão" }),
      el("option", { value: "high", text: "Alta precisão" }),
      el("option", { value: "fast", text: "Rápido" }),
    ]),
  ]);
  const rowSmooth = el("div", { class: "formRow" }, [
    el("div", { class: "formLabel", text: "Suavização (janela)" }),
    el("input", { type: "number", id: "smoothWin", min: "1", max: "99", value: "5" }),
  ]);

  const btnAlignWhole = el("button", { class: "btn", text: "Alinhar clip inteiro" });
  const btnAlignSegments = el("button", { class: "btn", text: "Sincronizar em segmentos" });
  const btnTimeAdjust = el("button", { class: "btn", text: "Ajuste de tempo (dinâmico)" });
  const btnRetry = el("button", { class: "btn", text: "Tentar novamente" });
  const btnRepeatCuts = el("button", { class: "btn", text: "Repetir cortes p/ encaixar" });
  const btnPreview = el("button", { class: "btn", text: "Ouvir resultado" });

  btnAlignWhole.onclick = async () => {
    statusLine.textContent = "Sincronizando clip inteiro…";
    const frameAnalysis = document.getElementById("frameAnalysis")?.checked ?? true;
    const motionModel = document.getElementById("motionModel")?.value || "default";
    const smoothWin = Number(document.getElementById("smoothWin")?.value || 5);
    await syncClipToMotion({ history, statusEl, getVideoId, clipId: clip.id, frameAnalysis, motionModel, smoothWin });
    statusLine.textContent = "Concluído.";
  };

  btnAlignSegments.onclick = async () => {
    statusLine.textContent = "Sincronizando em segmentos…";
    const frameAnalysis = document.getElementById("frameAnalysis")?.checked ?? true;
    const motionModel = document.getElementById("motionModel")?.value || "default";
    const smoothWin = Number(document.getElementById("smoothWin")?.value || 5);
    await syncClipSegmented({ history, statusEl, getVideoId, clipId: clip.id, repeatIfFew: false, frameAnalysis, motionModel, smoothWin });
    statusLine.textContent = "Concluído.";
  };

  btnTimeAdjust.onclick = async () => {
    statusLine.textContent = "Ajustando tempo…";
    const frameAnalysis = document.getElementById("frameAnalysis")?.checked ?? true;
    const motionModel = document.getElementById("motionModel")?.value || "default";
    const smoothWin = Number(document.getElementById("smoothWin")?.value || 5);
    await syncClipTimeAdjust({ history, statusEl, getVideoId, clipId: clip.id, frameAnalysis, motionModel, smoothWin });
    statusLine.textContent = "Concluído.";
  };

  btnRetry.onclick = async () => {
    statusLine.textContent = "Recalculando…";
    const frameAnalysis = document.getElementById("frameAnalysis")?.checked ?? true;
    const motionModel = document.getElementById("motionModel")?.value || "default";
    const smoothWin = Number(document.getElementById("smoothWin")?.value || 5);
    await syncClipSegmented({ history, statusEl, getVideoId, clipId: clip.id, repeatIfFew: false, frameAnalysis, motionModel, smoothWin });
    statusLine.textContent = "Concluído.";
  };

  btnRepeatCuts.onclick = async () => {
    statusLine.textContent = "Repetindo cortes para encaixar…";
    const frameAnalysis = document.getElementById("frameAnalysis")?.checked ?? true;
    const motionModel = document.getElementById("motionModel")?.value || "default";
    const smoothWin = Number(document.getElementById("smoothWin")?.value || 5);
    await syncClipSegmented({ history, statusEl, getVideoId, clipId: clip.id, repeatIfFew: true, frameAnalysis, motionModel, smoothWin });
    statusLine.textContent = "Concluído.";
  };

  btnPreview.onclick = () => {
    const v = document.querySelector("#video");
    if (v && v.paused) {
      const p = v.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    }
    if (audioEngine) audioEngine.playFrom({ state: history.get(), videoTimeS: (document.querySelector("#video")?.currentTime || 0) });
  };

  actions.append(btnAlignWhole, btnAlignSegments, btnTimeAdjust, btnRetry, btnRepeatCuts, btnPreview);

  body.append(
    el("div", { class: "modalSectionTitle", text: "Ações" }),
    actions,
    precision,
    rowFrame,
    rowModel,
    rowSmooth,
    el("div", { class: "modalSectionTitle", text: "Status" }),
    statusLine,
  );

  modal.append(header, body);
  backdrop.append(modal);
  document.body.append(backdrop);
}
