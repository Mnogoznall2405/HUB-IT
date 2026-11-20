"""Web-facing payload scrubbing for Scan Center projections."""
from __future__ import annotations

from typing import Any, Dict


# Web-facing task/job projections must never carry credentials or document
# content: rotate_key payloads hold API keys, job payloads hold excerpts,
# base64 documents and raw pattern-match values. Agent delivery (poll_tasks)
# bypasses the web serializers, so scrubbing here only affects UI/API reads.
_WEB_PAYLOAD_BLOCKED_FRAGMENTS = (
    "api_key",
    "token",
    "secret",
    "password",
    "passwd",
    "credential",
    "private_key",
    "_b64",
)
_WEB_PAYLOAD_BLOCKED_KEYS = {
    "key",
    "text",
    "text_excerpt",
    "ocr_text",
    "llm_text",
    "local_pattern_hits",
    "matched_patterns",
    "matched_values",
}


def sanitize_web_payload(value: Any) -> Dict[str, Any]:
    """Recursively drop credentials/document-content keys from a task/job payload."""
    if not isinstance(value, dict):
        return {}
    out: Dict[str, Any] = {}
    for key, item in value.items():
        lowered = str(key or "").strip().lower()
        if lowered in _WEB_PAYLOAD_BLOCKED_KEYS or any(
            fragment in lowered for fragment in _WEB_PAYLOAD_BLOCKED_FRAGMENTS
        ):
            continue
        out[key] = sanitize_web_payload(item) if isinstance(item, dict) else item
    return out
