# -*- coding: utf-8 -*-
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

from backend.api.deps import get_current_admin_user, require_permission
from backend.models.auth import User
from backend.services.address_book_service import address_book_service
from backend.services.authorization_service import (
    PERM_ADDRESS_BOOK_AGE_READ,
    PERM_ADDRESS_BOOK_HIRE_DATE_READ,
    PERM_ADDRESS_BOOK_PERSONAL_EMAIL_READ,
    PERM_ADDRESS_BOOK_PERSONAL_PHONE_READ,
    PERM_ADDRESS_BOOK_READ,
    authorization_service,
)


router = APIRouter()


def _public_field_flags(current_user: User) -> dict[str, bool]:
    permissions = set(getattr(current_user, "permissions", []) or [])
    permissions.update(
        authorization_service.get_effective_permissions(
            current_user.role,
            use_custom_permissions=bool(current_user.use_custom_permissions),
            custom_permissions=current_user.custom_permissions,
        )
    )
    return {
        "include_age": PERM_ADDRESS_BOOK_AGE_READ in permissions,
        "include_hire_date": PERM_ADDRESS_BOOK_HIRE_DATE_READ in permissions,
        "include_personal_emails": PERM_ADDRESS_BOOK_PERSONAL_EMAIL_READ in permissions,
        "include_personal_phones": PERM_ADDRESS_BOOK_PERSONAL_PHONE_READ in permissions,
    }


def _build_snapshot_response(**field_flags: bool) -> JSONResponse:
    return JSONResponse(
        content=address_book_service.snapshot(**field_flags),
        headers={"Cache-Control": "private, no-store"},
    )


@router.get("/search")
async def search_address_book(
    q: str = Query("", min_length=0, max_length=200),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(require_permission(PERM_ADDRESS_BOOK_READ)),
):
    search_kwargs = _public_field_flags(current_user)
    if int(offset) > 0:
        search_kwargs["offset"] = int(offset)
    return await run_in_threadpool(
        address_book_service.search,
        q,
        int(limit),
        **search_kwargs,
    )


@router.get("/snapshot")
async def get_address_book_snapshot(
    current_user: User = Depends(require_permission(PERM_ADDRESS_BOOK_READ)),
):
    return await run_in_threadpool(
        _build_snapshot_response,
        **_public_field_flags(current_user),
    )


@router.get("/status")
async def get_address_book_status(
    _: User = Depends(require_permission(PERM_ADDRESS_BOOK_READ)),
):
    return await run_in_threadpool(address_book_service.get_status)


@router.post("/sync")
async def sync_address_book(
    _: User = Depends(get_current_admin_user),
):
    try:
        return await run_in_threadpool(address_book_service.sync_from_1c)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
