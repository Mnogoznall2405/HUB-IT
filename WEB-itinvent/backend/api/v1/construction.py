from __future__ import annotations

import logging
from typing import Any
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.exc import SQLAlchemyError

from backend.api.deps import require_permission
from backend.appdb.db import AppDatabaseConfigurationError
from backend.models.auth import User
from backend.models.company_structure import CompanyStructureLeaderCandidatesResponse
from backend.models.construction import (
    ConstructionManagedObject,
    ConstructionManagementResponse,
    ConstructionObjectDetail,
    ConstructionObjectRequestsResponse,
    ConstructionObjectSaveRequest,
    ConstructionObjectsResponse,
)
from backend.services.address_book_service import address_book_service
from backend.services.authorization_service import PERM_CONSTRUCTION_READ, PERM_CONSTRUCTION_WRITE
from backend.services.company_structure_service import get_company_structure_service
from backend.services.construction_management_service import get_construction_management_service
from backend.services.warehouse_1c_service import (
    Warehouse1CCatalogUnavailableError,
    Warehouse1CQueryError,
    Warehouse1CValidationError,
    warehouse_1c_service,
)


router = APIRouter()
logger = logging.getLogger(__name__)


def _management_service():
    try:
        return get_construction_management_service()
    except (RuntimeError, AppDatabaseConfigurationError) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


def _raise_data_error(exc: ValueError) -> None:
    status = 404 if "не найден" in str(exc).casefold() else 409 if "уже привязана" in str(exc).casefold() else 400
    raise HTTPException(status_code=status, detail=str(exc)) from exc


def _resolve_object_detail(object_id: str) -> ConstructionObjectDetail:
    normalized_id = str(object_id or "").strip()
    if normalized_id.startswith("managed:"):
        normalized_id = normalized_id.split(":", 1)[1].strip()
    if not normalized_id:
        raise HTTPException(status_code=404, detail="Объект не найден")
    try:
        group_ref = str(uuid.UUID(normalized_id)).lower()
    except (ValueError, TypeError, AttributeError):
        service = _management_service()
        try:
            managed = service.get_object(normalized_id, include_history=True)
        except ValueError as exc:
            _raise_data_error(exc)
        return ConstructionObjectDetail.model_validate(
            {
                **managed,
                "id": normalized_id,
                "managed": True,
                "kind": "project",
            }
        )
    return ConstructionObjectDetail(
        id=group_ref,
        name="",
        managed=False,
        groups=[{"group_ref": group_ref, "group_name": ""}],
        team=[],
        role_history=[],
    )


def _group_refs(detail: ConstructionObjectDetail) -> list[str]:
    return [item.group_ref for item in detail.groups]


async def _resolve_role_candidates(payload: ConstructionObjectSaveRequest) -> dict[str, dict | None]:
    requested: dict[str, str] = {}
    for item in payload.roles:
        if item.role_key in requested:
            raise HTTPException(status_code=400, detail="Одна роль не может быть указана дважды")
        requested[item.role_key] = item.employee_code.strip()

    result: dict[str, dict | None] = {
        "project_lead": None,
        "pto_manager": None,
        "umto_coordinator": None,
    }
    if not requested:
        return result
    for role_key, employee_code in requested.items():
        person = await run_in_threadpool(address_book_service.get_person_by_code, employee_code)
        if person is None:
            raise HTTPException(
                status_code=400,
                detail=f"Сотрудник с кодом ЗУП {employee_code} не найден",
            )
        result[role_key] = {
            "employee_code": str(person.get("employee_code") or "").strip(),
            "full_name": str(person.get("full_name") or "").strip(),
            "position": str(person.get("position") or "").strip(),
            "department": str(person.get("department") or "").strip(),
            "department_location": str(person.get("department_location") or "").strip(),
        }
    return result


@router.get("/objects", response_model=ConstructionObjectsResponse)
async def list_construction_objects(
    q: str = Query("", min_length=0, max_length=200),
    kind: str = Query("all", pattern="^(all|project|general|unassigned)$"),
    limit: int = Query(24, ge=1, le=48),
    cursor: str = Query("", max_length=512),
    refresh: bool = Query(False),
    _current_user: User = Depends(require_permission(PERM_CONSTRUCTION_READ)),
) -> ConstructionObjectsResponse:
    try:
        managed_objects: list[dict] = []
        management_available = False
        try:
            management_service = get_construction_management_service()
            managed_objects = await run_in_threadpool(management_service.get_snapshot_definitions)
            management_available = True
        except (RuntimeError, AppDatabaseConfigurationError, SQLAlchemyError) as exc:
            logger.warning("Construction management overlay unavailable: %s", exc)
        result = await warehouse_1c_service.get_construction_objects(
            search=q,
            kind=kind,
            limit=limit,
            cursor=cursor or None,
            refresh=refresh,
            managed_objects=managed_objects,
        )
        result["management_available"] = management_available
        return ConstructionObjectsResponse.model_validate(result)
    except Warehouse1CCatalogUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Warehouse1CValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Warehouse1CQueryError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/objects/{object_id}", response_model=ConstructionObjectDetail)
async def get_construction_object(
    object_id: str,
    _current_user: User = Depends(require_permission(PERM_CONSTRUCTION_READ)),
) -> ConstructionObjectDetail:
    return await run_in_threadpool(_resolve_object_detail, object_id)


