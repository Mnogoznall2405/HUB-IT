"""App-owned, auditable registry for read-only 1C reconciliation.

The registry intentionally stores only HUB-side decisions.  It never opens a
1C connection and never writes a 1C document.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from backend.appdb.db import app_session, initialize_app_schema, is_app_database_configured
from backend.appdb.models import (
    AppOneCEmployeeOwnerLink,
    AppOneCItemLink,
    AppOneCReconcileEvent,
    AppOneCWarehouseOwnerLink,
)


STATUS_PENDING = "pending"
STATUS_LINKED = "linked"
STATUS_EXCLUDED = "excluded"
STATUS_INVALID = "invalid"
ITEM_LINK_STATUSES = {STATUS_PENDING, STATUS_LINKED, STATUS_EXCLUDED, STATUS_INVALID}
OWNER_LINK_STATUSES = {"active", "inactive", "invalid"}


class OneCReconcileRegistryConflict(RuntimeError):
    """Raised when a caller tries to overwrite a newer mapping decision."""


def _text(value: Any, *, maximum: int | None = None) -> str:
    text = str(value or "").strip()
    return text[:maximum] if maximum is not None else text


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _expected_version(value: int | None) -> int:
    """Normalize the mandatory compare-and-swap version for a mutation."""
    if value is None:
        raise ValueError("expected_version is required for a 1C reconcile mutation")
    try:
        version = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("expected_version must be a non-negative integer") from exc
    if version < 0:
        raise ValueError("expected_version must be a non-negative integer")
    return version


def _row_to_item_link(row: AppOneCItemLink) -> dict[str, Any]:
    return {
        "id": int(row.id),
        "hub_db_id": row.hub_db_id,
        "hub_item_id": row.hub_item_id,
        "source_base": row.source_base,
        "nomenclature_ref": row.nomenclature_ref,
        "nomenclature_code_snapshot": row.nomenclature_code_snapshot,
        "status": row.status,
        "reason": row.reason,
        "version": int(row.version),
        "created_by": row.created_by,
        "verified_by": row.verified_by,
        "verified_at": row.verified_at.isoformat() if row.verified_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _row_to_warehouse_owner_link(row: AppOneCWarehouseOwnerLink) -> dict[str, Any]:
    return {
        "id": int(row.id),
        "source_base": row.source_base,
        "warehouse_ref": row.warehouse_ref,
        "hub_db_id": row.hub_db_id,
        "owner_no": int(row.owner_no),
        "status": row.status,
        "reason": row.reason,
        "version": int(row.version),
        "created_by": row.created_by,
        "verified_by": row.verified_by,
        "verified_at": row.verified_at.isoformat() if row.verified_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _row_to_employee_owner_link(row: AppOneCEmployeeOwnerLink) -> dict[str, Any]:
    return {
        "id": int(row.id),
        "source_base": row.source_base,
        "employee_code": row.employee_code,
        "hub_db_id": row.hub_db_id,
        "owner_no": int(row.owner_no),
        "status": row.status,
        "version": int(row.version),
        "created_by": row.created_by,
        "verified_by": row.verified_by,
        "verified_at": row.verified_at.isoformat() if row.verified_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


class OneCReconcileRegistryService:
    """Persistence seam for verified 1C links and reconciliation audit."""

    def __init__(self, database_url: str | None = None) -> None:
        self._database_url = database_url

    @property
    def configured(self) -> bool:
        return bool(self._database_url or is_app_database_configured())

    def _ensure_schema(self) -> bool:
        if not self.configured:
            return False
        initialize_app_schema(self._database_url)
        return True

    def get_item_link(
        self,
        *,
        hub_db_id: str,
        hub_item_id: str | int,
        source_base: str = "buh20",
    ) -> dict[str, Any] | None:
        if not self._ensure_schema():
            return None
        normalized_source = _text(source_base, maximum=64) or "buh20"
        with app_session(self._database_url) as session:
            row = session.scalars(
                select(AppOneCItemLink).where(
                    AppOneCItemLink.hub_db_id == _text(hub_db_id, maximum=128),
                    AppOneCItemLink.hub_item_id == _text(hub_item_id, maximum=64),
                    AppOneCItemLink.source_base == normalized_source,
                )
            ).first()
            return _row_to_item_link(row) if row is not None else None

    def get_item_links(
        self,
        *,
        hub_db_id: str,
        hub_item_ids: list[str | int],
        source_base: str = "buh20",
    ) -> dict[str, dict[str, Any]]:
        """Load link versions in one indexed query for a HUB result page."""
        if not self._ensure_schema():
            return {}
        item_ids = sorted(
            {
                _text(value, maximum=64)
                for value in hub_item_ids
                if _text(value, maximum=64)
            }
        )
        if not item_ids:
            return {}
        normalized_source = _text(source_base, maximum=64) or "buh20"
        with app_session(self._database_url) as session:
            rows = session.scalars(
                select(AppOneCItemLink).where(
                    AppOneCItemLink.hub_db_id == _text(hub_db_id, maximum=128),
                    AppOneCItemLink.source_base == normalized_source,
                    AppOneCItemLink.hub_item_id.in_(item_ids),
                )
            ).all()
        return {str(row.hub_item_id): _row_to_item_link(row) for row in rows}

    def upsert_item_link(
        self,
        *,
        hub_db_id: str,
        hub_item_id: str | int,
        nomenclature_ref: str | None,
        nomenclature_code_snapshot: str | None,
        status: str,
        actor: str,
        reason: str,
        expected_version: int,
        source_base: str = "buh20",
        correlation_id: str | None = None,
        legacy_part_no_before: str | None = None,
        legacy_part_no_after: str | None = None,
    ) -> dict[str, Any] | None:
        """Create or update one mapping and append its audit event atomically."""
        if not self._ensure_schema():
            return None

        normalized_status = _text(status, maximum=16).lower()
        if normalized_status not in ITEM_LINK_STATUSES:
            raise ValueError("Unsupported 1C item-link status")
        normalized_db_id = _text(hub_db_id, maximum=128)
        normalized_item_id = _text(hub_item_id, maximum=64)
        normalized_source = _text(source_base, maximum=64) or "buh20"
        if not normalized_db_id or not normalized_item_id:
            raise ValueError("hub_db_id and hub_item_id are required")
        if normalized_status == STATUS_LINKED and not _text(nomenclature_ref, maximum=64):
            raise ValueError("nomenclature_ref is required for a linked item")
        if normalized_status == STATUS_EXCLUDED and not _text(reason):
            raise ValueError("reason is required for an excluded item")

        expected = _expected_version(expected_version)
        correlation = _text(correlation_id, maximum=64) or uuid.uuid4().hex
        now = _now()
        with app_session(self._database_url) as session:
            existing = session.scalars(
                select(AppOneCItemLink).where(
                    AppOneCItemLink.hub_db_id == normalized_db_id,
                    AppOneCItemLink.hub_item_id == normalized_item_id,
                    AppOneCItemLink.source_base == normalized_source,
                )
            ).first()
            before = _row_to_item_link(existing) if existing is not None else {}
            if legacy_part_no_before is not None:
                before["legacy_part_no"] = _text(legacy_part_no_before, maximum=200)

            if expected == 0:
                row = AppOneCItemLink(
                    hub_db_id=normalized_db_id,
                    hub_item_id=normalized_item_id,
                    source_base=normalized_source,
                    nomenclature_ref=_text(nomenclature_ref, maximum=64) or None,
                    nomenclature_code_snapshot=_text(nomenclature_code_snapshot, maximum=200) or None,
                    status=normalized_status,
                    reason=_text(reason) or None,
                    version=1,
                    created_by=_text(actor, maximum=128),
                    verified_by=_text(actor, maximum=128) or None,
                    verified_at=now,
                    updated_at=now,
                )
                try:
                    # A unique-key insert is the atomic compare-and-swap for
                    # the initial version (zero means "no row observed").
                    with session.begin_nested():
                        session.add(row)
                        session.flush()
                except IntegrityError as exc:
                    raise OneCReconcileRegistryConflict(
                        "1C item link changed by another user"
                    ) from exc
            else:
                updated = session.execute(
                    update(AppOneCItemLink)
                    .where(
                        AppOneCItemLink.hub_db_id == normalized_db_id,
                        AppOneCItemLink.hub_item_id == normalized_item_id,
                        AppOneCItemLink.source_base == normalized_source,
                        AppOneCItemLink.version == expected,
                    )
                    .values(
                        nomenclature_ref=_text(nomenclature_ref, maximum=64) or None,
                        nomenclature_code_snapshot=_text(nomenclature_code_snapshot, maximum=200) or None,
                        status=normalized_status,
                        reason=_text(reason) or None,
                        version=AppOneCItemLink.version + 1,
                        verified_by=_text(actor, maximum=128) or None,
                        verified_at=now,
                        updated_at=now,
                    )
                )
                if updated.rowcount != 1 or existing is None:
                    raise OneCReconcileRegistryConflict("1C item link changed by another user")
                # The conditional UPDATE holds the row lock until the audit
                # event commits, so this refresh is the exact post-CAS value.
                session.refresh(existing)
                row = existing
            after = _row_to_item_link(row)
            if legacy_part_no_after is not None:
                after["legacy_part_no"] = _text(legacy_part_no_after, maximum=200)
            session.add(
                AppOneCReconcileEvent(
                    id=uuid.uuid4().hex,
                    event_type=f"item_link.{normalized_status}",
                    correlation_id=correlation,
                    hub_db_id=normalized_db_id,
                    hub_item_id=normalized_item_id,
                    actor=_text(actor, maximum=128),
                    reason=_text(reason) or None,
                    before_json=json.dumps(before, ensure_ascii=False, sort_keys=True),
                    after_json=json.dumps(after, ensure_ascii=False, sort_keys=True),
                )
            )
            return after

    def get_active_owner_links(
        self,
        *,
        hub_db_id: str,
        warehouse_refs: list[str],
        source_base: str = "buh20",
    ) -> dict[str, list[int]]:
        """Return explicit warehouse-owner links; callers may fall back to FIO only when absent."""
        if not self._ensure_schema():
            return {}
        refs = sorted({_text(item, maximum=64) for item in warehouse_refs if _text(item, maximum=64)})
        if not refs:
            return {}
        normalized_source = _text(source_base, maximum=64) or "buh20"
        with app_session(self._database_url) as session:
            rows = session.scalars(
                select(AppOneCWarehouseOwnerLink).where(
                    AppOneCWarehouseOwnerLink.hub_db_id == _text(hub_db_id, maximum=128),
                    AppOneCWarehouseOwnerLink.source_base == normalized_source,
                    AppOneCWarehouseOwnerLink.status == "active",
                    AppOneCWarehouseOwnerLink.warehouse_ref.in_(refs),
                )
            ).all()
        result: dict[str, list[int]] = {}
        for row in rows:
            result.setdefault(row.warehouse_ref, []).append(int(row.owner_no))
        return result

    def upsert_warehouse_owner_link(
        self,
        *,
        warehouse_ref: str,
        hub_db_id: str,
        owner_no: int,
        actor: str,
        reason: str,
        status: str = "active",
        expected_version: int,
        source_base: str = "buh20",
        correlation_id: str | None = None,
    ) -> dict[str, Any] | None:
        if not self._ensure_schema():
            return None
        normalized_ref = _text(warehouse_ref, maximum=64)
        normalized_db_id = _text(hub_db_id, maximum=128)
        if not normalized_ref or not normalized_db_id or int(owner_no) <= 0:
            raise ValueError("warehouse_ref, hub_db_id and owner_no are required")
        normalized_status = _text(status, maximum=16).lower()
        if normalized_status not in OWNER_LINK_STATUSES:
            raise ValueError("Unsupported warehouse-owner link status")
        if not _text(reason):
            raise ValueError("reason is required for a warehouse-owner link decision")
        expected = _expected_version(expected_version)
        now = _now()
        normalized_source = _text(source_base, maximum=64) or "buh20"
        with app_session(self._database_url) as session:
            existing = session.scalars(
                select(AppOneCWarehouseOwnerLink).where(
                    AppOneCWarehouseOwnerLink.source_base == normalized_source,
                    AppOneCWarehouseOwnerLink.warehouse_ref == normalized_ref,
                    AppOneCWarehouseOwnerLink.hub_db_id == normalized_db_id,
                    AppOneCWarehouseOwnerLink.owner_no == int(owner_no),
                )
            ).first()
            before = _row_to_warehouse_owner_link(existing) if existing is not None else {}
            if expected == 0:
                row = AppOneCWarehouseOwnerLink(
                    source_base=normalized_source,
                    warehouse_ref=normalized_ref,
                    hub_db_id=normalized_db_id,
                    owner_no=int(owner_no),
                    status=normalized_status,
                    reason=_text(reason),
                    created_by=_text(actor, maximum=128),
                    version=1,
                    verified_by=_text(actor, maximum=128) or None,
                    verified_at=now,
                    updated_at=now,
                )
                try:
                    # The row identity and the partial active-owner index are
                    # both enforced here, rather than by a prior SELECT.
                    with session.begin_nested():
                        session.add(row)
                        session.flush()
                except IntegrityError as exc:
                    raise OneCReconcileRegistryConflict(
                        "The warehouse already has an active HUB owner or changed by another user"
                    ) from exc
            else:
                try:
                    # Activating an inactive historical link can conflict with
                    # the DB-level one-active-owner invariant, so isolate the
                    # DML in a savepoint and leave no half-written audit row.
                    with session.begin_nested():
                        updated = session.execute(
                            update(AppOneCWarehouseOwnerLink)
                            .where(
                                AppOneCWarehouseOwnerLink.source_base == normalized_source,
                                AppOneCWarehouseOwnerLink.warehouse_ref == normalized_ref,
                                AppOneCWarehouseOwnerLink.hub_db_id == normalized_db_id,
                                AppOneCWarehouseOwnerLink.owner_no == int(owner_no),
                                AppOneCWarehouseOwnerLink.version == expected,
                            )
                            .values(
                                status=normalized_status,
                                reason=_text(reason),
                                version=AppOneCWarehouseOwnerLink.version + 1,
                                verified_by=_text(actor, maximum=128) or None,
                                verified_at=now,
                                updated_at=now,
                            )
                        )
                        if updated.rowcount != 1 or existing is None:
                            raise OneCReconcileRegistryConflict(
                                "1C warehouse-owner link changed by another user"
                            )
                except IntegrityError as exc:
                    raise OneCReconcileRegistryConflict(
                        "The warehouse already has an active HUB owner"
                    ) from exc
                session.refresh(existing)
                row = existing
            after = _row_to_warehouse_owner_link(row)
            session.add(
                AppOneCReconcileEvent(
                    id=uuid.uuid4().hex,
                    event_type=f"warehouse_owner_link.{normalized_status}",
                    correlation_id=_text(correlation_id, maximum=64) or uuid.uuid4().hex,
                    hub_db_id=normalized_db_id,
                    actor=_text(actor, maximum=128),
                    reason=_text(reason) or None,
                    before_json=json.dumps(before, ensure_ascii=False, sort_keys=True),
                    after_json=json.dumps(after, ensure_ascii=False, sort_keys=True),
                )
            )
        return after

    def get_active_employee_owner_links(
        self,
        *,
        hub_db_id: str,
        employee_codes: list[str],
        source_base: str = "zar31",
    ) -> dict[str, list[int]]:
        """Resolve explicit ZUP employee-code links without inferring a warehouse."""
        if not self._ensure_schema():
            return {}
        codes = sorted({_text(value, maximum=128) for value in employee_codes if _text(value, maximum=128)})
        if not codes:
            return {}
        with app_session(self._database_url) as session:
            rows = session.scalars(
                select(AppOneCEmployeeOwnerLink).where(
                    AppOneCEmployeeOwnerLink.hub_db_id == _text(hub_db_id, maximum=128),
                    AppOneCEmployeeOwnerLink.source_base == (_text(source_base, maximum=64) or "zar31"),
                    AppOneCEmployeeOwnerLink.status == "active",
                    AppOneCEmployeeOwnerLink.employee_code.in_(codes),
                )
            ).all()
        result: dict[str, list[int]] = {}
        for row in rows:
            result.setdefault(row.employee_code, []).append(int(row.owner_no))
        return result

    def upsert_employee_owner_link(
        self,
        *,
        employee_code: str,
        hub_db_id: str,
        owner_no: int,
        actor: str,
        reason: str,
        status: str = "active",
        expected_version: int,
        source_base: str = "zar31",
        correlation_id: str | None = None,
    ) -> dict[str, Any] | None:
        if not self._ensure_schema():
            return None
        normalized_code = _text(employee_code, maximum=128)
        normalized_db_id = _text(hub_db_id, maximum=128)
        if not normalized_code or not normalized_db_id or int(owner_no) <= 0:
            raise ValueError("employee_code, hub_db_id and owner_no are required")
        normalized_status = _text(status, maximum=16).lower()
        if normalized_status not in OWNER_LINK_STATUSES:
            raise ValueError("Unsupported employee-owner link status")
        if not _text(reason):
            raise ValueError("reason is required for an employee-owner link decision")
        expected = _expected_version(expected_version)
        now = _now()
        normalized_source = _text(source_base, maximum=64) or "zar31"
        with app_session(self._database_url) as session:
            existing = session.scalars(
                select(AppOneCEmployeeOwnerLink).where(
                    AppOneCEmployeeOwnerLink.source_base == normalized_source,
                    AppOneCEmployeeOwnerLink.employee_code == normalized_code,
                    AppOneCEmployeeOwnerLink.hub_db_id == normalized_db_id,
                    AppOneCEmployeeOwnerLink.owner_no == int(owner_no),
                )
            ).first()
            before = _row_to_employee_owner_link(existing) if existing is not None else {}
            if expected == 0:
                row = AppOneCEmployeeOwnerLink(
                    source_base=normalized_source,
                    employee_code=normalized_code,
                    hub_db_id=normalized_db_id,
                    owner_no=int(owner_no),
                    status=normalized_status,
                    created_by=_text(actor, maximum=128),
                    version=1,
                    verified_by=_text(actor, maximum=128) or None,
                    verified_at=now,
                    updated_at=now,
                )
                try:
                    with session.begin_nested():
                        session.add(row)
                        session.flush()
                except IntegrityError as exc:
                    raise OneCReconcileRegistryConflict(
                        "1C employee-owner link changed by another user"
                    ) from exc
            else:
                updated = session.execute(
                    update(AppOneCEmployeeOwnerLink)
                    .where(
                        AppOneCEmployeeOwnerLink.source_base == normalized_source,
                        AppOneCEmployeeOwnerLink.employee_code == normalized_code,
                        AppOneCEmployeeOwnerLink.hub_db_id == normalized_db_id,
                        AppOneCEmployeeOwnerLink.owner_no == int(owner_no),
                        AppOneCEmployeeOwnerLink.version == expected,
                    )
                    .values(
                        status=normalized_status,
                        version=AppOneCEmployeeOwnerLink.version + 1,
                        verified_by=_text(actor, maximum=128) or None,
                        verified_at=now,
                        updated_at=now,
                    )
                )
                if updated.rowcount != 1 or existing is None:
                    raise OneCReconcileRegistryConflict("1C employee-owner link changed by another user")
                session.refresh(existing)
                row = existing
            after = _row_to_employee_owner_link(row)
            session.add(
                AppOneCReconcileEvent(
                    id=uuid.uuid4().hex,
                    event_type=f"employee_owner_link.{normalized_status}",
                    correlation_id=_text(correlation_id, maximum=64) or uuid.uuid4().hex,
                    hub_db_id=normalized_db_id,
                    actor=_text(actor, maximum=128),
                    reason=_text(reason),
                    before_json=json.dumps(before, ensure_ascii=False, sort_keys=True),
                    after_json=json.dumps(after, ensure_ascii=False, sort_keys=True),
                )
            )
        return after


one_c_reconcile_registry_service = OneCReconcileRegistryService()
