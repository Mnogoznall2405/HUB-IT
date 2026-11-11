"""
Database management API endpoints - switch between databases.
"""
from fastapi import APIRouter, Depends, HTTPException, Cookie, Header, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List, Dict, Optional
import logging
import os

from backend.api.deps import get_current_active_user, require_any_permission
from backend.database.connection import get_database_config, set_user_database, get_user_database
from backend.models.auth import User
from backend.services.authorization_service import (
    PERM_DATABASE_DELETE,
    PERM_DATABASE_DELETE_EQUIPMENT,
    PERM_DATABASE_READ,
    PERM_DATABASE_WRITE,
)
from backend.services.settings_service import settings_service
from backend.services.user_db_selection_service import user_db_selection_service
from backend.config import config
from backend.services.database_catalog import _DB_CATALOG, _is_db_configured, get_all_db_configs  # noqa: F401

logger = logging.getLogger(__name__)


_DATABASE_ACCESS_PERMISSIONS = (
    PERM_DATABASE_READ,
    PERM_DATABASE_WRITE,
    PERM_DATABASE_DELETE,
    PERM_DATABASE_DELETE_EQUIPMENT,
)

router = APIRouter(
    dependencies=[Depends(require_any_permission(_DATABASE_ACCESS_PERMISSIONS))]
)


class DatabaseInfo(BaseModel):
    """Database information model."""
    id: str
    name: str
    access: str


def _get_assigned_db(current_user: Optional[User]) -> Optional[str]:
    if not current_user:
        return None
    user_assigned_db = (str(getattr(current_user, "assigned_database", None) or "").strip() or None)
    if user_assigned_db:
        return user_assigned_db
    return user_db_selection_service.get_assigned_database(getattr(current_user, "telegram_id", None))


def normalize_database_id(database_id: object) -> Optional[str]:
    """Return a known database ID or None for empty/unknown values."""
    normalized = str(database_id or "").strip()
    if not normalized:
        return None
    allowed = {
        str(item.get("id") or "").strip()
        for item in get_all_db_configs()
        if str(item.get("id") or "").strip()
    }
    if allowed and normalized not in allowed:
        return None
    return normalized


def _get_persisted_user_database(current_user: Optional[User]) -> Optional[str]:
    if not current_user:
        return None
    user_db = normalize_database_id(get_user_database(current_user.id, current_user.username))
    if user_db:
        return user_db
    settings = settings_service.get_user_settings(current_user.id)
    return normalize_database_id(settings.get("pinned_database"))


def resolve_current_database_id(
    current_user: Optional[User],
    *,
    request_hint: Optional[str] = None,
    legacy_cookie: Optional[str] = None,
    include_default: bool = True,
    prefer_request_hint: bool = False,
) -> tuple[Optional[str], str]:
    """Resolve the effective database with an optional request-scoped override.

    A non-admin fixed assignment always wins. Normal selection endpoints keep
    the persisted server-side value authoritative; explicitly request-scoped
    data endpoints may opt into a validated header before that persisted value.
    """
    assigned_db = normalize_database_id(_get_assigned_db(current_user))
    if assigned_db and current_user and current_user.role != "admin":
        return assigned_db, "assigned"

    hint_db = normalize_database_id(request_hint)
    if prefer_request_hint and hint_db:
        return hint_db, "request_hint"

    persisted_db = _get_persisted_user_database(current_user)
    if persisted_db:
        return persisted_db, "user_selection"

    if hint_db:
        return hint_db, "request_hint"

    cookie_db = normalize_database_id(legacy_cookie)
    if cookie_db:
        return cookie_db, "legacy_cookie"

    if include_default:
        return config.database.database, "default"
    return None, "default"


@router.get("/list")
async def get_available_databases(current_user: User = Depends(get_current_active_user)) -> List[DatabaseInfo]:
    """
    Get list of available databases.

    Returns:
        List of available databases
    """
    def _build_response() -> list[dict]:
        databases = get_all_db_configs()
        assigned_db = normalize_database_id(_get_assigned_db(current_user))
        if assigned_db and current_user and current_user.role != "admin":
            filtered = [db for db in databases if db["id"] == assigned_db]
            if filtered:
                return filtered
        return databases

    return await run_in_threadpool(_build_response)


@router.get("/current")
async def get_current_database(
    x_database_id: Optional[str] = Header(None, alias="X-Database-ID"),
    selected_database: Optional[str] = Cookie(None),
    current_user: User = Depends(get_current_active_user),
) -> Dict[str, str]:
    """
    Get current active database.

    Returns:
        Current database information
    """
    def _build_response() -> dict[str, str]:
        active_db, source = resolve_current_database_id(
            current_user,
            request_hint=x_database_id,
            legacy_cookie=selected_database,
            include_default=True,
        )
        db_config = get_database_config(active_db)
        return {
            "id": active_db or config.database.database,
            "name": db_config["database"],
            "source": source,
            "locked": "true" if source == "assigned" else "false",
        }

    return await run_in_threadpool(_build_response)


class SwitchDatabaseRequest(BaseModel):
    """Request to switch database."""
    database_id: str


@router.post("/switch")
async def switch_database(
    request: SwitchDatabaseRequest,
    current_user: User = Depends(get_current_active_user),
):
    """
    Switch to a different database.

    The database selection is stored per-user session and takes effect immediately
    without requiring a server restart.

    Args:
        request: SwitchDatabaseRequest with database_id

    Returns:
        Success message
    """
    requested_db = normalize_database_id(request.database_id)
    logger.info(f"Switch database request: {request.database_id}, user: {current_user}")

    # Check if database exists
    all_dbs = get_all_db_configs()
    db_info = next((db for db in all_dbs if db["id"] == requested_db), None)
    if not requested_db or not db_info:
        raise HTTPException(status_code=404, detail="Database not found")

    assigned_db = normalize_database_id(_get_assigned_db(current_user))
    if assigned_db and current_user and current_user.role != "admin" and requested_db != assigned_db:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Database is fixed for this user: {assigned_db}",
        )

    # Persist the selection as the server-owned contract; the in-memory map
    # remains only a fast compatibility cache for older call sites.
    user_id = current_user.id
    username = current_user.username
    await run_in_threadpool(settings_service.update_user_settings, user_id, {"pinned_database": requested_db})
    set_user_database(user_id, requested_db, username)
    logger.info(f"Set database {requested_db} for user id={user_id}, username={username}")

    payload = {
        "success": True,
        "message": f"Переключено на {db_info['name']}. База данных применена немедленно.",
        # Never expose connection settings (host, username, password) to clients.
        "database": {
            "id": db_info["id"],
            "name": db_info["name"],
            "access": db_info["access"],
        },
        "user_id": user_id
    }
    response = JSONResponse(content=payload)
    response.delete_cookie(
        key="selected_database",
        samesite="lax",
    )
    return response
