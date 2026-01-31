import { decodeAudio } from "../utils/audio.js";
import { el, qs, toast } from "../utils/dom.js";

const LS = Object.freeze({
  token: "audioEditor.freesound.token",
  configs: "audioEditor.freesound.configs",
});

function defaultConfigs() {
  return [
    {
      name: "Lucas",
      clientId: "5lr2NsaiLZEP4rSZNMzz",
      clientSecret: "",
      redirectUrl: "https://freesound.org/apiv2/oauth2/authorize/",
    },
  ];
}

function loadConfigs() {
  try {
    const raw = window.localStorage.getItem(LS.configs);
    if (!raw) return defaultConfigs();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || !arr.length) return defaultConfigs();
    return arr;
  } catch {
    return defaultConfigs();
  }
}

function saveConfigs(cfgs) {
  window.localStorage.setItem(LS.configs, JSON.stringify(cfgs));
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function safeFilePart(s) {
  return String(s || "")
    .trim()
    .replace(/[^\w\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64) || "export";
}

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

function audioBufferToWavArrayBuffer(buffer, { scale = 1.0, numChannels = 2 } = {}) {
  const sr = buffer.sampleRate;
  const length = buffer.length;
  const channels = clamp(numChannels, 1, 2);
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const byteRate = sr * blockAlign;
  const dataSize = length * blockAlign;
  const headerSize = 44;
  const ab = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(ab);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  const ch0 = buffer.getChannelData(0);
  const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : ch0;
  let o = 44;
  for (let i = 0; i < length; i++) {
    const s0 = clamp(ch0[i] * scale, -1, 1);
    view.setInt16(o, s0 < 0 ? s0 * 0x8000 : s0 * 0x7fff, true);
    o += 2;
    if (channels === 2) {
      const s1 = clamp(ch1[i] * scale, -1, 1);
      view.setInt16(o, s1 < 0 ? s1 * 0x8000 : s1 * 0x7fff, true);
      o += 2;
    }
  }

  return ab;
}

function scheduleAutomation(param, points, startAt, duration, { minV, maxV }) {
  if (!points?.length) return;
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const t0 = startAt;
  param.cancelScheduledValues(t0);
  const first = sorted[0];
  param.setValueAtTime(clamp(first.v, minV, maxV), t0 + first.t * duration);
  for (let i = 1; i < sorted.length; i++) {
    const p = sorted[i];
    param.linearRampToValueAtTime(clamp(p.v, minV, maxV), t0 + p.t * duration);
  }
}

function applyFades(gainParam, startAt, duration, fadeInS, fadeOutS) {
  const fi = clamp(fadeInS || 0, 0, duration);
  const fo = clamp(fadeOutS || 0, 0, duration);
  if (fi > 0.001) {
    gainParam.setValueAtTime(0.0001, startAt);
    gainParam.linearRampToValueAtTime(1.0, startAt + fi);
  }
  if (fo > 0.001) {
    gainParam.setValueAtTime(1.0, startAt + duration - fo);
    gainParam.linearRampToValueAtTime(0.0001, startAt + duration);
  }
}

function projectDurationS(state) {
  let end = 0;
  for (const c of state.clips || []) end = Math.max(end, (c.startS || 0) + (c.durationS || 0));
  return Math.max(0.1, end);
}

async function renderOfflineBuffer({ state, onlyTrackId = null, sampleRate, channels, onProgress }) {
  const durationS = projectDurationS(state);
  const length = Math.ceil(durationS * sampleRate);
  const ctx = new OfflineAudioContext(channels, length, sampleRate);
  const cache = new Map();

  async function getBuffer(url) {
    if (!url) return null;
    if (cache.has(url)) return cache.get(url);
    const buf = await decodeAudio(url);
    cache.set(url, buf);
    return buf;
  }

  const clips = (state.clips || []).filter((clip) => {
    if (!clip.previewUrl) return false;
    if (onlyTrackId && clip.trackId !== onlyTrackId) return false;
    return true;
  });

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    if (!clip.previewUrl) continue;
    const track = (state.tracks || []).find((t) => t.id === clip.trackId);
    if (!track) continue;

    if (onProgress) onProgress({ phase: "decode", current: i + 1, total: clips.length, clipName: clip.name || "Clip" });
    const buf = await getBuffer(clip.previewUrl);
    if (!buf) continue;

    const clipStart = Math.max(0, Number(clip.startS || 0));
    if (clipStart >= durationS) continue;

    const trackGain = ctx.createGain();
    trackGain.gain.value = clamp(track.gain ?? 1.0, 0, 1);

    if (channels !== 1) {
      const trackPan = ctx.createStereoPanner();
      trackPan.pan.value = clamp(track.pan ?? 0.0, -1, 1);
      trackGain.connect(trackPan);
      trackPan.connect(ctx.destination);
    } else {
      trackGain.connect(ctx.destination);
    }

    const timeWarp = Array.isArray(clip.timeWarpSegments) && clip.timeWarpSegments.length ? clip.timeWarpSegments : null;
    const eps = 1e-3;

    const renderSegment = ({ segStartRel, segDur, srcOffAbs, segFadeInS, segFadeOutS }) => {
      const startAt = clipStart + segStartRel;
      if (startAt >= durationS) return;
      const srcOffset = Math.max(0, srcOffAbs);
      const dur = Math.max(0.001, Math.min(segDur, Number(buf.duration || 0) - srcOffset));

      const src = ctx.createBufferSource();
      src.buffer = buf;

      const clipGain = ctx.createGain();
      if (channels === 1) {
        src.connect(clipGain);
        clipGain.connect(trackGain);
      } else {
        const clipPan = ctx.createStereoPanner();
        src.connect(clipGain);
        clipGain.connect(clipPan);
        clipPan.connect(trackGain);
        scheduleAutomation(clipPan.pan, clip.panAutomation, startAt, dur, { minV: -1, maxV: 1 });
      }

      scheduleAutomation(clipGain.gain, clip.gainAutomation, startAt, dur, { minV: 0, maxV: 1.5 });
      applyFades(clipGain.gain, startAt, dur, segFadeInS, segFadeOutS);

      src.start(startAt, srcOffset, dur);
    };

    if (timeWarp) {
      for (let si = 0; si < timeWarp.length; si++) {
        const seg = timeWarp[si];
        const segStartRel = Math.max(0, Number(seg.startS || 0));
        const segDur = Math.max(0.001, Number(seg.durationS || 0));
        const srcOffAbs = Number(seg.sourceOffsetS || 0);
        const isFirst = segStartRel <= eps;
        const isLast = segStartRel + segDur >= Number(clip.durationS || 0) - eps;
        const segFadeInS = isFirst ? Number(clip.fadeInS || 0) : 0.005;
        const segFadeOutS = isLast ? Number(clip.fadeOutS || 0) : 0.005;
        renderSegment({ segStartRel, segDur, srcOffAbs, segFadeInS, segFadeOutS });
      }
    } else {
      renderSegment({
        segStartRel: 0,
        segDur: Math.max(0.001, Number(clip.durationS || 0)),
        srcOffAbs: Math.max(0, Number(clip.sourceOffsetS || 0)),
        segFadeInS: Number(clip.fadeInS || 0),
        segFadeOutS: Number(clip.fadeOutS || 0),
      });
    }
  }

  return ctx.startRendering();
}

async function postWavToMp3({ wavBlob, bitrateKbps }) {
  const fd = new FormData();
  const file = new File([wavBlob], "mixdown.wav", { type: "audio/wav" });
  fd.append("file", file, file.name);
  const url = `/api/export/mp3?bitrate_kbps=${encodeURIComponent(String(bitrateKbps))}`;
  const res = await fetch(url, { method: "POST", body: fd });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const data = await res.json();
      msg = data.detail || JSON.stringify(data);
    } catch {}
    throw new Error(msg);
  }
  return res.arrayBuffer();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function renderExportPanel({ root, statusEl, getState }) {
  root.textContent = "";

  const modeSel = el("select", { class: "select" }, [
    el("option", { value: "mixdown", text: "Tudo junto (mixdown)" }),
    el("option", { value: "stems", text: "Faixas separadas (stems)" }),
  ]);

  const fmtSel = el("select", { class: "select" }, [
    el("option", { value: "wav", text: "WAV (PCM 16-bit)" }),
    el("option", { value: "mp3", text: "MP3" }),
  ]);

  const bitrateSel = el("select", { class: "select" }, [
    el("option", { value: "64", text: "64 kbps" }),
    el("option", { value: "96", text: "96 kbps" }),
    el("option", { value: "128", text: "128 kbps" }),
    el("option", { value: "160", text: "160 kbps" }),
    el("option", { value: "192", text: "192 kbps" }),
    el("option", { value: "256", text: "256 kbps" }),
    el("option", { value: "320", text: "320 kbps" }),
  ]);
  bitrateSel.value = "192";

  const srSel = el("select", { class: "select" }, [
    el("option", { value: "44100", text: "44100 Hz" }),
    el("option", { value: "48000", text: "48000 Hz" }),
  ]);
  srSel.value = "44100";

  const chSel = el("select", { class: "select" }, [
    el("option", { value: "2", text: "Estéreo (2 canais)" }),
    el("option", { value: "1", text: "Mono (1 canal)" }),
  ]);
  chSel.value = "2";

  const normalize = el("input", { type: "checkbox" });
  normalize.checked = true;

  const btn = el("button", { class: "btn", text: "Exportar" });
  const small = el("div", { style: "margin-top: 8px; color: var(--muted); font-size: 12px;" });

  async function runExport() {
    const state = getState?.();
    if (!state) {
      toast(statusEl, "Erro: timeline não encontrada.");
      return;
    }
    if (!state.clips?.length) {
      toast(statusEl, "Nada para exportar (sem clips).");
      return;
    }

    const mode = modeSel.value;
    const fmt = fmtSel.value;
    const bitrateKbps = Number(bitrateSel.value);
    const sampleRate = Number(srSel.value);
    const channels = Number(chSel.value);

    btn.disabled = true;
    btn.textContent = "Exportando…";
    small.textContent = "";

    try {
      const project = safeFilePart("audio_editor");
      const durS = projectDurationS(state);
      small.textContent = `Renderizando ${durS.toFixed(2)}s…`;

      const targets = mode === "stems" ? (state.tracks || []).map((t) => ({ type: "track", track: t })) : [{ type: "mixdown" }];
      for (let i = 0; i < targets.length; i++) {
        const target = targets[i];
        if (target.type === "track") {
          const hasClips = (state.clips || []).some((c) => c.trackId === target.track.id && c.previewUrl);
          if (!hasClips) continue;
          small.textContent = `Renderizando stem ${i + 1}/${targets.length}…`;
        } else {
          small.textContent = "Renderizando mixdown…";
        }

        const rendered = await renderOfflineBuffer({
          state,
          onlyTrackId: target.type === "track" ? target.track.id : null,
          sampleRate,
          channels,
          onProgress: (p) => {
            if (p?.phase === "decode") small.textContent = `Decodificando áudio ${p.current}/${p.total}: ${p.clipName}`;
          },
        });

        let maxAbs = 0;
        small.textContent = "Normalizando…";
        for (let ch = 0; ch < rendered.numberOfChannels; ch++) {
          const data = rendered.getChannelData(ch);
          for (let k = 0; k < data.length; k++) maxAbs = Math.max(maxAbs, Math.abs(data[k]));
        }
        const scale = normalize.checked && maxAbs > 0 ? Math.min(1.0, 0.99 / maxAbs) : 1.0;

        const wavAb = audioBufferToWavArrayBuffer(rendered, { scale, numChannels: channels });
        const wavBlob = new Blob([wavAb], { type: "audio/wav" });

        const baseName = target.type === "track" ? `${project}_stem_${safeFilePart(target.track.name || "track")}` : `${project}_mixdown`;

        if (fmt === "wav") {
          downloadBlob(wavBlob, `${baseName}.wav`);
        } else {
          small.textContent = "Convertendo para MP3…";
          const mp3Ab = await postWavToMp3({ wavBlob, bitrateKbps });
          const mp3Blob = new Blob([mp3Ab], { type: "audio/mpeg" });
          downloadBlob(mp3Blob, `${baseName}_${bitrateKbps}kbps.mp3`);
        }
      }

      toast(statusEl, "Exportação concluída.");
      small.textContent = "Concluído.";
    } catch (e) {
      toast(statusEl, `Erro: ${String(e.message || e)}`);
      small.textContent = "";
    } finally {
      btn.disabled = false;
      btn.textContent = "Exportar";
    }
  }

  btn.addEventListener("click", runExport);
  fmtSel.addEventListener("change", () => {
    bitrateSel.disabled = fmtSel.value !== "mp3";
  });
  bitrateSel.disabled = fmtSel.value !== "mp3";

  root.append(
    el("div", { class: "exportGrid" }, [
      el("div", { class: "formLabel", text: "Modo" }),
      modeSel,
      el("div", { class: "formLabel", text: "Formato" }),
      fmtSel,
      el("div", { class: "formLabel", text: "Bitrate (MP3)" }),
      bitrateSel,
      el("div", { class: "formLabel", text: "Sample rate" }),
      srSel,
      el("div", { class: "formLabel", text: "Canais" }),
      chSel,
      el("div", { class: "formLabel", text: "Normalizar" }),
      el("div", {}, [normalize]),
    ]),
    el("div", { class: "actionsRow" }, [btn]),
    small,
  );
}

