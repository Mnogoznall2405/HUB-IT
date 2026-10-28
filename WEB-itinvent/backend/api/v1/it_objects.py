"""IT objects API: object cards, IT owner assignment and per-section access grants."""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from sqlalchemy.exc import SQLAlchemyError

from backend.api.deps import ensure_user_permission, require_permission
from backend.appdb.db import AppDatabaseConfigurationError
from backend.models.auth import User
from backend.services.authorization_service import PERM_IT_OBJECTS_MANAGE, PERM_IT_OBJECTS_READ
from backend.services.it_objects_service import (
    ItObjectError,
    ItObjectSourceError,
    get_it_objects_service,
)
from backend.services.user_service import user_service


router = APIRouter()
logger = logging.getLogger(__name__)


class OwnerRequest(BaseModel):
    user_id: int = Field(ge=1)


class GrantRequest(BaseModel):
    user_id: int = Field(ge=1)
    section: str = Field(min_length=1, max_length=32)
    level: str = Field(min_length=1, max_length=16)


def _service():
    try:
        return get_it_objects_service()
    except (RuntimeError, AppDatabaseConfigurationError, SQLAlchemyError) as exc:
        raise HTTPException(status_code=503, detail="Объекты ИТ временно недоступны") from exc


def _can_manage_owner(user: User) -> bool:
    try:
        ensure_user_permission(user, PERM_IT_OBJECTS_MANAGE)
    except HTTPException:
        return False
    return True


async def _run(func, /, *args, **kwargs) -> Any:
    try:
        return await run_in_threadpool(func, *args, **kwargs)
    except ItObjectError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    except ItObjectSourceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except (SQLAlchemyError, AppDatabaseConfigurationError) as exc:
        # Missing tables (migration not applied yet) or a down app database.
        logger.warning("IT objects storage unavailable: %s", exc)
        raise HTTPException(status_code=503, detail="Объекты ИТ временно недоступны") from exc


def _resolve_target(user_id: int) -> dict[str, Any]:
    target = user_service.get_by_id(int(user_id))
    if not target or user_service.is_system_hidden_user(target):
        raise HTTPException(status_code=400, detail="Пользователь не найден")
    return target


@router.get("", response_model=dict[str, Any])
@router.get("/", response_model=dict[str, Any])
async def list_it_objects(
    q: str = Query("", max_length=200),
    mine: bool = Query(False),
    current_user: User = Depends(require_permission(PERM_IT_OBJECTS_READ)),
) -> dict[str, Any]:
    service = _service()
    items = await _run(service.list_objects, user_id=int(current_user.id), query=q, only_mine=mine)
    return {"items": items, "source_db_id": service.source_db_id}


@router.get("/user-options", response_model=dict[str, Any])
async def list_user_options(
    q: str = Query("", max_length=160),
    limit: int = Query(20, ge=1, le=50),
    current_user: User = Depends(require_permission(PERM_IT_OBJECTS_READ)),
) -> dict[str, Any]:
    result = await run_in_threadpool(
        user_service.search_users,
        query=q,
        limit=limit,
        status="active",
        exclude_user_id=int(current_user.id),
    )
    return {
        "items": [
            {
                "id": int(item.get("id") or 0),
                "username": str(item.get("username") or ""),
                "full_name": str(item.get("full_name") or ""),
                "job_title": str(item.get("job_title") or ""),
            }
            for item in result.get("items") or []
        ]
    }


@router.get("/{object_ref}", response_model=dict[str, Any])
async def get_it_object(
    object_ref: str,
    current_user: User = Depends(require_permission(PERM_IT_OBJECTS_READ)),
) -> dict[str, Any]:
    return await _run(
        _service().get_object,
        object_ref,
        user_id=int(current_user.id),
        can_manage_owner=_can_manage_owner(current_user),
    )


def _section_service(object_ref: str, *, user_id: int, section: str, level: str = "view", label: str):
    try:
        service = get_it_objects_service()
    except (RuntimeError, AppDatabaseConfigurationError, SQLAlchemyError) as exc:
        raise ItObjectError("Объекты ИТ временно недоступны", 503) from exc
    if not service.can_access(object_ref, user_id=user_id, section=section, level=level):
        raise ItObjectError(f"Раздел «{label}» этого объекта вам не выдан", 403)
    return service


def _read_external(description: str, read):
    """Reads of Inventory / ITINVENT: any failure of those sources is an answer 502, not a bare 500."""
    try:
        return read()
    except (ItObjectError, ItObjectSourceError):
        raise
    except Exception as exc:  # noqa: BLE001 - driver, configuration and store errors alike
        logger.warning("IT object %s read failed: %s", description, type(exc).__name__)
        raise ItObjectSourceError(f"{description}: источник данных недоступен") from exc


