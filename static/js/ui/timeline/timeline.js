import { formatTime, toast } from "../../utils/dom.js";
import { createContextMenu } from "./context_menu.js";
import { createHistory } from "./history.js";
import { createAudioEngine } from "./audio_engine.js";
import { renderTimeline } from "./renderer.js";
import { UI } from "./geometry.js";
import { createInitialState, addTrack } from "./state.js";
import { bindTimelineInteractions } from "./interactions.js";

function makeCanvasWrap(root) {
  root.textContent = "";
  const wrap = document.createElement("div");
  wrap.className = "timelineCanvasWrap";
  const canvas = document.createElement("canvas");
  canvas.className = "timelineCanvas";
  const overlay = document.createElement("div");
  overlay.style.position = "absolute";
  overlay.style.left = "0";
  overlay.style.top = "0";
  overlay.style.right = "0";
  overlay.style.bottom = "0";
  overlay.style.zIndex = "5";
  overlay.style.cursor = "default";
  wrap.append(canvas, overlay);
  root.append(wrap);
  return { wrap, canvas, overlay };
}

export function createTimeline({ timelineRoot, statusEl, timeEl, video, getVideoId }) {
  const { wrap, canvas, overlay } = makeCanvasWrap(timelineRoot);
  const history = createHistory(createInitialState());
  const audioEngine = createAudioEngine({ statusEl });
  const contextMenu = createContextMenu();

  let raf = 0;

  function requestRender() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      render();
    });
  }

  function render() {
    const st = history.get();
    const viewWidth = timelineRoot.clientWidth || 1200;
    let maxEndS = st.playheadS || 0;
    for (const c of st.clips) maxEndS = Math.max(maxEndS, c.startS + c.durationS);
    const widthPx = Math.max(viewWidth, UI.GUTTER_W + maxEndS * st.pixelsPerSecond + 240);
    wrap.style.width = `${Math.ceil(widthPx)}px`;
    renderTimeline(canvas, st, { widthPx, pixelsPerSecond: st.pixelsPerSecond });
    timeEl.textContent = formatTime(st.playheadS);
  }

  function setZoom(pixelsPerSecond) {
    history.preview((s) => {
      s.pixelsPerSecond = pixelsPerSecond;
    });
    requestRender();
    timelineRoot.dispatchEvent(new CustomEvent("timelinezoom", { detail: pixelsPerSecond }));
  }

  bindTimelineInteractions({
    canvas,
    overlay,
    history,
    audioEngine,
    video,
    getVideoId,
    statusEl,
    contextMenu,
    requestRender,
    setZoom,
    setPlayhead: (t, opts) => {
      history.preview((s) => {
        s.playheadS = Math.max(0, t);
      });
      if (!opts?.fromVideo) {
        video.currentTime = history.get().playheadS;
      }
      requestRender();
    },
  });

  const ro = new ResizeObserver(() => requestRender());
  ro.observe(timelineRoot);

  requestRender();

  return {
    history,
    requestRender,
    setZoom,
    addTrack: () => {
      history.commit((s) => addTrack(s));
      requestRender();
      toast(statusEl, "Faixa adicionada.");
    },
  };
}
