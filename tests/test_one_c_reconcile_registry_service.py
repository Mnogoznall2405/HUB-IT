from __future__ import annotations

import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services.one_c_reconcile_registry_service import (  # noqa: E402
    OneCReconcileRegistryConflict,
    OneCReconcileRegistryService,
    STATUS_EXCLUDED,
    STATUS_LINKED,
)


def _service(temp_dir) -> OneCReconcileRegistryService:
    database_path = Path(temp_dir) / "one_c_registry.db"
    return OneCReconcileRegistryService(f"sqlite:///{database_path.as_posix()}")


def test_item_link_is_auditable_and_uses_optimistic_version(temp_dir):
    service = _service(temp_dir)

    created = service.upsert_item_link(
        hub_db_id="ITINVENT",
        hub_item_id=101,
        nomenclature_ref="11111111-1111-1111-1111-111111111111",
        nomenclature_code_snapshot="PN-101",
        status=STATUS_LINKED,
        actor="alice",
        reason="verified against catalog",
        expected_version=0,
    )

    assert created is not None
    assert created["status"] == STATUS_LINKED
    assert created["version"] == 1

    updated = service.upsert_item_link(
        hub_db_id="ITINVENT",
        hub_item_id=101,
        nomenclature_ref=None,
        nomenclature_code_snapshot=None,
        status=STATUS_EXCLUDED,
        actor="alice",
        reason="legacy item intentionally excluded",
        expected_version=1,
    )
    assert updated is not None
    assert updated["version"] == 2
    assert updated["status"] == STATUS_EXCLUDED

    with pytest.raises(OneCReconcileRegistryConflict):
        service.upsert_item_link(
            hub_db_id="ITINVENT",
            hub_item_id=101,
            nomenclature_ref="22222222-2222-2222-2222-222222222222",
            nomenclature_code_snapshot="PN-102",
            status=STATUS_LINKED,
            actor="bob",
            reason="stale update",
            expected_version=1,
        )


def test_warehouse_owner_links_are_explicit_and_scoped_to_hub_database(temp_dir):
    service = _service(temp_dir)

    assert service.upsert_warehouse_owner_link(
        warehouse_ref="warehouse-1",
        hub_db_id="ITINVENT",
        owner_no=42,
        actor="admin",
        reason="verified owner",
        expected_version=0,
    )
    assert service.get_active_owner_links(
        hub_db_id="ITINVENT",
        warehouse_refs=["warehouse-1", "warehouse-2"],
    ) == {"warehouse-1": [42]}
    assert service.get_active_owner_links(
        hub_db_id="OTHER",
        warehouse_refs=["warehouse-1"],
    ) == {}


def test_owner_link_updates_use_optimistic_version(temp_dir):
    service = _service(temp_dir)
    created = service.upsert_warehouse_owner_link(
        warehouse_ref="warehouse-1",
        hub_db_id="ITINVENT",
        owner_no=42,
        actor="admin",
        reason="initial review",
        expected_version=0,
    )
    assert created is not None
    assert created["version"] == 1

    updated = service.upsert_warehouse_owner_link(
        warehouse_ref="warehouse-1",
        hub_db_id="ITINVENT",
        owner_no=42,
        actor="admin",
        reason="reviewed again",
        status="inactive",
        expected_version=1,
    )
    assert updated is not None
    assert updated["version"] == 2

    with pytest.raises(OneCReconcileRegistryConflict):
        service.upsert_warehouse_owner_link(
            warehouse_ref="warehouse-1",
            hub_db_id="ITINVENT",
            owner_no=42,
            actor="admin",
            reason="stale request",
            expected_version=1,
        )


