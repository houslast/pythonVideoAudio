from __future__ import annotations

from pydantic import BaseModel, Field


class VideoUploadResponse(BaseModel):
    video_id: str
    filename: str
    size_bytes: int


class MotionAnalyzeRequest(BaseModel):
    video_id: str
    start_s: float = Field(ge=0.0, default=0.0)
    duration_s: float | None = Field(ge=0.0, default=None)
    max_events: int = Field(ge=1, le=50, default=12)
    frame_analysis: bool = True
    model: str = "default"
    smooth_win: int = Field(ge=1, le=99, default=5)
    blur_ksize: int = Field(ge=1, le=99, default=7)
    roi_x: float = Field(ge=0.0, le=1.0, default=0.10)
    roi_y: float = Field(ge=0.0, le=1.0, default=0.55)
    roi_w: float = Field(ge=0.0, le=1.0, default=0.80)
    roi_h: float = Field(ge=0.0, le=1.0, default=0.43)


class MotionEvent(BaseModel):
    t_s: float
    score: float


class MotionAnalyzeResponse(BaseModel):
    events: list[MotionEvent]
