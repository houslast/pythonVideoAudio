from __future__ import annotations

import httpx


def create_async_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=httpx.Timeout(30.0))

