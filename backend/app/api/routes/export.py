from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, UploadFile
from fastapi.responses import Response

from ...services.audio_encode import encode_wav_to_mp3


router = APIRouter()


@router.post("/mp3")
async def export_mp3(
    file: UploadFile,
    bitrate_kbps: int = Query(192, ge=32, le=320),
) -> Response:
    try:
        wav_bytes = await file.read()
        mp3 = encode_wav_to_mp3(wav_bytes, bitrate_kbps=bitrate_kbps)
        return Response(content=mp3, media_type="audio/mpeg")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(e)) from e

