from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool

from backend.api.deps import get_current_admin_user, require_permission
from backend.models.auth import User
from backend.services.ad_groups_access_service import (
    get_export_dataset,
    get_group_detail,
    get_matrix,
    get_matrix_grid,
    get_status,
    search_user_access,
    sync_snapshot,
)
from backend.services.authorization_service import PERM_GROUPS_ACCESS_READ

router = APIRouter()


@router.get("/status")
async def groups_access_status(
    _: User = Depends(require_permission(PERM_GROUPS_ACCESS_READ)),
):
    return await run_in_threadpool(get_status)


@router.get("/matrix")
async def groups_access_matrix(
    branch: str = Query(default=""),
    q: str = Query(default="", max_length=200),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=5000),
    _: User = Depends(require_permission(PERM_GROUPS_ACCESS_READ)),
):
    normalized_branch = str(branch or "").strip() or None
    return await run_in_threadpool(
        get_matrix,
        branch=normalized_branch,
        query=q,
        page=page,
        limit=limit,
    )


@router.get("/user")
async def groups_access_user_search(
    q: str = Query(..., min_length=1, max_length=200),
    branch: str = Query(default=""),
    limit: int = Query(default=100, ge=1, le=200),
    _: User = Depends(require_permission(PERM_GROUPS_ACCESS_READ)),
):
    normalized_branch = str(branch or "").strip() or None
    return await run_in_threadpool(
        search_user_access,
        query=q,
        branch=normalized_branch,
        limit=limit,
    )


@router.get("/matrix-grid")
async def groups_access_matrix_grid(
    branch: str = Query(default=""),
    folder_q: str = Query(default="", max_length=200),
    user_q: str = Query(default="", max_length=200),
    _: User = Depends(require_permission(PERM_GROUPS_ACCESS_READ)),
):
    normalized_branch = str(branch or "").strip() or None
    return await run_in_threadpool(
        get_matrix_grid,
        branch=normalized_branch,
        folder_query=folder_q,
        user_query=user_q,
    )


@router.get("/export")
async def groups_access_export(
    branch: str = Query(default=""),
    folder_q: str = Query(default="", max_length=200),
    user_q: str = Query(default="", max_length=200),
    _: User = Depends(require_permission(PERM_GROUPS_ACCESS_READ)),
):
    normalized_branch = str(branch or "").strip() or None
    return await run_in_threadpool(
        get_export_dataset,
        branch=normalized_branch,
        folder_query=folder_q,
        user_query=user_q,
    )


@router.get("/group")
async def groups_access_group_detail(
    dn: str = Query(..., min_length=3, max_length=1024),
    _: User = Depends(require_permission(PERM_GROUPS_ACCESS_READ)),
):
    payload = await run_in_threadpool(get_group_detail, group_dn=dn)
    if payload.get("status") == "not_found":
        raise HTTPException(status_code=404, detail="Group not found in snapshot")
    if payload.get("status") == "error":
        raise HTTPException(status_code=400, detail=str(payload.get("error") or "Invalid request"))
    return payload


@router.post("/refresh")
async def groups_access_refresh(
    _: User = Depends(get_current_admin_user),
):
    result = await run_in_threadpool(sync_snapshot, force=True)
    if result.get("status") == "error":
        raise HTTPException(status_code=500, detail=str(result.get("message") or "Sync failed"))
    return result
