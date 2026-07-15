# -*- coding: utf-8 -*-
from __future__ import annotations

import os

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from urllib.parse import quote

from backend.api.deps import (
    get_current_admin_user,
    get_current_database_id,
    require_permission,
)
from backend.models.auth import User
from backend.models.warehouse_1c import (
    EmployeeOwnerLinkRequest,
    ReconcileAiSuggestRequest,
    ReconcileApplyPartNoRequest,
    ReconcileAutoLinkRequest,
    ReconcileMarkNotIn1CRequest,
    Warehouse1CBalanceBatchRequest,
    WarehouseOwnerLinkRequest,
)
from backend.services.authorization_service import (
    PERM_DATABASE_WRITE,
    PERM_WAREHOUSE_1C_READ,
    PERM_WAREHOUSE_1C_RECONCILE_WRITE,
)
from backend.services.one_c_reconcile_registry_service import OneCReconcileRegistryConflict
from backend.services.warehouse_1c_scope import (
    Warehouse1CAllScopeConfigurationError,
    allowlisted_reconcile_db_configs,
)
from backend.services.warehouse_1c_service import (
    Warehouse1CCatalogUnavailableError,
    Warehouse1CQueryError,
    Warehouse1CValidationError,
    warehouse_1c_service,
)


router = APIRouter()


async def _run_or_raise(coro):
    try:
        return await coro
    except Warehouse1CCatalogUnavailableError as exc:
        raise HTTPException(
            status_code=503,
            detail={"code": "catalog_unavailable", "message": str(exc)},
        ) from exc
    except Warehouse1CValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OneCReconcileRegistryConflict as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "reconcile_version_conflict",
                "message": str(exc),
            },
        ) from exc
    except Warehouse1CQueryError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


def _is_admin(current_user: User) -> bool:
    return str(current_user.role or "").strip().lower() == "admin"


def _reconcile_write_enabled() -> bool:
    """Return the rollout switch for every HUB-side reconcile mutation.

    The switch deliberately governs registry links, their legacy ``PART_NO``
    projection, and owner mappings together.  A permission alone must never
    accidentally re-open a write path during audit-only rollout.
    """
    # The registry/audit migration is now the normal production baseline.
    # Set the flag explicitly to 0 only for a controlled audit-only rollback.
    value = str(os.getenv("WAREHOUSE_1C_RECONCILE_REGISTRY_WRITE_ENABLED", "1")).strip().lower()
    return value in {"1", "true", "yes", "on"}


def _require_reconcile_write_enabled() -> None:
    if not _reconcile_write_enabled():
        raise HTTPException(
            status_code=409,
            detail=(
                "1C reconciliation write mode is disabled by feature flag; "
                "the current rollout is preview/audit-only"
            ),
        )


def _resolve_scoped_hub_db(
    *,
    current_user: User,
    selected_db_id: str | None,
    requested_scope: str = "current",
) -> tuple[str | None, str]:
    """Resolve one server-owned HUB database, or explicit admin-only ``all``.

    A browser header is only a hint.  In particular, an ordinary user without
    an assigned or persisted database must never turn ``None`` into a query
    across every configured HUB database.
    """
    scope = str(requested_scope or "current").strip().lower() or "current"
    if scope not in {"current", "all"}:
        raise HTTPException(status_code=422, detail="scope must be current or all")
    if scope == "all":
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Cross-DB reconciliation is available to administrators only")
        from backend.api.v1.database import get_all_db_configs

        try:
            allowed = allowlisted_reconcile_db_configs(get_all_db_configs())
        except Warehouse1CAllScopeConfigurationError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        if not allowed:
            # Defensive: the helper currently raises for this case, but a
            # cross-DB aggregate must stay fail-closed if that changes.
            raise HTTPException(status_code=409, detail="No HUB databases are allowlisted for scope=all")
        return None, "all"

    from backend.api.v1.database import normalize_database_id, resolve_current_database_id

    if _is_admin(current_user):
        # ``get_current_database_id`` has already validated the selected
        # database. Fall back to a configured server default instead of an
        # accidental all-database read when the admin has not selected one.
        current = normalize_database_id(selected_db_id)
        if not current:
            current, _ = resolve_current_database_id(current_user, include_default=True)
            current = normalize_database_id(current)
    else:
        # Do not pass request headers/cookies here: a non-admin's reconcile
        # scope comes only from an assignment or persisted server-side choice.
        current, _ = resolve_current_database_id(current_user, include_default=False)
        current = normalize_database_id(current)

    if not current:
        raise HTTPException(
            status_code=409,
            detail="Select or assign a HUB database before using 1C reconciliation",
        )
    return current, "current"


