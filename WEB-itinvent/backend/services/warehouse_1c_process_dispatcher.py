"""Typed read dispatcher executed inside the isolated 1C COM child process.

It deliberately exposes only the warehouse reads used by the web API.  The
child creates its own service with process bridging disabled, so no request can
recursively create another bridge or access a mutable 1C operation.
"""
from __future__ import annotations

import asyncio
from typing import Any


_service: Any | None = None


def _get_service() -> Any:
    global _service
    if _service is None:
        from backend.services.warehouse_1c_service import Warehouse1CService

        _service = Warehouse1CService(enable_process_bridge=False)
    return _service


def dispatch(operation: str, payload: dict[str, Any]) -> Any:
    """Run one allowlisted, JSON-only warehouse read in the COM child."""
    service = _get_service()
    if operation == "warmup":
        return service.warmup_connection()
    if operation == "balances":
        return asyncio.run(
            service.get_balances(
                nomenclature_ref=str(payload.get("nomenclature_ref") or ""),
                warehouse_ref=str(payload.get("warehouse_ref") or ""),
                text=str(payload.get("text") or ""),
                limit=payload.get("limit"),
                include_meta=bool(payload.get("include_meta")),
            )
        )
    if operation == "balances_batch":
        refs = payload.get("nomenclature_refs")
        if not isinstance(refs, list):
            raise ValueError("nomenclature_refs должен быть массивом")
        return asyncio.run(
            service.get_balances_batch(
                nomenclature_refs=[str(ref or "") for ref in refs],
                warehouse_ref=str(payload.get("warehouse_ref") or ""),
                limit_per_nomenclature=int(payload.get("limit_per_nomenclature") or 50),
            )
        )
    if operation == "movements":
        return asyncio.run(
            service.get_movements(
                nomenclature_ref=str(payload.get("nomenclature_ref") or ""),
                warehouse_ref=str(payload.get("warehouse_ref") or ""),
                series_ref=str(payload.get("series_ref") or ""),
                date_from=str(payload.get("date_from") or "") or None,
                date_to=str(payload.get("date_to") or "") or None,
                limit=payload.get("limit"),
                cursor=str(payload.get("cursor") or "") or None,
                include_meta=bool(payload.get("include_meta")),
            )
        )
    if operation == "it_requests":
        raw_overdue = payload.get("overdue")
        overdue = raw_overdue if isinstance(raw_overdue, bool) else None
        return asyncio.run(
            service.get_it_requests(
                view=str(payload.get("view") or "active"),
                search=str(payload.get("search") or ""),
                stage=str(payload.get("stage") or ""),
                overdue=overdue,
                limit=int(payload.get("limit") or 25),
                cursor=str(payload.get("cursor") or "") or None,
                warehouse_ref=str(payload.get("warehouse_ref") or ""),
                refresh=bool(payload.get("refresh")),
            )
        )
    if operation == "it_request_detail":
        return asyncio.run(
            service.get_it_request_detail(str(payload.get("request_ref") or ""))
        )
    if operation == "construction_objects":
        return asyncio.run(
            service.get_construction_objects(
                search=str(payload.get("search") or ""),
                kind=str(payload.get("kind") or "all"),
                limit=int(payload.get("limit") or 24),
                cursor=str(payload.get("cursor") or "") or None,
                refresh=bool(payload.get("refresh")),
                managed_objects=list(payload.get("managed_objects") or []),
            )
        )
    if operation == "construction_object_requests":
        raw_group_refs = payload.get("group_refs")
        if not isinstance(raw_group_refs, list):
            raise ValueError("group_refs должен быть массивом")
        raw_overdue = payload.get("overdue")
        overdue = raw_overdue if isinstance(raw_overdue, bool) else None
        return asyncio.run(
            service.get_construction_object_requests(
                group_refs=[str(value or "") for value in raw_group_refs],
                view=str(payload.get("view") or "active"),
                search=str(payload.get("search") or ""),
                stage=str(payload.get("stage") or ""),
                overdue=overdue,
                warehouse_ref=str(payload.get("warehouse_ref") or ""),
                limit=int(payload.get("limit") or 25),
                cursor=str(payload.get("cursor") or "") or None,
                refresh=bool(payload.get("refresh")),
            )
        )
    if operation == "construction_object_request_detail":
        raw_group_refs = payload.get("group_refs")
        if not isinstance(raw_group_refs, list):
            raise ValueError("group_refs должен быть массивом")
        return asyncio.run(
            service.get_construction_object_request_detail(
                group_refs=[str(value or "") for value in raw_group_refs],
                request_ref=str(payload.get("request_ref") or ""),
            )
        )
    if operation == "catalog_sync":
        return service.sync_catalog_from_1c()
    raise ValueError(f"Read operation {operation!r} is not implemented by the warehouse 1C dispatcher")
