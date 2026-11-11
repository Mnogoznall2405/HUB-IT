"""HTTP behaviour of the personal absence source, isolated from live DB/1C."""
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from backend.api import deps
from backend.api.v1 import docflow as api
from backend.main import app
from backend.models.auth import User
from backend.services import docflow_absence_service as module


@pytest.fixture
def source_client(monkeypatch):
    monkeypatch.setenv("DOCFLOW_ABSENCES_ENABLED", "1")
    class ScenarioDate(date):
        @classmethod
        def today(cls):
            return cls(2026, 10, 29)

    monkeypatch.setattr(module, "date", ScenarioDate)
    store = SimpleNamespace(rows={
        1: SimpleNamespace(login="personal-one", password_enc="sealed-one"),
        2: SimpleNamespace(login="personal-two", password_enc="sealed-two"),
    })
    store.get = lambda uid: store.rows.get(uid)
    person = {
        "employee_code": "zup-7", "full_name": "Одинаковое Имя",
        "work_emails": [{"value": "worker@example.test"}],
        "absence": {"kind": "vacation", "starts_on": "2026-10-26", "returns_on": "2026-10-31"},
    }
    cache = {"items": [person], "updated_at": datetime.now(timezone.utc).isoformat(), "last_error": ""}
    calls = []
    bridge = SimpleNamespace()

    def read(operation, payload, **kwargs):
        calls.append(dict(payload))
        if payload["login"] == "personal-two":
            return {"rows": [], "email_owners": {}}
        return {
            "rows": [
                {"ref": "absence-1", "employee_ref": "do-7", "display_name": "Одинаковое Имя",
                 "starts_on": "2026-10-26", "ends_on": "2026-11-04", "label": "Отпуск",
                 "comment": "Связь через мессенджер", "available": True, "email": "worker@example.test"},
                {"ref": "absence-2", "employee_ref": "do-8", "display_name": "Одинаковое Имя",
                 "starts_on": "2026-10-26", "ends_on": "2026-10-30", "label": "Больничный",
                 "comment": "", "available": False, "email": ""},
            ],
            "email_owners": {"worker@example.test": ["do-7"]},
        }

    bridge.call = read
    service = module.DocflowAbsenceService(store=store, source=SimpleNamespace(load_cache=lambda: cache), bridge=bridge)
    monkeypatch.setattr(module, "docflow_absence_service", service)
    monkeypatch.setattr(module, "decrypt_docflow_secret", lambda value: "test-only-password")
    user = User(id=1, username="personal", role="viewer", is_active=True,
                permissions=["docflow.read", "address_book.read"], use_custom_permissions=True,
                custom_permissions=["docflow.read", "address_book.read"])
    monkeypatch.setattr(api, "date", ScenarioDate)
    monkeypatch.setattr(app, "dependency_overrides", {deps.get_current_active_user: lambda: user})
    # Real route table and middleware; no lifespan/background integrations.
    return TestClient(app, base_url="https://testserver/api/v1"), user, cache, store, calls


def test_personal_absences_keep_inclusive_end_comment_and_source_without_name_matching(source_client):
    client, _, _, _, _ = source_client
    response = client.get("/docflow/absences?on=2026-10-29")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    data = response.json()
    assert data["count"] == 2
    assert data["unresolved_count"] == 1
    linked, unresolved = data["items"]
    assert linked["employee_code"] == "zup-7"
    assert linked["ends_on"] == "2026-11-04"
    assert linked["comment"] == "Связь через мессенджер"
    assert linked["will_handle_tasks"] is True
    assert linked["source"] == "docflow"
    assert linked["differences"] == ["ends_on"]
    assert unresolved["employee_code"] is None
    assert "test-only-password" not in response.text
    assert "worker@example.test" not in response.text
    assert "sealed-one" not in response.text


def test_employee_filter_rejects_ambiguous_email_and_never_falls_back_to_name(source_client):
    client, _, cache, _, _ = source_client
    cache["items"].append({**cache["items"][0], "employee_code": "zup-8"})
    response = client.get("/docflow/absences?employee_code=zup-7&on=2026-10-29")
    assert response.status_code == 200
    assert response.json()["items"] == []
    assert response.json()["unresolved_count"] == 2


def test_cached_absences_are_personal_and_removed_credentials_prevent_cached_reads(source_client):
    client, user, _, store, calls = source_client
    assert client.get("/docflow/absences").json()["count"] == 2
    user.id = 2
    assert client.get("/docflow/absences").json()["count"] == 0
    user.id = 1
    assert client.get("/docflow/absences").json()["count"] == 2
    assert len(calls) == 2
    del store.rows[1]
    response = client.get("/docflow/absences")
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "DOCFLOW_CREDENTIALS_REQUIRED"


def test_absences_fail_closed_and_can_retry_without_reusing_old_data(source_client, monkeypatch):
    client, _, _, _, calls = source_client
    service = module.docflow_absence_service

    def fail(*args, **kwargs):
        raise RuntimeError("internal connection information")

    original = service._bridge.call
    service._bridge.call = fail
    response = client.get("/docflow/absences")
    assert response.status_code == 503
    assert "internal connection information" not in response.text
    service._bridge.call = original
    assert client.get("/docflow/absences").json()["count"] == 2
    assert len(calls) == 1
    monkeypatch.setenv("DOCFLOW_ABSENCES_ENABLED", "0")
    data = client.get("/docflow/absences").json()
    assert data["status"] == "disabled"
    assert data["count"] is None
    assert len(calls) == 1


