# -*- coding: utf-8 -*-
"""Hub ↔ 1C PART_NO reconcile queue (exception-driven workflow)."""
from __future__ import annotations

import base64
import binascii
import asyncio
import json
import logging
import re
from typing import Any

from backend.database import queries as db_queries
from backend.services.warehouse_1c_service import (
    Warehouse1CQueryError,
    Warehouse1CValidationError,
    normalize_1c_ref,
    warehouse_1c_service,
)
from backend.services.one_c_reconcile_registry_service import (
    OneCReconcileRegistryConflict,
    STATUS_EXCLUDED,
    STATUS_INVALID,
    STATUS_LINKED,
    STATUS_PENDING,
    one_c_reconcile_registry_service,
)
from backend.services.warehouse_1c_scope import (
    Warehouse1CAllScopeConfigurationError,
    allowlisted_reconcile_db_configs,
)

logger = logging.getLogger(__name__)

HUB_PART_NO_NOT_IN_1C = db_queries.HUB_PART_NO_NOT_IN_1C


def _hub_db_configs(db_id: str | None = None) -> list[dict[str, Any]]:
    """Resolve Hub DB scope for reconcile.

    When ``db_id`` is set (current user database), work only that DB —
    the UI database switcher is the way to change scope.
    """
    from backend.api.v1.database import get_all_db_configs

    current_db_id = str(db_id or "").strip() or None
    db_configs = get_all_db_configs() or []
    if current_db_id:
        for cfg in db_configs:
            one_id = str(cfg.get("id") or "").strip()
            if one_id and one_id.casefold() == current_db_id.casefold():
                return [{"id": one_id, "name": str(cfg.get("name") or one_id)}]
        return [{"id": current_db_id, "name": current_db_id}]
    try:
        return allowlisted_reconcile_db_configs(db_configs)
    except Warehouse1CAllScopeConfigurationError as exc:
        # The API validates this before entering a cross-DB service call.  A
        # direct/background invocation must have the same fail-closed rule.
        raise Warehouse1CValidationError(str(exc)) from exc


def _tag_db(items: list[dict[str, Any]], *, db_id: str | None, db_name: str) -> list[dict[str, Any]]:
    tagged: list[dict[str, Any]] = []
    for item in items:
        row = dict(item)
        row["hub_db_id"] = db_id or ""
        row["hub_db_name"] = db_name
        tagged.append(row)
    return tagged


