"""Environment helpers for the shared OpenAI-compatible LLM gateway."""
from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any, Optional

from dotenv import dotenv_values

PROJECT_ROOT = Path(__file__).resolve().parents[2]
ROOT_ENV_PATH = PROJECT_ROOT / ".env"
ROOT_ENV = dotenv_values(str(ROOT_ENV_PATH)) if ROOT_ENV_PATH.exists() else {}

DEFAULT_ROUTERAI_BASE_URL = "https://routerai.ru/api/v1"
# Backwards-compatible export for callers that still import the old name.
DEFAULT_OPENROUTER_BASE_URL = DEFAULT_ROUTERAI_BASE_URL
DEFAULT_AI_MODEL = "google/gemini-3.6-flash"


def read_env(name: str, default: Optional[str] = None) -> Optional[str]:
    value = os.getenv(name)
    if value not in (None, ""):
        return str(value).strip()
    root_value = ROOT_ENV.get(name)
    if root_value not in (None, ""):
        return str(root_value).strip()
    return default


def normalize_openrouter_base_url(
    raw_value: Any,
    default_base_url: str = DEFAULT_OPENROUTER_BASE_URL,
) -> str:
    raw = str(raw_value or "").strip()
    if not raw:
        return default_base_url
    value = raw.rstrip("/")
    lower = value.lower()
    if lower.endswith("/chat/completions"):
        value = value[: -len("/chat/completions")]
        lower = value.lower()
    elif lower.endswith("/completions"):
        value = value[: -len("/completions")]
        lower = value.lower()
    if lower.endswith("/api"):
        value = f"{value}/v1"
        lower = value.lower()
    if lower.endswith("/v1") and not lower.endswith("/api/v1"):
        value = re.sub(r"/v1$", "", value, flags=re.IGNORECASE)
        value = f"{value}/api/v1"
        lower = value.lower()
    if not lower.endswith("/api/v1"):
        value = f"{value}/api/v1"
    return value
