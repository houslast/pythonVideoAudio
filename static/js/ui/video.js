import { qs, toast } from "../utils/dom.js";
import { apiPostFile } from "../api/client.js";

export function createVideoController({ statusEl }) {
  const video = qs("#video");
  const picker = qs("#videoPicker");
  const meta = qs("#videoMeta");

  let videoId = null;
  let objectUrl = null;

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    const file = files[0] || null;
    if (!file) {
      toast(statusEl, "Erro: nenhum vídeo encontrado na seleção.");
      return;
    }

    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);
    video.src = objectUrl;
    meta.textContent = `${file.name} · ${(file.size / (1024 * 1024)).toFixed(1)} MB`;

    try {
      toast(statusEl, "Enviando vídeo para sincronização…");
      const data = await apiPostFile("/api/sync/video/upload", file, "file");
      videoId = data.video_id;
      toast(statusEl, "Vídeo pronto.");
    } catch (e) {
      videoId = null;
      toast(statusEl, `Erro ao enviar vídeo: ${String(e.message || e)}`);
    }
  }

  picker.addEventListener("change", async (ev) => {
    await handleFiles(ev.target.files);
  });

  function getVideoEl() {
    return video;
  }

  function getVideoId() {
    return videoId;
  }

  return { getVideoEl, getVideoId };
}
