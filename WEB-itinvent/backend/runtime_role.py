"""Process role helpers for split Main API / Chat API runtimes."""
from __future__ import annotations

import os


def get_runtime_role() -> str:
    """Return embedded | api | chat.

    embedded — legacy single process (default)
    api      — main HUB/API without chat WebSocket/routers
    chat     — chat-only FastAPI process
    """
    raw = str(os.getenv("HUBIT_RUNTIME_ROLE") or os.getenv("CHAT_RUNTIME_ROLE") or "embedded").strip().lower()
    if raw in {"api", "main", "hub"}:
        return "api"
    if raw in {"chat", "chat-api", "chat_api"}:
        return "chat"
    return "embedded"


def chat_routes_enabled() -> bool:
    return get_runtime_role() in {"embedded", "chat"}


def heavy_api_routes_enabled() -> bool:
    return get_runtime_role() in {"embedded", "api"}


def is_chat_process() -> bool:
    return get_runtime_role() == "chat"


def is_api_process() -> bool:
    return get_runtime_role() == "api"
