from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.responses import Response

from ...schemas.freesound import FreesoundSearchResponse
from ...services.freesound_client import FreesoundClient
from ...services.query_ai_mapper import map_pt_to_freesound_ai, model_status
from ...services.query_mapper import map_pt_to_freesound


router = APIRouter()


@router.get("/search", response_model=FreesoundSearchResponse)
async def search(
    q: str = Query(..., min_length=1),
    lang: str = Query("pt"),
    page_size: int = Query(15, ge=1, le=50),
    page: int = Query(1, ge=1, le=100),
    x_freesound_token: str | None = Header(default=None),
) -> FreesoundSearchResponse:
    client = FreesoundClient()
    try:
        if lang.lower().startswith("pt"):
            mapped_ai = map_pt_to_freesound_ai(q)
            mapped = map_pt_to_freesound(q)
            tags = list(dict.fromkeys([*(mapped_ai.tags or []), *(mapped.tags or [])]))[:8]
            return await client.search_text(
                query=(mapped_ai.query or mapped.query or q),
                tags=tags or None,
                page_size=page_size,
                page=page,
                token=x_freesound_token,
            )
        return await client.search_text(
            query=q,
            tags=None,
            page_size=page_size,
            page=page,
            token=x_freesound_token,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/pt_mapper/status")
async def pt_mapper_status() -> dict:
    return model_status()


@router.get("/pt_mapper/debug")
async def pt_mapper_debug(q: str = Query(..., min_length=1)) -> dict:
    mapped = map_pt_to_freesound_ai(q)
    return {
        "input": q,
        "query": mapped.query,
        "tags": mapped.tags,
        "score": mapped.score,
        "debug": mapped.debug,
    }


@router.get("/sounds/{sound_id}/preview")
async def preview(
    sound_id: int,
    quality: str = Query("lq"),
    fmt: str = Query("mp3"),
    fs_token: str | None = Query(default=None),
    x_freesound_token: str | None = Header(default=None),
) -> Response:
    client = FreesoundClient()
    try:
        resolved = (x_freesound_token or "").strip() or (fs_token or "").strip() or None
        data, media_type = await client.fetch_preview_bytes(
            sound_id,
            quality=quality,
            fmt=fmt,
            token=resolved,
        )
        return Response(content=data, media_type=media_type)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
