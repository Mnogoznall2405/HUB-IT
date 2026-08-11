"""Company org-structure API."""
from __future__ import annotations

import os

from fastapi import APIRouter, Body, Depends, File, HTTPException, Query, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse

from backend.api.deps import require_permission
from backend.models.auth import User
from backend.models.company_structure import (
    CompanyStructureImportRequest,
    CompanyStructureImportResponse,
    CompanyStructureLeaderCandidatesResponse,
    CompanyStructureMoveRequest,
    CompanyStructureNodeCreate,
    CompanyStructureNodeResponse,
    CompanyStructureNodeUpdate,
    CompanyStructurePeopleResponse,
    CompanyStructureSearchResponse,
    CompanyStructureTreeResponse,
)
from backend.services.authorization_service import (
    PERM_COMPANY_STRUCTURE_READ,
    PERM_COMPANY_STRUCTURE_WRITE,
)
from backend.services.company_structure_service import get_company_structure_service


router = APIRouter()


def _service():
    try:
        return get_company_structure_service()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/tree", response_model=CompanyStructureTreeResponse)
async def get_company_structure_tree(
    include_inactive: bool = False,
    _: User = Depends(require_permission(PERM_COMPANY_STRUCTURE_READ)),
):
    service = _service()
    return await run_in_threadpool(service.get_tree, include_inactive=bool(include_inactive))


@router.get("/search", response_model=CompanyStructureSearchResponse)
async def search_company_structure(
    q: str = Query(..., min_length=1, max_length=200),
    limit: int = Query(30, ge=1, le=100),
    _: User = Depends(require_permission(PERM_COMPANY_STRUCTURE_READ)),
):
    service = _service()
    return await run_in_threadpool(service.search_directory, q, limit=int(limit))


@router.get("/leader-candidates", response_model=CompanyStructureLeaderCandidatesResponse)
async def list_company_structure_leader_candidates(
    q: str = Query("", max_length=200),
    limit: int = Query(30, ge=1, le=100),
    _: User = Depends(require_permission(PERM_COMPANY_STRUCTURE_WRITE)),
):
    service = _service()
    return await run_in_threadpool(service.list_leader_candidates, q, limit=int(limit))


@router.post("/import-from-zup", response_model=CompanyStructureImportResponse)
async def import_company_structure_from_zup(
    payload: CompanyStructureImportRequest,
    _: User = Depends(require_permission(PERM_COMPANY_STRUCTURE_WRITE)),
):
    service = _service()
    try:
        return await run_in_threadpool(
            service.import_zup_departments,
            parent_id=payload.parent_id,
            departments=payload.departments,
        )
    except ValueError as exc:
        status = 404 if "not found" in str(exc).lower() else 400
        raise HTTPException(status_code=status, detail=str(exc)) from exc


