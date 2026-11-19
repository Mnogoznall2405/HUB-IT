"""Отправка актов по email: письмо не уходит пользователю, который акт не создавал."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

ACT_ID = "925505bd-01c8-51e5-8b6e-f6a62b490a55"
OWNER_ID = 42
OTHER_USER_ID = 15


@pytest.fixture
def local_store_in_tmp(monkeypatch, tmp_path):
    import local_store

    monkeypatch.setattr(local_store, "_STORE_SINGLETON", None)
    local_store.get_local_store(data_dir=tmp_path / "local_store")


@pytest.fixture
def email_http(local_store_in_tmp, monkeypatch, tmp_path):
    from backend.api import deps
    from backend.api.v1 import equipment
    from backend.services import transfer_service

    acts_dir = tmp_path / "acts"
    acts_dir.mkdir()
    pdf = acts_dir / f"transfer_act_{ACT_ID}_Старый_сотрудник.pdf"
    pdf.write_bytes(b"%PDF-1.4")
    monkeypatch.setattr(transfer_service, "DEFAULT_ACTS_DIR", acts_dir)
    monkeypatch.setattr(transfer_service, "_ACT_STORE", {})
    transfer_service.register_act_records([
        {
            "act_id": ACT_ID,
            "file_path": str(pdf),
            "file_name": pdf.name,
            "file_type": "pdf",
            "old_employee_name": "Старый сотрудник",
            "old_employee_email": "old@example.test",
            "new_employee_name": "Новый сотрудник",
            "new_employee_email": "new@example.test",
            "equipment_count": 1,
            "created_by_user_id": OWNER_ID,
        }
    ])
    sent = []

    def send(*, recipient_email, files, subject, body):
        sent.append(recipient_email)
        return True

    monkeypatch.setattr(transfer_service, "_send_outgoing_files", send)
    current = {"id": OTHER_USER_ID}
    app = FastAPI()
    app.include_router(equipment.router, prefix="/api/v1/equipment")
    app.dependency_overrides[deps.get_current_active_user] = lambda: SimpleNamespace(
        id=current["id"], username="user", role="operator", permissions=["database.write"], is_active=True,
    )
    app.dependency_overrides[equipment.get_request_scoped_database_id] = lambda: "main"
    client = TestClient(app, base_url="https://testserver", raise_server_exceptions=False)
    return SimpleNamespace(client=client, sent=sent, current=current)


def _send_as(email_http, user_id):
    email_http.current["id"] = user_id
    return email_http.client.post(
        "/api/v1/equipment/transfer/email",
        json={"act_ids": [ACT_ID], "mode": "new"},
    )


def test_owner_gets_own_act_by_email(email_http):
    _send_as(email_http, OWNER_ID)

    assert email_http.sent == ["new@example.test"]


def test_other_user_cannot_send_someone_elses_act(email_http):
    response = _send_as(email_http, OTHER_USER_ID)

    assert response.status_code == 404
    assert email_http.sent == []
