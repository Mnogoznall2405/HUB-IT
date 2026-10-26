"""Technical-support chat: every user's direct dialog with the configured support user.

The dialog is an ordinary ``direct`` conversation; the support user is resolved
from the ``support_chat_username`` app setting (not from a role). The id is cached
in-process for a short time so the per-conversation serializer stays cheap.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Optional

from backend.services.app_settings_service import app_settings_service
from backend.services.user_service import user_service

logger = logging.getLogger(__name__)

SUPPORT_CHAT_TITLE = "Техподдержка HUB"
_CACHE_TTL_SEC = 60.0

_lock = threading.Lock()
_cached_id: Optional[int] = None
_cached_at: float = 0.0
_cache_ready = False


def reset_support_user_cache() -> None:
    global _cached_id, _cached_at, _cache_ready
    with _lock:
        _cached_id = None
        _cached_at = 0.0
        _cache_ready = False


def get_support_user_id() -> Optional[int]:
    """Id of the active support user, or None when it is not configured/available."""
    global _cached_id, _cached_at, _cache_ready
    now = time.monotonic()
    with _lock:
        if _cache_ready and now - _cached_at < _CACHE_TTL_SEC:
            return _cached_id
    resolved: Optional[int] = None
    try:
        username = str(app_settings_service.get_settings().get("support_chat_username") or "").strip()
        raw = user_service.get_by_username(username) if username else None
        if raw and bool(raw.get("is_active", True)):
            resolved = int(raw.get("id") or 0) or None
    except Exception:
        logger.warning("Support chat user lookup failed", exc_info=True)
        with _lock:
            return _cached_id if _cache_ready else None
    with _lock:
        _cached_id = resolved
        _cached_at = now
        _cache_ready = True
    return resolved