@router.post("/nodes", response_model=CompanyStructureNodeResponse)
async def create_company_structure_node(
    payload: CompanyStructureNodeCreate,
    _: User = Depends(require_permission(PERM_COMPANY_STRUCTURE_WRITE)),
):
    service = _service()
    try:
        return await run_in_threadpool(service.create_node, payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/nodes/{node_id}", response_model=CompanyStructureNodeResponse)
async def update_company_structure_node(
    node_id: str,
    payload: CompanyStructureNodeUpdate,
    _: User = Depends(require_permission(PERM_COMPANY_STRUCTURE_WRITE)),
):
    service = _service()
    try:
        return await run_in_threadpool(
            service.update_node,
            node_id,
            payload.model_dump(exclude_unset=True),
        )
    except ValueError as exc:
        status = 404 if "not found" in str(exc).lower() else 400
        raise HTTPException(status_code=status, detail=str(exc)) from exc


@router.put("/nodes/{node_id}/position", response_model=CompanyStructureNodeResponse)
async def move_company_structure_node(
    node_id: str,
    payload: CompanyStructureMoveRequest,
    _: User = Depends(require_permission(PERM_COMPANY_STRUCTURE_WRITE)),
):
    service = _service()
    try:
        return await run_in_threadpool(
            service.move_node,
            node_id,
            parent_id=payload.parent_id,
            position=payload.position,
        )
    except ValueError as exc:
        status = 404 if "not found" in str(exc).lower() else 400
        raise HTTPException(status_code=status, detail=str(exc)) from exc


@router.post("/nodes/{node_id}/photo", response_model=CompanyStructureNodeResponse)
async def upload_company_structure_node_photo(
    node_id: str,
    file: UploadFile = File(...),
    _: User = Depends(require_permission(PERM_COMPANY_STRUCTURE_WRITE)),
):
    service = _service()
    raw = await file.read(2 * 1024 * 1024 + 1)
    try:
        return await run_in_threadpool(
            service.save_node_photo,
            node_id,
            raw=raw,
            content_type=str(file.content_type or ""),
        )
    except ValueError as exc:
        status = 404 if "not found" in str(exc).lower() else 400
        raise HTTPException(status_code=status, detail=str(exc)) from exc


@router.delete("/nodes/{node_id}/photo", response_model=CompanyStructureNodeResponse)
async def delete_company_structure_node_photo(
    node_id: str,
    _: User = Depends(require_permission(PERM_COMPANY_STRUCTURE_WRITE)),
):
    service = _service()
    try:
        return await run_in_threadpool(service.delete_node_photo, node_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/nodes/{node_id}/photo")
async def get_company_structure_node_photo(node_id: str):
    service = _service()
    try:
        path = await run_in_threadpool(service.get_node_photo_path, node_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    stat = os.stat(path)
    return FileResponse(
        path=str(path),
        media_type="image/jpeg",
        headers={
            "Cache-Control": "public, max-age=0, must-revalidate",
            "ETag": f'"{int(stat.st_mtime)}-{stat.st_size}"',
        },
    )


@router.delete("/layout")
async def reset_company_structure_layout(
    _: User = Depends(require_permission(PERM_COMPANY_STRUCTURE_WRITE)),
):
    service = _service()
    return await run_in_threadpool(service.reset_layout_positions)


@router.put("/nodes/{node_id}/parent")
async def set_company_structure_node_parent(
    node_id: str,
    payload: dict = Body(...),
    _: User = Depends(require_permission(PERM_COMPANY_STRUCTURE_WRITE)),
):
    service = _service()
    body = payload if isinstance(payload, dict) else {}
    try:
        return await run_in_threadpool(
            service.set_parent,
            node_id,
            parent_id=body.get("parent_id"),
            sort_order=body.get("sort_order"),
        )
    except ValueError as exc:
        message = str(exc)
        status = 404 if "not found" in message.lower() else 400
        raise HTTPException(status_code=status, detail=message) from exc


@router.put("/nodes/{node_id}/department-codes")
async def set_company_structure_department_codes(
    node_id: str,
    payload: dict = Body(...),
    _: User = Depends(require_permission(PERM_COMPANY_STRUCTURE_WRITE)),
):
    service = _service()
    body = payload if isinstance(payload, dict) else {}
    codes = body.get("department_codes") if isinstance(body, dict) else []
    try:
        return await run_in_threadpool(service.set_department_codes, node_id, codes or [])
    except ValueError as exc:
        status = 404 if "not found" in str(exc).lower() else 400
        raise HTTPException(status_code=status, detail=str(exc)) from exc


@router.delete("/nodes/{node_id}")
async def delete_company_structure_node(
    node_id: str,
    force: bool = Query(False),
    _: User = Depends(require_permission(PERM_COMPANY_STRUCTURE_WRITE)),
):
    service = _service()
    try:
        return await run_in_threadpool(service.delete_node, node_id, force=bool(force))
    except ValueError as exc:
        message = str(exc)
        status = 404 if "not found" in message.lower() else 400
        raise HTTPException(status_code=status, detail=message) from exc


@router.get("/nodes/{node_id}/people", response_model=CompanyStructurePeopleResponse)
async def list_company_structure_node_people(
    node_id: str,
    limit: int = Query(500, ge=1, le=2000),
    include_descendants: bool = Query(False),
    _: User = Depends(require_permission(PERM_COMPANY_STRUCTURE_READ)),
):
    service = _service()
    try:
        return await run_in_threadpool(
            service.list_node_people,
            node_id,
            limit=int(limit),
            include_descendants=bool(include_descendants),
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/department-codes")
async def list_company_structure_department_codes(
    q: str = Query("", max_length=200),
    limit: int = Query(50, ge=1, le=200),
    _: User = Depends(require_permission(PERM_COMPANY_STRUCTURE_READ)),
):
    service = _service()
    return await run_in_threadpool(service.list_department_code_suggestions, q, int(limit))


@router.get("/department-names")
async def list_company_structure_department_names(
    q: str = Query("", max_length=200),
    limit: int = Query(50, ge=1, le=1000),
    _: User = Depends(require_permission(PERM_COMPANY_STRUCTURE_READ)),
):
    service = _service()
    return await run_in_threadpool(service.list_department_name_suggestions, q, int(limit))