export function createSettingsModal({ statusEl, getState }) {
  const backdrop = qs("#modalBackdrop");
  const btnOpen = qs("#btnSettings");
  const btnClose = qs("#btnCloseModal");
  const btnAdd = qs("#btnAddCfgRow");
  const btnSave = qs("#btnSaveCfg");
  const tokenInput = qs("#cfgFreesoundToken");
  const table = qs("#cfgTable");
  const tbody = table.querySelector("tbody");
  const exportPanel = qs("#exportPanel");

  function open() {
    tokenInput.value = window.localStorage.getItem(LS.token) || "";
    renderTable(loadConfigs());
    backdrop.style.display = "flex";
    renderExportPanel({ root: exportPanel, statusEl, getState });
    let dbgPanel = qs("#syncDebugPanel");
    if (!dbgPanel) {
      const modalBodyEl = qs("#modalBackdrop .modalBody");
      dbgPanel = el("div", { id: "syncDebugPanel" });
      modalBodyEl.append(dbgPanel);
    }
    dbgPanel.textContent = "";
    const dbgTitle = el("div", { class: "modalSectionTitle", text: "Sincronização (Debug)" });
    const rowActive = el("div", { class: "formRow" }, [
      el("div", { class: "formLabel", text: "Modelos de Sincronia Ativos" }),
      el("div", { text: "Sim (detecção de movimento, transientes)" }),
    ]);
    const rowRepeat = el("div", { class: "formRow" }, [
      el("div", { class: "formLabel", text: "Repetição de cortes" }),
      el("input", { type: "checkbox", id: "syncRepeatClips", checked: true }),
    ]);
    const rowGradual = el("div", { class: "formRow" }, [
      el("div", { class: "formLabel", text: "Transição gradual (pulsantes)" }),
      el("input", { type: "checkbox", id: "syncGradualTransitions", checked: true }),
    ]);
    const ptTitle = el("div", { class: "modalSectionTitle", text: "Busca PT→Tags (Debug)" });
    const ptStatus = el("div", { id: "ptModelStatus", style: "color: var(--muted); font-size: 12px; margin: 6px 0 10px 0;", text: "Carregando status do modelo…" });
    const ptInput = el("input", { id: "ptModelTestInput", value: "passos na neve" });
    const ptBtn = el("button", { class: "btn", text: "Testar mapeamento" });
    const ptOut = el("textarea", { id: "ptModelLogs", style: "width: 100%; height: 110px; resize: none;", placeholder: "Saída do mapeamento aparecerá aqui…" });
    const ptRow = el("div", { class: "formRow" }, [el("div", { class: "formLabel", text: "Texto (PT)" }), ptInput]);
    const ptActions = el("div", { class: "actionsRow" }, [ptBtn]);

    async function refreshPtStatus() {
      try {
        const res = await fetch("/api/freesound/pt_mapper/status");
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const data = await res.json();
        const loaded = data?.model_loaded ? "sim" : "não";
        const tfOk = data?.transformers_ok ? "sim" : "não";
        const torchOk = data?.torch_ok ? "sim" : "não";
        const tokenOk = data?.hf_token_present ? "sim" : "não";
        ptStatus.textContent = `engine=${data?.engine || "-"} | model_loaded=${loaded} | transformers_ok=${tfOk} | torch_ok=${torchOk} | hf_token=${tokenOk}`;
      } catch (e) {
        ptStatus.textContent = `Falha ao ler status: ${String(e.message || e)}`;
      }
    }

    ptBtn.onclick = async () => {
      ptOut.value = "";
      try {
        const q = String(ptInput.value || "").trim();
        if (!q) return;
        const res = await fetch(`/api/freesound/pt_mapper/debug?q=${encodeURIComponent(q)}`);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const data = await res.json();
        ptOut.value = JSON.stringify(data, null, 2);
        await refreshPtStatus();
      } catch (e) {
        ptOut.value = `Erro: ${String(e.message || e)}`;
      }
    };

    dbgPanel.append(dbgTitle, rowActive, rowRepeat, rowGradual, ptTitle, ptStatus, ptRow, ptActions, ptOut);
    refreshPtStatus();
  }

  function close() {
    backdrop.style.display = "none";
  }

  function renderTable(cfgs) {
    tbody.textContent = "";
    for (let i = 0; i < cfgs.length; i++) {
      const cfg = cfgs[i];
      const row = el("tr", {}, [
        el("td", {}, [el("input", { value: cfg.name || "" })]),
        el("td", {}, [el("input", { value: cfg.clientId || "" })]),
        el("td", {}, [el("input", { value: cfg.clientSecret || "", type: "password", placeholder: "Opcional (não vem no código)" })]),
        el("td", {}, [el("input", { value: cfg.redirectUrl || "" })]),
        el("td", {}, [
          el("button", { class: "btn", text: "Remover", onclick: () => { cfgs.splice(i, 1); renderTable(cfgs); } }),
        ]),
      ]);
      tbody.append(row);
    }
    tbody.__cfgs = cfgs;
  }

  function collectConfigs() {
    const rows = Array.from(tbody.querySelectorAll("tr"));
    const cfgs = [];
    for (const r of rows) {
      const inputs = Array.from(r.querySelectorAll("input"));
      cfgs.push({
        name: inputs[0].value.trim(),
        clientId: inputs[1].value.trim(),
        clientSecret: inputs[2].value,
        redirectUrl: inputs[3].value.trim(),
      });
    }
    return cfgs;
  }

  btnOpen.addEventListener("click", open);
  btnClose.addEventListener("click", close);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && backdrop.style.display !== "none") close();
  });

  btnAdd.addEventListener("click", () => {
    const cfgs = tbody.__cfgs || loadConfigs();
    cfgs.push({ name: "", clientId: "", clientSecret: "", redirectUrl: "" });
    renderTable(cfgs);
  });

  btnSave.addEventListener("click", () => {
    const token = tokenInput.value.trim();
    if (token) window.localStorage.setItem(LS.token, token);
    else window.localStorage.removeItem(LS.token);

    const cfgs = collectConfigs();
    saveConfigs(cfgs);
    toast(statusEl, "Configurações salvas no navegador.");
    close();
  });

  return { open, close };
}
