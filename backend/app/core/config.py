from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv


load_dotenv()


@dataclass(frozen=True)
class Settings:
    app_name: str = "Audio Editor"
    host: str = "127.0.0.1"
    port: int = int(os.getenv("PORT", "8000"))
    freesound_token: str | None = os.getenv("FREESOUND_TOKEN")
    temp_dir: str = os.getenv("TEMP_DIR", ".temp")


settings = Settings()

