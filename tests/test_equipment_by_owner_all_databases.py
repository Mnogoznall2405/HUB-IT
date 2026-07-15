from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.database import queries as db_queries  # noqa: E402


def test_get_equipment_by_owner_all_databases_merges_and_tags(monkeypatch):
    monkeypatch.setattr(
        "backend.api.v1.database.get_all_db_configs",
        lambda: [
            {"id": "ITINVENT", "name": "ITINVENT"},
            {"id": "MSK-ITINVENT", "name": "MSK"},
        ],
    )

    def fake_get_equipment_by_owner(owner_no, db_id=None):
        if db_id == "ITINVENT" and owner_no == 10:
            return [{"inv_no": "100", "model_name": "Dell"}]
        if db_id == "MSK-ITINVENT" and owner_no == 55:
            return [{"inv_no": "200", "model_name": "Lenovo"}]
        return []

    monkeypatch.setattr(db_queries, "get_equipment_by_owner", fake_get_equipment_by_owner)
    monkeypatch.setattr(
        db_queries,
        "list_owners_compact",
        lambda db_id=None: (
            [{"OWNER_NO": 55, "OWNER_DISPLAY_NAME": "Фомин Максим Николаевич"}]
            if db_id == "MSK-ITINVENT"
            else []
        ),
    )
    monkeypatch.setattr(
        "backend.services.warehouse_1c_service.fio_person_match_score",
        lambda owner_name, label: 100 if "Фомин" in owner_name and "Фомин" in label else 0,
    )

    rows = db_queries.get_equipment_by_owner_all_databases(
        10,
        employee_name="Фомин Максим Николаевич",
        current_db_id="ITINVENT",
    )

    assert [row["inv_no"] for row in rows] == ["100", "200"]
    assert rows[0]["hub_db_id"] == "ITINVENT"
    assert rows[0]["is_current_db"] is True
    assert rows[1]["hub_db_id"] == "MSK-ITINVENT"
    assert rows[1]["is_current_db"] is False
    assert rows[1]["hub_owner_no"] == 55


def test_get_equipment_by_owner_all_databases_skips_unresolved_db(monkeypatch):
    monkeypatch.setattr(
        "backend.api.v1.database.get_all_db_configs",
        lambda: [
            {"id": "ITINVENT", "name": "ITINVENT"},
            {"id": "MSK-ITINVENT", "name": "MSK"},
        ],
    )
    calls = []

    def fake_get_equipment_by_owner(owner_no, db_id=None):
        calls.append((owner_no, db_id))
        return [{"inv_no": "1"}]

    monkeypatch.setattr(db_queries, "get_equipment_by_owner", fake_get_equipment_by_owner)
    monkeypatch.setattr(db_queries, "list_owners_compact", lambda db_id=None: [])

    rows = db_queries.get_equipment_by_owner_all_databases(
        42,
        employee_name="",
        current_db_id="ITINVENT",
    )

    assert calls == [(42, "ITINVENT")]
    assert len(rows) == 1
    assert rows[0]["hub_db_id"] == "ITINVENT"


def test_get_equipment_by_owner_all_databases_skips_db_when_owner_resolution_fails(monkeypatch):
    monkeypatch.setattr(
        "backend.api.v1.database.get_all_db_configs",
        lambda: [
            {"id": "ITINVENT", "name": "ITINVENT"},
            {"id": "MSK-ITINVENT", "name": "MSK"},
        ],
    )

    def fake_list_owners_compact(db_id=None):
        if db_id == "MSK-ITINVENT":
            raise RuntimeError("secondary Hub database is unavailable")
        return []

    calls = []

    def fake_get_equipment_by_owner(owner_no, db_id=None):
        calls.append((owner_no, db_id))
        return [{"inv_no": "100"}]

    monkeypatch.setattr(db_queries, "list_owners_compact", fake_list_owners_compact)
    monkeypatch.setattr(db_queries, "get_equipment_by_owner", fake_get_equipment_by_owner)

    rows = db_queries.get_equipment_by_owner_all_databases(
        42,
        employee_name="Ivanova Ekaterina",
        current_db_id="ITINVENT",
    )

    assert calls == [(42, "ITINVENT")]
    assert [row["inv_no"] for row in rows] == ["100"]
