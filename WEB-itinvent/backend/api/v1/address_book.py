# -*- coding: utf-8 -*-
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool

from backend.api.deps import get_current_admin_user, require_permission
from backend.models.auth import User
from backend.services.address_book_service import address_book_service
from backend.services.authorization_service import PERM_ADDRESS_BOOK_READ


router = APIRouter()


@router.get("/search")
async def search_address_book(
    q: str = Query("", min_length=0, max_length=200),
    limit: int = Query(50, ge=1, le=200),
    _: User = Depends(require_permission(PERM_ADDRESS_BOOK_READ)),
):
    return await run_in_threadpool(address_book_service.search, q, int(limit))


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
