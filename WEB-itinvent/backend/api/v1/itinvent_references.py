"""Admin CRUD for ITINVENT reference data (vendors, branches, statuses, locations, types, models)."""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from fastapi.concurrency import run_in_threadpool

from backend.api.deps import get_request_scoped_database_id, require_permission
from backend.models.auth import User
from backend.services import itinvent_reference_service as service
from backend.services.authorization_service import PERM_DATABASE_REFERENCES_MANAGE

router = APIRouter()

_STATUS_BY_CODE = {
    "invalid": status.HTTP_400_BAD_REQUEST,
    "not_found": status.HTTP_404_NOT_FOUND,
    "duplicate": status.HTTP_409_CONFLICT,
    "in_use": status.HTTP_409_CONFLICT,
}


def _raise(error: service.ReferenceDataError) -> None:
    detail: Any = error.message
    if error.extra.get("usage"):
        detail = {"message": error.message, "usage": error.extra["usage"]}
    raise HTTPException(status_code=_STATUS_BY_CODE.get(error.code, status.HTTP_400_BAD_REQUEST), detail=detail)


@router.get("/meta")
async def get_meta(
    _: User = Depends(require_permission(PERM_DATABASE_REFERENCES_MANAGE)),
):
    return {
        "kinds": list(service.KINDS),
        "ci_types": [
            {"value": 1, "label": "Оборудование"},
            {"value": 4, "label": "Расходники"},
        ],
    }


@router.get("/{kind}")
async def list_references(
    kind: str,
    ci_type: Optional[int] = Query(None),
    type_no: Optional[int] = Query(None),
    branch_no: Optional[int] = Query(None),
    q: Optional[str] = Query(None, max_length=100),
    db_id: Optional[str] = Depends(get_request_scoped_database_id),
    _: User = Depends(require_permission(PERM_DATABASE_REFERENCES_MANAGE)),
):
    try:
        items = await run_in_threadpool(
            service.list_references, kind, db_id, ci_type=ci_type, type_no=type_no, branch_no=branch_no, q=q
        )
    except service.ReferenceDataError as error:
        _raise(error)
    return {"items": items}


@router.get("/{kind}/{ref_id}/usage")
async def get_reference_usage(
    kind: str,
    ref_id: int,
    ci_type: Optional[int] = Query(None),
    db_id: Optional[str] = Depends(get_request_scoped_database_id),
    _: User = Depends(require_permission(PERM_DATABASE_REFERENCES_MANAGE)),
):
    try:
        return await run_in_threadpool(service.get_usage, kind, ref_id, db_id, ci_type=ci_type)
    except service.ReferenceDataError as error:
        _raise(error)


@router.post("/{kind}", status_code=status.HTTP_201_CREATED)
async def create_reference(
    kind: str,
    payload: Dict[str, Any] = Body(...),
    db_id: Optional[str] = Depends(get_request_scoped_database_id),
    current_user: User = Depends(require_permission(PERM_DATABASE_REFERENCES_MANAGE)),
):
    try:
        return await run_in_threadpool(service.create, kind, payload, db_id, actor=current_user.username)
    except service.ReferenceDataError as error:
        _raise(error)


@router.patch("/{kind}/{ref_id}")
async def update_reference(
    kind: str,
    ref_id: int,
    payload: Dict[str, Any] = Body(...),
    ci_type: Optional[int] = Query(None),
    db_id: Optional[str] = Depends(get_request_scoped_database_id),
    current_user: User = Depends(require_permission(PERM_DATABASE_REFERENCES_MANAGE)),
):
    try:
        return await run_in_threadpool(
            service.update, kind, ref_id, payload, db_id, actor=current_user.username, ci_type=ci_type
        )
    except service.ReferenceDataError as error:
        _raise(error)


@router.delete("/{kind}/{ref_id}")
async def delete_reference(
    kind: str,
    ref_id: int,
    ci_type: Optional[int] = Query(None),
    db_id: Optional[str] = Depends(get_request_scoped_database_id),
    current_user: User = Depends(require_permission(PERM_DATABASE_REFERENCES_MANAGE)),
):
    try:
        row = await run_in_threadpool(
            service.delete, kind, ref_id, db_id, actor=current_user.username, ci_type=ci_type
        )
    except service.ReferenceDataError as error:
        _raise(error)
    return {"success": True, "deleted": row}