def _load_object_computers(object_ref: str, *, user_id: int) -> dict[str, Any]:
    from backend.api.v1 import inventory  # heavy module: loaded only when the section is opened

    service = _section_service(object_ref, user_id=user_id, section="computers", label="Компьютеры")
    binding = service.source_binding(object_ref)
    items = _read_external(
        "Компьютеры объекта",
        lambda: inventory.list_object_computers(database_id=binding["database_id"], branch_no=binding["branch_no"]),
    )
    return {"object_ref": object_ref, "database_id": binding["database_id"], "items": items}


@router.get("/{object_ref}/computers", response_model=dict[str, Any])
async def list_it_object_computers(
    object_ref: str,
    current_user: User = Depends(require_permission(PERM_IT_OBJECTS_READ)),
) -> dict[str, Any]:
    return await _run(_load_object_computers, object_ref, user_id=int(current_user.id))


def _load_object_inventory(object_ref: str, *, user_id: int, page: int, limit: int) -> dict[str, Any]:
    from backend.database import equipment_db

    service = _section_service(object_ref, user_id=user_id, section="inventory", label="Инвентарь")
    binding = service.source_binding(object_ref)
    try:
        branch_no = int(binding["branch_no"])
    except ValueError as exc:
        raise ItObjectError("Объект не найден", 404) from exc
    result = _read_external(
        "Инвентарь объекта",
        lambda: equipment_db.get_equipment_by_branch_no(branch_no, page=page, limit=limit, db_id=binding["database_id"]),
    )
    items = [{str(key).lower(): value for key, value in row.items()} for row in result["equipment"]]
    return {
        "object_ref": object_ref,
        "database_id": binding["database_id"],
        "items": items,
        "total": result["total"],
        "page": result["page"],
        "limit": result["limit"],
        "pages": result["pages"],
    }


@router.get("/{object_ref}/inventory", response_model=dict[str, Any])
async def list_it_object_inventory(
    object_ref: str,
    page: int = Query(1, ge=1),
    limit: int = Query(100, ge=1, le=500),
    current_user: User = Depends(require_permission(PERM_IT_OBJECTS_READ)),
) -> dict[str, Any]:
    return await _run(_load_object_inventory, object_ref, user_id=int(current_user.id), page=page, limit=limit)


def _load_object_passwords_audit(object_ref: str, *, user_id: int, limit: int) -> dict[str, Any]:
    from backend.services.password_vault_service import PasswordVaultError, password_vault_service

    _section_service(object_ref, user_id=user_id, section="passwords", level="manage", label="Пароли (управление)")
    try:
        items = password_vault_service.list_object_audit(object_ref, limit=limit)
    except PasswordVaultError as exc:
        raise ItObjectError("Журнал паролей объекта временно недоступен", 503) from exc
    return {"object_ref": object_ref, "items": items}


@router.get("/{object_ref}/passwords/audit", response_model=dict[str, Any])
async def list_it_object_passwords_audit(
    object_ref: str,
    limit: int = Query(100, ge=1, le=500),
    current_user: User = Depends(require_permission(PERM_IT_OBJECTS_READ)),
) -> dict[str, Any]:
    return await _run(_load_object_passwords_audit, object_ref, user_id=int(current_user.id), limit=limit)


@router.put("/{object_ref}/owner", response_model=dict[str, Any])
async def assign_it_object_owner(
    object_ref: str,
    payload: OwnerRequest,
    current_user: User = Depends(require_permission(PERM_IT_OBJECTS_MANAGE)),
) -> dict[str, Any]:
    target = await run_in_threadpool(_resolve_target, payload.user_id)
    return await _run(_service().assign_owner, object_ref, target=target, actor_id=int(current_user.id))


@router.delete("/{object_ref}/owner", response_model=dict[str, Any])
async def clear_it_object_owner(
    object_ref: str,
    current_user: User = Depends(require_permission(PERM_IT_OBJECTS_MANAGE)),
) -> dict[str, Any]:
    return await _run(_service().clear_owner, object_ref, actor_id=int(current_user.id))


@router.put("/{object_ref}/grants", response_model=dict[str, Any])
async def set_it_object_grant(
    object_ref: str,
    payload: GrantRequest,
    current_user: User = Depends(require_permission(PERM_IT_OBJECTS_READ)),
) -> dict[str, Any]:
    target = await run_in_threadpool(_resolve_target, payload.user_id)
    return await _run(
        _service().grant,
        object_ref,
        target=target,
        section=payload.section,
        level=payload.level,
        actor_id=int(current_user.id),
        can_manage_owner=_can_manage_owner(current_user),
    )


@router.delete("/{object_ref}/grants", response_model=dict[str, Any])
async def revoke_it_object_grant(
    object_ref: str,
    user_id: int = Query(ge=1),
    section: str = Query(min_length=1, max_length=32),
    current_user: User = Depends(require_permission(PERM_IT_OBJECTS_READ)),
) -> dict[str, Any]:
    return await _run(
        _service().revoke,
        object_ref,
        target_user_id=user_id,
        section=section,
        actor_id=int(current_user.id),
        can_manage_owner=_can_manage_owner(current_user),
    )
