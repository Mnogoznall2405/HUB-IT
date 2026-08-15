from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from typing import Any


_SECRET_KEY_RE = re.compile(
    r"(?:password|passwd|pwd|secret|token|api[_-]?key|authorization|cookie|credential|private[_-]?key)",
    re.IGNORECASE,
)
_BEARER_RE = re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]{8,}")
_ASSIGNMENT_RE = re.compile(
    r"(?i)\b(password|passwd|pwd|secret|token|api[_-]?key|authorization)\s*[:=]\s*([^\s,;]+)"
)
_URL_CREDENTIAL_RE = re.compile(r"(?i)(https?://)[^/@\s:]+:[^/@\s]+@")


def redact_text(value: object, *, max_length: int = 2_000) -> str:
    text = str(value or "")
    text = _BEARER_RE.sub("Bearer [REDACTED]", text)
    text = _ASSIGNMENT_RE.sub(lambda match: f"{match.group(1)}=[REDACTED]", text)
    text = _URL_CREDENTIAL_RE.sub(r"\1[REDACTED]@", text)
    if len(text) > max_length:
        text = text[:max_length].rstrip() + "…"
    return text


def redact_preview(value: object, *, depth: int = 0) -> Any:
    """Bound and redact model-provided permission previews before persistence."""

    if depth >= 5:
        return "[TRUNCATED]"
    if isinstance(value, Mapping):
        result: dict[str, Any] = {}
        for index, (raw_key, item) in enumerate(value.items()):
            if index >= 50:
                result["_truncated"] = True
                break
            key = redact_text(raw_key, max_length=128)
            result[key] = "[REDACTED]" if _SECRET_KEY_RE.search(key) else redact_preview(item, depth=depth + 1)
        return result
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        rows = list(value[:50]) if hasattr(value, "__getitem__") else list(value)[:50]
        return [redact_preview(item, depth=depth + 1) for item in rows]
    if isinstance(value, (bool, int, float)) or value is None:
        return value
    return redact_text(value)

