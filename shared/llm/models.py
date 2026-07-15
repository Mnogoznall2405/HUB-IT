"""Model resolution by purpose for OpenRouter callers."""
from __future__ import annotations

from typing import Iterable, Optional

from shared.llm.env import DEFAULT_AI_MODEL, read_env

ModelPurpose = str

_PURPOSE_CHAINS: dict[str, tuple[str, ...]] = {
    "mail": (
        "OPENROUTER_MODEL_MAIL",
        "OPENROUTER_MODEL_CHAT",
        "OPENROUTER_MODEL_MARKDOWN",
        "ACT_PARSE_MODEL",
        "OCR_MODEL",
    ),
    "chat": (
        "OPENROUTER_MODEL_CHAT",
        "OPENROUTER_MODEL_MARKDOWN",
        "ACT_PARSE_MODEL",
        "OCR_MODEL",
    ),
    "markdown": (
        "OPENROUTER_MODEL_MARKDOWN",
        "ACT_PARSE_MODEL",
        "OCR_MODEL",
    ),
    "act": (
        "ACT_PARSE_MODEL",
        "OCR_MODEL",
    ),
    "ocr": (
        "OCR_MODEL",
    ),
}


def resolve_model(purpose: ModelPurpose = "chat", *, default: Optional[str] = None) -> str:
    """Resolve model id for a named purpose using env fallback chains."""
    key = str(purpose or "chat").strip().lower() or "chat"
    env_names = _PURPOSE_CHAINS.get(key, _PURPOSE_CHAINS["chat"])
    for name in env_names:
        value = read_env(name)
        if value:
            return value
    return str(default or DEFAULT_AI_MODEL).strip() or DEFAULT_AI_MODEL


def resolve_model_candidates(purpose: ModelPurpose = "act") -> list[str]:
    """Return unique non-empty model candidates for a purpose (ordered)."""
    key = str(purpose or "act").strip().lower() or "act"
    env_names = _PURPOSE_CHAINS.get(key, _PURPOSE_CHAINS["act"])
    return _unique_nonempty(read_env(name) for name in env_names)


def _unique_nonempty(values: Iterable[Optional[str]]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for raw in values:
        value = str(raw or "").strip()
        if not value or value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result
