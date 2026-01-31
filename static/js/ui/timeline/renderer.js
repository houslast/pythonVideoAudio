import { formatTime } from "../../utils/dom.js";
import { UI, canvasHeight, timeToX, trackHeight, trackTop } from "./geometry.js";

function drawGrid(ctx, width, height, pixelsPerSecond) {
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.03)";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(27,42,58,0.85)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(UI.GUTTER_W + 0.5, 0);
  ctx.lineTo(UI.GUTTER_W + 0.5, height);
  ctx.stroke();

  const secondsPerMajor = pixelsPerSecond >= 180 ? 1 : pixelsPerSecond >= 90 ? 2 : 5;
  const majorStep = secondsPerMajor * pixelsPerSecond;
  const minorStep = majorStep / 2;

  ctx.font = "12px ui-sans-serif, system-ui";
  for (let x = UI.GUTTER_W; x < width; x += minorStep) {
    const isMajor = Math.round((x - UI.GUTTER_W) / majorStep) === (x - UI.GUTTER_W) / majorStep;
    ctx.strokeStyle = isMajor ? "rgba(93,214,255,0.14)" : "rgba(27,42,58,0.55)";
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, height);
    ctx.stroke();

    if (isMajor) {
      const t = (x - UI.GUTTER_W) / pixelsPerSecond;
      ctx.fillStyle = "rgba(127,154,181,0.85)";
      ctx.fillText(formatTime(t), x + 6, 16);
    }
  }
  ctx.restore();
}

function drawTracks(ctx, state, width, trackScale) {
  ctx.save();
  for (let i = 0; i < state.tracks.length; i++) {
    const y = trackTop(i, trackScale);
    const h = trackHeight(trackScale);
    ctx.fillStyle = "rgba(15,22,32,0.45)";
    ctx.fillRect(0, y, UI.GUTTER_W, h);
    ctx.strokeStyle = "rgba(27,42,58,0.8)";
    ctx.strokeRect(0.5, y + 0.5, UI.GUTTER_W - 1, h - 1);

    ctx.fillStyle = "rgba(214,226,240,0.85)";
    ctx.font = "600 12px ui-sans-serif, system-ui";
    ctx.fillText(state.tracks[i].name, 12, y + 18 * trackScale);
    ctx.font = "12px ui-sans-serif, system-ui";
    ctx.fillStyle = "rgba(127,154,181,0.85)";
    ctx.fillText(`G ${Math.round(state.tracks[i].gain * 100)}%`, 12, y + 36 * trackScale);

    ctx.strokeStyle = "rgba(27,42,58,0.8)";
    ctx.strokeRect(UI.GUTTER_W + 0.5, y + 0.5, width - UI.GUTTER_W - 1, h - 1);
  }
  ctx.restore();
}

function clipRect(clip, trackIndex, pixelsPerSecond, trackScale) {
  const x = timeToX(clip.startS, pixelsPerSecond);
  const w = Math.max(24, clip.durationS * pixelsPerSecond);
  const y = trackTop(trackIndex, trackScale);
  return { x, y, w, h: trackHeight(trackScale) };
}