def test_item_link_stale_compare_and_swap_keeps_first_writer_value(temp_dir):
    """Two service instances may share a DB, but only one observed version wins."""
    first = _service(temp_dir)
    second = _service(temp_dir)
    created = first.upsert_item_link(
        hub_db_id="ITINVENT",
        hub_item_id=101,
        nomenclature_ref="11111111-1111-1111-1111-111111111111",
        nomenclature_code_snapshot="PN-101",
        status=STATUS_LINKED,
        actor="alice",
        reason="initial review",
        expected_version=0,
    )
    assert created is not None

    winner = first.upsert_item_link(
        hub_db_id="ITINVENT",
        hub_item_id=101,
        nomenclature_ref=None,
        nomenclature_code_snapshot=None,
        status=STATUS_EXCLUDED,
        actor="alice",
        reason="reviewed exclusion",
        expected_version=1,
    )
    assert winner is not None
    assert winner["version"] == 2

    with pytest.raises(OneCReconcileRegistryConflict):
        second.upsert_item_link(
            hub_db_id="ITINVENT",
            hub_item_id=101,
            nomenclature_ref="22222222-2222-2222-2222-222222222222",
            nomenclature_code_snapshot="PN-102",
            status=STATUS_LINKED,
            actor="bob",
            reason="concurrent stale confirmation",
            expected_version=1,
        )

    current = second.get_item_link(hub_db_id="ITINVENT", hub_item_id=101)
    assert current is not None
    assert current["status"] == STATUS_EXCLUDED
    assert current["version"] == 2


def test_warehouse_owner_replacement_requires_deactivation_and_keeps_one_active(temp_dir):
    service = _service(temp_dir)
    original = service.upsert_warehouse_owner_link(
        warehouse_ref="warehouse-1",
        hub_db_id="ITINVENT",
        owner_no=42,
        actor="admin",
        reason="initial owner",
        expected_version=0,
    )
    assert original is not None

    # The partial unique index is the final guard against an accidental second
    # active owner, including a racing request that passed a stale read.
    with pytest.raises(OneCReconcileRegistryConflict):
        service.upsert_warehouse_owner_link(
            warehouse_ref="warehouse-1",
            hub_db_id="ITINVENT",
            owner_no=77,
            actor="admin",
            reason="unconfirmed replacement",
            expected_version=0,
        )

    retired = service.upsert_warehouse_owner_link(
        warehouse_ref="warehouse-1",
        hub_db_id="ITINVENT",
        owner_no=42,
        actor="admin",
        reason="owner replaced",
        status="inactive",
        expected_version=1,
    )
    assert retired is not None
    replacement = service.upsert_warehouse_owner_link(
        warehouse_ref="warehouse-1",
        hub_db_id="ITINVENT",
        owner_no=77,
        actor="admin",
        reason="replacement confirmed",
        expected_version=0,
    )
    assert replacement is not None
    assert service.get_active_owner_links(
        hub_db_id="ITINVENT",
        warehouse_refs=["warehouse-1"],
    ) == {"warehouse-1": [77]}

    # One owner can remain the active owner of several distinct warehouses.
    assert service.upsert_warehouse_owner_link(
        warehouse_ref="warehouse-2",
        hub_db_id="ITINVENT",
        owner_no=77,
        actor="admin",
        reason="another confirmed warehouse",
        expected_version=0,
    )
    assert service.get_active_owner_links(
        hub_db_id="ITINVENT",
        warehouse_refs=["warehouse-1", "warehouse-2"],
    ) == {"warehouse-1": [77], "warehouse-2": [77]}


def test_employee_owner_link_rejects_a_stale_version(temp_dir):
    service = _service(temp_dir)
    created = service.upsert_employee_owner_link(
        employee_code="EMP-42",
        hub_db_id="ITINVENT",
        owner_no=42,
        actor="admin",
        reason="employee verified",
        expected_version=0,
    )
    assert created is not None
    assert created["version"] == 1

    updated = service.upsert_employee_owner_link(
        employee_code="EMP-42",
        hub_db_id="ITINVENT",
        owner_no=42,
        actor="admin",
        reason="employee left",
        status="inactive",
        expected_version=1,
    )
    assert updated is not None
    assert updated["version"] == 2

    with pytest.raises(OneCReconcileRegistryConflict):
        service.upsert_employee_owner_link(
            employee_code="EMP-42",
            hub_db_id="ITINVENT",
            owner_no=42,
            actor="admin",
            reason="stale reactivation",
            expected_version=1,
        )
