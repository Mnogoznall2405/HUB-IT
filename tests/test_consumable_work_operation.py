from __future__ import annotations

import sys
import uuid
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.api import deps  # noqa: E402
from backend.api.v1 import equipment as equipment_api  # noqa: E402
from backend.database import queries as db_queries  # noqa: E402
from backend.models.auth import User  # noqa: E402
from backend.services import consumable_work_service  # noqa: E402


def _make_user() -> User:
    return User(
        id=1,
        username="admin",
        role="admin",  # type: ignore[arg-type]
        is_active=True,
        use_custom_permissions=False,
        custom_permissions=[],
    )


class _FakeWorksDataManager:
    """In-memory JSON store capturing appended works records."""

    def __init__(self):
        self.files: dict[str, list[dict]] = {}

    def load_json(self, filename, default_content=None):
        return self.files.setdefault(filename, [])

    def append_to_json(self, filename, record):
        self.files.setdefault(filename, []).append(dict(record))


class _FakeWorksManager:
    COMPONENT_FILE = "component_replacements.json"
    CARTRIDGE_FILE = "cartridge_replacements.json"

    _shared_manager = _FakeWorksDataManager()
    fail_next_component = False

    def __init__(self, data_manager=None):
        self.data_manager = _FakeWorksManager._shared_manager

    def add_cartridge_replacement(self, **kwargs):
        record = {"kind": "cartridge", **kwargs}
        record["timestamp"] = "2026-01-01T00:00:00"
        self.data_manager.append_to_json(self.CARTRIDGE_FILE, record)
        return record

    def add_component_replacement(self, **kwargs):
        if _FakeWorksManager.fail_next_component:
            raise RuntimeError("works store unavailable")
        record = {"kind": "component", **kwargs}
        record["timestamp"] = "2026-01-01T00:00:00"
        self.data_manager.append_to_json(self.COMPONENT_FILE, record)
        return record


@pytest.fixture
def consume_env(monkeypatch):
    app = FastAPI()
    app.include_router(equipment_api.router, prefix="/equipment")

    app.dependency_overrides[deps.get_current_active_user] = _make_user
    app.dependency_overrides[deps.get_request_scoped_database_id] = lambda: "main"

    state = {"qty": 5, "calls": 0}

    def fake_consume(*, db_id=None, item_id=None, inv_no=None, qty=1, changed_by=""):
        state["calls"] += 1
        if state["qty"] < qty:
            return {
                "success": False,
                "item_id": item_id,
                "inv_no": inv_no,
                "qty_old": state["qty"],
                "qty_new": state["qty"],
                "message": "Insufficient consumable quantity",
            }
        state["qty"] -= qty
        return {
            "success": True,
            "item_id": item_id,
            "inv_no": inv_no,
            "qty_old": state["qty"] + qty,
            "qty_new": state["qty"],
            "message": "Consumable stock updated",
        }

    monkeypatch.setattr(db_queries, "consume_consumable_stock", fake_consume)
    monkeypatch.setattr(equipment_api, "invalidate_equipment_cache", lambda db_id=None: None)

    _FakeWorksManager._shared_manager = _FakeWorksDataManager()
    _FakeWorksManager.fail_next_component = False
    monkeypatch.setattr(
        "backend.json_db.works.WorksManager", _FakeWorksManager
    )

    return {
        "client": TestClient(app, raise_server_exceptions=False),
        "state": state,
        "works": _FakeWorksManager._shared_manager,
    }


def _op_id() -> str:
    return f"test-{uuid.uuid4()}"


def _component_work() -> dict:
    return {
        "kind": "component",
        "payload": {
            "serial_number": "SN-1",
            "component_type": "ram",
            "component_model": "Kingston 8GB",
            "component_name": "ОЗУ",
            "equipment_kind": "pc",
            "branch": "ЦО",
            "location": "101",
            "inv_no": "INV-1",
            "db_name": "main",
        },
    }


