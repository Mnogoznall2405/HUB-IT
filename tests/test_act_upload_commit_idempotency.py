"""Загрузка подписанного акта: параллельный commit одного черновика, сбой Hub после записи акта
и доступ к черновику только у его автора (или администратора).

SQL Server и Hub изолированы подменами; проверяется поведение commit на границе
сервиса и HTTP-маршрута.
"""

from __future__ import annotations

import importlib
import threading
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

COMMIT_PAYLOAD = {
    "from_employee": "Старый сотрудник",
    "to_employee": "Новый сотрудник",
    "doc_date": "2026-11-16 10:00:00",
    "equipment_inv_nos": ["1001"],
}
OPERATOR_ID = 15
OTHER_OPERATOR_ID = 16


def _rows_for(inv_nos):
    rows = [
        {"item_id": index + 1, "inv_no": inv_no, "INV_NO": inv_no, "model_name": "TEST-MODEL", "serial_no": f"SN-{inv_no}"}
        for index, inv_no in enumerate(inv_nos)
    ]
    return rows, [], {}


def _created_act(doc_no):
    return {
        "doc_no": doc_no,
        "doc_number": str(doc_no),
        "file_no": doc_no + 1000,
        "linked_item_ids": [1],
        "updated_previous_doc_nos": [],
        "annulled_doc_nos": [],
    }


def _hub_unavailable(**kwargs):
    raise RuntimeError("Hub недоступен")


@pytest.fixture
def local_store_in_tmp(monkeypatch, tmp_path):
    import local_store

    monkeypatch.setattr(local_store, "_STORE_SINGLETON", None)
    local_store.get_local_store(data_dir=tmp_path / "local_store")


@pytest.fixture
def act_upload(local_store_in_tmp, monkeypatch):
    service = importlib.import_module("backend.services.act_upload_service")
    monkeypatch.setattr(service, "_ACT_DRAFTS", {})
    monkeypatch.setattr(service, "_extract_pdf_text", lambda file_bytes: ("", []))
    monkeypatch.setattr(service, "_stamp_pdf_doc_no", lambda file_bytes, doc_no: file_bytes)
    monkeypatch.setattr(service, "_resolve_rows_for_inv_nos", lambda inv_nos, db_id: _rows_for(inv_nos))
    return service


@pytest.fixture
def upload_http(local_store_in_tmp, act_upload, monkeypatch):
    from backend.api import deps
    from backend.api.v1 import equipment

    monkeypatch.setattr(equipment, "invalidate_equipment_cache", lambda *args: None)
    monkeypatch.setattr(equipment.queries, "get_equipment_by_inv", lambda *args, **kwargs: None)
    monkeypatch.setattr(equipment, "_touch_recent_card_safely", lambda **kwargs: None)
    monkeypatch.setattr(equipment, "_touch_recent_act_safely", lambda **kwargs: None)
    current = {"id": OPERATOR_ID}
    app = FastAPI()
    app.include_router(equipment.router, prefix="/api/v1/equipment")
    app.dependency_overrides[deps.get_current_active_user] = lambda: SimpleNamespace(
        id=current["id"], username=f"operator-{current['id']}", role="operator",
        permissions=["database.write"], is_active=True,
    )
    app.dependency_overrides[equipment.get_request_scoped_database_id] = lambda: "main"
    client = TestClient(app, base_url="https://testserver", raise_server_exceptions=False)
    return SimpleNamespace(client=client, equipment=equipment, current=current)


def test_parallel_commits_of_one_draft_create_a_single_act(act_upload, monkeypatch):
    barrier = threading.Barrier(2)
    created = []

    def create(**kwargs):
        created.append(kwargs)
        try:
            barrier.wait(timeout=2)
        except threading.BrokenBarrierError:
            pass
        return _created_act(100 + len(created))

    monkeypatch.setattr(act_upload.queries, "create_uploaded_transfer_act", create)
    draft = act_upload.create_uploaded_act_draft(
        file_bytes=b"%PDF-1.4", file_name="act.pdf", db_id="main", created_by="operator",
        skip_llm=True, created_by_user_id=OPERATOR_ID,
    )

    def commit():
        try:
            act_upload.commit_uploaded_act_draft(
                draft_id=draft["draft_id"], payload=dict(COMMIT_PAYLOAD), db_id="main", committed_by="operator",
            )
        except Exception:
            pass

    threads = [threading.Thread(target=commit) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=10)

    assert len(created) == 1


def test_hub_failure_after_act_is_stored_keeps_commit_successful(upload_http, act_upload, monkeypatch):
    monkeypatch.setattr(act_upload.queries, "create_uploaded_transfer_act", lambda **kwargs: _created_act(42))
    monkeypatch.setattr(
        upload_http.equipment.transfer_act_reminder_service, "complete_for_uploaded_act", _hub_unavailable,
    )
    draft = act_upload.create_uploaded_act_draft(
        file_bytes=b"%PDF-1.4", file_name="act.pdf", db_id="main", created_by="operator",
        skip_llm=True, created_by_user_id=OPERATOR_ID,
    )

    committed = upload_http.client.post(
        "/api/v1/equipment/acts/upload/commit",
        json={"draft_id": draft["draft_id"], **COMMIT_PAYLOAD},
    )

    assert committed.status_code == 200, committed.text
    assert committed.json()["doc_no"] == 42
    assert committed.json()["reminder_status"] == "error"
    assert committed.json()["reminder_warning"]


def test_other_operator_cannot_read_or_commit_someone_elses_draft(upload_http, act_upload, monkeypatch):
    created = []
    monkeypatch.setattr(
        act_upload.queries, "create_uploaded_transfer_act", lambda **kwargs: created.append(kwargs) or _created_act(42),
    )
    draft = act_upload.create_uploaded_act_draft(
        file_bytes=b"%PDF-1.4", file_name="act.pdf", db_id="main", created_by="operator",
        skip_llm=True, created_by_user_id=OPERATOR_ID,
    )
    draft_url = f"/api/v1/equipment/acts/upload/draft/{draft['draft_id']}"
    commit_body = {"draft_id": draft["draft_id"], **COMMIT_PAYLOAD}

    upload_http.current["id"] = OTHER_OPERATOR_ID
    assert upload_http.client.get(draft_url).status_code == 404
    assert upload_http.client.post("/api/v1/equipment/acts/upload/commit", json=commit_body).status_code == 404

    upload_http.current["id"] = OPERATOR_ID
    assert upload_http.client.get(draft_url).status_code == 200
    assert created == []
