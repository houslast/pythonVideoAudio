import { el, qs } from "./utils/dom.js";
import { createSearchPanel } from "./ui/search.js";
import { createVideoController } from "./ui/video.js";
import { createTimeline } from "./ui/timeline/timeline.js";
import { renderMixerPanel } from "./ui/mixer_panel.js";
import { setTransitionS } from "./ui/timeline/state.js";
import { createSettingsModal } from "./ui/settings.js";

function renderMixPanel({ root, history, requestRender }) {
  root.textContent = "";
  const st = history.get();
  const transitionS = Math.max(0, Number(st?.mix?.transitionS || 0));

  const title = el("div", { style: "color: var(--text); font-weight: 600; margin-bottom: 10px;", text: "Mixagem" });

  const valueEl = el("div", { style: "color: var(--muted); font-size: 12px; margin-top: 6px;", text: `Tempo de transição: ${transitionS.toFixed(2)}s` });
  const slider = el("input", { class: "slider", type: "range", min: "0", max: "2", step: "0.01", value: String(transitionS) });

  let baseState = null;
  const begin = () => {
    if (!baseState) baseState = JSON.parse(JSON.stringify(history.get()));
  };
  slider.addEventListener("pointerdown", begin);
  slider.addEventListener("input", () => {
    const v = Math.max(0, Number(slider.value || 0));
    history.preview((s) => setTransitionS(s, v));
    valueEl.textContent = `Tempo de transição: ${v.toFixed(2)}s`;
    requestRender();
  });
  slider.addEventListener("change", () => {
    if (baseState) history.finalizePreview(baseState);
    baseState = null;
    requestRender();
  });

  const row = el("div", { class: "formRow" }, [
    el("div", { class: "formLabel", text: "Tempo entre transição (crossfade)" }),
    slider,
  ]);

  const info = el("div", { style: "color: var(--muted); font-size: 12px; line-height: 1.6; margin-top: 10px;" });
  info.innerHTML = `
    <div>Quando dois clipes se sobrepõem até esse tempo, o volume do anterior cai e o do próximo sobe gradualmente.</div>
    <div>G: automação de ganho · P: automação de pan.</div>
    <div>Duplo clique no clipe: cria ponto de automação.</div>
    <div>Clique direito no clipe: sincronizar por movimento.</div>
  `;

  const selId = st?.selection?.clipId;
  if (selId) {
    const c = st.clips.find((x) => x.id === selId);
    if (c) {
      const sameTrack = st.clips.filter((x) => x.trackId === c.trackId && x.id !== c.id);
      let bestOv = 0;
      for (const o of sameTrack) {
        const ov = Math.min(c.startS + c.durationS, o.startS + o.durationS) - Math.max(c.startS, o.startS);
        if (ov > bestOv) bestOv = ov;
      }
      const ovLine = el("div", { style: "color: var(--muted); font-size: 12px; margin-top: 10px;", text: `Sobreposição atual (clipe selecionado): ${Math.max(0, bestOv).toFixed(2)}s` });
      root.append(title, row, valueEl, info, ovLine);
      return;
    }
  }

  root.append(title, row, valueEl, info);
}

function initTabs({ rightBody, timeline }) {
  const tabs = Array.from(document.querySelectorAll(".tab"));

  function setTab(name) {
    for (const t of tabs) t.classList.toggle("active", t.dataset.tab === name);
    rightBody.textContent = "";
    if (name === "mixer") {
      renderMixerPanel({ root: rightBody, history: timeline.history, requestRender: timeline.requestRender });
    } else {
      renderMixPanel({ root: rightBody, history: timeline.history, requestRender: timeline.requestRender });
    }
  }

  for (const t of tabs) t.addEventListener("click", () => setTab(t.dataset.tab));
  setTab("mix");
}

async function main() {
  const statusEl = qs("#status");
  const timeEl = qs("#timeReadout");
  const rightBody = qs("#rightPanelBody");
  const zoom = qs("#zoom");
  const timelineRoot = qs("#timelineRoot");
  const btnAddTrack = qs("#btnAddTrack");
  const btnPlayPause = qs("#btnPlayPause");

  const videoCtl = createVideoController({ statusEl });

  const timeline = createTimeline({
    timelineRoot,
    statusEl,
    timeEl,
    video: videoCtl.getVideoEl(),
    getVideoId: videoCtl.getVideoId,
  });

  createSearchPanel({ statusEl });

  initTabs({ rightBody, timeline });

  createSettingsModal({
    statusEl,
    getState: () => timeline.history.get(),
  });

  zoom.addEventListener("input", () => {
    timeline.setZoom(Number(zoom.value));
  });

  timelineRoot.addEventListener("timelinezoom", (ev) => {
    zoom.value = String(Math.round(ev.detail));
  });

  btnAddTrack.addEventListener("click", () => {
    timeline.addTrack();
    renderMixerPanel({ root: rightBody, history: timeline.history, requestRender: timeline.requestRender });
  });

  btnPlayPause.addEventListener("click", () => {
    const v = videoCtl.getVideoEl();
    if (v.paused) {
      const p = v.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    }
    else v.pause();
  });
}

main();