def _attach_reconcile_link_versions(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Attach a CAS version without doing one app-DB query per HUB row."""
    if not items or not one_c_reconcile_registry_service.configured:
        for row in items:
            row.setdefault("one_c_link", None)
            row.setdefault("expected_version", 0)
        return items

    item_ids_by_db: dict[str, list[str]] = {}
    for row in items:
        item_id = _extract_hub_item_id(row)
        if item_id:
            db_key = _hub_registry_db_id(row.get("hub_db_id"))
            item_ids_by_db.setdefault(db_key, []).append(item_id)

    links_by_db: dict[str, dict[str, dict[str, Any]]] = {}
    for db_key, item_ids in item_ids_by_db.items():
        try:
            links_by_db[db_key] = one_c_reconcile_registry_service.get_item_links(
                hub_db_id=db_key,
                hub_item_ids=item_ids,
            )
        except Exception:
            logger.warning("Unable to load 1C link versions for HUB database %s", db_key, exc_info=True)
            links_by_db[db_key] = {}

    for row in items:
        item_id = _extract_hub_item_id(row)
        link = links_by_db.get(_hub_registry_db_id(row.get("hub_db_id")), {}).get(item_id) if item_id else None
        row["one_c_link"] = link
        row["expected_version"] = int(link.get("version") or 0) if link else 0
    return items


def _get_registry_link_status_counts(
    *,
    hub_db_id: str | None,
    source_base: str = "buh20",
) -> dict[str, int] | None:
    """Count app-owned link states for one HUB database in one indexed query.

    ``ITEMS.PART_NO`` is a legacy projection.  Once the registry is available,
    only its explicit ``linked`` rows can contribute to confirmed coverage.
    Keeping this query here avoids making the SQL Server query layer depend on
    app-owned PostgreSQL tables.
    """
    if not one_c_reconcile_registry_service.configured:
        return None

    from sqlalchemy import func, select

    from backend.appdb.db import app_session, initialize_app_schema
    from backend.appdb.models import AppOneCItemLink

    database_url = getattr(one_c_reconcile_registry_service, "_database_url", None)
    initialize_app_schema(database_url)
    with app_session(database_url) as session:
        rows = session.execute(
            select(AppOneCItemLink.status, func.count(AppOneCItemLink.id))
            .where(
                AppOneCItemLink.hub_db_id == _hub_registry_db_id(hub_db_id),
                AppOneCItemLink.source_base
                == (str(source_base or "buh20").strip() or "buh20"),
            )
            .group_by(AppOneCItemLink.status)
        ).all()

    counts = {
        STATUS_PENDING: 0,
        STATUS_LINKED: 0,
        STATUS_EXCLUDED: 0,
        STATUS_INVALID: 0,
    }
    for raw_status, raw_count in rows:
        status = str(raw_status or "").strip().lower()
        if status not in counts:
            continue
        try:
            counts[status] = int(raw_count or 0)
        except (TypeError, ValueError):
            continue
    return counts


def get_reconcile_coverage(db_id: str | None = None) -> dict[str, Any]:
    totals = {
        "pending_count": 0,
        "not_in_1c_count": 0,
        "invalid_count": 0,
        "linked_count": 0,
        "total_count": 0,
        "legacy_pending_count": 0,
        "legacy_not_in_1c_count": 0,
        "legacy_linked_count": 0,
    }
    per_db: list[dict[str, Any]] = []
    registry_configured = bool(one_c_reconcile_registry_service.configured)
    for cfg in _hub_db_configs(db_id):
        one_db_id = str(cfg.get("id") or "").strip() or None
        db_name = str(cfg.get("name") or one_db_id or "default")
        try:
            counts = db_queries.count_hub_part_no_coverage(db_id=one_db_id)
        except Exception as exc:
            logger.warning("count_hub_part_no_coverage failed for db=%s: %s", one_db_id, exc)
            continue
        counts = dict(counts)
        if registry_configured:
            # A usable legacy code is only a migration candidate.  Coverage is
            # based on the registry decision, which prevents PART_NO from
            # silently inflating the confirmed-link percentage.
            registry_counts = _get_registry_link_status_counts(hub_db_id=one_db_id)
            if registry_counts is None:
                raise Warehouse1CQueryError("1C reconcile registry is not available")
            registry_total = sum(int(registry_counts.get(status) or 0) for status in registry_counts)
            total_count = int(counts.get("total_count") or 0)
            counts["linked_count"] = int(registry_counts[STATUS_LINKED])
            counts["not_in_1c_count"] = int(registry_counts[STATUS_EXCLUDED])
            counts["invalid_count"] = int(registry_counts[STATUS_INVALID])
            counts["pending_count"] = int(registry_counts[STATUS_PENDING]) + max(
                total_count - registry_total,
                0,
            )
            counts["registry_pending_count"] = int(registry_counts[STATUS_PENDING])
            counts["registry_excluded_count"] = int(registry_counts[STATUS_EXCLUDED])
            counts["registry_invalid_count"] = int(registry_counts[STATUS_INVALID])
            counts["registry_unregistered_count"] = max(total_count - registry_total, 0)
            counts["coverage_source"] = "app_registry"
        else:
            counts.setdefault("invalid_count", 0)
            counts["coverage_source"] = "legacy_part_no_projection"
        per_db.append({"hub_db_id": one_db_id or "", "hub_db_name": db_name, **counts})
        for key in totals:
            totals[key] += int(counts.get(key) or 0)

    linked = int(totals["linked_count"])
    total = int(totals["total_count"])
    closed = linked + int(totals["not_in_1c_count"])

    return {
        **totals,
        # An explicit exclusion closes the old PART_NO queue but is not a
        # confirmed 1C link, so it must never inflate coverage.
        "coverage_pct": round((linked / total) * 100.0, 1) if total else 0.0,
        "linked_pct": round((linked / total) * 100.0, 1) if total else 0.0,
        "closed_pct": round((closed / total) * 100.0, 1) if total else 0.0,
        "coverage_source": "app_registry" if registry_configured else "legacy_part_no_projection",
        "not_in_1c_sentinel": HUB_PART_NO_NOT_IN_1C,
        "databases": per_db,
    }


def migrate_legacy_part_no_candidates(
    *,
    db_id: str | None,
    limit: int = 500,
    offset: int = 0,
    dry_run: bool = True,
    actor: str = "migration",
) -> dict[str, Any]:
    """Seed the registry from legacy projections without trusting them.

    A historical usable PART_NO becomes a ``pending`` candidate, never a
    confirmed link.  The old sentinel becomes an ``excluded`` decision with a
    machine-readable migration reason.  Existing app-owned rows are left
    untouched so the operation is idempotent and safe for phased rollout.
    """
    if not one_c_reconcile_registry_service.configured:
        raise Warehouse1CQueryError("APP_DATABASE_URL required for 1C reconcile migration")
    registry_db_id = _hub_registry_db_id(db_id)
    rows = db_queries.list_hub_part_no_projection_candidates(
        limit=limit,
        offset=offset,
        db_id=db_id,
    )
    pending: list[dict[str, Any]] = []
    excluded: list[dict[str, Any]] = []
    invalid: list[dict[str, Any]] = []
    skipped = 0
    for row in rows:
        hub_item_id = str(row.get("id") or "").strip()
        part_no = str(row.get("part_no") or "").strip()
        if not hub_item_id:
            skipped += 1
            continue
        existing = one_c_reconcile_registry_service.get_item_link(
            hub_db_id=registry_db_id,
            hub_item_id=hub_item_id,
        )
        if existing is not None:
            skipped += 1
            continue
        is_excluded = db_queries._is_not_in_1c_hub_part_no(part_no)
        if is_excluded:
            status = STATUS_EXCLUDED
            reason = "migrated_legacy_not_in_1c_sentinel"
            target = excluded
        elif db_queries._is_usable_hub_part_no(part_no):
            status = STATUS_PENDING
            reason = "migrated_legacy_part_no_requires_confirmation"
            target = pending
        else:
            status = STATUS_INVALID
            reason = "migrated_invalid_legacy_part_no"
            target = invalid
        target.append(
            {
                "hub_item_id": hub_item_id,
                "inv_no": str(row.get("inv_no") or ""),
                "part_no": part_no,
                "status": status,
            }
        )
        if not dry_run:
            one_c_reconcile_registry_service.upsert_item_link(
                hub_db_id=registry_db_id,
                hub_item_id=hub_item_id,
                nomenclature_ref=None,
                nomenclature_code_snapshot=part_no or None,
                status=status,
                actor=actor,
                reason=reason,
                expected_version=0,
                legacy_part_no_before=part_no,
                legacy_part_no_after=part_no,
            )
    return {
        "dry_run": bool(dry_run),
        "hub_db_id": registry_db_id,
        "offset": max(0, int(offset or 0)),
        "returned": len(rows),
        "pending_candidates": pending,
        "excluded": excluded,
        "invalid": invalid,
        "skipped_existing": skipped,
        "has_more": len(rows) >= max(1, min(int(limit or 500), 2000)),
    }


def list_reconcile_queue(
    *,
    queue: str = "pending",
    limit: int = 100,
    offset: int = 0,
    q: str = "",
    has_owner: str = "with",
    db_id: str | None = None,
) -> dict[str, Any]:
    queue_key = str(queue or "pending").strip().lower()
    if queue_key not in {"pending", "not_in_1c", "linked"}:
        raise Warehouse1CValidationError("queue must be pending|not_in_1c|linked")

    owner_key = str(has_owner or "with").strip().lower()
    if owner_key not in {"all", "with", "without"}:
        owner_key = "with"

    configs = _hub_db_configs(db_id)
    items: list[dict[str, Any]] = []
    total = 0
    for cfg in configs:
        one_db_id = str(cfg.get("id") or "").strip() or None
        db_name = str(cfg.get("name") or one_db_id or "default")
        try:
            payload = db_queries.list_hub_equipment_by_part_no_status(
                status=queue_key,
                limit=limit,
                offset=0 if len(configs) > 1 else offset,
                q=q,
                has_owner=owner_key,
                db_id=one_db_id,
            )
        except Exception as exc:
            logger.warning("list_hub_equipment_by_part_no_status failed for db=%s: %s", one_db_id, exc)
            continue
        total += int(payload.get("total") or 0)
        items.extend(
            _tag_db(list(payload.get("items") or []), db_id=one_db_id, db_name=db_name)
        )

    items.sort(
        key=lambda row: (
            0 if row.get("employee_name") else 1,
            str(row.get("employee_name") or "").casefold(),
            str(row.get("inv_no") or ""),
            str(row.get("hub_db_id") or ""),
        )
    )
    _attach_reconcile_link_versions(items)
    safe_limit = max(1, min(int(limit or 100), 500))
    safe_offset = max(0, int(offset or 0))
    page = items[safe_offset : safe_offset + safe_limit]
    return {
        "queue": queue_key,
        "items": page,
        "total": total,
        "limit": safe_limit,
        "offset": safe_offset,
        "has_owner": owner_key,
        "not_in_1c_sentinel": HUB_PART_NO_NOT_IN_1C,
    }


async def list_owner_mismatches(
    *,
    employee_name: str = "",
    warehouse_ref: str = "",
    limit: int = 200,
    db_id: str | None = None,
) -> dict[str, Any]:
    employee = str(employee_name or "").strip()
    if not employee and not str(warehouse_ref or "").strip():
        raise Warehouse1CValidationError("Укажите фамилию/ФИО сотрудника или warehouse_ref")

    # 1) Hub queue filtered by surname/FIO — primary for "По человеку".
    hub_pending = list_reconcile_queue(
        queue="pending",
        limit=limit,
        offset=0,
        q=employee,
        has_owner="with",
        db_id=db_id,
    )

    warehouse_payload: dict[str, Any] = {
        "status": "not_searched",
        "warehouse": None,
        "candidates": [],
        "balances": [],
    }
    mismatches: list[dict[str, Any]] = []
    only_in_1c: list[dict[str, Any]] = []

    # 2) Optional 1C warehouse compare (best-effort; surname-only may yield candidates).
    try:
        warehouse_payload = await warehouse_1c_service.get_employee_warehouse(
            employee_name=employee,
            warehouse_ref=warehouse_ref,
            load_balances=True,
            balances_limit=limit,
        )
    except Warehouse1CValidationError:
        warehouse_payload = {
            "status": "not_found",
            "warehouse": None,
            "candidates": [],
            "balances": [],
        }
    except Exception as exc:
        logger.warning("get_employee_warehouse failed for %s: %s", employee, exc)
        warehouse_payload = {
            "status": "error",
            "warehouse": None,
            "candidates": [],
            "balances": [],
            "error": str(exc),
        }

    warehouse = warehouse_payload.get("warehouse") or {}
    balances = list(warehouse_payload.get("balances") or [])
    balances_meta = dict(warehouse_payload.get("balances_meta") or {})
    balance_status = str(balances_meta.get("status") or "unknown").strip().lower()
    balances_incomplete = (
        balance_status != "ok"
        or bool(balances_meta.get("truncated"))
        or bool(balances_meta.get("has_more"))
    )
    if balances_incomplete:
        # A partial/time-limited 1C answer is not a smaller warehouse. Do not
        # expose per-code deltas that look like confirmed mismatches.
        balances_meta["comparison_status"] = (
            "incomplete" if balance_status == "ok" else balance_status
        )
    candidate_mismatches: list[dict[str, Any]] = []
    if warehouse and balances and not balances_incomplete:
        # 1C gives batch/series rows; compare only the deliberate aggregate
        # unit.  This removes the prior N+1 COM calls and the erroneous
        # fallback that summed unrelated warehouse owners.
        aggregates = warehouse_1c_service.aggregate_balance_rows(balances)
        codes = [
            str(row.get("nomenclature_code") or "").strip()
            for row in aggregates
            if db_queries._is_usable_hub_part_no(str(row.get("nomenclature_code") or ""))
        ]
        warehouse_ref_value = str(warehouse.get("ref") or warehouse_ref or "").strip()
        warehouse_name_value = str(warehouse.get("name") or "").strip()

        for cfg in _hub_db_configs(db_id):
            one_db_id = str(cfg.get("id") or "").strip() or None
            one_db_name = str(cfg.get("name") or one_db_id or "default")
            from backend.services.one_c_reconcile_registry_service import one_c_reconcile_registry_service

            explicit_links = await asyncio.to_thread(
                one_c_reconcile_registry_service.get_active_owner_links,
                hub_db_id=str(one_db_id or "default"),
                warehouse_refs=[warehouse_ref_value],
            )
            owner_nos = list(explicit_links.get(warehouse_ref_value) or [])
            mapping_method = "explicit" if owner_nos else "candidate_fio"
            match_score: int | None = 100 if owner_nos else None
            if not owner_nos and warehouse_name_value:
                try:
                    owners = db_queries.list_owners_compact(db_id=one_db_id)
                    matched, score = warehouse_1c_service._match_warehouse_to_owners(
                        warehouse_name_value,
                        owners,
                    )
                    owner_nos = [
                        int(owner.get("OWNER_NO") or owner.get("owner_no"))
                        for owner in matched
                        if str(owner.get("OWNER_NO") or owner.get("owner_no") or "").strip().isdigit()
                    ]
                    match_score = score or None
                except Exception as exc:
                    logger.warning("Unable to resolve HUB owner for warehouse=%s: %s", warehouse_name_value, exc)
                    owner_nos = []

            if not owner_nos or not codes:
                continue
            try:
                counts = db_queries.count_equipment_by_owners_and_part_nos(
                    owner_nos,
                    codes,
                    db_id=one_db_id,
                )
            except Exception as exc:
                logger.warning("Batch HUB count failed for warehouse=%s db=%s: %s", warehouse_name_value, one_db_id, exc)
                continue

            for aggregate in aggregates:
                code = str(aggregate.get("nomenclature_code") or "").strip()
                if not db_queries._is_usable_hub_part_no(code):
                    continue
                qty_1c = float(aggregate.get("qty_1c_total") or 0)
                hub_count = sum(int(counts.get((int(owner_no), code.casefold()), 0) or 0) for owner_no in owner_nos)
                delta = qty_1c - hub_count
                payload = {
                    **aggregate,
                    "qty_1c": qty_1c,
                    "qty_1c_total": qty_1c,
                    "exact_linked_count": hub_count,
                    "unlinked_candidate_count": None,
                    "hub_count": hub_count,
                    "delta": delta,
                    "hub_db_id": one_db_id or "",
                    "hub_db_name": one_db_name,
                    "owner_link_method": mapping_method,
                    "owner_match_score": match_score,
                    "status": "ok" if mapping_method == "explicit" else "unknown",
                }
                if abs(delta) <= 0.0001:
                    continue
                if mapping_method == "explicit":
                    mismatches.append(payload)
                    if hub_count <= 0 and qty_1c > 0:
                        only_in_1c.append(payload)
                else:
                    candidate_mismatches.append(payload)

    warehouse_result_status = str(warehouse_payload.get("status") or "").strip().lower()
    if balances_incomplete:
        if balance_status == "error" or warehouse_result_status == "error":
            result_status = "error"
        elif balance_status in {"unknown", "incomplete"}:
            result_status = balance_status
        else:
            result_status = "incomplete"
    elif warehouse:
        result_status = "ok"
    else:
        result_status = "error" if warehouse_result_status == "error" else "unknown"

    return {
        "warehouse": warehouse or None,
        "warehouse_status": warehouse_payload.get("status"),
        "warehouse_candidates": warehouse_payload.get("candidates") or [],
        "balances_meta": balances_meta,
        "employee_name": employee or str(warehouse.get("name") or ""),
        "hub_pending": hub_pending.get("items") or [],
        "hub_pending_total": int(hub_pending.get("total") or 0),
        "items": mismatches,
        "only_in_1c": only_in_1c,
        "only_in_hub": [],
        "mismatched": mismatches,
        "candidate_mismatches": candidate_mismatches,
        "status": result_status,
    }


def _model_tokens(text: str) -> list[str]:
    return [
        t
        for t in re.findall(r"[a-zA-Zа-яА-Я0-9]{3,}", str(text or "").casefold())
        if t not in {"для", "the", "and", "монитор", "принтер"}
    ]


def _tokens_match(haystack: str, tokens: list[str], *, min_hits: int = 1) -> bool:
    text = str(haystack or "").casefold()
    if not text or not tokens:
        return False
    hits = sum(1 for token in tokens if token in text)
    need = min(min_hits, len(tokens))
    return hits >= need


async def suggest_for_hub_item(
    *,
    inv_no: str = "",
    model_name: str = "",
    serial_no: str = "",
    employee_name: str = "",
    owner_no: int | None = None,
    limit: int = 8,
    db_id: str | None = None,
) -> dict[str, Any]:
    """Suggest PART_NO for one Hub item, prioritizing the person's 1C warehouse."""
    inv = str(inv_no or "").strip()
    model = str(model_name or "").strip()
    serial = str(serial_no or "").strip()
    employee = str(employee_name or "").strip()
    equipment: dict[str, Any] = {}
    prefer_owner: int | None = None
    try:
        prefer_owner = int(owner_no) if owner_no is not None else None
    except (TypeError, ValueError):
        prefer_owner = None
    if prefer_owner is not None and prefer_owner <= 0:
        prefer_owner = None

    if inv:
        equipment = db_queries.get_equipment_by_inv(inv, db_id) or {}
        if not model:
            model = str(
                equipment.get("model_name")
                or equipment.get("MODEL_NAME")
                or ""
            ).strip()
        if not serial:
            serial = str(
                equipment.get("serial_no")
                or equipment.get("SERIAL_NO")
                or ""
            ).strip()
        if not employee:
            employee = str(
                equipment.get("employee_name")
                or equipment.get("OWNER_DISPLAY_NAME")
                or ""
            ).strip()
        if prefer_owner is None:
            try:
                prefer_owner = int(equipment.get("owner_no") or equipment.get("EMPL_NO") or 0) or None
            except (TypeError, ValueError):
                prefer_owner = None

    tokens = _model_tokens(model)
    warehouse_payload: dict[str, Any] = {
        "status": "skipped",
        "warehouse": None,
        "balances": [],
    }
    warehouse_matches: list[dict[str, Any]] = []
    warehouse_missing_in_hub: list[dict[str, Any]] = []

    if employee:
        try:
            warehouse_payload = await warehouse_1c_service.get_employee_warehouse(
                employee_name=employee,
                load_balances=True,
                balances_limit=300,
            )
        except Exception as exc:
            logger.warning("employee warehouse lookup failed for %s: %s", employee, exc)
            warehouse_payload = {
                "status": "error",
                "warehouse": None,
                "balances": [],
                "error": str(exc),
            }

    warehouse = warehouse_payload.get("warehouse") or {}
    balances = list(warehouse_payload.get("balances") or [])
    seen_codes: set[str] = set()
    balances_by_code: dict[str, dict[str, Any]] = {}
    for row in balances:
        code = str(row.get("nomenclature_code") or "").strip()
        name = str(row.get("nomenclature_name") or "").strip()
        ref = str(row.get("nomenclature_ref") or "").strip()
        if not code:
            continue
        try:
            qty_1c = float(row.get("qty_balance") or 0)
        except (TypeError, ValueError):
            qty_1c = 0.0
        if qty_1c <= 0:
            continue

        key = code.casefold()
        bucket = balances_by_code.setdefault(
            key,
            {
                "code": code,
                "name": name,
                "ref": ref,
                "qty_1c": 0.0,
                "source_row_count": 0,
                "warehouse_name": str(warehouse.get("name") or row.get("warehouse_name") or ""),
                "warehouse_ref": str(warehouse.get("ref") or row.get("warehouse_ref") or ""),
            },
        )
        bucket["qty_1c"] += qty_1c
        bucket["source_row_count"] += 1

    owner_counts: dict[tuple[int, str], int] = {}
    if prefer_owner:
        try:
            owner_counts = db_queries.count_equipment_by_owners_and_part_nos(
                [prefer_owner],
                [row["code"] for row in balances_by_code.values()],
                db_id=db_id,
            )
        except Exception:
            owner_counts = {}

    for bucket in balances_by_code.values():
        code = str(bucket["code"])
        name = str(bucket["name"])
        ref = str(bucket["ref"])
        qty_1c = float(bucket["qty_1c"])

        model_hit = _tokens_match(f"{code} {name}", tokens, min_hits=1) if tokens else False
        hub_count_owner = int(owner_counts.get((int(prefer_owner or 0), code.casefold()), 0) or 0)

        payload = {
            "code": code,
            "name": name,
            "ref": ref,
            "qty_1c": qty_1c,
            "hub_count_owner": hub_count_owner,
            "model_match": model_hit,
            "source": "employee_warehouse",
            "source_row_count": int(bucket["source_row_count"]),
            "warehouse_name": str(bucket["warehouse_name"]),
            "warehouse_ref": str(bucket["warehouse_ref"]),
            "recommended": bool(model_hit and hub_count_owner < qty_1c),
        }
        seen_codes.add(code.casefold())

        # On person's warehouse in 1C, but Hub does not cover the qty for this owner.
        if hub_count_owner < qty_1c:
            warehouse_missing_in_hub.append(payload)
            if model_hit:
                warehouse_matches.append(payload)

    warehouse_matches.sort(
        key=lambda row: (-int(bool(row.get("recommended"))), -float(row.get("qty_1c") or 0))
    )
    warehouse_missing_in_hub.sort(
        key=lambda row: (
            -int(bool(row.get("model_match"))),
            -float(row.get("qty_1c") or 0),
            str(row.get("name") or ""),
        )
    )

    # Catalog fallback only when warehouse gave nothing model-related.
    catalog_candidates: list[dict[str, Any]] = []
    if model and not warehouse_matches:
        suggest = await warehouse_1c_service.suggest_nomenclature(model, limit=max(8, int(limit or 8)))
        for row in list(suggest.get("results") or []):
            code = str(row.get("code") or row.get("nomenclature_code") or "").strip()
            name = str(row.get("name") or row.get("nomenclature_name") or "").strip()
            ref = str(row.get("ref") or row.get("nomenclature_ref") or "").strip()
            if not code or code.casefold() in seen_codes:
                continue
            catalog_candidates.append(
                {
                    "code": code,
                    "name": name,
                    "ref": ref,
                    "qty_1c_total": None,
                    "source": "catalog",
                    "model_match": True,
                    "recommended": False,
                }
            )
            if len(catalog_candidates) >= max(1, min(int(limit or 8), 15)):
                break

    has_actionable = bool(warehouse_matches or warehouse_missing_in_hub or catalog_candidates)
    if warehouse_matches:
        hint = (
            "На складе сотрудника в 1С найдена похожая номенклатура — "
            "проставьте её PART_NO. Клик по строке покажет, у кого она стоит."
        )
    elif warehouse_missing_in_hub:
        hint = (
            "На складе сотрудника в 1С есть позиции, которых нет (или мало) в Hub. "
            "Выберите нужную или найдите номенклатуру вручную."
        )
    elif catalog_candidates:
        hint = "На складе сотрудника совпадений не найдено — ниже каталожные варианты по модели."
    elif employee:
        hint = (
            "На складе сотрудника подходящей номенклатуры нет. "
            "Найдите вручную или пометьте «нет в 1С»."
        )
    else:
        hint = "У единицы нет сотрудника — ищите номенклатуру вручную."

    link: dict[str, Any] | None = None
    hub_item_id = _extract_hub_item_id(equipment)
    if hub_item_id and one_c_reconcile_registry_service.configured:
        try:
            link = one_c_reconcile_registry_service.get_item_link(
                hub_db_id=_hub_registry_db_id(db_id),
                hub_item_id=hub_item_id,
            )
        except Exception:
            logger.warning("Unable to load 1C reconcile link for inv_no=%s", inv, exc_info=True)

    return {
        "inv_no": inv,
        "model_name": model,
        "serial_no": serial,
        "employee_name": employee,
        "owner_no": prefer_owner,
        "warehouse": warehouse or None,
        "warehouse_status": warehouse_payload.get("status"),
        "warehouse_matches": warehouse_matches[: max(1, min(int(limit or 8), 20))],
        "warehouse_missing_in_hub": warehouse_missing_in_hub[:50],
        "candidates": warehouse_matches[: max(1, min(int(limit or 8), 20))] or catalog_candidates,
        "catalog_candidates": catalog_candidates,
        "one_c_link": link,
        "expected_version": int(link.get("version") or 0) if link else 0,
        "can_mark_not_in_1c": not has_actionable,
        "not_in_1c_sentinel": HUB_PART_NO_NOT_IN_1C,
        "hint": hint,
    }


async def list_hub_over_1c(
    *,
    limit: int = 100,
    cursor: str | None = None,
    db_id: str | None = None,
) -> dict[str, Any]:
    """PART_NO groups where HUB count exceeds a *complete* 1C balance.

    A timeout, missing catalogue ref, or safety-capped 1C query is represented
    as an incomplete comparison.  It is never coerced into a zero balance.

    ``total`` is deliberately the exact total of source HUB PART_NO groups,
    rather than the total of final mismatches.  A paged response cannot know
    that latter value until every source group has been checked against 1C;
    callers must use ``comparison_total`` only when it is non-null.
    """

    def decode_cursor(value: str | None) -> tuple[int | None, str]:
        text = str(value or "").strip()
        if not text:
            return None, ""
        try:
            padded = text + "=" * (-len(text) % 4)
            payload = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8"))
            if payload.get("v") != 2:
                raise ValueError("unexpected cursor")
            return int(payload["count"]), str(payload["part_no"] or "")
        except (KeyError, TypeError, ValueError, UnicodeDecodeError, binascii.Error, json.JSONDecodeError) as exc:
            raise Warehouse1CValidationError("Некорректный cursor hub-over-1c") from exc

    def encode_cursor(bucket: dict[str, Any]) -> str:
        raw = json.dumps(
            {
                "v": 2,
                "count": int(bucket.get("hub_count") or 0),
                "part_no": str(bucket.get("part_no") or ""),
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")

    def parse_non_negative_count(value: Any) -> int | None:
        if isinstance(value, bool) or value is None:
            return None
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return None
        return parsed if parsed >= 0 else None

    def parse_page_flag(value: Any) -> bool | None:
        if isinstance(value, bool):
            return value
        if isinstance(value, int) and value in (0, 1):
            return bool(value)
        return None

    safe_limit = max(1, min(int(limit or 100), 500))
    configs = _hub_db_configs(db_id)
    source_incomplete = False
    source_total: int | None = None
    has_more_candidates = False
    candidates: list[dict[str, Any]] = []
    hub_counts: dict[str, dict[str, Any]] = {}

    if len(configs) == 1:
        one_db_id = str(configs[0].get("id") or "").strip() or None
        db_name = str(configs[0].get("name") or one_db_id or "default")
        after_count, after_part_no = decode_cursor(cursor)
        try:
            page = db_queries.get_hub_items_by_usable_part_no_page(
                limit=safe_limit,
                after_hub_count=after_count,
                after_part_no=after_part_no,
                db_id=one_db_id,
            )
        except Exception as exc:
            logger.warning("HUB-over-1C keyset page failed for db=%s: %s", one_db_id, exc)
            return {
                "items": [],
                "returned": 0,
                "total": None,
                "comparison_total": None,
                "source_total": None,
                "limit": safe_limit,
                "cursor": cursor or None,
                "next_cursor": None,
                "has_more": False,
                "truncated": False,
                "status": "error",
                "incomplete_items": [],
                "probed": 0,
                "error": "hub_group_query_failed",
            }
        source_total = parse_non_negative_count(page.get("total"))
        page_has_more = parse_page_flag(page.get("has_more"))
        if source_total is None or page_has_more is None:
            # A successful SQL call without reliable page metadata is still
            # not a completed comparison.  Do not turn an unknown count into
            # an apparently authoritative zero.
            source_incomplete = True
        has_more_candidates = bool(page_has_more)
        page_rows = list(page.get("items") or [])
        if len(page_rows) > safe_limit:
            # The SQL helper promises a bounded keyset page.  Fail closed if
            # an adapter violates that contract so ``returned`` remains the
            # number of rows the caller can actually see.
            source_incomplete = True
            has_more_candidates = True
            page_rows = page_rows[:safe_limit]
        for row in page_rows:
            part_no = str(row.get("part_no") or "").strip()
            if not part_no:
                source_incomplete = True
                continue
            candidates.append(
                {
                    "part_no": part_no,
                    "hub_count": int(row.get("hub_count") or 0),
                    "databases": [
                        {"hub_db_id": one_db_id or "", "hub_db_name": db_name, "hub_count": int(row.get("hub_count") or 0)}
                    ],
                }
            )
        if source_total is not None and len(candidates) > source_total:
            # This cannot happen for a consistent grouped source query.  The
            # advertised count is therefore not safe to expose as a total.
            source_total = None
            source_incomplete = True
    else:
        # Aggregating independent SQL Server databases has no shared keyset.
        # Keep this admin-only path explicitly incomplete until a centralized
        # snapshot is available; it must never claim a full total.
        source_incomplete = True
        for cfg in configs:
            one_db_id = str(cfg.get("id") or "").strip() or None
            db_name = str(cfg.get("name") or one_db_id or "default")
            try:
                rows = db_queries.count_hub_items_by_usable_part_no(limit=5000, db_id=one_db_id)
            except Exception as exc:
                logger.warning("count_hub_items_by_usable_part_no failed for db=%s: %s", one_db_id, exc)
                continue
            for row in rows:
                part_no = str(row.get("part_no") or "").strip()
                key = part_no.casefold()
                if not key:
                    continue
                bucket = hub_counts.setdefault(
                    key,
                    {"part_no": part_no, "hub_count": 0, "databases": []},
                )
                add = int(row.get("hub_count") or 0)
                bucket["hub_count"] += add
                bucket["databases"].append(
                    {"hub_db_id": one_db_id or "", "hub_db_name": db_name, "hub_count": add}
                )
        ranked = sorted(
            hub_counts.values(),
            key=lambda row: (-int(row.get("hub_count") or 0), str(row.get("part_no") or "").casefold()),
        )
        candidates = ranked[:safe_limit]
        has_more_candidates = len(ranked) > safe_limit

    # Resolve all PART_NO codes in one indexed app-snapshot query.  The
    # warehouse service falls back to JSON only when no promoted snapshot is
    # available; do not reach into its private Python cache here.
    code_to_entry = await asyncio.to_thread(
        warehouse_1c_service.lookup_nomenclature_codes,
        [str(bucket.get("part_no") or "") for bucket in candidates],
    )

    items: list[dict[str, Any]] = []
    incomplete_items: list[dict[str, Any]] = []
    for bucket in candidates:
        key = str(bucket.get("part_no") or "").casefold()
        entry = code_to_entry.get(key)
        qty_1c: float | None = None
        nomenclature_ref = ""
        nomenclature_name = ""
        nomenclature_code = str(bucket.get("part_no") or "")
        if not entry:
            incomplete_items.append(
                {
                    "part_no": nomenclature_code,
                    "hub_count": int(bucket.get("hub_count") or 0),
                    "status": "unknown",
                    "reason": "nomenclature_not_in_catalog",
                }
            )
            continue

        nomenclature_ref = str(entry.get("ref") or "")
        nomenclature_code = str(entry.get("code") or nomenclature_code)
        nomenclature_name = str(entry.get("name") or "")
        try:
            balance_payload = await warehouse_1c_service.get_balances(
                nomenclature_ref=nomenclature_ref,
                limit=500,
                include_meta=True,
            )
            if isinstance(balance_payload, dict):
                balance_rows = list(balance_payload.get("items") or [])
                balance_status = str(balance_payload.get("status") or "unknown")
                balance_incomplete = bool(balance_payload.get("truncated")) or balance_status != "ok"
            else:
                balance_rows = list(balance_payload or [])
                balance_status = "ok"
                balance_incomplete = False
            if balance_incomplete:
                incomplete_items.append(
                    {
                        "part_no": nomenclature_code,
                        "nomenclature_ref": nomenclature_ref,
                        "hub_count": int(bucket.get("hub_count") or 0),
                        "status": "incomplete",
                        "reason": balance_status,
                    }
                )
                continue
            qty_1c = sum(float(row.get("qty_balance") or 0) for row in balance_rows)
        except Exception as exc:
            logger.warning("get_balances failed for part_no=%s: %s", nomenclature_code, exc)
            incomplete_items.append(
                {
                    "part_no": nomenclature_code,
                    "nomenclature_ref": nomenclature_ref,
                    "hub_count": int(bucket.get("hub_count") or 0),
                    "status": "error",
                    "reason": "balance_query_failed",
                }
            )
            continue

        hub_count = int(bucket["hub_count"] or 0)
        if qty_1c is None or hub_count <= qty_1c:
            continue

        sample_items: list[dict[str, Any]] = []
        for cfg in _hub_db_configs(db_id):
            one_db_id = str(cfg.get("id") or "").strip() or None
            db_name = str(cfg.get("name") or one_db_id or "default")
            try:
                found = db_queries.list_hub_items_by_part_no(
                    nomenclature_code,
                    limit=20,
                    db_id=one_db_id,
                )
            except Exception:
                found = []
            sample_items.extend(_tag_db(found, db_id=one_db_id, db_name=db_name))
            if len(sample_items) >= 20:
                break

        items.append(
            {
                "part_no": nomenclature_code,
                "nomenclature_code": nomenclature_code,
                "nomenclature_name": nomenclature_name,
                "nomenclature_ref": nomenclature_ref,
                "hub_count": hub_count,
                "qty_1c": qty_1c,
                "qty_1c_total": qty_1c,
                "delta": hub_count - qty_1c,
                "status": "ok",
                "in_1c_catalog": bool(entry),
                "hub_items": sample_items[:20],
                "databases": bucket.get("databases") or [],
            }
        )
    items.sort(key=lambda row: (-float(row.get("delta") or 0), str(row.get("part_no") or "")))
    visible_items = items[:safe_limit]
    complete_comparison = bool(
        not cursor
        and source_total is not None
        and not source_incomplete
        and not incomplete_items
        and not has_more_candidates
        and len(candidates) == source_total
    )
    # This number is only meaningful when this response checked every source
    # group.  In particular, do not infer it from a final cursor page: it has
    # no knowledge of mismatches returned by earlier pages.
    comparison_total = len(visible_items) if complete_comparison else None
    incomplete = bool(
        source_incomplete
        or incomplete_items
        or has_more_candidates
        or comparison_total is None
    )
    if has_more_candidates and not candidates:
        # The SQL keyset says there is another page, but we cannot construct
        # a safe continuation token from this malformed page.
        source_incomplete = True
    next_cursor = encode_cursor(candidates[-1]) if has_more_candidates and candidates else None
    return {
        "items": visible_items,
        "returned": len(visible_items),
        # ``total`` is the real source-candidate total.  It deliberately does
        # not claim to be a total of HUB>1C mismatches.
        "total": source_total,
        "source_total": source_total,
        "comparison_total": comparison_total,
        "limit": safe_limit,
        "cursor": cursor or None,
        "next_cursor": next_cursor,
        "has_more": bool(next_cursor),
        "truncated": bool(source_incomplete or has_more_candidates),
        "status": "incomplete" if incomplete else "ok",
        "incomplete_items": incomplete_items,
        "probed": len(candidates),
    }


def _hub_registry_db_id(db_id: str | None) -> str:
    """Use a stable non-empty database key in the app-owned registry."""
    return str(db_id or "default").strip() or "default"


def _validate_linked_nomenclature(
    *,
    nomenclature_ref: str,
    part_no: str,
) -> tuple[str, dict[str, str]]:
    """Require an exact, cached 1C nomenclature identity for a HUB write.

    A code alone is not a stable 1C identity.  The caller must select a
    reference from the read-only 1C catalogue and that reference must still
    resolve to exactly the selected code.  A missing cache is deliberately a
    blocked write instead of a guessed mapping.
    """
    normalized_ref = normalize_1c_ref(nomenclature_ref)
    if not normalized_ref:
        raise Warehouse1CValidationError("nomenclature_ref обязателен для подтверждённой связи")
    candidate = warehouse_1c_service.lookup_nomenclature_ref(normalized_ref)
    if candidate is None:
        raise Warehouse1CValidationError(
            "Номенклатура 1С не найдена в актуальном каталоге; синхронизируйте каталог и повторите"
        )
    catalog_code = str(candidate.get("code") or "").strip()
    if not catalog_code or catalog_code.casefold() != str(part_no or "").strip().casefold():
        raise Warehouse1CValidationError(
            "Код номенклатуры не соответствует выбранной ссылке 1С"
        )
    return normalized_ref, candidate


def _extract_hub_item_id(equipment: dict[str, Any]) -> str:
    raw_id = equipment.get("id") or equipment.get("ID")
    value = str(raw_id or "").strip()
    if not value:
        raise Warehouse1CQueryError("У карточки HUB отсутствует immutable ITEMS.ID")
    return value


def apply_part_no(
    *,
    inv_no: str,
    part_no: str,
    db_id: str | None = None,
    changed_by: str = "IT-WEB",
    nomenclature_ref: str | None = None,
    reason: str = "",
    expected_version: int | None = None,
    expected_part_no: str | None = None,
    correlation_id: str | None = None,
    source_base: str = "buh20",
    link_status: str = STATUS_LINKED,
) -> dict[str, Any]:
    """Confirm a HUB-side 1C mapping and project it to legacy ``PART_NO``.

    This function never writes 1C.  The durable source of truth is the
    app-owned registry; SQL Server ``PART_NO`` is retained only as a legacy
    projection while consumers are migrated.  The two stores cannot share a
    transaction, so an audit-persistence failure compensates the projection
    before the request is failed.
    """
    inv = str(inv_no or "").strip()
    code = str(part_no or "").strip()
    if not inv:
        raise Warehouse1CValidationError("inv_no обязателен")
    if not code:
        raise Warehouse1CValidationError("part_no обязателен")
    if not db_queries._is_usable_hub_part_no(code) and not db_queries._is_not_in_1c_hub_part_no(code):
        raise Warehouse1CValidationError("Некорректный part_no")
    status = str(link_status or STATUS_LINKED).strip().lower()
    if status not in {STATUS_LINKED, STATUS_EXCLUDED}:
        raise Warehouse1CValidationError("Недопустимый статус связи 1С")

    normalized_reason = str(reason or "").strip()
    wants_registry = nomenclature_ref is not None or bool(normalized_reason) or expected_version is not None
    if wants_registry and expected_version is None:
        raise Warehouse1CValidationError(
            "expected_version обязателен для подтверждённой связи 1С"
        )
    normalized_ref: str | None = None
    catalog_item: dict[str, str] | None = None
    if status == STATUS_LINKED and nomenclature_ref is not None:
        normalized_ref, catalog_item = _validate_linked_nomenclature(
            nomenclature_ref=nomenclature_ref,
            part_no=code,
        )
    if status == STATUS_EXCLUDED and not normalized_reason and wants_registry:
        raise Warehouse1CValidationError("Для исключения из 1С требуется причина")

    equipment_before = db_queries.get_equipment_by_inv(inv, db_id) or {}
    if not equipment_before:
        raise Warehouse1CQueryError(f"Карточка HUB {inv} не найдена")
    old_part_no = str(
        equipment_before.get("part_no") or equipment_before.get("PART_NO") or ""
    ).strip()
    if expected_part_no is not None and old_part_no.casefold() != str(expected_part_no).strip().casefold():
        raise OneCReconcileRegistryConflict("PART_NO изменён другим пользователем")

    registry_link: dict[str, Any] | None = None
    registry_db_id = _hub_registry_db_id(db_id)
    hub_item_id = ""
    if wants_registry:
        if not one_c_reconcile_registry_service.configured:
            raise Warehouse1CQueryError(
                "APP_DATABASE_URL недоступен: подтверждение связи 1С без аудита запрещено"
            )
        hub_item_id = _extract_hub_item_id(equipment_before)
        existing = one_c_reconcile_registry_service.get_item_link(
            hub_db_id=registry_db_id,
            hub_item_id=hub_item_id,
            source_base=source_base,
        )
        if expected_version is not None:
            actual_version = int(existing.get("version") or 0) if existing else 0
            if actual_version != int(expected_version):
                raise OneCReconcileRegistryConflict("Связь 1С уже изменена другим пользователем")

    if expected_part_no is not None:
        updated = db_queries.update_equipment_part_no_if_current(
            inv,
            part_no=code,
            expected_part_no=old_part_no,
            changed_by=changed_by,
            db_id=db_id,
        )
    else:
        updated = db_queries.update_equipment_fields(
            inv,
            {"part_no": code},
            changed_by=changed_by,
            db_id=db_id,
        )
    if not updated:
        if expected_part_no is not None:
            raise OneCReconcileRegistryConflict("PART_NO изменён другим пользователем")
        raise Warehouse1CQueryError(f"Не удалось обновить PART_NO для {inv}")

    if wants_registry:
        try:
            registry_link = one_c_reconcile_registry_service.upsert_item_link(
                hub_db_id=registry_db_id,
                hub_item_id=hub_item_id,
                nomenclature_ref=normalized_ref if status == STATUS_LINKED else None,
                nomenclature_code_snapshot=(catalog_item or {}).get("code") if status == STATUS_LINKED else None,
                status=status,
                actor=changed_by,
                reason=normalized_reason,
                expected_version=expected_version,
                source_base=source_base,
                correlation_id=correlation_id,
                legacy_part_no_before=old_part_no,
                legacy_part_no_after=code,
            )
        except Exception as exc:
            # Avoid a successful mutable legacy projection without its required
            # immutable audit row.  The conditional compensation refuses to
            # overwrite a newer value written after this request.
            compensated = db_queries.update_equipment_part_no_if_current(
                inv,
                part_no=old_part_no,
                expected_part_no=code,
                changed_by=changed_by,
                db_id=db_id,
            )
            if not compensated:
                logger.critical(
                    "1C reconcile audit failed and PART_NO compensation failed for inv=%s db=%s",
                    inv,
                    db_id,
                )
            if isinstance(exc, OneCReconcileRegistryConflict):
                raise
            raise Warehouse1CQueryError("Не удалось сохранить подтверждённую связь и аудит 1С") from exc

    equipment = db_queries.get_equipment_by_inv(inv, db_id) or {}
    return {
        "ok": True,
        "inv_no": inv,
        "part_no": code,
        "equipment": equipment,
        "hub_db_id": db_id or "",
        "link": registry_link,
        "audit_persisted": bool(registry_link),
    }


def mark_not_in_1c(
    *,
    inv_no: str,
    db_id: str | None = None,
    changed_by: str = "IT-WEB",
    reason: str = "",
    expected_version: int | None = None,
    expected_part_no: str | None = None,
    correlation_id: str | None = None,
) -> dict[str, Any]:
    return apply_part_no(
        inv_no=inv_no,
        part_no=HUB_PART_NO_NOT_IN_1C,
        db_id=db_id,
        changed_by=changed_by,
        reason=reason,
        expected_version=expected_version,
        expected_part_no=expected_part_no,
        correlation_id=correlation_id,
        link_status=STATUS_EXCLUDED,
    )


async def auto_link_pending(
    *,
    limit: int = 50,
    dry_run: bool = True,
    db_id: str | None = None,
    changed_by: str = "IT-WEB",
    reason: str = "",
) -> dict[str, Any]:
    """
    Build a review-only list of strong catalogue candidates.

    A candidate is intentionally never committed from this batch path.  Even
    one unique fuzzy match is only evidence; the operator must confirm the
    exact item/ref/version through ``apply_part_no``.
    """
    if not dry_run:
        raise Warehouse1CValidationError(
            "Automatic reconcile is preview-only; confirm each exact item separately"
        )
    queue = list_reconcile_queue(queue="pending", limit=limit, offset=0, db_id=db_id)
    linked: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []

    for item in queue.get("items") or []:
        inv_no = str(item.get("inv_no") or "").strip()
        model = str(item.get("model_name") or "").strip()
        one_db_id = str(item.get("hub_db_id") or "").strip() or db_id
        if not inv_no or not model:
            skipped.append({**item, "reason": "no_model"})
            continue

        suggest = await warehouse_1c_service.suggest_nomenclature(model, limit=5)
        results = list(suggest.get("results") or [])
        if len(results) != 1:
            skipped.append({**item, "reason": "ambiguous_or_empty", "candidates": len(results)})
            continue

        candidate = results[0]
        code = str(candidate.get("code") or candidate.get("nomenclature_code") or "").strip()
        name = str(candidate.get("name") or candidate.get("nomenclature_name") or "").strip()
        nomenclature_ref = str(candidate.get("ref") or candidate.get("nomenclature_ref") or "").strip()
        if not db_queries._is_usable_hub_part_no(code):
            skipped.append({**item, "reason": "bad_code"})
            continue
        if not normalize_1c_ref(nomenclature_ref):
            skipped.append({**item, "reason": "missing_nomenclature_ref"})
            continue

        # Require that all significant model tokens appear in nomenclature name.
        model_tokens = [
            t for t in re.findall(r"[a-zA-Zа-яА-Я0-9]{3,}", model.casefold())
            if t not in {"для", "the", "and"}
        ]
        name_cf = name.casefold()
        if model_tokens and not all(token in name_cf for token in model_tokens[:4]):
            skipped.append({**item, "reason": "weak_token_overlap", "code": code, "name": name})
            continue

        action = {
            "inv_no": inv_no,
            "part_no": code,
            "nomenclature_ref": nomenclature_ref,
            "nomenclature_name": name,
            "hub_db_id": one_db_id or "",
            "model_name": model,
            # The queue is read immediately before the commit.  Carry its
            # app-owned version into the mutation so a reviewer/worker never
            # overwrites a link that has changed since the preview.
            "expected_version": int(item.get("expected_version") or 0),
            "expected_part_no": str(item.get("part_no") or ""),
        }
        linked.append({**action, "applied": False})

    return {
        "dry_run": True,
        "scanned": len(queue.get("items") or []),
        "linked": linked,
        "skipped": skipped,
        "linked_count": len(linked),
        "skipped_count": len(skipped),
    }


async def ai_suggest_part_no(
    *,
    inv_no: str = "",
    model_name: str = "",
    serial_no: str = "",
    limit: int = 3,
    db_id: str | None = None,
) -> dict[str, Any]:
    """AI-assisted top-N nomenclature suggestions. Never writes PART_NO."""
    from backend.ai_chat.openrouter_client import OpenRouterClientError, openrouter_client

    model = str(model_name or "").strip()
    inv = str(inv_no or "").strip()
    serial = str(serial_no or "").strip()

    if inv and not model:
        equipment = db_queries.get_equipment_by_inv(inv, db_id) or {}
        model = str(
            equipment.get("model_name")
            or equipment.get("MODEL_NAME")
            or ""
        ).strip()
        if not serial:
            serial = str(
                equipment.get("serial_no")
                or equipment.get("SERIAL_NO")
                or ""
            ).strip()

    if not model:
        raise Warehouse1CValidationError("model_name или inv_no обязателен")

    suggest = await warehouse_1c_service.suggest_nomenclature(model, limit=12)
    catalog_hits = list(suggest.get("results") or [])
    catalog_compact = [
        {
            "code": str(row.get("code") or row.get("nomenclature_code") or "").strip(),
            "name": str(row.get("name") or row.get("nomenclature_name") or "").strip(),
            "ref": str(row.get("ref") or row.get("nomenclature_ref") or "").strip(),
        }
        for row in catalog_hits
        if str(row.get("code") or row.get("nomenclature_code") or "").strip()
    ][:12]

    if not openrouter_client.is_configured():
        return {
            "configured": False,
            "model_name": model,
            "inv_no": inv,
            "suggestions": [
                {
                    "code": row["code"],
                    "name": row["name"],
                    "ref": row["ref"],
                    "confidence": None,
                    "reason": "Каталожный suggest (AI не настроен)",
                }
                for row in catalog_compact[: max(1, min(int(limit or 3), 5))]
            ],
            "source": "catalog_only",
        }

    limit_n = max(1, min(int(limit or 3), 5))
    prompt = (
        f"Подбери до {limit_n} наиболее вероятных кодов номенклатуры 1С для единицы IT-оборудования Hub.\n"
        "Можно выбирать ТОЛЬКО code из списка candidates. Не выдумывай коды.\n"
        f"Модель Hub: {model}\n"
        f"Инв.№: {inv or '-'}\n"
        f"S/N: {serial or '-'}\n"
        f"candidates: {catalog_compact}\n"
        'Верни JSON вида: {"suggestions":[{"code":"...","name":"...","confidence":0.0,"reason":"..."}]}'
    )

    try:
        payload, _usage = openrouter_client.complete_json(
            system_prompt=(
                "Ты помощник сверки Hub↔1С. Отвечай только JSON. "
                "Не назначай PART_NO сам — только ранжируй кандидатов."
            ),
            user_prompt=prompt,
            purpose="chat",
            max_tokens=800,
        )
    except OpenRouterClientError as exc:
        logger.warning("AI suggest failed: %s", exc)
        return {
            "configured": True,
            "model_name": model,
            "inv_no": inv,
            "suggestions": [
                {
                    "code": row["code"],
                    "name": row["name"],
                    "ref": row["ref"],
                    "confidence": None,
                    "reason": "Каталожный suggest (AI ошибка)",
                }
                for row in catalog_compact[: max(1, min(int(limit or 3), 5))]
            ],
            "source": "catalog_fallback",
            "error": str(exc),
        }

    allowed = {row["code"].casefold(): row for row in catalog_compact}
    suggestions: list[dict[str, Any]] = []
    raw_suggestions = []
    if isinstance(payload, dict):
        raw_suggestions = payload.get("suggestions") or []
    if not isinstance(raw_suggestions, list):
        raw_suggestions = []

    for row in raw_suggestions:
        if not isinstance(row, dict):
            continue
        code = str(row.get("code") or "").strip()
        base = allowed.get(code.casefold())
        if not base:
            continue
        try:
            confidence = float(row.get("confidence")) if row.get("confidence") is not None else None
        except (TypeError, ValueError):
            confidence = None
        suggestions.append(
            {
                "code": base["code"],
                "name": base["name"],
                "ref": base["ref"],
                "confidence": confidence,
                "reason": str(row.get("reason") or "").strip() or "AI",
            }
        )
        if len(suggestions) >= max(1, min(int(limit or 3), 5)):
            break

    if not suggestions:
        suggestions = [
            {
                "code": row["code"],
                "name": row["name"],
                "ref": row["ref"],
                "confidence": None,
                "reason": "Каталожный suggest",
            }
            for row in catalog_compact[: max(1, min(int(limit or 3), 5))]
        ]

    return {
        "configured": True,
        "model_name": model,
        "inv_no": inv,
        "suggestions": suggestions,
        "source": "ai",
    }