async def _require_expected_part_no(
    *,
    inv_no: str,
    expected_part_no: str | None,
    db_id: str | None,
) -> None:
    """Reject a stale manual reconcile decision when the observed PART_NO changed."""
    if expected_part_no is None:
        return

    from backend.database import queries as db_queries

    equipment = await run_in_threadpool(db_queries.get_equipment_by_inv, inv_no, db_id)
    if not equipment:
        raise HTTPException(status_code=404, detail="HUB equipment was not found")

    current_part_no = str(equipment.get("part_no") or equipment.get("PART_NO") or "").strip()
    if current_part_no.casefold() != expected_part_no.strip().casefold():
        raise HTTPException(
            status_code=409,
            detail={
                "code": "reconcile_part_no_conflict",
                "message": "PART_NO changed since this reconcile decision was opened",
                "current_part_no": current_part_no,
            },
        )


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
    include_meta: bool = Query(False),
    _: User = Depends(require_permission(PERM_WAREHOUSE_1C_READ)),
):
    return await _run_or_raise(
        warehouse_1c_service.get_balances(
            nomenclature_ref=nomenclature_ref,
            warehouse_ref=warehouse_ref,
            text=q,
            limit=limit,
            include_meta=include_meta,
        )
    )


@router.get("/balances-with-hub")
async def get_balances_with_hub(
    nomenclature_ref: str = Query(..., max_length=64),
    part_no: str = Query("", max_length=200),
    nomenclature_code: str = Query("", max_length=200),
    model_name: str = Query("", max_length=500),
    hub_query: str = Query("", max_length=500),
    hub_query_source: str = Query("model", max_length=32),
    limit: int = Query(200, ge=1, le=500),
    scope: str = Query("current", max_length=16),
    db_id: str | None = Depends(get_current_database_id),
    current_user: User = Depends(require_permission(PERM_WAREHOUSE_1C_READ)),
):
    target_db_id, resolved_scope = _resolve_scoped_hub_db(
        current_user=current_user,
        selected_db_id=db_id,
        requested_scope=scope,
    )
    return await _run_or_raise(
        warehouse_1c_service.get_balances_with_hub(
            nomenclature_ref=nomenclature_ref,
            part_no=part_no,
            nomenclature_code=nomenclature_code,
            model_name=model_name,
            hub_query=hub_query,
            hub_query_source=hub_query_source,
            limit=limit,
            db_id=target_db_id,
            scope=resolved_scope,
            include_meta=True,
        )
    )


@router.get("/nomenclature/match-to-hub")
async def match_nomenclature_to_hub(
    nomenclature_code: str = Query("", max_length=200),
    nomenclature_name: str = Query("", max_length=500),
    nomenclature_ref: str = Query("", max_length=64),
    owner_no: int | None = Query(None, ge=1),
    warehouse_name: str = Query("", max_length=200),
    employee_name: str = Query("", max_length=200),
    qty_balance: float | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    scope: str = Query("current", max_length=16),
    db_id: str | None = Depends(get_current_database_id),
    current_user: User = Depends(require_permission(PERM_WAREHOUSE_1C_READ)),
):
    target_db_id, resolved_scope = _resolve_scoped_hub_db(
        current_user=current_user,
        selected_db_id=db_id,
        requested_scope=scope,
    )
    return await _run_or_raise(
        warehouse_1c_service.match_nomenclature_to_hub(
            nomenclature_code=nomenclature_code,
            nomenclature_name=nomenclature_name,
            nomenclature_ref=nomenclature_ref,
            owner_no=owner_no,
            warehouse_name=warehouse_name,
            employee_name=employee_name,
            qty_balance=qty_balance,
            limit=limit,
            db_id=target_db_id,
            scope=resolved_scope,
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
    cursor: str = Query("", max_length=512),
    include_meta: bool = Query(False),
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
            cursor=cursor or None,
            include_meta=include_meta,
        )
    )


