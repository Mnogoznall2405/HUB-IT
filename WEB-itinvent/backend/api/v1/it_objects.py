"""IT objects API: object cards, IT owner assignment and per-section access grants."""
from __future__ import annotations

import logging
from typing import Any

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request
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


class CreateObjectRequest(BaseModel):
    name: str = Field(min_length=2, max_length=255)
    linked_ref: str | None = Field(default=None, max_length=128)


class TeamEmployee(BaseModel):
    employee_code: str = Field(min_length=1, max_length=128)
    full_name: str = Field(min_length=1, max_length=255)
    position: str = Field(default="", max_length=255)
    department: str = Field(default="", max_length=255)
    department_location: str = Field(default="", max_length=255)


class TeamRequest(BaseModel):
    # role_key -> employee from the ZUP directory | null (clear the role); only listed roles change
    roles: dict[str, TeamEmployee | None] = Field(min_length=1, max_length=8)


class AccessRequest(BaseModel):
    # section -> "view" | "manage" | null (take the section away)
    sections: dict[str, str | None] = Field(min_length=1, max_length=8)


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
    hidden: bool = Query(False),
    current_user: User = Depends(require_permission(PERM_IT_OBJECTS_READ)),
) -> dict[str, Any]:
    service = _service()
    can_manage = _can_manage_owner(current_user)
    if hidden and not can_manage:
        raise HTTPException(status_code=403, detail="Удалённые объекты видит только администратор")
    items = await _run(service.list_objects, user_id=int(current_user.id), query=q, only_mine=mine, only_hidden=hidden)
    return {"items": items, "source_db_id": service.source_db_id, "can_manage": can_manage}


@router.post("", response_model=dict[str, Any], status_code=201)
@router.post("/", response_model=dict[str, Any], status_code=201)
async def create_it_object(
    payload: CreateObjectRequest,
    current_user: User = Depends(require_permission(PERM_IT_OBJECTS_MANAGE)),
) -> dict[str, Any]:
    return await _run(
        _service().create_object, name=payload.name, linked_ref=payload.linked_ref, actor_id=int(current_user.id)
    )


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
        exclude_user_id=None if _can_manage_owner(current_user) else int(current_user.id),
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


@router.get("/employee-candidates", response_model=dict[str, Any])
async def list_employee_candidates(
    q: str = Query("", max_length=200),
    limit: int = Query(30, ge=1, le=100),
    current_user: User = Depends(require_permission(PERM_IT_OBJECTS_MANAGE)),
) -> dict[str, Any]:
    from backend.services.company_structure_service import get_company_structure_service

    try:
        directory = get_company_structure_service()
        result = await run_in_threadpool(directory.list_leader_candidates, q, limit=int(limit))
    except (RuntimeError, AppDatabaseConfigurationError) as exc:
        raise HTTPException(status_code=503, detail="Справочник сотрудников временно недоступен") from exc
    return result.model_dump() if hasattr(result, "model_dump") else dict(result)


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


def _load_object_computer(object_ref: str, mac_address: str, *, user_id: int) -> dict[str, Any]:
    from backend.api.v1 import inventory

    service = _section_service(object_ref, user_id=user_id, section="computers", label="Компьютеры")
    binding = service.source_binding(object_ref)
    detail = _read_external(
        "Компьютер объекта",
        lambda: inventory.get_object_computer_detail(
            database_id=binding["database_id"], branch_no=binding["branch_no"], mac_address=mac_address
        ),
    )
    if detail is None:
        raise ItObjectError("Компьютер не найден на этом объекте", 404)
    return detail


@router.get("/{object_ref}/computers/{mac_address}", response_model=dict[str, Any])
async def get_it_object_computer(
    object_ref: str,
    mac_address: str,
    current_user: User = Depends(require_permission(PERM_IT_OBJECTS_READ)),
) -> dict[str, Any]:
    return await _run(_load_object_computer, object_ref, mac_address, user_id=int(current_user.id))


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
        "branch_name": binding["branch_name"],
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


