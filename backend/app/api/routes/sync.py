from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi import UploadFile

from ...core.config import settings
from ...schemas.sync import (
    MotionAnalyzeRequest,
    MotionAnalyzeResponse,
    VideoUploadResponse,
)
from ...services.video_motion import analyze_motion_events
from ...storage.temp_files import TempFileStore


router = APIRouter()
_store = TempFileStore(settings.temp_dir)


@router.post("/video/upload", response_model=VideoUploadResponse)
async def upload_video(file: UploadFile) -> VideoUploadResponse:
    content = await file.read()
    stored = _store.put(filename=file.filename or "video.mp4", content=content)
    return VideoUploadResponse(
        video_id=stored.file_id,
        filename=stored.filename,
        size_bytes=stored.size_bytes,
    )


@router.post("/motion", response_model=MotionAnalyzeResponse)
async def motion(req: MotionAnalyzeRequest) -> MotionAnalyzeResponse:
    stored = _store.get(req.video_id)
    if not stored:
        raise HTTPException(status_code=404, detail="Vídeo não encontrado. Reimporte.")

    try:
        events = analyze_motion_events(
            video_path=stored.path,
            start_s=req.start_s,
            duration_s=req.duration_s,
            max_events=req.max_events,
            frame_analysis=req.frame_analysis,
            model=req.model,
            smooth_win=req.smooth_win,
            blur_ksize=req.blur_ksize,
            roi_x=req.roi_x,
            roi_y=req.roi_y,
            roi_w=req.roi_w,
            roi_h=req.roi_h,
        )
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(e)) from e

    return MotionAnalyzeResponse(
        events=[{"t_s": ev.t_s, "score": ev.score} for ev in events],
    )
