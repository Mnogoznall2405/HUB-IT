from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services import equipment_recent_acts_service as recent_module  # noqa: E402


@pytest.fixture
def recent_service(monkeypatch, tmp_path):
    monkeypatch.setattr(recent_module, "is_app_database_configured", lambda: False)
    counter = {"value": 0}
    base = datetime(2026, 7, 16, 8, 0, tzinfo=timezone.utc)

    def fake_now():
        current = base + timedelta(seconds=counter["value"])
        counter["value"] += 1
        return current

    monkeypatch.setattr(recent_module, "_utc_now", fake_now)
    return recent_module.EquipmentRecentActsService(
        file_path=tmp_path / "web_equipment_recent_acts.json",
    )


def test_recent_acts_upserts_sorts_and_keeps_latest_snapshot(recent_service):
    recent_service.touch(
        user_id=7,
        db_id="main",
        doc_no=1001,
        doc_number="A-1001",
        action_type="view",
        snapshot={"doc_number": "A-1001", "employee_name": "Ivanov"},
    )
    recent_service.touch(
        user_id=7,
        db_id="main",
        doc_no=1002,
        doc_number="A-1002",
        action_type="upload",
        snapshot={"doc_number": "A-1002", "employee_name": "Petrov"},
    )
    recent_service.touch(
        user_id=7,
        db_id="main",
        doc_no=1001,
        doc_number="A-1001",
        action_type="open_file",
        snapshot={"doc_number": "A-1001", "employee_name": "Ivanov I."},
    )

    items = recent_service.list_recent(user_id=7, db_id="main", limit=8)

    assert [item["doc_no"] for item in items] == [1001, 1002]
    assert items[0]["activity_count"] == 2
    assert items[0]["last_action"] == "open_file"
    assert items[0]["snapshot"]["employee_name"] == "Ivanov I."
    assert items[1]["activity_count"] == 1


def test_recent_acts_are_isolated_by_user_and_database(recent_service):
    recent_service.touch(user_id=7, db_id="main", doc_no=1001, action_type="view")
    recent_service.touch(user_id=8, db_id="main", doc_no=1002, action_type="view")
    recent_service.touch(user_id=7, db_id="archive", doc_no=1003, action_type="view")

    assert [item["doc_no"] for item in recent_service.list_recent(user_id=7, db_id="main")] == [1001]
    assert [item["doc_no"] for item in recent_service.list_recent(user_id=8, db_id="main")] == [1002]
    assert [item["doc_no"] for item in recent_service.list_recent(user_id=7, db_id="archive")] == [1003]


def test_recent_acts_prunes_to_50_per_user_database(recent_service):
    for index in range(60):
        recent_service.touch(
            user_id=7,
            db_id="main",
            doc_no=1000 + index,
            action_type="view",
        )

    items = recent_service.list_recent(user_id=7, db_id="main", limit=50)

    assert len(items) == 50
    assert items[0]["doc_no"] == 1059
    assert items[-1]["doc_no"] == 1010
    assert not recent_service.remove(user_id=7, db_id="main", doc_no=1009)["removed"]