@router.get("/movements/detail")
async def get_movement_detail(
    registrar_ref: str = Query(..., max_length=64),
    _: User = Depends(require_permission(PERM_WAREHOUSE_1C_READ)),
):
    return await _run_or_raise(warehouse_1c_service.get_movement_detail(registrar_ref))


@router.get("/movements/files/{file_ref}")
async def download_movement_file(
    file_ref: str,
    registrar_ref: str = Query(..., max_length=64),
    _: User = Depends(require_permission(PERM_WAREHOUSE_1C_READ)),
):
    payload = await _run_or_raise(
        warehouse_1c_service.get_movement_file(registrar_ref, file_ref)
    )
    filename = str(payload.get("name") or "file.bin")
    ascii_name = filename.encode("ascii", "ignore").decode("ascii") or "file.bin"
    utf8_name = quote(filename)
    return StreamingResponse(
        iter((payload["content"],)),
        media_type=str(payload.get("content_type") or "application/octet-stream"),
        headers={
            "Content-Disposition": (
                f'attachment; filename="{ascii_name}"; '
                f"filename*=UTF-8''{utf8_name}"
            ),
            "Content-Length": str(int(payload.get("size") or len(payload["content"]))),
        },
    )


@router.get("/catalog/status")
async def get_catalog_status(
    current_user: User = Depends(require_permission(PERM_WAREHOUSE_1C_READ)),
):
    status = await run_in_threadpool(warehouse_1c_service.get_catalog_status)
    if str(current_user.role or "").strip().lower() != "admin":
        status.pop("last_error", None)
    return status


@router.get("/status")
async def get_warehouse_1c_status(
    current_user: User = Depends(require_permission(PERM_WAREHOUSE_1C_READ)),
):
    status = await run_in_threadpool(warehouse_1c_service.get_runtime_status)
    status["reconcile"] = {
        "write_enabled": _reconcile_write_enabled(),
        "mode": "write_enabled" if _reconcile_write_enabled() else "audit_only",
    }
    if str(current_user.role or "").strip().lower() != "admin":
        status.get("catalog", {}).pop("last_error", None)
        status.get("bridge", {}).pop("last_error", None)
    return status


@router.post("/catalog/sync")
async def sync_catalog(
    _: User = Depends(get_current_admin_user),
):
    try:
        return await run_in_threadpool(warehouse_1c_service.sync_catalog_from_1c_as_leader)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/reconcile/coverage")
async def reconcile_coverage(
    scope: str = Query("current", max_length=16),
    db_id: str | None = Depends(get_current_database_id),
    current_user: User = Depends(require_permission(PERM_WAREHOUSE_1C_READ)),
):
    from backend.services import warehouse_1c_reconcile as reconcile

    target_db, _ = _resolve_scoped_hub_db(
        current_user=current_user,
        selected_db_id=db_id,
        requested_scope=scope,
    )
    return await _run_or_raise(
        run_in_threadpool(reconcile.get_reconcile_coverage, target_db)
    )


@router.post("/reconcile/migrate-legacy")
async def reconcile_migrate_legacy_projection(
    dry_run: bool = Query(True),
    confirm: bool = Query(False),
    limit: int = Query(500, ge=1, le=2000),
    offset: int = Query(0, ge=0),
    db_id: str | None = Depends(get_current_database_id),
    current_user: User = Depends(get_current_admin_user),
    _: User = Depends(require_permission(PERM_WAREHOUSE_1C_RECONCILE_WRITE)),
    __: User = Depends(require_permission(PERM_DATABASE_WRITE)),
):
    """Opt-in audit-only migration from legacy PART_NO to app-owned links."""
    if not dry_run:
        _require_reconcile_write_enabled()
        if not confirm:
            raise HTTPException(status_code=409, detail="Migration commit requires confirm=true")
    from backend.services import warehouse_1c_reconcile as reconcile
    target_db, _ = _resolve_scoped_hub_db(
        current_user=current_user,
        selected_db_id=db_id,
    )

    return await _run_or_raise(
        run_in_threadpool(
            reconcile.migrate_legacy_part_no_candidates,
            db_id=target_db,
            limit=limit,
            offset=offset,
            dry_run=dry_run,
            actor=getattr(current_user, "username", None) or "IT-WEB",
        )
    )


