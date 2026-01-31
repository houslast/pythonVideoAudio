import { toast } from "../../../utils/dom.js";
import { AutomationMode, addClip, canPlaceClip, forceMoveClip, moveClip, removeSelectedClip } from "../state.js";
import { hitTestClip } from "../renderer.js";
import { UI, trackTop, trackHeight } from "../geometry.js";
import { syncClipToMotion } from "./sync.js";
import { automationPointHit, canvasPoint, clamp, clipEdgeHit, findTrackAt, isOnTimeline, timeAtX, trackIndexAtYWithScale } from "./helpers.js";

function findPlacementTrack(state, startS, durationS) {
  for (const t of state.tracks) {
    if (canPlaceClip(state, { trackId: t.id, startS, durationS })) return t;
  }
  return null;
}

export function bindMouse({
  canvas,
  overlay,
  history,
  statusEl,
  contextMenu,
  requestRender,
  setZoom,
  setPlayhead,
  video,
  getVideoId,
}) {
  let drag = null;
  let clipboard = null;

  function st() {
    return history.get();
  }

  function setSelected(id) {
    history.commit((s) => {
      s.selection.clipId = id;
      s.selection.clipIds = id ? [id] : [];
    });
    requestRender();
  }

  function selectedClipId() {
    return st().selection.clipId;
  }

  const scrollEl = overlay.closest(".timelineBody") || overlay.parentElement?.parentElement;
  let marquee = null;

  overlay.addEventListener(
    "wheel",
    (ev) => {
      if (!scrollEl) return;
      if (!ev.ctrlKey && !ev.altKey) return;
      ev.preventDefault();

      const cur = st();
      const p = canvasPoint(canvas, ev);

      if (ev.ctrlKey) {
        const oldPps = Number(cur.pixelsPerSecond || 100);
        const factor = Math.exp(-ev.deltaY * 0.002);
        const nextPps = clamp(oldPps * factor, 20, 1200);
        const t = timeAtX(oldPps, p.x);
        const nextX = UI.GUTTER_W + t * nextPps;
        const dx = nextX - p.x;
        setZoom(nextPps);
        scrollEl.scrollLeft += dx;
        return;
      }

      if (ev.altKey) {
        const oldScale = Number(cur.trackScale || 1);
        const factor = Math.exp(-ev.deltaY * 0.002);
        const nextScale = clamp(oldScale * factor, 0.3, 6);
        const y = p.y;
        const base = scrollEl.scrollTop + y;
        history.preview((s) => {
          s.trackScale = nextScale;
        });
        requestRender();
        scrollEl.scrollTop = base * (nextScale / oldScale) - y;
        scrollEl.style.overflowY = "auto";
      }
    },
    { passive: false },
  );

  overlay.addEventListener("mousedown", (ev) => {
    if (ev.button !== 0) return;
    const p = canvasPoint(canvas, ev);
    const pixelsPerSecond = st().pixelsPerSecond;

    if (!isOnTimeline(p.x)) {
      setSelected(null);
      return;
    }

    const hit = hitTestClip(st(), pixelsPerSecond, p.x, p.y);
    if (!hit) {
      setSelected(null);
      const el = document.createElement("div");
      el.style.position = "absolute";
      el.style.border = "1px dashed rgba(93,214,255,0.65)";
      el.style.background = "rgba(93,214,255,0.08)";
      el.style.pointerEvents = "none";
      el.style.zIndex = "10";
      overlay.append(el);
      marquee = { startX: p.x, startY: p.y, x: p.x, y: p.y, w: 0, h: 0, el };
      return;
    }

    const alreadySelected = Array.isArray(st().selection.clipIds) && st().selection.clipIds.includes(hit.clip.id);
    if (!alreadySelected) setSelected(hit.clip.id);
    const clip = hit.clip;
    const mode = st().automationMode;
    const points = mode === AutomationMode.PAN ? clip.panAutomation : clip.gainAutomation;
    const aHit = automationPointHit(hit.rect, mode, points, p.x, p.y);
    if (aHit) {
      drag = { type: "automation", clipId: clip.id, index: aHit.index, rect: hit.rect, mode, baseState: JSON.parse(JSON.stringify(st())) };
      return;
    }

    const edge = clipEdgeHit(hit.rect, p.x);
    if (edge) {
      drag = { type: "fade", clipId: clip.id, edge, lastX: p.x, baseState: JSON.parse(JSON.stringify(st())) };
      return;
    }

    const many = Array.isArray(st().selection.clipIds) ? st().selection.clipIds.filter((id) => id && id !== clip.id) : [];
    if (many.length) {
      const base = JSON.parse(JSON.stringify(st()));
      const ids = [clip.id, ...many];
      const baseStarts = new Map();
      for (const c of base.clips) if (ids.includes(c.id)) baseStarts.set(c.id, c.startS);
      drag = { type: "moveMany", clipIds: ids, startX: p.x, baseState: base, baseStarts };
    } else {
      drag = {
        type: "move",
        clipId: clip.id,
        startX: p.x,
        startY: p.y,
        originStartS: clip.startS,
        originTrackId: clip.trackId,
        lastOkStartS: clip.startS,
        blocked: null,
        baseState: JSON.parse(JSON.stringify(st())),
      };
    }
  });

  overlay.addEventListener("mousemove", (ev) => {
    const p = canvasPoint(canvas, ev);
    const pixelsPerSecond = st().pixelsPerSecond;

    if (marquee) {
      marquee.x = Math.min(marquee.startX, p.x);
      marquee.y = Math.min(marquee.startY, p.y);
      marquee.w = Math.abs(p.x - marquee.startX);
      marquee.h = Math.abs(p.y - marquee.startY);
      marquee.el.style.left = `${marquee.x}px`;
      marquee.el.style.top = `${marquee.y}px`;
      marquee.el.style.width = `${marquee.w}px`;
      marquee.el.style.height = `${marquee.h}px`;
      history.commit((s) => {
        s.selection.clipIds = [];
        for (const c of s.clips) {
          const ti = s.tracks.findIndex((t) => t.id === c.trackId);
          if (ti < 0) continue;
          const x = UI.GUTTER_W + c.startS * pixelsPerSecond;
          const w = Math.max(24, c.durationS * pixelsPerSecond);
          const y = trackTop(ti, Number(s.trackScale || 1));
          const h = trackHeight(Number(s.trackScale || 1));
          const intersects = x < marquee.x + marquee.w && x + w > marquee.x && y < marquee.y + marquee.h && y + h > marquee.y;
          if (intersects) s.selection.clipIds.push(c.id);
        }
      });
      requestRender();
      return;
    }

    if (!drag) return;
    const cur = st().clips.find((c) => c.id === drag.clipId);
    if (drag.type !== "moveMany" && !cur) return;

    if (drag.type === "move") {
      const dt = timeAtX(pixelsPerSecond, p.x) - timeAtX(pixelsPerSecond, drag.startX);
      const targetStart = Math.max(0, drag.originStartS + dt);
      const targetTrackIndex = trackIndexAtYWithScale(p.y, Number(st().trackScale || 1));
      const targetTrack = findTrackAt(st(), targetTrackIndex);
      const targetTrackId = targetTrack ? targetTrack.id : drag.originTrackId;
      const shiftPressed = !!ev.shiftKey;

      if (shiftPressed) {
        history.preview((s) => {
          forceMoveClip(s, cur.id, { trackId: targetTrackId, startS: targetStart });
        });
        drag.lastOkStartS = targetStart;
        drag.blocked = null;
        requestRender();
        return;
      }

      const ok = canPlaceClip(st(), { trackId: targetTrackId, startS: targetStart, durationS: cur.durationS, ignoreClipId: cur.id });
      if (!ok) {
        if (!drag.blocked || drag.blocked.trackId !== targetTrackId) {
          const dir = Math.sign(targetStart - Number(drag.lastOkStartS || 0)) || Math.sign(dt) || 1;
          drag.blocked = { atX: p.x, dir, trackId: targetTrackId };
          return;
        }

        const push = drag.blocked.dir * (p.x - drag.blocked.atX);
        if (push <= 0) {
          drag.blocked = null;
          return;
        }
        if (push < 28) return;
      }

      history.preview((s) => {
        const moved = moveClip(s, cur.id, { trackId: targetTrackId, startS: targetStart });
        if (!moved) forceMoveClip(s, cur.id, { trackId: targetTrackId, startS: targetStart });
      });
      drag.lastOkStartS = targetStart;
      drag.blocked = null;
      requestRender();
    }

    if (drag.type === "moveMany") {
      const dt = timeAtX(pixelsPerSecond, p.x) - timeAtX(pixelsPerSecond, drag.startX);
      const targets = [];
      for (const id of drag.clipIds) {
        const baseStart = Number(drag.baseStarts.get(id) || 0);
        const targetStart = Math.max(0, baseStart + dt);
        targets.push({ id, targetStart });
      }
      for (const t of targets) {
        const clip = st().clips.find((c) => c.id === t.id);
        if (!clip) return;
        const ok = canPlaceClip(st(), { trackId: clip.trackId, startS: t.targetStart, durationS: clip.durationS, ignoreClipId: clip.id });
        if (!ok) return;
      }
      history.preview((s) => {
        for (const t of targets) moveClip(s, t.id, { trackId: s.clips.find((c) => c.id === t.id)?.trackId, startS: t.targetStart });
      });
      requestRender();
    }

    if (drag.type === "fade") {
      const dx = p.x - drag.lastX;
      drag.lastX = p.x;
      const ds = dx / pixelsPerSecond;
      history.preview((s) => {
        const c = s.clips.find((x) => x.id === cur.id);
        if (!c) return;
        if (drag.edge === "left") c.fadeInS = clamp(c.fadeInS + ds, 0, c.durationS);
        else c.fadeOutS = clamp(c.fadeOutS - ds, 0, c.durationS);
      });
      requestRender();
    }

    if (drag.type === "automation") {
      history.preview((s) => {
        const c = s.clips.find((x) => x.id === cur.id);
        if (!c) return;
        const mode = drag.mode;
        const points = mode === AutomationMode.PAN ? c.panAutomation : c.gainAutomation;
        const hit = hitTestClip(s, pixelsPerSecond, p.x, p.y);
        const r = hit?.rect || drag.rect;
        const x0 = r.x + 8;
        const x1 = r.x + r.w - 8;
        const y0 = r.y + 8;
        const y1 = r.y + r.h - 8;
        const t = clamp((p.x - x0) / (x1 - x0), 0, 1);
        const ny = clamp((p.y - y0) / (y1 - y0), 0, 1);
        const v = mode === AutomationMode.PAN ? clamp(1 - ny, 0, 1) * 2 - 1 : clamp(1 - ny, 0, 1);
        points[drag.index] = { t, v };
        points.sort((a, b) => a.t - b.t);
      });
      requestRender();
    }
  });

  window.addEventListener("mouseup", () => {
    if (marquee) {
      const small = marquee.w * marquee.h < 16;
      marquee.el.remove();
      const startX = marquee.startX;
      marquee = null;
      if (small) {
        const s = st();
        const pps = s ? s.pixelsPerSecond : 100;
        const t = timeAtX(pps, startX);
        setPlayhead(t, { fromVideo: false });
        video.currentTime = st().playheadS;
      }
    }
    if (drag) {
      if (drag.baseState) history.finalizePreview(drag.baseState);
      drag = null;
    }
    requestRender();
  });

  overlay.addEventListener("dblclick", (ev) => {
    const p = canvasPoint(canvas, ev);
    const pixelsPerSecond = st().pixelsPerSecond;
    if (p.x < UI.GUTTER_W) {
      const ti = trackIndexAtYWithScale(p.y, Number(st().trackScale || 1));
      const tr = findTrackAt(st(), ti);
      if (tr) {
        const name = window.prompt("Renomear faixa:", tr.name || "");
        if (name != null) {
          history.commit((s) => {
            const tt = s.tracks.find((x) => x.id === tr.id);
            if (tt) tt.name = String(name).slice(0, 80);
          });
          requestRender();
        }
      }
      return;
    }
    const hit = hitTestClip(st(), pixelsPerSecond, p.x, p.y);
    if (!hit) return;
    setSelected(hit.clip.id);

    history.commit((s) => {
      const c = s.clips.find((x) => x.id === hit.clip.id);
      if (!c) return;
      const mode = s.automationMode;
      const points = mode === AutomationMode.PAN ? c.panAutomation : c.gainAutomation;
      const x0 = hit.rect.x + 8;
      const x1 = hit.rect.x + hit.rect.w - 8;
      const y0 = hit.rect.y + 8;
      const y1 = hit.rect.y + hit.rect.h - 8;
      const t = clamp((p.x - x0) / (x1 - x0), 0, 1);
      const ny = clamp((p.y - y0) / (y1 - y0), 0, 1);
      const v = mode === AutomationMode.PAN ? clamp(1 - ny, 0, 1) * 2 - 1 : clamp(1 - ny, 0, 1);
      points.push({ t, v });
      points.sort((a, b) => a.t - b.t);
    });
    requestRender();
  });

  overlay.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    const p = canvasPoint(canvas, ev);
    const pixelsPerSecond = st().pixelsPerSecond;
    const hit = hitTestClip(st(), pixelsPerSecond, p.x, p.y);
    if (!hit) return;
    setSelected(hit.clip.id);

    contextMenu.showAt({
      x: ev.clientX,
      y: ev.clientY,
      items: [
        { label: "Sincronizar com movimento", onClick: () => syncClipToMotion({ history, statusEl, getVideoId, clipId: hit.clip.id }).then(requestRender) },
        { label: "Copiar", onClick: () => { clipboard = JSON.parse(JSON.stringify(hit.clip)); window.__audioEditorClipboard = JSON.parse(JSON.stringify(hit.clip)); toast(statusEl, "Copiado."); } },
        {
          label: "Renomear faixa",
          onClick: () => {
            const tr = st().tracks.find((t) => t.id === hit.clip.trackId);
            if (!tr) return;
            const name = window.prompt("Renomear faixa:", tr.name || "");
            if (name != null) {
              history.commit((s) => {
                const tt = s.tracks.find((x) => x.id === tr.id);
                if (tt) tt.name = String(name).slice(0, 80);
              });
              requestRender();
            }
          },
        },
        {
          label: "Colar no playhead",
          onClick: () => {
            const clip = clipboard || window.__audioEditorClipboard;
            if (!clip) return;
            const t = st().playheadS;
            history.commit((s) => {
              const tr = s.tracks.find((x) => x.id === hit.clip.trackId) || s.tracks[0];
              const durationS = clip.durationS;
              let trackId = tr.id;
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
          },
        },
        { label: "Deletar", danger: true, onClick: () => { history.commit((s) => removeSelectedClip(s)); requestRender(); } },
      ],
    });
  });
}
