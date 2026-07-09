# -*- coding: utf-8 -*-
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool

from backend.api.deps import get_current_admin_user, require_permission
from backend.models.auth import User
from backend.services.authorization_service import PERM_WAREHOUSE_1C_READ
from backend.services.warehouse_1c_service import (
    Warehouse1CQueryError,
    Warehouse1CValidationError,
    warehouse_1c_service,
)


router = APIRouter()


async def _run_or_raise(coro):
    try:
        return await coro
    except Warehouse1CValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Warehouse1CQueryError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/nomenclature/search")
async def search_nomenclature(
    q: str = Query("", min_length=0, max_length=200),
    limit: int = Query(20, ge=1, le=50),
    _: User = Depends(require_permission(PERM_WAREHOUSE_1C_READ)),
):
    return await _run_or_raise(warehouse_1c_service.search_nomenclature(q, limit))


@router.get("/warehouses/search")
async def search_warehouses(
    q: str = Query("", min_length=0, max_length=200),
    limit: int = Query(20, ge=1, le=100),
    _: User = Depends(require_permission(PERM_WAREHOUSE_1C_READ)),
):
    return await _run_or_raise(warehouse_1c_service.search_warehouses(q, limit))


@router.get("/nomenclature/suggest")
async def suggest_nomenclature(
    text: str = Query("", min_length=0, max_length=500),
    limit: int = Query(20, ge=1, le=50),
    _: User = Depends(require_permission(PERM_WAREHOUSE_1C_READ)),
):
    return await _run_or_raise(warehouse_1c_service.suggest_nomenclature(text, limit))


@router.get("/employee-warehouse")
async def get_employee_warehouse(
    employee_name: str = Query("", max_length=200),
    warehouse_ref: str = Query("", max_length=64),
    load_balances: bool = Query(True),
    limit: int = Query(200, ge=1, le=500),
    _: User = Depends(require_permission(PERM_WAREHOUSE_1C_READ)),
):
    return await _run_or_raise(
        warehouse_1c_service.get_employee_warehouse(
            employee_name=employee_name,
            warehouse_ref=warehouse_ref,
            load_balances=load_balances,
            balances_limit=limit,
        )
    )


@router.get("/balances")
async def get_balances(
    nomenclature_ref: str = Query("", max_length=64),
    warehouse_ref: str = Query("", max_length=64),
    q: str = Query("", max_length=200),
    limit: int = Query(200, ge=1, le=500),
    _: User = Depends(require_permission(PERM_WAREHOUSE_1C_READ)),
):
    return await _run_or_raise(
        warehouse_1c_service.get_balances(
            nomenclature_ref=nomenclature_ref,
            warehouse_ref=warehouse_ref,
            text=q,
            limit=limit,
        )
    )


@router.get("/movements")
async def get_movements(
    nomenclature_ref: str = Query(..., max_length=64),
    warehouse_ref: str = Query("", max_length=64),
    series_ref: str = Query("", max_length=64),
    date_from: str = Query("", max_length=10),
    date_to: str = Query("", max_length=10),
    limit: int = Query(500, ge=1, le=2000),
    _: User = Depends(require_permission(PERM_WAREHOUSE_1C_READ)),
):
    return await _run_or_raise(
        warehouse_1c_service.get_movements(
            nomenclature_ref=nomenclature_ref,
            warehouse_ref=warehouse_ref,
            series_ref=series_ref,
            date_from=date_from or None,
            date_to=date_to or None,
            limit=limit,
        )
    )


@router.get("/movements/detail")
async def get_movement_detail(
    registrar_ref: str = Query(..., max_length=64),
    _: User = Depends(require_permission(PERM_WAREHOUSE_1C_READ)),
):
    return await _run_or_raise(warehouse_1c_service.get_movement_detail(registrar_ref))


@router.get("/catalog/status")
async def get_catalog_status(
    _: User = Depends(require_permission(PERM_WAREHOUSE_1C_READ)),
):
    return await run_in_threadpool(warehouse_1c_service.get_catalog_status)


@router.post("/catalog/sync")
async def sync_catalog(
    _: User = Depends(get_current_admin_user),
):
    try:
        return await run_in_threadpool(warehouse_1c_service.sync_catalog_from_1c)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