def _load_object_monitoring(object_ref: str, *, user_id: int) -> dict[str, Any]:
    from backend.services.network_monitor_service import network_monitor_service
    from backend.services.network_monitor_store import MonitoringNotReady

    _section_service(object_ref, user_id=user_id, section="monitoring", label="Мониторинг")
    try:
        overview = network_monitor_service.overview(object_ref)
    except (MonitoringNotReady, SQLAlchemyError) as exc:
        raise ItObjectError("Мониторинг временно недоступен", 503) from exc
    return {"object_ref": object_ref, **overview}


@router.get("/{object_ref}/monitoring", response_model=dict[str, Any])
async def list_it_object_monitoring(
    object_ref: str,
    current_user: User = Depends(require_permission(PERM_IT_OBJECTS_READ)),
) -> dict[str, Any]:
    return await _run(_load_object_monitoring, object_ref, user_id=int(current_user.id))


def _scoped_monitoring_service(object_ref: str, target_id: str, *, user_id: int):
    """Monitoring service for reading one device of this object: needs the object's monitoring section."""
    from backend.services.network_monitor_service import network_monitor_service
    from backend.services.network_monitor_store import MonitoringNotReady

    _section_service(object_ref, user_id=user_id, section="monitoring", label="Мониторинг")
    try:
        network_monitor_service.store.ready()
        owner = network_monitor_service.store.target_object_ref(target_id)
    except LookupError as exc:
        raise ItObjectError("Устройство не найдено", 404) from exc
    except (MonitoringNotReady, SQLAlchemyError) as exc:
        raise ItObjectError("Мониторинг временно недоступен", 503) from exc
    if owner != object_ref:
        raise ItObjectError("Устройство не найдено", 404)  # a device of another object is not revealed
    return network_monitor_service


async def _scoped_read(request: Request, object_ref: str, target_id: str, user_id: int, read):
    from backend.api.v1.monitoring import read_response

    service = await _run(_scoped_monitoring_service, object_ref, target_id, user_id=user_id)
    try:
        return await read_response(request, *read(service))
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="Устройство не найдено") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Мониторинг временно недоступен") from exc


@router.get("/{object_ref}/monitoring/targets/{target_id}")
async def get_object_monitoring_device(
    request: Request,
    object_ref: str,
    target_id: str,
    current_user: User = Depends(require_permission(PERM_IT_OBJECTS_READ)),
):
    return await _scoped_read(request, object_ref, target_id, int(current_user.id), lambda svc: (svc.store.detail, target_id))


@router.get("/{object_ref}/monitoring/targets/{target_id}/history")
async def get_object_monitoring_history(
    request: Request,
    object_ref: str,
    target_id: str,
    interface_id: str = Query("", max_length=36),
    hours: int = Query(24, ge=1, le=8760),
    start: datetime | None = Query(None),
    end: datetime | None = Query(None),
    current_user: User = Depends(require_permission(PERM_IT_OBJECTS_READ)),
):
    def read(svc):
        return (lambda: svc.store.history(target_id, interface_id, hours, svc.clock(), start=start, end=end)),

    return await _scoped_read(request, object_ref, target_id, int(current_user.id), read)


@router.get("/{object_ref}/monitoring/targets/{target_id}/latency-history")
async def get_object_monitoring_latency_history(
    request: Request,
    object_ref: str,
    target_id: str,
    hours: int = Query(24, ge=1, le=8760),
    start: datetime | None = Query(None),
    end: datetime | None = Query(None),
    after: datetime | None = Query(None),
    current_user: User = Depends(require_permission(PERM_IT_OBJECTS_READ)),
):
    def read(svc):
        return (lambda: svc.store.latency_history(target_id, hours, svc.clock(), start=start, end=end, after=after)),

    return await _scoped_read(request, object_ref, target_id, int(current_user.id), read)


def _monitoring_store(object_ref: str, *, user_id: int):
    """Store of the monitoring module, after checking that the user manages this object's monitoring."""
    from backend.services.network_monitor_service import network_monitor_service
    from backend.services.network_monitor_store import MonitoringNotReady

    _section_service(object_ref, user_id=user_id, section="monitoring", level="manage", label="Мониторинг (управление)")
    try:
        network_monitor_service.store.ready()
    except (MonitoringNotReady, SQLAlchemyError) as exc:
        raise ItObjectError("Мониторинг временно недоступен", 503) from exc
    return network_monitor_service.store


