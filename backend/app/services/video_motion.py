from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


@dataclass(frozen=True)
class MotionEvent:
    t_s: float
    score: float


def _peak_pick(values: list[float], max_events: int) -> list[int]:
    if not values:
        return []
    idxs = np.argsort(values)[::-1].tolist()
    picked: list[int] = []
    min_dist = max(3, int(len(values) * 0.02))
    for i in idxs:
        if values[i] <= 0:
            break
        if all(abs(i - p) >= min_dist for p in picked):
            picked.append(i)
            if len(picked) >= max_events:
                break
    return sorted(picked)


def analyze_motion_events(
    video_path: str,
    start_s: float,
    duration_s: float | None,
    max_events: int,
    *,
    frame_analysis: bool = True,
    model: str = "default",
    smooth_win: int = 5,
    blur_ksize: int = 7,
    roi_x: float = 0.10,
    roi_y: float = 0.55,
    roi_w: float = 0.80,
    roi_h: float = 0.43,
) -> list[MotionEvent]:
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError("Não foi possível abrir o vídeo.")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    start_frame = int(start_s * fps)
    end_frame = total_frames
    if duration_s is not None:
        end_frame = min(total_frames, int((start_s + duration_s) * fps))

    cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)

    prev_gray: np.ndarray | None = None
    scores: list[float] = []
    frame_times: list[float] = []
    flow_scores: list[float] = []
    cell_scores: list[float] = []

    frame_idx = start_frame
    while frame_idx < end_frame:
        ok, frame = cap.read()
        if not ok:
            break

        h, w = frame.shape[:2]
        rx = max(0.0, min(1.0, roi_x))
        ry = max(0.0, min(1.0, roi_y))
        rw = max(0.0, min(1.0, roi_w))
        rh = max(0.0, min(1.0, roi_h))
        x0 = int(w * rx)
        y0 = int(h * ry)
        x1 = int(w * min(1.0, rx + rw))
        y1 = int(h * min(1.0, ry + rh))
        roi = frame[y0:y1, x0:x1]
        gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        k = max(1, int(blur_ksize))
        if k % 2 == 0:
            k += 1
        if frame_analysis:
            gray = cv2.GaussianBlur(gray, (k, k), 0)

        if prev_gray is not None:
            diff = cv2.absdiff(gray, prev_gray)
            score = float(np.mean(diff))
            scores.append(score)
            frame_times.append((frame_idx - start_frame) / fps)
            if frame_analysis:
                flow = cv2.calcOpticalFlowFarneback(prev_gray, gray, None, 0.5, 3, 15, 3, 5, 1.2, 0)
                mag, _ang = cv2.cartToPolar(flow[..., 0], flow[..., 1])
                flow_scores.append(float(np.mean(mag)))
                gh, gw = gray.shape[:2]
                grid_h, grid_w = 3, 3
                ch = gh // grid_h
                cw = gw // grid_w
                cells = []
                for gy in range(grid_h):
                    for gx in range(grid_w):
                        y0c = gy * ch
                        x0c = gx * cw
                        y1c = min(gh, (gy + 1) * ch)
                        x1c = min(gw, (gx + 1) * cw)
                        cells.append(float(np.mean(mag[y0c:y1c, x0c:x1c])))
                cell_scores.append(float(np.max(cells)))

        prev_gray = gray
        frame_idx += 1

    cap.release()

    if not scores:
        return []

    arr_a = np.array(scores, dtype=np.float32)
    arr_b = np.array(flow_scores if flow_scores else scores, dtype=np.float32)
    arr_c = np.array(cell_scores if cell_scores else scores, dtype=np.float32)
    def _norm(x: np.ndarray) -> np.ndarray:
        mn = float(np.min(x))
        rg = float(np.ptp(x))
        return (x - mn) / (rg + 1e-6)
    a = _norm(arr_a)
    b = _norm(arr_b)
    c = _norm(arr_c)
    comb = (0.5 * a + 0.3 * b + 0.2 * c)
    win = max(1, int(smooth_win))
    if model == "high":
        win = max(win, 7)
    elif model == "fast":
        win = max(1, min(win, 3))
    if win % 2 == 0:
        win += 1
    kernel = np.ones(win, dtype=np.float32) / float(win)
    smooth = np.convolve(comb, kernel, mode="same").tolist()
    onset = np.convolve(a, [1, -1], mode="same")
    if onset.size:
        i0 = int(np.argmax(onset))
        if 0 <= i0 < len(smooth):
            smooth[i0] = max(smooth[i0], float(a[i0]) + 0.5)

    md = max(3, int(len(smooth) * 0.02))
    if model == "high":
        md = max(2, int(len(smooth) * 0.015))
    elif model == "fast":
        md = max(4, int(len(smooth) * 0.03))
    def _pick(values: list[float], k: int) -> list[int]:
        if not values:
            return []
        idxs = np.argsort(values)[::-1].tolist()
        picked: list[int] = []
        for i in idxs:
            if values[i] <= 0:
                break
            if all(abs(i - p) >= md for p in picked):
                picked.append(i)
                if len(picked) >= k:
                    break
        return sorted(picked)
    picked = _pick(smooth, max_events)
    events: list[MotionEvent] = []
    for i in picked:
        events.append(MotionEvent(t_s=float(frame_times[i]), score=float(smooth[i])))

    return events
