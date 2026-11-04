"""Shared libraries ("Общие папки") of My Files: administrators create them, members use them like a disk."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from backend.api.deps import ensure_user_permission, require_permission
from backend.api.v1.my_files import _enforce_trusted_browser_origin, _request_meta, _service_error_to_http
from backend.models.auth import User
from backend.services.authorization_service import PERM_MY_FILES_LIBRARIES_MANAGE, PERM_MY_FILES_READ
from backend.services.my_files_library_service import MAX_LIBRARY_MEMBERS, my_files_library_service


router = APIRouter()


class LibraryResponse(BaseModel):
    id: str
    name: str
    quota_bytes: int = 0
    used_bytes: int = 0
    files_count: int = 0
    members_count: int = 0
    my_role: str = ""
    created_at: datetime | None = None
    updated_at: datetime | None = None


class LibraryListResponse(BaseModel):
    items: list[LibraryResponse] = Field(default_factory=list)
    can_manage: bool = False


class LibraryCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    quota_bytes: int = Field(default=0, ge=0)


class LibraryUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    quota_bytes: int | None = Field(default=None, ge=0)


class LibraryMember(BaseModel):
    principal_type: Literal["user", "department"]
    principal_id: str = Field(min_length=1, max_length=64)
    role: Literal["manage", "edit", "comment", "view"] = "edit"


class LibraryMemberResponse(LibraryMember):
    name: str = ""
    members_count: int = 0


class LibraryMembersRequest(BaseModel):
    members: list[LibraryMember] = Field(default_factory=list, max_length=MAX_LIBRARY_MEMBERS)


class LibraryMembersResponse(BaseModel):
    items: list[LibraryMemberResponse] = Field(default_factory=list)


def _can_manage(user: User) -> bool:
    try:
        ensure_user_permission(user, PERM_MY_FILES_LIBRARIES_MANAGE)
    except HTTPException:
        return False
    return True


@router.get("/libraries", response_model=LibraryListResponse)
async def list_libraries(current_user: User = Depends(require_permission(PERM_MY_FILES_READ))) -> dict:
    can_manage = _can_manage(current_user)
    try:
        items = await run_in_threadpool(
            my_files_library_service.list_for_user, user_id=int(current_user.id), is_admin=can_manage
        )
    except Exception as exc:
        raise _service_error_to_http(exc) from exc
    return {"items": items, "can_manage": can_manage}


@router.post("/libraries", response_model=LibraryResponse, status_code=status.HTTP_201_CREATED)
async def create_library(
    payload: LibraryCreateRequest,
    request: Request,
    current_user: User = Depends(require_permission(PERM_MY_FILES_LIBRARIES_MANAGE)),
) -> dict:
    _enforce_trusted_browser_origin(request)
    try:
        return await run_in_threadpool(
            my_files_library_service.create_library,
            actor=current_user,
            name=payload.name,
            quota_bytes=payload.quota_bytes,
            meta=_request_meta(request),
        )
    except Exception as exc:
        raise _service_error_to_http(exc) from exc


@router.patch("/libraries/{library_id}", response_model=LibraryResponse)
async def update_library(
    library_id: str,
    payload: LibraryUpdateRequest,
    request: Request,
    current_user: User = Depends(require_permission(PERM_MY_FILES_LIBRARIES_MANAGE)),
) -> dict:
    _enforce_trusted_browser_origin(request)
    try:
        return await run_in_threadpool(
            my_files_library_service.update_library,
            library_id=library_id,
            actor=current_user,
            name=payload.name,
            quota_bytes=payload.quota_bytes,
            meta=_request_meta(request),
        )
    except Exception as exc:
        raise _service_error_to_http(exc) from exc


@router.delete("/libraries/{library_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_library(
    library_id: str,
    request: Request,
    current_user: User = Depends(require_permission(PERM_MY_FILES_LIBRARIES_MANAGE)),
) -> Response:
    _enforce_trusted_browser_origin(request)
    try:
        await run_in_threadpool(
            my_files_library_service.delete_library,
            library_id=library_id,
            actor=current_user,
            meta=_request_meta(request),
        )
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except Exception as exc:
        raise _service_error_to_http(exc) from exc


@router.get("/libraries/{library_id}/members", response_model=LibraryMembersResponse)
async def list_library_members(
    library_id: str,
    current_user: User = Depends(require_permission(PERM_MY_FILES_LIBRARIES_MANAGE)),
) -> dict:
    try:
        items = await run_in_threadpool(my_files_library_service.list_members, library_id=library_id)
    except Exception as exc:
        raise _service_error_to_http(exc) from exc
    return {"items": items}


@router.put("/libraries/{library_id}/members", response_model=LibraryMembersResponse)
async def set_library_members(
    library_id: str,
    payload: LibraryMembersRequest,
    request: Request,
    current_user: User = Depends(require_permission(PERM_MY_FILES_LIBRARIES_MANAGE)),
) -> dict:
    _enforce_trusted_browser_origin(request)
    try:
        items = await run_in_threadpool(
            my_files_library_service.set_members,
            library_id=library_id,
            members=[(item.principal_type, item.principal_id, item.role) for item in payload.members],
            actor=current_user,
            meta=_request_meta(request),
        )
    except Exception as exc:
        raise _service_error_to_http(exc) from exc
    return {"items": items}
