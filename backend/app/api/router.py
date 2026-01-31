from __future__ import annotations

from fastapi import APIRouter

from .routes import export, freesound, sync


api_router = APIRouter()
api_router.include_router(freesound.router, prefix="/freesound", tags=["freesound"])
api_router.include_router(sync.router, prefix="/sync", tags=["sync"])
api_router.include_router(export.router, prefix="/export", tags=["export"])
