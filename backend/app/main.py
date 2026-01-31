from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from .api.router import api_router
from .core.config import settings
from .core.logging import configure_logging


configure_logging()

app = FastAPI(title=settings.app_name)
app.include_router(api_router, prefix="/api")

_STATIC_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "static")
)

if os.path.isdir(_STATIC_DIR):
    app.mount("/static", StaticFiles(directory=_STATIC_DIR), name="static")


@app.get("/")
async def root() -> FileResponse:
    return FileResponse(os.path.join(_STATIC_DIR, "index.html"))


@app.get("/favicon.ico")
async def favicon() -> Response:
    return Response(status_code=204)