def test_consume_with_work_writes_record_and_reports_id(consume_env):
    response = consume_env["client"].post(
        "/equipment/consumables/consume",
        json={
            "item_id": 4821,
            "qty": 1,
            "reason": "component",
            "operation_id": _op_id(),
            "work": _component_work(),
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["success"] is True
    assert body["qty_new"] == 4
    assert body["work_status"] == "recorded"
    assert body["operation_id"]
    written = consume_env["works"].files["component_replacements.json"]
    assert len(written) == 1
    assert written[0]["additional_data"]["operation_id"] == body["operation_id"]


def test_failed_work_write_then_retry_does_not_double_consume(consume_env):
    operation_id = _op_id()
    _FakeWorksManager.fail_next_component = True

    first = consume_env["client"].post(
        "/equipment/consumables/consume",
        json={
            "item_id": 4821,
            "qty": 1,
            "reason": "component",
            "operation_id": operation_id,
            "work": _component_work(),
        },
    )
    assert first.status_code == 500, first.text
    assert consume_env["state"]["qty"] == 4
    assert consume_env["state"]["calls"] == 1

    _FakeWorksManager.fail_next_component = False
    second = consume_env["client"].post(
        "/equipment/consumables/consume",
        json={
            "item_id": 4821,
            "qty": 1,
            "reason": "component",
            "operation_id": operation_id,
            "work": _component_work(),
        },
    )

    assert second.status_code == 200, second.text
    body = second.json()
    # The retry resumed from the consumed checkpoint — stock was decremented
    # exactly once across both attempts.
    assert body["qty_new"] == 4
    assert consume_env["state"]["calls"] == 1
    assert consume_env["state"]["qty"] == 4
    assert len(consume_env["works"].files["component_replacements.json"]) == 1


def test_replayed_done_operation_returns_stored_result(consume_env):
    operation_id = _op_id()
    payload = {
        "item_id": 4821,
        "qty": 1,
        "reason": "component",
        "operation_id": operation_id,
        "work": _component_work(),
    }

    first = consume_env["client"].post("/equipment/consumables/consume", json=payload)
    assert first.status_code == 200, first.text

    second = consume_env["client"].post("/equipment/consumables/consume", json=payload)
    assert second.status_code == 200, second.text
    assert second.json()["qty_new"] == first.json()["qty_new"]
    assert consume_env["state"]["calls"] == 1
    assert len(consume_env["works"].files["component_replacements.json"]) == 1


def test_invalid_work_payload_rejected_before_consume(consume_env):
    response = consume_env["client"].post(
        "/equipment/consumables/consume",
        json={
            "item_id": 4821,
            "qty": 1,
            "reason": "component",
            "operation_id": _op_id(),
            "work": {"kind": "component", "payload": {"component_type": "ram"}},
        },
    )

    assert response.status_code == 400, response.text
    assert consume_env["state"]["calls"] == 0
    assert consume_env["state"]["qty"] == 5


def test_operation_id_conflict_for_different_payload(consume_env):
    operation_id = _op_id()
    base = {
        "item_id": 4821,
        "qty": 1,
        "reason": "component",
        "operation_id": operation_id,
        "work": _component_work(),
    }
    first = consume_env["client"].post("/equipment/consumables/consume", json=base)
    assert first.status_code == 200, first.text

    changed = dict(base, qty=2)
    second = consume_env["client"].post("/equipment/consumables/consume", json=changed)
    assert second.status_code == 409, second.text


def test_consume_only_operation_id_still_idempotent(consume_env):
    operation_id = _op_id()
    payload = {"item_id": 4821, "qty": 1, "reason": "qr_scan", "operation_id": operation_id}

    first = consume_env["client"].post("/equipment/consumables/consume", json=payload)
    assert first.status_code == 200, first.text
    assert first.json()["work_status"] == "none"

    second = consume_env["client"].post("/equipment/consumables/consume", json=payload)
    assert second.status_code == 200, second.text
    assert consume_env["state"]["calls"] == 1
