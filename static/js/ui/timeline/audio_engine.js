import { getAudioContext, decodeAudio } from "../../utils/audio.js";

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function scheduleAutomation(param, points, startAt, duration, { minV, maxV }) {
  if (!points?.length) {
    param.setValueAtTime(clamp(1, minV, maxV), startAt);
    return;
  }

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

export function createAudioEngine({ statusEl }) {
  const ctx = getAudioContext();
  const cache = new Map();
  let playing = false;
  let sources = [];
  let playToken = 0;

  async function getBuffer(url) {
    if (!url) return null;
    const v = cache.get(url);
    if (v) return v instanceof Promise ? await v : v;
    const p = decodeAudio(url)
      .then((buf) => {
        cache.set(url, buf);
        return buf;
      })
      .catch((e) => {
        cache.delete(url);
        throw e;
      });
    cache.set(url, p);
    return await p;
  }

  function stopAll() {
    playToken += 1;
    for (const s of sources) {
      try {
        s.src.stop();
      } catch {}
    }
    sources = [];
    playing = false;
  }

  async function playFrom({ state, videoTimeS }) {
    stopAll();
    if (ctx.state === "suspended") await ctx.resume();
    const baseNow = ctx.currentTime;
    const baseVideoTime = videoTimeS;
    const token = playToken;

    const candidates = [];
    for (const clip of state.clips) {
      if (!clip.previewUrl) continue;
      const clipEnd = clip.startS + clip.durationS;
      if (baseVideoTime > clipEnd) continue;
      candidates.push(clip);
    }

    await Promise.allSettled(
      candidates.map(async (clip) => {
        const buf = await getBuffer(clip.previewUrl);
        if (!buf) return;
        if (token !== playToken) return;

        const elapsed = ctx.currentTime - baseNow;
        const videoT = baseVideoTime + elapsed;
        const clipStart = clip.startS;
        const clipEnd = clip.startS + clip.durationS;
        if (videoT > clipEnd) return;

        const track = state.tracks.find((t) => t.id === clip.trackId);
        if (!track) return;

        const timeWarp = Array.isArray(clip.timeWarpSegments) && clip.timeWarpSegments.length ? clip.timeWarpSegments : null;
        const eps = 1e-3;

        const playSegment = ({ segStartRel, segDur, srcOffAbs, segFadeInS, segFadeOutS }) => {
          const segStartAbs = clipStart + segStartRel;
          const segEndAbs = segStartAbs + segDur;
          if (videoT > segEndAbs) return;

          const startAt = ctx.currentTime + Math.max(0, segStartAbs - videoT);
          const offsetLocal = Math.max(0, videoT - segStartAbs);
          const sourceOffset = Math.max(0, srcOffAbs) + offsetLocal;
          const remainingClip = Math.max(0.001, segDur - offsetLocal);
          const remainingBuffer = Math.max(0.001, buf.duration - sourceOffset);
          const maxPlayable = Math.max(0.001, Math.min(remainingClip, remainingBuffer));

          const src = ctx.createBufferSource();
          src.buffer = buf;

          const clipGain = ctx.createGain();
          const clipPan = ctx.createStereoPanner();

          const trackGain = ctx.createGain();
          const trackPan = ctx.createStereoPanner();

          trackGain.gain.value = clamp(track.gain ?? 1.0, 0, 1);
          trackPan.pan.value = clamp(track.pan ?? 0.0, -1, 1);

          src.connect(clipGain);
          clipGain.connect(clipPan);
          clipPan.connect(trackGain);
          trackGain.connect(trackPan);
          trackPan.connect(ctx.destination);

          scheduleAutomation(clipGain.gain, clip.gainAutomation, startAt, maxPlayable, { minV: 0, maxV: 1.5 });
          scheduleAutomation(clipPan.pan, clip.panAutomation, startAt, maxPlayable, { minV: -1, maxV: 1 });
          scheduleAutomation(src.playbackRate, clip.rateAutomation, startAt, maxPlayable, { minV: 0.5, maxV: 2 });
          applyFades(clipGain.gain, startAt, maxPlayable, segFadeInS, segFadeOutS);

          src.start(startAt, sourceOffset, maxPlayable);
          sources.push({ src });
        };

        if (timeWarp) {
          for (let i = 0; i < timeWarp.length; i++) {
            const seg = timeWarp[i];
            const segStartRel = Math.max(0, Number(seg.startS || 0));
            const segDur = Math.max(0.001, Number(seg.durationS || 0));
            const srcOffAbs = Number(seg.sourceOffsetS || 0);
            const isFirst = segStartRel <= eps;
            const isLast = segStartRel + segDur >= Number(clip.durationS || 0) - eps;
            const segFadeInS = isFirst ? Number(clip.fadeInS || 0) : 0.005;
            const segFadeOutS = isLast ? Number(clip.fadeOutS || 0) : 0.005;
            playSegment({ segStartRel, segDur, srcOffAbs, segFadeInS, segFadeOutS });
          }
          return;
        }

        playSegment({
          segStartRel: 0,
          segDur: Math.max(0.001, Number(clip.durationS || 0)),
          srcOffAbs: Math.max(0, Number(clip.sourceOffsetS || 0)),
          segFadeInS: Number(clip.fadeInS || 0),
          segFadeOutS: Number(clip.fadeOutS || 0),
        });
      }),
    );

    playing = true;
    if (statusEl) statusEl.textContent = "Tocando.";
  }

  function prefetch(url) {
    return getBuffer(url).catch(() => null);
  }

  function isPlaying() {
    return playing;
  }

  return { playFrom, stopAll, isPlaying, prefetch };
}
