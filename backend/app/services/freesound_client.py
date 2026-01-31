from __future__ import annotations

import logging

import httpx

from ..core.config import settings
from ..schemas.freesound import FreesoundSearchResponse, FreesoundSound
from ..utils.http import create_async_client


logger = logging.getLogger(__name__)

def _normalize_previews(d: dict | None) -> dict | None:
    if not isinstance(d, dict):
        return d
    m: dict = {}
    for k, v in d.items():
        nk = k.replace("-", "_")
        m[nk] = v
    return m

def _model_validate(cls, data):
    fn = getattr(cls, "model_validate", None)
    if callable(fn):
        return fn(data)
    return cls.parse_obj(data)

class FreesoundClient:
    def __init__(self, http_client: httpx.AsyncClient | None = None) -> None:
        self._http = http_client or create_async_client()

    async def search_text(
        self,
        query: str,
        tags: list[str] | None = None,
        page_size: int = 15,
        page: int = 1,
        token: str | None = None,
    ) -> FreesoundSearchResponse:
        resolved_token = (token or "").strip() or settings.freesound_token
        if not resolved_token:
            raise RuntimeError("FREESOUND_TOKEN não configurado.")

        base_url = "https://freesound.org/apiv2/search/text/"
        fields = (
            "id,name,username,duration,tags,license,url,previews"
        )
        params: dict[str, str | int] = {
            "query": query,
            "page_size": page_size,
            "page": page,
            "fields": fields,
            "token": resolved_token,
        }
        if tags:
            params["filter"] = " ".join([f"tag:{t}" for t in tags[:8]])

        resp = await self._http.get(base_url, params=params)
        resp.raise_for_status()
        data = resp.json()
        try:
            results = data.get("results") or []
            for i in range(len(results)):
                p = results[i].get("previews")
                if p is not None:
                    results[i]["previews"] = _normalize_previews(p)
        except Exception:
            pass
        return _model_validate(FreesoundSearchResponse, data)

    async def get_sound(self, sound_id: int, token: str | None = None) -> FreesoundSound:
        resolved_token = (token or "").strip() or settings.freesound_token
        if not resolved_token:
            raise RuntimeError("FREESOUND_TOKEN não configurado.")

        url = f"https://freesound.org/apiv2/sounds/{int(sound_id)}/"
        fields = "id,name,username,duration,tags,license,url,previews"
        resp = await self._http.get(url, params={"fields": fields, "token": resolved_token})
        resp.raise_for_status()
        data = resp.json()
        try:
            p = data.get("previews")
            if p is not None:
                data["previews"] = _normalize_previews(p)
        except Exception:
            pass
        return _model_validate(FreesoundSound, data)

    async def fetch_preview_bytes(
        self,
        sound_id: int,
        *,
        quality: str,
        fmt: str,
        token: str | None = None,
    ) -> tuple[bytes, str]:
        sound = await self.get_sound(sound_id, token=token)
        previews = sound.previews
        if not previews:
            raise RuntimeError("Preview não disponível para este som.")

        q = (quality or "lq").strip().lower()
        f = (fmt or "mp3").strip().lower()
        if q not in {"lq", "hq"}:
            raise RuntimeError("quality inválido (use lq/hq).")
        if f not in {"mp3", "ogg"}:
            raise RuntimeError("fmt inválido (use mp3/ogg).")

        key = f"preview_{q}_{f}"
        preview_url = getattr(previews, key, None)
        if not preview_url:
            fallback_key = f"preview_{'hq' if q == 'lq' else 'lq'}_{f}"
            preview_url = getattr(previews, fallback_key, None)
        if not preview_url and f == "mp3":
            preview_url = getattr(previews, f"preview_{q}_ogg", None) or getattr(
                previews, f"preview_{'hq' if q == 'lq' else 'lq'}_ogg", None
            )
            f = "ogg" if preview_url else f

        if not preview_url:
            raise RuntimeError("Preview não disponível no formato solicitado.")

        try:
            resp = await self._http.get(preview_url)
            resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            status = e.response.status_code if e.response is not None else 0
            if status in (401, 403):
                raise RuntimeError("Token do Freesound inválido ou ausente.") from e
            raise RuntimeError(f"Falha ao baixar preview ({status}).") from e
        except httpx.RequestError as e:
            raise RuntimeError("Erro de rede ao baixar preview.") from e
        media_type = "audio/mpeg" if f == "mp3" else "audio/ogg"
        return resp.content, media_type
