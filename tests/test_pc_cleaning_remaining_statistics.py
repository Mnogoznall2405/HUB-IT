from __future__ import annotations

import sys
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.json_db.works import WorksManager
from backend.models.json_operations import PcCleaningRemainingResponse, PcCleaningStatisticsResponse


def test_inventory_statistics_query_uses_items_descr_not_description():
    sql = WorksManager.INVENTORY_STATISTICS_QUERY
    assert "i.DESCR as description" in sql
    assert "i.DESCRIPTION" not in sql
    assert "i.ID as id" in sql



def _patch_cleaning_inventory(monkeypatch, manager):
    now = datetime.now()
    recent = (now - timedelta(days=3)).isoformat()
    stale = (now - timedelta(days=180)).isoformat()
    monkeypatch.setattr(
        manager,
        "_get_pc_inventory",
        lambda db_name=None: [
            {
                "branch_name": "Москва",
                "location": "Кабинет 12",
                "inv_no": "1001",
                "serial_no": "SN-CLEANED",
                "hw_serial_no": "",
                "model_name": "HP ProDesk",
                "employee_name": "Иванов",
                "id": 11,
                "vendor_name": "HP",
                "description": "ПК Иванова",
            },
            {
                "branch_name": "Москва",
                "location": "Склад",
                "inv_no": "1002",
                "serial_no": "SN-STALE",
                "hw_serial_no": "",
                "model_name": "Lenovo ThinkCentre",
                "employee_name": "Петров",
                "id": 12,
                "vendor_name": "Lenovo",
                "description": "Складской ПК",
            },
            {
                "branch_name": "СПб",
                "location": "Бухгалтерия",
                "inv_no": "2001",
                "serial_no": "SN-NEVER",
                "hw_serial_no": "HW-2001",
                "model_name": "Dell OptiPlex",
                "employee_name": "Сидоров",
                "id": 21,
                "vendor_name": "Dell",
                "description": "",
            },
        ],
    )
    monkeypatch.setattr(
        manager,
        "get_pc_cleanings",
        lambda db_name=None: [
            {"timestamp": recent, "branch": "Москва", "serial_no": "SN-CLEANED", "inv_no": "1001"},
            {"timestamp": stale, "branch": "Москва", "serial_no": "SN-STALE", "inv_no": "1002"},
        ],
    )


def test_pc_cleaning_statistics_lists_remaining_pcs_by_branch(monkeypatch):
    manager = WorksManager(data_manager=SimpleNamespace())
    _patch_cleaning_inventory(monkeypatch, manager)

    stats = manager.get_pc_cleaning_statistics(period_days=90)
    payload = PcCleaningStatisticsResponse(**stats)
    by_branch = {row.branch: row for row in payload.branches}

    moscow = by_branch["Москва"]
    assert moscow.total_pc == 2
    assert moscow.cleaned_pc == 1
    assert moscow.remaining_pc == 1
    assert [row.inv_no for row in moscow.remaining_pcs] == ["1002"]
    assert moscow.remaining_pcs[0].employee == "Петров"
    assert moscow.remaining_pcs[0].last_cleaned_at

    spb = by_branch["СПб"]
    assert spb.remaining_pc == 1
    assert spb.remaining_pcs[0].inv_no == "2001"
    assert spb.remaining_pcs[0].serial_no == "SN-NEVER"
    assert spb.remaining_pcs[0].last_cleaned_at == ""
    assert payload.totals.remaining_pc == 2


def test_pc_cleaning_remaining_filters_one_branch(monkeypatch):
    manager = WorksManager(data_manager=SimpleNamespace())
    _patch_cleaning_inventory(monkeypatch, manager)

    payload = PcCleaningRemainingResponse(
        **manager.get_pc_cleaning_remaining(period_days=90, branch="спб")
    )
    assert payload.branch == "СПб"
    assert payload.remaining_pc == 1
    assert [row.inv_no for row in payload.remaining_pcs] == ["2001"]
    assert payload.remaining_pcs[0].employee == "Сидоров"
    assert payload.remaining_pcs[0].equipment_id == 21
    assert payload.remaining_pcs[0].manufacturer == "Dell"


def test_pc_cleaning_history_uses_stable_inventory_identity_after_move():
    cleaning_records = [
        {
            "db_name": "main-db",
            "inv_no": "1001",
            "serial_no": "DUPLICATE-SERIAL",
            "branch": "Old branch",
            "employee": "Old owner",
            "timestamp": "2026-02-12T10:00:00",
        },
        {
            "equipment_id": 22,
            "db_name": "main-db",
            "inv_no": "2002",
            "serial_no": "DUPLICATE-SERIAL",
            "branch": "Other branch",
            "employee": "Other owner",
            "timestamp": "2026-08-03T10:00:00",
        },
        {
            "equipment_id": 11,
            "db_name": "other-db",
            "inv_no": "1001",
            "serial_no": "DUPLICATE-SERIAL",
            "timestamp": "2026-08-04T10:00:00",
        },
    ]
    manager = WorksManager(
        data_manager=SimpleNamespace(
            load_json=lambda *_args, **_kwargs: cleaning_records,
        )
    )

    history = manager.get_pc_cleaning_history(
        serial_number="DUPLICATE-SERIAL",
        inv_no="1001",
        equipment_id=11,
        db_name="main-db",
    )

    assert history["count"] == 1
    assert history["last_date"] == "2026-02-12T10:00:00"


def test_add_pc_cleaning_persists_equipment_id_for_future_moves():
    saved = []
    manager = WorksManager(
        data_manager=SimpleNamespace(
            append_to_json=lambda _file_name, record: saved.append(record) or True,
        )
    )

    record = manager.add_pc_cleaning(
        serial_number="SERIAL-1001",
        employee="Owner",
        branch="Branch",
        location="Room",
        inv_no="1001",
        equipment_id=11,
    )

    assert record["equipment_id"] == 11
    assert saved[0]["equipment_id"] == 11


def test_pc_cleaning_statistics_prefers_inv_no_for_legacy_records_after_move(monkeypatch):
    manager = WorksManager(data_manager=SimpleNamespace())
    monkeypatch.setattr(
        manager,
        "_get_pc_inventory",
        lambda db_name=None: [
            {
                "id": 11,
                "branch_name": "New branch",
                "location": "New room",
                "inv_no": "1001",
                "serial_no": "DUPLICATE-SERIAL",
                "type_name": "PC",
                "model_name": "Workstation",
            }
        ],
    )
    monkeypatch.setattr(
        manager,
        "get_pc_cleanings",
        lambda db_name=None: [
            {
                "db_name": "main-db",
                "inv_no": "1001",
                "serial_no": "DUPLICATE-SERIAL",
                "branch": "Old branch",
                "timestamp": (datetime.now() - timedelta(days=180)).isoformat(),
            },
            {
                "db_name": "main-db",
                "inv_no": "2002",
                "serial_no": "DUPLICATE-SERIAL",
                "branch": "Other branch",
                "timestamp": (datetime.now() - timedelta(days=3)).isoformat(),
            },
        ],
    )

    stats = manager.get_pc_cleaning_statistics(period_days=90, db_name="main-db")

    moved_branch = next(row for row in stats["branches"] if row["branch"] == "New branch")
    assert moved_branch["cleaned_pc"] == 0
    assert moved_branch["remaining_pc"] == 1
    assert moved_branch["remaining_pcs"][0]["last_cleaned_at"].startswith(
        (datetime.now() - timedelta(days=180)).date().isoformat()
    )
