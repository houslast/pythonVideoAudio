let _ctx;

export function getAudioContext() {
  if (_ctx) return _ctx;
  _ctx = new (window.AudioContext || window.webkitAudioContext)();
  return _ctx;
}

export async function fetchArrayBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.arrayBuffer();
}

export async function decodeAudio(url) {
  const ctx = getAudioContext();
  const ab = await fetchArrayBuffer(url);
  return ctx.decodeAudioData(ab);
}

export function drawWaveform(canvas, audioBuffer, color = "rgba(93,214,255,0.9)") {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(canvas.clientWidth * dpr);
  canvas.height = Math.floor(canvas.clientHeight * dpr);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const data = audioBuffer.getChannelData(0);
  const step = Math.max(1, Math.floor(data.length / canvas.width));
  const mid = canvas.height / 2;
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1 * dpr;
  ctx.beginPath();
  for (let x = 0; x < canvas.width; x++) {
    const i0 = x * step;
    let min = 1, max = -1;
    for (let i = i0; i < i0 + step && i < data.length; i++) {
      const v = data[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    ctx.moveTo(x, mid + min * mid);
    ctx.lineTo(x, mid + max * mid);
  }
  ctx.stroke();
}

export function detectTransientTimes(audioBuffer, maxEvents = 12) {
  const data = audioBuffer.getChannelData(0);
  const sr = audioBuffer.sampleRate;
  const win = Math.floor(sr * 0.01);
  const hop = Math.floor(win / 2);
  const env = [];
  for (let i = 0; i + win < data.length; i += hop) {
    let sum = 0;
    for (let j = 0; j < win; j++) sum += Math.abs(data[i + j]);
    env.push(sum / win);
  }
  const smooth = [];
  const k = 6;
  for (let i = 0; i < env.length; i++) {
    let s = 0;
    for (let j = -k; j <= k; j++) s += env[Math.min(env.length - 1, Math.max(0, i + j))];
    smooth.push(s / (2 * k + 1));
  }
  const peaks = [];
  for (let i = 2; i < smooth.length - 2; i++) {
    if (smooth[i] > smooth[i - 1] && smooth[i] > smooth[i + 1]) peaks.push({ i, v: smooth[i] });
  }
  peaks.sort((a, b) => b.v - a.v);
  const picked = [];
  const minDist = Math.max(3, Math.floor(smooth.length * 0.02));
  for (const p of peaks) {
    if (picked.every((q) => Math.abs(q.i - p.i) >= minDist)) picked.push(p);
    if (picked.length >= maxEvents) break;
  }
  picked.sort((a, b) => a.i - b.i);
  return picked.map((p) => (p.i * hop) / sr);
}