def _change_monitoring_device(object_ref: str, target_id: str, *, user_id: int, release: bool) -> dict[str, Any]:
    store = _monitoring_store(object_ref, user_id=user_id)
    try:
        store.move_target_object(target_id, object_ref, release=release)
    except LookupError as exc:
        raise ItObjectError("Устройство не найдено", 404) from exc
    except ValueError as exc:
        raise ItObjectError(str(exc), 409) from exc
    except SQLAlchemyError as exc:
        raise ItObjectError("Мониторинг временно недоступен", 503) from exc
    logger.info("IT object monitoring device %s: object=%s target=%s user=%s", "released" if release else "assigned", object_ref, target_id, user_id)
    return {"object_ref": object_ref, "target_id": target_id}


def _load_free_monitoring_devices(object_ref: str, *, user_id: int) -> dict[str, Any]:
    store = _monitoring_store(object_ref, user_id=user_id)
    try:
        return {"object_ref": object_ref, "items": store.unassigned_targets()}
    except SQLAlchemyError as exc:
        raise ItObjectError("Мониторинг временно недоступен", 503) from exc


@router.get("/{object_ref}/monitoring/free-devices", response_model=dict[str, Any])
async def list_free_monitoring_devices(
    object_ref: str,
    current_user: User = Depends(require_permission(PERM_IT_OBJECTS_READ)),
) -> dict[str, Any]:
    return await _run(_load_free_monitoring_devices, object_ref, user_id=int(current_user.id))


@router.put("/{object_ref}/monitoring/devices/{target_id}", response_model=dict[str, Any])
async def assign_monitoring_device(
    object_ref: str,
    target_id: str,
    current_user: User = Depends(require_permission(PERM_IT_OBJECTS_READ)),
) -> dict[str, Any]:
    return await _run(_change_monitoring_device, object_ref, target_id, user_id=int(current_user.id), release=False)


@router.delete("/{object_ref}/monitoring/devices/{target_id}", response_model=dict[str, Any])
async def release_monitoring_device(
    object_ref: str,
    target_id: str,
    current_user: User = Depends(require_permission(PERM_IT_OBJECTS_READ)),
) -> dict[str, Any]:
    return await _run(_change_monitoring_device, object_ref, target_id, user_id=int(current_user.id), release=True)


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


@router.delete("/{object_ref}", response_model=dict[str, Any])
async def hide_it_object(
    object_ref: str,
    current_user: User = Depends(require_permission(PERM_IT_OBJECTS_MANAGE)),
) -> dict[str, Any]:
    return await _run(_service().set_object_hidden, object_ref, hidden=True, actor_id=int(current_user.id))


@router.post("/{object_ref}/restore", response_model=dict[str, Any])
async def restore_it_object(
    object_ref: str,
    current_user: User = Depends(require_permission(PERM_IT_OBJECTS_MANAGE)),
) -> dict[str, Any]:
    return await _run(_service().set_object_hidden, object_ref, hidden=False, actor_id=int(current_user.id))


@router.put("/{object_ref}/owner", response_model=dict[str, Any])
async def assign_it_object_owner(
    object_ref: str,
    payload: OwnerRequest,
    current_user: User = Depends(require_permission(PERM_IT_OBJECTS_MANAGE)),
) -> dict[str, Any]:
    target = await run_in_threadpool(_resolve_target, payload.user_id)
    return await _run(_service().assign_owner, object_ref, target=target, actor_id=int(current_user.id))


@router.put("/{object_ref}/team", response_model=dict[str, Any])
async def set_it_object_team(
    object_ref: str,
    payload: TeamRequest,
    current_user: User = Depends(require_permission(PERM_IT_OBJECTS_MANAGE)),
) -> dict[str, Any]:
    candidates = {key: (value.model_dump() if value else None) for key, value in payload.roles.items()}
    return await _run(_service().set_team, object_ref, candidates=candidates, actor_id=int(current_user.id))


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


@router.put("/{object_ref}/access/{user_id}", response_model=dict[str, Any])
async def set_it_object_user_access(
    object_ref: str,
    user_id: int,
    payload: AccessRequest,
    current_user: User = Depends(require_permission(PERM_IT_OBJECTS_READ)),
) -> dict[str, Any]:
    target = await run_in_threadpool(_resolve_target, user_id)
    return await _run(
        _service().set_user_access,
        object_ref,
        target=target,
        sections=payload.sections,
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
