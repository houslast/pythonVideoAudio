from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class FreesoundPreview(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    preview_hq_mp3: str | None = Field(default=None, alias="preview_hq_mp3")
    preview_lq_mp3: str | None = Field(default=None, alias="preview_lq_mp3")
    preview_hq_ogg: str | None = Field(default=None, alias="preview_hq_ogg")
    preview_lq_ogg: str | None = Field(default=None, alias="preview_lq_ogg")


class FreesoundSound(BaseModel):
    id: int
    name: str
    username: str | None = None
    duration: float | None = None
    tags: list[str] = []
    license: str | None = None
    url: str | None = None
    previews: FreesoundPreview | None = None


class FreesoundSearchResponse(BaseModel):
    count: int
    next: str | None = None
    previous: str | None = None
    results: list[FreesoundSound] = []