@router.get(
    "/objects/{object_id}/requests",
    response_model=ConstructionObjectRequestsResponse,
)
async def list_construction_object_requests(
    object_id: str,
    view: str = Query("active", max_length=16),
    q: str = Query("", max_length=200),
    stage: str = Query("", max_length=32),
    overdue: bool | None = Query(None),
    warehouse_ref: str = Query("", max_length=64),
    limit: int = Query(25, ge=1, le=100),
    cursor: str = Query("", max_length=512),
    refresh: bool = Query(False),
    _current_user: User = Depends(require_permission(PERM_CONSTRUCTION_READ)),
) -> ConstructionObjectRequestsResponse:
    detail = await run_in_threadpool(_resolve_object_detail, object_id)
    try:
        result = await warehouse_1c_service.get_construction_object_requests(
            group_refs=_group_refs(detail),
            view=view,
            search=q,
            stage=stage,
            overdue=overdue,
            warehouse_ref=warehouse_ref,
            limit=limit,
            cursor=cursor or None,
            refresh=refresh,
        )
        return ConstructionObjectRequestsResponse.model_validate(result)
    except Warehouse1CCatalogUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Warehouse1CValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Warehouse1CQueryError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/objects/{object_id}/requests/{request_ref}", response_model=dict[str, Any])
async def get_construction_object_request(
    object_id: str,
    request_ref: str,
    _current_user: User = Depends(require_permission(PERM_CONSTRUCTION_READ)),
) -> dict[str, Any]:
    detail = await run_in_threadpool(_resolve_object_detail, object_id)
    try:
        result = await warehouse_1c_service.get_construction_object_request_detail(
            group_refs=_group_refs(detail),
            request_ref=request_ref,
        )
    except Warehouse1CCatalogUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Warehouse1CValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Warehouse1CQueryError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(status_code=404, detail="Заявка объекта не найдена")
    return result


@router.get("/employee-candidates", response_model=CompanyStructureLeaderCandidatesResponse)
async def list_construction_employee_candidates(
    q: str = Query("", max_length=200),
    limit: int = Query(30, ge=1, le=100),
    _: User = Depends(require_permission(PERM_CONSTRUCTION_WRITE)),
):
    try:
        directory = get_company_structure_service()
        return await run_in_threadpool(directory.list_leader_candidates, q, limit=int(limit))
    except (RuntimeError, AppDatabaseConfigurationError) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/management", response_model=ConstructionManagementResponse)
async def get_construction_management_context(
    _: User = Depends(require_permission(PERM_CONSTRUCTION_WRITE)),
) -> ConstructionManagementResponse:
    service = _management_service()
    objects = await run_in_threadpool(
        service.list_objects,
        include_inactive=False,
        include_history=True,
    )
    cursor: str | None = None
    available_groups: list[dict[str, str]] = []
    seen: set[str] = set()
    as_of: str | None = None
    try:
        for _page in range(10):
            page = await warehouse_1c_service.get_construction_objects(
                kind="project",
                limit=48,
                cursor=cursor,
                managed_objects=[],
            )
            as_of = as_of or str(page.get("as_of") or "") or None
            for item in page.get("items") or []:
                group_ref = str(item.get("object_ref") or "").strip().lower()
                if group_ref and group_ref not in seen:
                    seen.add(group_ref)
                    available_groups.append(
                        {"group_ref": group_ref, "group_name": str(item.get("name") or "")}
                    )
            if not page.get("has_more"):
                break
            cursor = str(page.get("next_cursor") or "") or None
    except Warehouse1CCatalogUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Warehouse1CValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Warehouse1CQueryError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    available_groups.sort(key=lambda item: item["group_name"].casefold())
    return ConstructionManagementResponse.model_validate(
        {"objects": objects, "available_groups": available_groups, "as_of": as_of}
    )


async def _save_managed_object(
    *,
    object_id: str | None,
    payload: ConstructionObjectSaveRequest,
    current_user: User,
) -> ConstructionManagedObject:
    service = _management_service()
    role_candidates = await _resolve_role_candidates(payload)
    try:
        result = await run_in_threadpool(
            service.save_object,
            object_id=object_id,
            name=payload.name,
            groups=[item.model_dump() for item in payload.groups],
            role_candidates=role_candidates,
            actor_user_id=current_user.id,
        )
    except ValueError as exc:
        _raise_data_error(exc)
    return ConstructionManagedObject.model_validate(result)


@router.post("/management/objects", response_model=ConstructionManagedObject, status_code=201)
async def create_managed_construction_object(
    payload: ConstructionObjectSaveRequest,
    current_user: User = Depends(require_permission(PERM_CONSTRUCTION_WRITE)),
) -> ConstructionManagedObject:
    return await _save_managed_object(object_id=None, payload=payload, current_user=current_user)


@router.put("/management/objects/{object_id}", response_model=ConstructionManagedObject)
async def update_managed_construction_object(
    object_id: str,
    payload: ConstructionObjectSaveRequest,
    current_user: User = Depends(require_permission(PERM_CONSTRUCTION_WRITE)),
) -> ConstructionManagedObject:
    return await _save_managed_object(object_id=object_id, payload=payload, current_user=current_user)
