from __future__ import annotations

import os
import re
from dataclasses import dataclass
import unicodedata
from typing import Any

from .query_mapper import _PT_SYNONYMS, map_pt_to_freesound


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
class AiQueryMapping:
    query: str
    tags: list[str]
    score: float
    debug: dict[str, Any] | None = None


_MODEL_NAME = str(os.getenv("PT_EN_TRANSLATION_MODEL", "Helsinki-NLP/opus-mt-pt-en")).strip() or "Helsinki-NLP/opus-mt-pt-en"
_TOKENIZER: Any | None = None
_MODEL: Any | None = None

_TAG_VOCAB = sorted({t for tags in _PT_SYNONYMS.values() for t in tags}, key=lambda x: (-len(str(x)), str(x)))
_TAG_VOCAB_NORM = [(t, _normalize(str(t))) for t in _TAG_VOCAB]


def _load_translator() -> tuple[Any, Any]:
    global _TOKENIZER, _MODEL
    if _TOKENIZER is not None and _MODEL is not None:
        return _TOKENIZER, _MODEL

    from transformers import AutoModelForSeq2SeqLM, AutoTokenizer  # type: ignore

    token = (
        str(os.getenv("HUGGINGFACE_HUB_TOKEN") or os.getenv("HUGGINGFACE_TOKEN") or os.getenv("HF_TOKEN") or "").strip()
        or None
    )
    auth = token if token else False
    try:
        tok = AutoTokenizer.from_pretrained(_MODEL_NAME, local_files_only=True, token=auth)
        model = AutoModelForSeq2SeqLM.from_pretrained(_MODEL_NAME, local_files_only=True, token=auth)
    except Exception:
        tok = AutoTokenizer.from_pretrained(_MODEL_NAME, token=auth)
        model = AutoModelForSeq2SeqLM.from_pretrained(_MODEL_NAME, token=auth)
    model.eval()
    _TOKENIZER = tok
    _MODEL = model
    return tok, model


def _translate_pt_to_en(text_pt: str) -> str:
    tok, model = _load_translator()
    import torch  # type: ignore

    inputs = tok([text_pt], return_tensors="pt", truncation=True)
    with torch.no_grad():
        out = model.generate(**inputs, max_new_tokens=72, num_beams=4, num_return_sequences=1)
    decoded = tok.batch_decode(out, skip_special_tokens=True)
    return str(decoded[0] if decoded else "").strip()


def _extract_tags_from_english(text_en: str) -> list[str]:
    t = _normalize(text_en)
    if not t:
        return []
    picked: list[str] = []
    for orig, norm in _TAG_VOCAB_NORM:
        if not norm:
            continue
        if " " in norm:
            if norm in t:
                picked.append(orig)
            continue
        if re.search(rf"(?<!\w){re.escape(norm)}(?!\w)", t):
            picked.append(orig)
    return picked


def model_status() -> dict[str, Any]:
    transformers_ok = False
    torch_ok = False
    transformers_version = None
    torch_version = None
    try:
        import transformers  # type: ignore

        transformers_ok = True
        transformers_version = getattr(transformers, "__version__", None)
    except Exception:
        transformers_ok = False
    try:
        import torch  # type: ignore

        torch_ok = True
        torch_version = getattr(torch, "__version__", None)
    except Exception:
        torch_ok = False

    token_present = bool(
        str(os.getenv("HUGGINGFACE_HUB_TOKEN") or os.getenv("HUGGINGFACE_TOKEN") or os.getenv("HF_TOKEN") or "").strip()
    )
    return {
        "engine": "marianmt_pt_en",
        "model_name": _MODEL_NAME,
        "model_loaded": bool(_MODEL is not None),
        "transformers_ok": transformers_ok,
        "transformers_version": transformers_version,
        "torch_ok": torch_ok,
        "torch_version": torch_version,
        "hf_token_present": token_present,
    }


def map_pt_to_freesound_ai(query_pt: str) -> AiQueryMapping:
    raw = str(query_pt or "").strip()
    if not raw:
        return AiQueryMapping(query="", tags=[], score=0.0, debug={"engine": "marianmt_pt_en", "empty": True})

    mapped_pt = map_pt_to_freesound(raw)

    try:
        translated = _translate_pt_to_en(raw)
        tags_en = _extract_tags_from_english(translated)
        tags = list(dict.fromkeys([*tags_en, *(mapped_pt.tags or [])]))[:8]
        query = translated.strip() or (mapped_pt.query or raw)
        return AiQueryMapping(
            query=query,
            tags=tags,
            score=1.0 if translated else 0.0,
            debug={
                "engine": "marianmt_pt_en",
                "model_name": _MODEL_NAME,
                "translated": translated,
                "tags_from_english": tags_en,
                "tags_from_pt_synonyms": mapped_pt.tags,
            },
        )
    except Exception as e:
        tags = list(dict.fromkeys([*(mapped_pt.tags or [])]))[:8]
        return AiQueryMapping(
            query=(mapped_pt.query or raw),
            tags=tags,
            score=0.0,
            debug={
                "engine": "marianmt_pt_en",
                "model_name": _MODEL_NAME,
                "error": str(e),
                "tags_from_pt_synonyms": mapped_pt.tags,
            },
        )