@router.post("/reconcile/warehouse-owner-links")
async def reconcile_set_warehouse_owner_link(
    payload: WarehouseOwnerLinkRequest = Body(...),
    db_id: str | None = Depends(get_current_database_id),
    current_user: User = Depends(get_current_admin_user),
    _: User = Depends(require_permission(PERM_WAREHOUSE_1C_RECONCILE_WRITE)),
    __: User = Depends(require_permission(PERM_DATABASE_WRITE)),
):
    """Confirm or deactivate a 1C warehouse-to-HUB-owner mapping."""
    if not payload.confirm:
        raise HTTPException(status_code=409, detail="Warehouse-owner mapping requires confirm=true")
    _require_reconcile_write_enabled()
    target_db, _ = _resolve_scoped_hub_db(
        current_user=current_user,
        selected_db_id=db_id,
    )
    from backend.database import queries as db_queries
    from backend.services.one_c_reconcile_registry_service import one_c_reconcile_registry_service

    owner = await run_in_threadpool(db_queries.get_owner_by_no, payload.owner_no, target_db)
    if not owner:
        raise HTTPException(status_code=404, detail="HUB owner was not found in the selected database")
    try:
        link = await run_in_threadpool(
            one_c_reconcile_registry_service.upsert_warehouse_owner_link,
            warehouse_ref=payload.warehouse_ref,
            hub_db_id=str(target_db or "default"),
            owner_no=payload.owner_no,
            actor=getattr(current_user, "username", None) or "IT-WEB",
            reason=payload.reason,
            status=payload.status,
            expected_version=payload.expected_version,
        )
    except OneCReconcileRegistryConflict as exc:
        raise HTTPException(
            status_code=409,
            detail={"code": "reconcile_version_conflict", "message": str(exc)},
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if link is None:
        raise HTTPException(status_code=503, detail="App-owned reconcile registry is unavailable")
    return {"hub_db_id": target_db or "", "link": link}


@router.post("/reconcile/employee-owner-links")
async def reconcile_set_employee_owner_link(
    payload: EmployeeOwnerLinkRequest = Body(...),
    db_id: str | None = Depends(get_current_database_id),
    current_user: User = Depends(get_current_admin_user),
    _: User = Depends(require_permission(PERM_WAREHOUSE_1C_RECONCILE_WRITE)),
    __: User = Depends(require_permission(PERM_DATABASE_WRITE)),
):
    """Confirm or deactivate a ZUP employee-code-to-HUB-owner mapping."""
    if not payload.confirm:
        raise HTTPException(status_code=409, detail="Employee-owner mapping requires confirm=true")
    _require_reconcile_write_enabled()
    target_db, _ = _resolve_scoped_hub_db(
        current_user=current_user,
        selected_db_id=db_id,
    )
    from backend.database import queries as db_queries
    from backend.services.one_c_reconcile_registry_service import one_c_reconcile_registry_service

    owner = await run_in_threadpool(db_queries.get_owner_by_no, payload.owner_no, target_db)
    if not owner:
        raise HTTPException(status_code=404, detail="HUB owner was not found in the selected database")
    try:
        link = await run_in_threadpool(
            one_c_reconcile_registry_service.upsert_employee_owner_link,
            employee_code=payload.employee_code,
            hub_db_id=str(target_db or "default"),
            owner_no=payload.owner_no,
            actor=getattr(current_user, "username", None) or "IT-WEB",
            reason=payload.reason,
            status=payload.status,
            expected_version=payload.expected_version,
        )
    except OneCReconcileRegistryConflict as exc:
        raise HTTPException(
            status_code=409,
            detail={"code": "reconcile_version_conflict", "message": str(exc)},
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if link is None:
        raise HTTPException(status_code=503, detail="App-owned reconcile registry is unavailable")
    return {"hub_db_id": target_db or "", "link": link}


@router.get("/reconcile/queue")
async def reconcile_queue(
    queue: str = Query("pending", max_length=32),
    q: str = Query("", max_length=200),
    has_owner: str = Query("with", max_length=16),
    scope: str = Query("current", max_length=16),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db_id: str | None = Depends(get_current_database_id),
    current_user: User = Depends(require_permission(PERM_WAREHOUSE_1C_READ)),
):
    from backend.services import warehouse_1c_reconcile as reconcile
    target_db, _ = _resolve_scoped_hub_db(
        current_user=current_user,
        selected_db_id=db_id,
        requested_scope=scope,
    )

    return await _run_or_raise(
        run_in_threadpool(
            reconcile.list_reconcile_queue,
            queue=queue,
            limit=limit,
            offset=offset,
            q=q,
            has_owner=has_owner,
            db_id=target_db,
        )
    )


@router.get("/reconcile/owner-mismatches")
async def reconcile_owner_mismatches(
    employee_name: str = Query("", max_length=200),
    warehouse_ref: str = Query("", max_length=64),
    limit: int = Query(100, ge=1, le=500),
    scope: str = Query("current", max_length=16),
    db_id: str | None = Depends(get_current_database_id),
    current_user: User = Depends(require_permission(PERM_WAREHOUSE_1C_READ)),
):
    from backend.services import warehouse_1c_reconcile as reconcile
    target_db, _ = _resolve_scoped_hub_db(
        current_user=current_user,
        selected_db_id=db_id,
        requested_scope=scope,
    )

    return await _run_or_raise(
        reconcile.list_owner_mismatches(
            employee_name=employee_name,
            warehouse_ref=warehouse_ref,
            limit=limit,
            db_id=target_db,
        )
    )


@router.get("/reconcile/hub-over-1c")
async def reconcile_hub_over_1c(
    limit: int = Query(50, ge=1, le=200),
    cursor: str = Query("", max_length=512),
    scope: str = Query("current", max_length=16),
    db_id: str | None = Depends(get_current_database_id),
    current_user: User = Depends(require_permission(PERM_WAREHOUSE_1C_READ)),
):
    from backend.services import warehouse_1c_reconcile as reconcile
    target_db, _ = _resolve_scoped_hub_db(
        current_user=current_user,
        selected_db_id=db_id,
        requested_scope=scope,
    )

    return await _run_or_raise(
        reconcile.list_hub_over_1c(limit=limit, cursor=cursor or None, db_id=target_db)
    )


@router.get("/reconcile/item-suggestions")
async def reconcile_item_suggestions(
    inv_no: str = Query("", max_length=64),
    model_name: str = Query("", max_length=500),
    serial_no: str = Query("", max_length=200),
    employee_name: str = Query("", max_length=200),
    owner_no: int | None = Query(None, ge=1),
    limit: int = Query(8, ge=1, le=15),
    db_id: str | None = Depends(get_current_database_id),
    current_user: User = Depends(require_permission(PERM_WAREHOUSE_1C_READ)),
):
    from backend.services import warehouse_1c_reconcile as reconcile

    target_db_id, _ = _resolve_scoped_hub_db(
        current_user=current_user,
        selected_db_id=db_id,
    )
    return await _run_or_raise(
        reconcile.suggest_for_hub_item(
            inv_no=inv_no,
            model_name=model_name,
            serial_no=serial_no,
            employee_name=employee_name,
            owner_no=owner_no,
            limit=limit,
            db_id=target_db_id,
        )
    )


@router.post("/balances/batch")
async def get_balances_batch(
    payload: Warehouse1CBalanceBatchRequest = Body(...),
    _: User = Depends(require_permission(PERM_WAREHOUSE_1C_READ)),
):
    """Fetch up to 50 nomenclature balances in one bounded 1C query."""
    return await _run_or_raise(
        warehouse_1c_service.get_balances_batch(
            nomenclature_refs=payload.nomenclature_refs,
            warehouse_ref=payload.warehouse_ref or "",
            limit_per_nomenclature=payload.limit_per_nomenclature,
        )
    )


@router.post("/reconcile/apply-part-no")
async def reconcile_apply_part_no(
    payload: ReconcileApplyPartNoRequest = Body(...),
    db_id: str | None = Depends(get_current_database_id),
    current_user: User = Depends(require_permission(PERM_WAREHOUSE_1C_RECONCILE_WRITE)),
    _: User = Depends(require_permission(PERM_DATABASE_WRITE)),
):
    from backend.services import warehouse_1c_reconcile as reconcile

    if not payload.confirm:
        raise HTTPException(
            status_code=409,
            detail="Reconcile apply requires confirm=true after reviewing the preview",
        )
    if payload.expected_part_no is None:
        raise HTTPException(
            status_code=422,
            detail="expected_part_no is required for an optimistic reconcile apply",
        )

    target_db, _ = _resolve_scoped_hub_db(
        current_user=current_user,
        selected_db_id=db_id,
    )
    await _require_expected_part_no(
        inv_no=payload.inv_no,
        expected_part_no=payload.expected_part_no,
        db_id=target_db,
    )
    _require_reconcile_write_enabled()
    return await _run_or_raise(
        run_in_threadpool(
            reconcile.apply_part_no,
            inv_no=payload.inv_no,
            part_no=payload.part_no,
            nomenclature_ref=payload.nomenclature_ref,
            reason=payload.reason,
            expected_version=payload.expected_version,
            expected_part_no=payload.expected_part_no,
            db_id=target_db,
            changed_by=getattr(current_user, "username", None) or "IT-WEB",
        )
    )


@router.post("/reconcile/mark-not-in-1c")
async def reconcile_mark_not_in_1c(
    payload: ReconcileMarkNotIn1CRequest = Body(...),
    db_id: str | None = Depends(get_current_database_id),
    current_user: User = Depends(require_permission(PERM_WAREHOUSE_1C_RECONCILE_WRITE)),
    _: User = Depends(require_permission(PERM_DATABASE_WRITE)),
):
    from backend.services import warehouse_1c_reconcile as reconcile

    if not payload.confirm:
        raise HTTPException(
            status_code=409,
            detail="Reconcile exclusion requires confirm=true after reviewing the preview",
        )
    if payload.expected_part_no is None:
        raise HTTPException(
            status_code=422,
            detail="expected_part_no is required for an optimistic reconcile exclusion",
        )

    target_db, _ = _resolve_scoped_hub_db(
        current_user=current_user,
        selected_db_id=db_id,
    )
    await _require_expected_part_no(
        inv_no=payload.inv_no,
        expected_part_no=payload.expected_part_no,
        db_id=target_db,
    )
    _require_reconcile_write_enabled()
    return await _run_or_raise(
        run_in_threadpool(
            reconcile.mark_not_in_1c,
            inv_no=payload.inv_no,
            reason=payload.reason,
            expected_version=payload.expected_version,
            expected_part_no=payload.expected_part_no,
            db_id=target_db,
            changed_by=getattr(current_user, "username", None) or "IT-WEB",
        )
    )


@router.post("/reconcile/auto-link")
async def reconcile_auto_link(
    payload: ReconcileAutoLinkRequest | None = Body(default=None),
    db_id: str | None = Depends(get_current_database_id),
    current_user: User = Depends(require_permission(PERM_WAREHOUSE_1C_READ)),
):
    from backend.services import warehouse_1c_reconcile as reconcile

    body = payload or ReconcileAutoLinkRequest()
    target_db, _ = _resolve_scoped_hub_db(
        current_user=current_user,
        selected_db_id=db_id,
    )
    if not body.dry_run:
        # A fuzzy catalogue suggestion is evidence for a preview, never a
        # blanket write authority.  Applying a link remains the individual
        # typed/CAS `/apply-part-no` confirmation for one exact item.
        raise HTTPException(
            status_code=422,
            detail=(
                "Automatic reconcile is preview-only; confirm one exact "
                "candidate through /reconcile/apply-part-no"
            ),
        )
    return await _run_or_raise(
        reconcile.auto_link_pending(
            limit=body.limit,
            dry_run=True,
            db_id=target_db,
            changed_by=getattr(current_user, "username", None) or "IT-WEB",
            reason=body.reason or "",
        )
    )


@router.post("/reconcile/ai-suggest")
async def reconcile_ai_suggest(
    payload: ReconcileAiSuggestRequest | None = Body(default=None),
    db_id: str | None = Depends(get_current_database_id),
    current_user: User = Depends(require_permission(PERM_WAREHOUSE_1C_READ)),
):
    from backend.services import warehouse_1c_reconcile as reconcile

    body = payload or ReconcileAiSuggestRequest()
    target_db, _ = _resolve_scoped_hub_db(
        current_user=current_user,
        selected_db_id=db_id,
    )
    return await _run_or_raise(
        reconcile.ai_suggest_part_no(
            inv_no=body.inv_no,
            model_name=body.model_name,
            serial_no=body.serial_no,
            limit=body.limit,
            db_id=target_db,
        )
    )
