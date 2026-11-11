"""Branch scope of an IT owner in «Инвентарь».

A non-admin user who is an active IT owner of at least one object sees, in the objects database
(``IT_OBJECTS_DB_ID``), only the ITINVENT branches of the objects he owns. Admins, users without an
owned object and every other database are not restricted here (their database access is governed by
the existing per-user database assignment). The owned set is cached briefly per user.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Any, Iterable, Optional

from sqlalchemy import select

from backend.appdb.db import app_session, is_app_database_configured
from backend.appdb.models import AppItObject, AppItObjectOwner


logger = logging.getLogger(__name__)

_TTL_SEC = 30.0
_lock = threading.Lock()
_cache: dict[int, tuple[float, frozenset[int]]] = {}


def invalidate() -> None:
    """Drop cached scopes after an owner change made by this process (other processes catch up within the TTL)."""
    with _lock:
        _cache.clear()


def _objects_db_id() -> str:
    from backend.services.it_objects_service import objects_database_id

    return objects_database_id()


def _default_db_id() -> str:
    from backend.config import config

    return str(config.database.database or "").strip()


def _branch_no_of(ref: Any, objects_db: str) -> Optional[int]:
    """``OBJ-ITINVENT:12`` -> 12; refs of other databases or custom refs give ``None``."""
    db_part, sep, number = str(ref or "").strip().rpartition(":")
    if not sep or db_part.strip().upper() != objects_db.upper():
        return None
    try:
        return int(number.strip())
    except ValueError:
        return None


def _load_owned_branch_nos(user_id: int) -> frozenset[int]:
    objects_db = _objects_db_id()
    with app_session() as session:
        rows = session.execute(
            select(AppItObject.source_ref, AppItObject.linked_ref)
            .join(AppItObjectOwner, AppItObjectOwner.object_id == AppItObject.id)
            .where(
                AppItObjectOwner.user_id == user_id,
                AppItObjectOwner.valid_to.is_(None),
                AppItObject.is_active.is_(True),
            )
        ).all()
    result: set[int] = set()
    for source_ref, linked_ref in rows:
        # A custom object shows the inventory of the branch it is linked to.
        number = _branch_no_of(linked_ref or source_ref, objects_db)
        if number is not None:
            result.add(number)
    return frozenset(result)


def owned_branch_nos(user_id: Any) -> frozenset[int]:
    """Branch numbers (objects database) of the active objects the user owns. Fails closed to the last known value."""
    try:
        uid = int(user_id or 0)
    except (TypeError, ValueError):
        return frozenset()
    if uid <= 0 or not is_app_database_configured():
        return frozenset()
    now = time.monotonic()
    with _lock:
        cached = _cache.get(uid)
        if cached and cached[0] > now:
            return cached[1]
    try:
        loaded = _load_owned_branch_nos(uid)
    except Exception as exc:  # noqa: BLE001 - never turn a storage failure into an unrestricted view
        logger.warning("IT owner branch scope lookup failed: %s", type(exc).__name__)
        raise
    with _lock:
        _cache[uid] = (now + _TTL_SEC, loaded)
    return loaded


def _is_admin(user: Any) -> bool:
    return str(getattr(user, "role", "") or "").strip().lower() == "admin"


def branch_scope(user: Any, db_id: Optional[str]) -> Optional[frozenset[int]]:
    """``None`` — no restriction; otherwise the only branch numbers the user may see (may be empty)."""
    if _is_admin(user):
        return None
    effective_db = str(db_id or "").strip() or _default_db_id()
    if effective_db.upper() != _objects_db_id().upper():
        return None
    # Not an owner of any object (also: owner of objects only in other databases) -> as before.
    if not owned_branch_nos_any(user):
        return None
    return owned_branch_nos(getattr(user, "id", None))


def owned_branch_nos_any(user: Any) -> bool:
    """True when the user is an active IT owner of any object (the signal that makes the scope apply)."""
    from backend.services.it_object_owner_access import is_it_object_owner

    return is_it_object_owner(getattr(user, "id", None))


def row_branch_no(row: Any) -> Optional[int]:
    if not isinstance(row, dict):
        return None
    for key in ("branch_no", "BRANCH_NO"):
        value = row.get(key)
        if value not in (None, ""):
            try:
                return int(value)
            except (TypeError, ValueError):
                return None
    return None


def filter_branch_directory(rows: Optional[Iterable[Any]], scope: Optional[frozenset[int]]) -> list[Any]:
    """Branch directory rows (``id``/``BRANCH_NO``): ``id`` is the branch number here, unlike in equipment rows."""
    items = list(rows or [])
    if scope is None:
        return items
    result = []
    for row in items:
        if not isinstance(row, dict):
            continue
        for key in ("id", "BRANCH_NO", "branch_no"):
            value = row.get(key)
            if value in (None, ""):
                continue
            try:
                if int(value) in scope:
                    result.append(row)
            except (TypeError, ValueError):
                pass
            break
    return result


def row_allowed(row: Any, scope: Optional[frozenset[int]]) -> bool:
    if scope is None:
        return True
    number = row_branch_no(row)
    return number is not None and number in scope


def filter_rows(rows: Optional[Iterable[Any]], scope: Optional[frozenset[int]]) -> list[Any]:
    items = list(rows or [])
    if scope is None:
        return items
    return [row for row in items if row_allowed(row, scope)]


def computer_scope(user: Any) -> Optional[frozenset[int]]:
    """Scope for agent computers: the branches of an IT owner's objects, in the objects database."""
    return branch_scope(user, _objects_db_id())


def computer_allowed(record: Any, scope: Optional[frozenset[int]]) -> bool:
    """A computer of the objects database (or an unassigned one) is visible only inside the scope; other databases are untouched."""
    if scope is None:
        return True
    if not isinstance(record, dict):
        return False
    database_id = str(record.get("database_id") or "").strip()
    if database_id and database_id.upper() != _objects_db_id().upper():
        return True
    return row_allowed(record, scope)
