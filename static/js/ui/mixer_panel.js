import { el } from "../utils/dom.js";
import { setTrackGain, setTrackPan } from "./timeline/state.js";

export function renderMixerPanel({ root, history, requestRender }) {
  root.textContent = "";
  const st = history.get();

  for (const tr of st.tracks) {
    let baseState = null;
    const wrap = el("div", { class: "mixerTrack" });
    const left = el("div", {}, [
      el("div", { class: "mixerName", text: tr.name }),
      el("div", { style: "color: var(--muted); font-size: 12px;", text: `Clipes: ${st.clips.filter((c) => c.trackId === tr.id).length}` }),
    ]);
    const controls = el("div", { class: "mixerControls" });

    const gain = el("input", { class: "slider", type: "range", min: "0", max: "1", step: "0.01", value: String(tr.gain ?? 0.9) });
    const pan = el("input", { class: "slider", type: "range", min: "-1", max: "1", step: "0.01", value: String(tr.pan ?? 0) });

    const begin = () => {
      if (!baseState) baseState = JSON.parse(JSON.stringify(history.get()));
    };

    gain.addEventListener("pointerdown", begin);
    gain.addEventListener("input", () => {
      history.preview((s) => setTrackGain(s, tr.id, Number(gain.value)));
      requestRender();
    });
    gain.addEventListener("change", () => {
      if (baseState) history.finalizePreview(baseState);
      baseState = null;
      requestRender();
    });

    pan.addEventListener("pointerdown", begin);
    pan.addEventListener("input", () => {
      history.preview((s) => setTrackPan(s, tr.id, Number(pan.value)));
      requestRender();
    });
    pan.addEventListener("change", () => {
      if (baseState) history.finalizePreview(baseState);
      baseState = null;
      requestRender();
    });

    controls.append(
      el("div", { style: "color: var(--muted); font-size: 12px;", text: "Ganho" }),
      gain,
      el("div", { style: "color: var(--muted); font-size: 12px;", text: "Pan" }),
      pan,
    );

    wrap.append(left, controls);
    root.append(wrap);
  }
}
