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
    if operation == "catalog_sync":
        return service.sync_catalog_from_1c()
    raise ValueError(f"Read operation {operation!r} is not implemented by the warehouse 1C dispatcher")