function drawClip(ctx, rect, clip, selected) {
  const r = 12;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(rect.x + r, rect.y + 6);
  ctx.arcTo(rect.x + rect.w - 6, rect.y + 6, rect.x + rect.w - 6, rect.y + rect.h - 6, r);
  ctx.arcTo(rect.x + rect.w - 6, rect.y + rect.h - 6, rect.x + 6, rect.y + rect.h - 6, r);
  ctx.arcTo(rect.x + 6, rect.y + rect.h - 6, rect.x + 6, rect.y + 6, r);
  ctx.arcTo(rect.x + 6, rect.y + 6, rect.x + rect.w - 6, rect.y + 6, r);
  ctx.closePath();

  const base = selected ? "rgba(93,214,255,0.18)" : "rgba(161,139,255,0.12)";
  ctx.fillStyle = base;
  ctx.fill();

  ctx.strokeStyle = selected ? "rgba(93,214,255,0.7)" : "rgba(93,214,255,0.22)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const peaks = clip.waveformPeaks;
  if (Array.isArray(peaks) && peaks.length) {
    const x0 = rect.x + 10;
    const x1 = rect.x + rect.w - 10;
    const mid = rect.y + rect.h / 2;
    const amp = rect.h * 0.28;
    const total = peaks.length;
    const srcDur = Math.max(0.001, Number(clip.sourceDurationS || clip.durationS || 0));
    ctx.save();
    ctx.strokeStyle = selected ? "rgba(93,214,255,0.55)" : "rgba(214,226,240,0.30)";
    ctx.lineWidth = 1;
    const tw = Array.isArray(clip.timeWarpSegments) && clip.timeWarpSegments.length ? clip.timeWarpSegments : null;
    const clipDur = Math.max(0.001, Number(clip.durationS || 0));
    const spanW = x1 - x0;
    const drawSeg = (segX0, segX1, srcOff, visDur) => {
      let segLen = Math.max(2, Math.round((visDur / srcDur) * total));
      segLen = Math.min(total, segLen);
      const startIdx = Math.max(0, Math.min(total - 1, Math.round((srcOff / srcDur) * total)));
      const endIdx = Math.min(total, startIdx + segLen);
      const step = (segX1 - segX0) / Math.max(1, (endIdx - startIdx) - 1);
      let idx = 0;
      for (let srcIndex = startIdx; srcIndex < endIdx; srcIndex++) {
        const p = Math.max(0, Math.min(1, Number(peaks[srcIndex] || 0)));
        const x = segX0 + idx * step;
        ctx.moveTo(x, mid - p * amp);
        ctx.lineTo(x, mid + p * amp);
        idx += 1;
      }
    };
    ctx.beginPath();
    if (tw) {
      for (const seg of tw) {
        const st = Math.max(0, Math.min(clipDur, Number(seg.startS || 0)));
        const dur = Math.max(0.001, Math.min(clipDur - st, Number(seg.durationS || 0)));
        const segX0 = x0 + (st / clipDur) * spanW;
        const segX1 = x0 + ((st + dur) / clipDur) * spanW;
        const srcOff = Math.max(0, Number(seg.sourceOffsetS || 0));
        drawSeg(segX0, segX1, srcOff, dur);
      }
    } else {
      const visDur = clipDur;
      const srcOff = Math.max(0, Number(clip.sourceOffsetS || 0));
      drawSeg(x0, x1, srcOff, visDur);
    }
    ctx.stroke();
    ctx.restore();
  }

  ctx.fillStyle = "rgba(127,154,181,0.9)";
  ctx.font = "12px ui-sans-serif, system-ui";
  ctx.fillText(`${clip.durationS.toFixed(2)}s`, rect.x + 12, rect.y + 36);

  ctx.restore();
}

function drawFadeHandles(ctx, rect, clip, pixelsPerSecond) {
  const handleW = 10;
  ctx.save();
  ctx.fillStyle = "rgba(93,214,255,0.55)";

  const fi = Math.min(clip.fadeInS, clip.durationS) * pixelsPerSecond;
  if (fi > 0.01) {
    ctx.beginPath();
    ctx.moveTo(rect.x + 6, rect.y + rect.h - 6);
    ctx.lineTo(rect.x + 6 + Math.min(fi, rect.w - 12), rect.y + rect.h - 6);
    ctx.lineTo(rect.x + 6, rect.y + 6);
    ctx.closePath();
    ctx.fill();
  }

  const fo = Math.min(clip.fadeOutS, clip.durationS) * pixelsPerSecond;
  if (fo > 0.01) {
    ctx.beginPath();
    ctx.moveTo(rect.x + rect.w - 6, rect.y + 6);
    ctx.lineTo(rect.x + rect.w - 6 - Math.min(fo, rect.w - 12), rect.y + 6);
    ctx.lineTo(rect.x + rect.w - 6, rect.y + rect.h - 6);
    ctx.closePath();
    ctx.fill();
  }

  ctx.fillStyle = "rgba(214,226,240,0.7)";
  ctx.fillRect(rect.x + 6, rect.y + 6, handleW, 3);
  ctx.fillRect(rect.x + rect.w - 6 - handleW, rect.y + 6, handleW, 3);
  ctx.restore();
}

