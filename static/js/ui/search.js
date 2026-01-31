import { apiGet } from "../api/client.js";
import { el, qs, toast } from "../utils/dom.js";

function previewEndpointUrl(soundId, { quality = "lq", fmt = "mp3" } = {}) {
  const url = new URL(`/api/freesound/sounds/${encodeURIComponent(String(soundId))}/preview`, window.location.origin);
  url.searchParams.set("quality", quality);
  url.searchParams.set("fmt", fmt);
  try {
    const token = window.localStorage.getItem("audioEditor.freesound.token");
    if (token) url.searchParams.set("fs_token", token);
  } catch {}
  return url.toString();
}

export function createSearchPanel({ statusEl }) {
  const input = qs("#searchInput");
  const btn = qs("#searchBtn");
  const resultsRoot = qs("#searchResults");

  let lastQuery = "";
  let nextPage = 1;
  let canLoadMore = false;

  async function search({ append = false } = {}) {
    const q = input.value.trim();
    if (!q) return;
    if (!append || q !== lastQuery) {
      resultsRoot.textContent = "";
      nextPage = 1;
      lastQuery = q;
      canLoadMore = false;
    }

    if (append && !canLoadMore) return;
    toast(statusEl, "Buscando no Freesound…");

    try {
      const data = await apiGet("/api/freesound/search", { q, lang: "pt", page_size: 18, page: nextPage });
      canLoadMore = Boolean(data.next);
      nextPage += 1;
      toast(statusEl, `${data.count} resultados (mostrando ${Math.min(data.count, (nextPage - 1) * 18)}).`);
      renderResults(data.results || [], { append: true, showMore: canLoadMore });
    } catch (e) {
      toast(statusEl, `Erro: ${String(e.message || e)}`);
    }
  }

  function renderResults(items, { append, showMore }) {
    if (!append) resultsRoot.textContent = "";
    const moreOld = resultsRoot.querySelector("[data-role='showMore']");
    if (moreOld) moreOld.remove();

    for (const s of items) {
      const previewLqUrl = previewEndpointUrl(s.id, { quality: "lq", fmt: "mp3" });
      const previewHqUrl = previewEndpointUrl(s.id, { quality: "hq", fmt: "mp3" });

      const card = el("div", { class: "result" }, [
        el("div", { class: "resultTitle", text: s.name || `Sound ${s.id}` }),
        el("div", { class: "resultMeta" }, [
          el("div", { text: `⏱ ${Number(s.duration || 0).toFixed(2)}s` }),
          el("div", { text: `👤 ${s.username || "-"}` }),
        ]),
      ]);

      const row = el("div", { class: "resultRow" });
      const waveWrap = el("div", { class: "wave waveTall" });
      const embedUrl = `https://freesound.org/embed/sound/iframe/${encodeURIComponent(String(s.id))}/simple/medium/`;
      const iframe = el("iframe", { src: embedUrl, loading: "lazy", allow: "autoplay" });
      waveWrap.append(iframe);
      row.append(waveWrap);

      const dragBox = el("div", { class: "dragBox", draggable: "true" }, [el("div", { text: "Arrastar para a timeline" })]);
      dragBox.addEventListener("dragstart", (ev) => {
        const payload = {
          id: s.id,
          name: s.name,
          duration: s.duration,
          previewLqUrl,
          previewHqUrl,
          username: s.username,
          tags: s.tags || [],
        };
        ev.dataTransfer.setData("application/x-audio-editor-sound", JSON.stringify(payload));
        ev.dataTransfer.effectAllowed = "copy";
      });
      row.append(dragBox);
      card.append(row);

      resultsRoot.append(card);
    }

    if (showMore) {
      const more = el("button", { class: "btn", text: "Mostrar mais", "data-role": "showMore" });
      more.style.width = "100%";
      more.style.marginTop = "10px";
      more.addEventListener("click", () => search({ append: true }));
      resultsRoot.append(more);
    }
  }

  btn.addEventListener("click", () => search({ append: false }));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") search({ append: false });
  });

  return { search };
}
