"""Permission that follows the IT owner assignment.

An active IT owner of an (active) object always opens «Объекты ИТ», whatever role or custom
permission set the user has: the assignment itself is the grant. What the owner then sees is still
decided object by object (``ItObjectsService``). The set of owners is cached for a short time because
effective permissions are built on every authenticated request.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Any, Iterable

from sqlalchemy import select

from backend.appdb.db import app_session, is_app_database_configured
from backend.appdb.models import AppItObject, AppItObjectOwner
from backend.services.authorization_service import PERM_IT_OBJECTS_READ


logger = logging.getLogger(__name__)

_TTL_SEC = 30.0
_ERROR_RETRY_SEC = 5.0
_lock = threading.Lock()
_owner_ids: frozenset[int] = frozenset()
_expires_at = 0.0


def invalidate() -> None:
    """Drop the cache after an owner change made by this process (other processes catch up within the TTL)."""
    global _expires_at
    with _lock:
        _expires_at = 0.0
    from backend.services import it_object_branch_scope

    it_object_branch_scope.invalidate()


def _load_owner_ids() -> frozenset[int]:
    with app_session() as session:
        rows = session.scalars(
            select(AppItObjectOwner.user_id)
            .join(AppItObject, AppItObject.id == AppItObjectOwner.object_id)
            .where(AppItObjectOwner.valid_to.is_(None), AppItObject.is_active.is_(True))
            .distinct()
        ).all()
    return frozenset(int(user_id) for user_id in rows)


def owner_user_ids() -> frozenset[int]:
    global _owner_ids, _expires_at
    now = time.monotonic()
    with _lock:
        if now < _expires_at:
            return _owner_ids
    if not is_app_database_configured():
        return frozenset()
    try:
        loaded = _load_owner_ids()
    except Exception as exc:  # noqa: BLE001 - storage down or migration not applied: never break authentication
        logger.debug("IT object owners lookup failed: %s", type(exc).__name__)
        with _lock:
            _expires_at = now + _ERROR_RETRY_SEC
            return _owner_ids
    with _lock:
        _owner_ids = loaded
        _expires_at = now + _TTL_SEC
    return loaded


def is_it_object_owner(user_id: Any) -> bool:
    try:
        return int(user_id or 0) in owner_user_ids()
    except (TypeError, ValueError):
        return False


def with_owner_permissions(permissions: Iterable[str], user_id: Any) -> list[str]:
    result = list(permissions)
    if PERM_IT_OBJECTS_READ not in result and is_it_object_owner(user_id):
        result.append(PERM_IT_OBJECTS_READ)
        result.sort()
    return result