def test_concurrent_identical_absence_reads_share_one_slow_1c_call(source_client):
    import threading
    import time

    _, _, _, _, calls = source_client
    service = module.docflow_absence_service
    release = threading.Event()
    original = service._bridge.call

    def slow(*args, **kwargs):
        release.wait(timeout=5)
        return original(*args, **kwargs)

    service._bridge.call = slow
    results, errors = [], []

    def read():
        try:
            results.append(service.list_absences(user_id=1, on=date(2026, 10, 29)))
        except Exception as exc:
            errors.append(exc)

    threads = [threading.Thread(target=read) for _ in range(5)]
    for thread in threads:
        thread.start()
    time.sleep(0.3)
    release.set()
    for thread in threads:
        thread.join(timeout=10)
    assert not errors
    assert [item["count"] for item in results] == [2] * 5
    assert len(calls) == 1


def test_absences_require_authentication_and_validate_dates(source_client):
    client, user, _, _, calls = source_client
    assert client.get("/docflow/absences?on=not-a-date").status_code == 422
    client.app.dependency_overrides.clear()
    assert client.get("/docflow/absences").status_code == 401
    assert calls == []


def test_absences_do_not_read_source_when_permission_is_denied(source_client, monkeypatch):
    client, user, _, _, calls = source_client
    user.permissions = []
    monkeypatch.setattr(deps.authorization_service, "has_permission", lambda *args, **kwargs: False)
    assert client.get("/docflow/absences").status_code == 403
    assert calls == []


def test_zup_error_does_not_turn_into_a_confirmed_discrepancy(source_client):
    client, _, cache, _, _ = source_client
    cache["last_error"] = "sync failed"
    data = client.get("/docflow/absences").json()
    assert data["zup_comparison"] == "unavailable"
    assert data["items"][0]["employee_code"] == "zup-7"
    assert data["items"][0]["differences"] == []


def test_noncurrent_day_cannot_be_compared_with_current_zup_state(source_client):
    client, _, _, _, _ = source_client
    selected = (api.date.today() + timedelta(days=1)).isoformat()
    data = client.get(f"/docflow/absences?on={selected}").json()
    assert data["status"] == "available"
    assert data["zup_comparison"] == "unavailable"
    assert all(not item["differences"] for item in data["items"])


def test_email_shared_by_two_docflow_accounts_does_not_link_an_employee(source_client):
    client, _, _, _, _ = source_client
    bridge = module.docflow_absence_service._bridge
    original = bridge.call

    def duplicate_owner(*args, **kwargs):
        raw = original(*args, **kwargs)
        raw["email_owners"]["worker@example.test"].append("another-do-user")
        return raw

    bridge.call = duplicate_owner
    data = client.get("/docflow/absences?employee_code=zup-7").json()
    assert data["items"] == []
    assert data["unresolved_count"] == 2


def test_replaced_credentials_do_not_reuse_a_previous_personal_read(source_client):
    client, _, _, store, calls = source_client
    assert client.get("/docflow/absences").status_code == 200
    store.rows[1].password_enc = "sealed-replacement"
    assert client.get("/docflow/absences").status_code == 200
    assert len(calls) == 2


@pytest.mark.parametrize("collision", [None, "zup", "docflow", "missing_catalog", "ambiguous_email"])
def test_surname_fallback_links_only_unique_catalog_identity(source_client, collision):
    client, _, cache, _, _ = source_client
    cache["items"][0]["full_name"] = "Берёзкина Мария Ивановна"
    if collision == "zup":
        cache["items"].append({**cache["items"][0], "employee_code": "zup-other"})
    row = {
        "ref": "surname-absence", "employee_ref": "do-surname",
        "display_name": "  БЕРЕЗКИНА   Анна Петровна  ",
        "starts_on": "2026-10-26", "ends_on": "2026-10-30", "label": "Отпуск",
        "comment": "", "available": False, "email": "",
    }
    raw = {"rows": [row], "email_owners": {}, "surname_owners": {"березкина": ["do-surname"]}}
    if collision == "docflow":
        # The other namesake has no absence: uniqueness must include the catalog.
        raw["surname_owners"]["березкина"].append("do-not-absent")
    elif collision == "missing_catalog":
        del raw["surname_owners"]
    elif collision == "ambiguous_email":
        row["email"] = "worker@example.test"
        raw["email_owners"]["worker@example.test"] = ["do-surname", "do-other"]
    module.docflow_absence_service._bridge.call = lambda *args, **kwargs: raw
    response = client.get("/docflow/absences?employee_code=zup-7&on=2026-10-29")
    assert response.status_code == 200
    data = response.json()
    if collision is None:
        assert data["count"] == 1
        assert data["items"][0]["id"] == "docflow:surname-absence"
        assert data["items"][0]["employee_code"] == "zup-7"
        assert data["unresolved_count"] == 0
    else:
        assert data["items"] == []
        assert data["unresolved_count"] == 1


def test_unique_email_keeps_priority_over_surname(source_client):
    client, _, cache, _, _ = source_client
    cache["items"][0]["full_name"] = "Петров Иван Иванович"
    cache["items"].append({"employee_code": "zup-namesake", "full_name": "Иванов Иван Иванович", "work_emails": []})
    raw = {
        "rows": [{"ref": "priority", "employee_ref": "do-priority", "display_name": "Иванов Иван Иванович",
                  "email": "worker@example.test", "starts_on": "2026-10-26", "ends_on": "2026-10-30", "label": "Отпуск"}],
        "email_owners": {"worker@example.test": ["do-priority"]},
        "surname_owners": {"иванов": ["do-priority"]},
    }
    module.docflow_absence_service._bridge.call = lambda *args, **kwargs: raw
    data = client.get("/docflow/absences?employee_code=zup-7&on=2026-10-29").json()
    assert [item["id"] for item in data["items"]] == ["docflow:priority"]
    assert client.get("/docflow/absences?employee_code=zup-namesake&on=2026-10-29").json()["items"] == []
