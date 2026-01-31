from __future__ import annotations

import re
from dataclasses import dataclass
import unicodedata

from rapidfuzz import fuzz, process


_PT_SYNONYMS: dict[str, list[str]] = {
    "passos": ["footsteps", "steps", "walking"],
    "corrida": ["running", "run", "footsteps"],
    "batida": ["hit", "impact", "thump"],
    "explosao": ["explosion", "blast"],
    "porta": ["door", "door slam", "door close", "door open"],
    "chuva": ["rain", "storm", "drizzle"],
    "vento": ["wind", "gust"],
    "tiro": ["gunshot", "shot", "pistol", "rifle"],
    "soco": ["punch", "hit", "impact"],
    "vidro": ["glass", "glass break", "shatter"],
    "agua": ["water", "splash", "drop"],
    "fogo": ["fire", "flame", "burning"],
    "sirene": ["siren"],
    "freio": ["brake", "skid"],
    "carro": ["car", "vehicle", "engine"],
    "riso": ["laugh", "laughter"],
    "risos": ["laugh", "laughter"],
    "risada": ["laugh", "laughter"],
    "risadas": ["laugh", "laughter"],
    "crianca": ["child", "kids", "children"],
    "criancas": ["children", "kids", "child"],
    "bebes": ["baby", "babies"],
    "bebe": ["baby"],
    "menino": ["boy", "child"],
    "menina": ["girl", "child"],
}


def _strip_accents(text: str) -> str:
    nf = unicodedata.normalize("NFD", text)
    return "".join(ch for ch in nf if unicodedata.category(ch) != "Mn")

def _normalize(text: str) -> str:
    text = text.strip().lower()
    text = _strip_accents(text)
    text = re.sub(r"[^\w\s-]+", " ", text, flags=re.UNICODE)
    text = re.sub(r"\s+", " ", text)
    return text


@dataclass(frozen=True)
class QueryMapping:
    query: str
    tags: list[str]


def map_pt_to_freesound(query_pt: str) -> QueryMapping:
    normalized = _normalize(query_pt)
    if not normalized:
        return QueryMapping(query="", tags=[])

    words = normalized.split(" ")
    tags: list[str] = []

    keys = list(_PT_SYNONYMS.keys())
    for w in words:
        if w in _PT_SYNONYMS:
            tags.extend(_PT_SYNONYMS[w])
            continue

        best = process.extractOne(w, keys, scorer=fuzz.WRatio, score_cutoff=88)
        if best:
            tags.extend(_PT_SYNONYMS[best[0]])

    tags = list(dict.fromkeys(tags))[:8]
    query_en = normalized
    if tags:
        query_en = " ".join(tags[:3])

    return QueryMapping(query=query_en, tags=tags)
