# -*- coding: utf-8 -*-
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

from backend.api.deps import (
    ensure_user_permission,
    get_current_active_user,
    get_current_admin_user,
    require_any_permission,
)
from backend.models.auth import User
from backend.services.address_book_service import address_book_service
from backend.services.authorization_service import (
    PERM_ADDRESS_BOOK_AGE_READ,
    PERM_ADDRESS_BOOK_DISMISSED_READ,
    PERM_ADDRESS_BOOK_HIRE_DATE_READ,
    PERM_ADDRESS_BOOK_INN_READ,
    PERM_ADDRESS_BOOK_PERSONAL_EMAIL_READ,
    PERM_ADDRESS_BOOK_PERSONAL_PHONE_READ,
    PERM_ADDRESS_BOOK_READ,
    authorization_service,
)


router = APIRouter()


def public_field_flags(current_user: User) -> dict[str, bool]:
    """Resolve address-book field visibility flags from effective user rights."""
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
        "include_inn": PERM_ADDRESS_BOOK_INN_READ in permissions,
        "include_personal_emails": PERM_ADDRESS_BOOK_PERSONAL_EMAIL_READ in permissions,
        "include_personal_phones": PERM_ADDRESS_BOOK_PERSONAL_PHONE_READ in permissions,
    }


# Backwards-compatible alias for the previous private name.
_public_field_flags = public_field_flags


def _is_admin_user(current_user: User) -> bool:
    return str(getattr(current_user, "role", "") or "").strip().lower() == "admin"


def _with_sync_error_flags(payload: Any, current_user: User) -> dict[str, Any]:
    """Expose only the boolean sync-failure flag; keep the raw 1C error for admins."""
    if not isinstance(payload, dict):
        return payload
    result = dict(payload)
    raw_error = str(result.get("last_error") or "").strip()
    result["last_error"] = raw_error if _is_admin_user(current_user) else ""
    result["last_sync_failed"] = bool(raw_error)
    return result


NO_STORE_HEADERS = {"Cache-Control": "private, no-store"}

# C4 employee-code lookups are batched deliberately; keep the bound tight.
MAX_EMPLOYEE_CODES = 50


def normalize_query_value(value: str | None) -> str:
    return str(value or "").strip()


def _build_snapshot_response(current_user: User, **field_flags: bool) -> JSONResponse:
    payload = address_book_service.snapshot(**field_flags)
    return JSONResponse(
        content=_with_sync_error_flags(payload, current_user),
        headers=NO_STORE_HEADERS,
    )


@router.get("/search")
async def search_address_book(
    q: str = Query("", min_length=0, max_length=200),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    dismissed: bool = Query(False),
    department: str | None = Query(None, max_length=200),
    city: str | None = Query(None, max_length=200),
    employee_codes: list[str] = Query(default=[]),
    current_user: User = Depends(get_current_active_user),
):
    ensure_user_permission(
        current_user,
        PERM_ADDRESS_BOOK_DISMISSED_READ if dismissed else PERM_ADDRESS_BOOK_READ,
    )
    if len(employee_codes) > MAX_EMPLOYEE_CODES:
        raise HTTPException(
            status_code=422,
            detail=f"employee_codes accepts at most {MAX_EMPLOYEE_CODES} values",
        )
    search_kwargs = public_field_flags(current_user)
    if int(offset) > 0:
        search_kwargs["offset"] = int(offset)
    if dismissed:
        search_kwargs["dismissed"] = True
    if normalize_query_value(department):
        search_kwargs["department"] = department
    if normalize_query_value(city):
        search_kwargs["city"] = city
    if employee_codes:
        search_kwargs["employee_codes"] = employee_codes
    payload = await run_in_threadpool(
        address_book_service.search,
        q,
        int(limit),
        **search_kwargs,
    )
    return JSONResponse(
        content=_with_sync_error_flags(payload, current_user),
        headers=NO_STORE_HEADERS,
    )


@router.get("/filters")
async def get_address_book_filters(
    dismissed: bool = Query(False),
    current_user: User = Depends(get_current_active_user),
):
    ensure_user_permission(
        current_user,
        PERM_ADDRESS_BOOK_DISMISSED_READ if dismissed else PERM_ADDRESS_BOOK_READ,
    )
    payload = await run_in_threadpool(
        address_book_service.list_filters,
        dismissed=dismissed,
    )
    return JSONResponse(
        content=_with_sync_error_flags(payload, current_user),
        headers=NO_STORE_HEADERS,
    )


@router.get("/snapshot")
async def get_address_book_snapshot(
    dismissed: bool = Query(False),
    current_user: User = Depends(get_current_active_user),
):
    ensure_user_permission(
        current_user,
        PERM_ADDRESS_BOOK_DISMISSED_READ if dismissed else PERM_ADDRESS_BOOK_READ,
    )
    snapshot_kwargs = public_field_flags(current_user)
    if dismissed:
        snapshot_kwargs["dismissed"] = True
    return await run_in_threadpool(
        _build_snapshot_response,
        current_user,
        **snapshot_kwargs,
    )


@router.get("/status")
async def get_address_book_status(
    current_user: User = Depends(
        require_any_permission([PERM_ADDRESS_BOOK_READ, PERM_ADDRESS_BOOK_DISMISSED_READ])
    ),
):
    payload = await run_in_threadpool(address_book_service.get_status)
    return JSONResponse(
        content=_with_sync_error_flags(payload, current_user),
        headers=NO_STORE_HEADERS,
    )


@router.post("/sync")
async def sync_address_book(
    _: User = Depends(get_current_admin_user),
):
    try:
        return await run_in_threadpool(address_book_service.sync_from_1c)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