function drawAutomation(ctx, rect, clip, mode) {
  const points = mode === "pan" ? clip.panAutomation : clip.gainAutomation;
  if (!points?.length) return;
  const y0 = rect.y + 8;
  const y1 = rect.y + rect.h - 8;
  const x0 = rect.x + 8;
  const x1 = rect.x + rect.w - 8;

  ctx.save();
  ctx.strokeStyle = mode === "pan" ? "rgba(161,139,255,0.7)" : "rgba(93,214,255,0.75)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const px = x0 + p.t * (x1 - x0);
    const ny = mode === "pan" ? (1 - (p.v + 1) / 2) : 1 - p.v;
    const py = y0 + ny * (y1 - y0);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();

  ctx.fillStyle = "rgba(214,226,240,0.85)";
  for (const p of points) {
    const px = x0 + p.t * (x1 - x0);
    const ny = mode === "pan" ? (1 - (p.v + 1) / 2) : 1 - p.v;
    const py = y0 + ny * (y1 - y0);
    ctx.beginPath();
    ctx.arc(px, py, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawPlayhead(ctx, state, height, pixelsPerSecond) {
  const x = timeToX(state.playheadS, pixelsPerSecond);
  ctx.save();
  ctx.strokeStyle = "rgba(255,93,108,0.8)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + 0.5, 0);
  ctx.lineTo(x + 0.5, height);
  ctx.stroke();
  ctx.restore();
}

export function renderTimeline(canvas, state, { widthPx, pixelsPerSecond }) {
  const dpr = window.devicePixelRatio || 1;
  const trackScale = Number(state.trackScale || 1);
  const height = canvasHeight(state.tracks.length, trackScale);
  canvas.width = Math.floor(widthPx * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  drawGrid(ctx, widthPx, height, pixelsPerSecond);
  drawTracks(ctx, state, widthPx, trackScale);

  for (let ti = 0; ti < state.tracks.length; ti++) {
    const track = state.tracks[ti];
    const clips = state.clips.filter((c) => c.trackId === track.id);
    for (const clip of clips) {
      const rect = clipRect(clip, ti, pixelsPerSecond, trackScale);
      const selected = (Array.isArray(state.selection.clipIds) && state.selection.clipIds.includes(clip.id)) || state.selection.clipId === clip.id;
      drawClip(ctx, rect, clip, selected);
      drawFadeHandles(ctx, rect, clip, pixelsPerSecond);
      if (state.selection.clipId === clip.id) drawAutomation(ctx, rect, clip, state.automationMode);
    }
  }

  drawPlayhead(ctx, state, height, pixelsPerSecond);
}

export function hitTestClip(state, pixelsPerSecond, x, y) {
  const trackScale = Number(state.trackScale || 1);
  for (let ti = 0; ti < state.tracks.length; ti++) {
    const y0 = trackTop(ti, trackScale);
    const y1 = y0 + trackHeight(trackScale);
    if (y < y0 || y > y1) continue;
    const trackId = state.tracks[ti].id;
    const clips = state.clips.filter((c) => c.trackId === trackId);
    for (const clip of clips) {
      const rect = clipRect(clip, ti, pixelsPerSecond, trackScale);
      if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) {
        return { clip, trackIndex: ti, rect };
      }
    }
  }
  return null;
}
