"""PART_NO check against the 1C nomenclature snapshot: only really absent codes are reported."""
from __future__ import annotations

import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.api import deps  # noqa: E402
from backend.api.v1 import warehouse_1c as warehouse_1c_api  # noqa: E402
from backend.models.auth import User  # noqa: E402
from backend.services.warehouse_1c_service import warehouse_1c_service  # noqa: E402


class _Store:
    def __init__(self, known, available=True):
        self.known = known
        self.available = available

    def lookup_nomenclature_codes(self, codes, *, source_base=""):
        if not self.available:
            return False, {}
        return True, {code: {"ref": code, "code": code, "name": ""} for code in codes if code in self.known}


def _client(monkeypatch, store):
    monkeypatch.setattr(warehouse_1c_service, "_catalog_snapshot_store", store)
    app = FastAPI()
    app.include_router(warehouse_1c_api.router, prefix="/warehouse-1c")
    app.dependency_overrides[deps.get_current_active_user] = lambda: User(
        id=1, username="reviewer", role="admin", is_active=True
    )
    return TestClient(app)


def test_part_no_check_reports_only_codes_absent_from_nomenclature(monkeypatch):
    client = _client(monkeypatch, _Store({"abc-1", "xyz 2"}))

    body = client.post("/warehouse-1c/part-no-check", json={"codes": [" ABC-1 ", "XYZ  2", "NOPE-3", "nope-3", ""]}).json()

    assert body["available"] is True
    assert [code.upper() for code in body["missing"]] == ["NOPE-3"]


def test_part_no_check_marks_nothing_while_snapshot_is_unavailable(monkeypatch):
    client = _client(monkeypatch, _Store(set(), available=False))

    response = client.post("/warehouse-1c/part-no-check", json={"codes": ["NOPE-3"]})

    assert response.json() == {"available": False, "missing": []}
