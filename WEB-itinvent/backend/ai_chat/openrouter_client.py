"""Compatibility re-export of the shared OpenRouter LLM gateway.

Prefer importing from ``shared.llm`` in new code. This module keeps existing
``backend.ai_chat.openrouter_client`` imports working.
"""
from __future__ import annotations

import sys
from pathlib import Path

# Backend often runs with cwd=WEB-itinvent; ensure monorepo root is importable.
_MONOREPO_ROOT = Path(__file__).resolve().parents[3]
if str(_MONOREPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_MONOREPO_ROOT))

from shared.llm import (  # noqa: E402
    DEFAULT_AI_MODEL,
    DEFAULT_OPENROUTER_BASE_URL,
    OpenRouterClient,
    OpenRouterClientError,
    is_image_unsupported_error,
    normalize_openrouter_base_url,
    openrouter_client,
    provider_error_text,
    resolve_model,
    resolve_model_candidates,
)
from shared.llm.client import _extract_json_payload  # noqa: E402
from shared.llm.env import read_env as _read_env  # noqa: E402

__all__ = [
    "DEFAULT_AI_MODEL",
    "DEFAULT_OPENROUTER_BASE_URL",
    "OpenRouterClient",
    "OpenRouterClientError",
    "_extract_json_payload",
    "_read_env",
    "is_image_unsupported_error",
    "normalize_openrouter_base_url",
    "openrouter_client",
    "provider_error_text",
    "resolve_model",
    "resolve_model_candidates",
]
