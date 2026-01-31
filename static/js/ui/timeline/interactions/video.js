export function bindVideoPlayback({ history, audioEngine, video, setPlayhead, requestRender }) {
  function syncPlayheadFromVideo() {
    setPlayhead(video.currentTime, { fromVideo: true });
    requestRender();
  }

  video.addEventListener("timeupdate", syncPlayheadFromVideo);
  video.addEventListener("seeked", () => {
    syncPlayheadFromVideo();
    if (audioEngine.isPlaying() && !video.paused) {
      audioEngine.playFrom({ state: history.get(), videoTimeS: video.currentTime });
    }
  });
  video.addEventListener("play", () => {
    audioEngine.playFrom({ state: history.get(), videoTimeS: video.currentTime });
  });
  video.addEventListener("pause", () => {
    audioEngine.stopAll();
  });
}

