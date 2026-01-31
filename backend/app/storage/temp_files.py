from __future__ import annotations

import os
import time
import uuid
from dataclasses import dataclass


@dataclass
class StoredFile:
    file_id: str
    path: str
    filename: str
    size_bytes: int
    created_at: float


class TempFileStore:
    def __init__(self, root_dir: str) -> None:
        self._root_dir = root_dir
        self._files: dict[str, StoredFile] = {}
        os.makedirs(self._root_dir, exist_ok=True)

    def put(self, filename: str, content: bytes) -> StoredFile:
        file_id = uuid.uuid4().hex
        safe_name = os.path.basename(filename) or "video.bin"
        path = os.path.join(self._root_dir, f"{file_id}_{safe_name}")
        with open(path, "wb") as f:
            f.write(content)

        stored = StoredFile(
            file_id=file_id,
            path=path,
            filename=safe_name,
            size_bytes=len(content),
            created_at=time.time(),
        )
        self._files[file_id] = stored
        return stored

    def get(self, file_id: str) -> StoredFile | None:
        stored = self._files.get(file_id)
        if not stored:
            return None
        if not os.path.exists(stored.path):
            self._files.pop(file_id, None)
            return None
        return stored

    def cleanup(self, max_age_s: float = 60 * 60) -> int:
        now = time.time()
        removed = 0
        for file_id, stored in list(self._files.items()):
            if now - stored.created_at > max_age_s:
                try:
                    if os.path.exists(stored.path):
                        os.remove(stored.path)
                finally:
                    self._files.pop(file_id, None)
                    removed += 1
        return removed

