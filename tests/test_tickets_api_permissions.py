from __future__ import annotations

from collections.abc import Callable

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api import deps
from backend.api.v1 import tickets as tickets_api
from backend.models.auth import User


def _make_user(
    *,
    role: str = "viewer",
    permissions: list[str] | None = None,
    use_custom_permissions: bool = True,
) -> User:
    return User(
        id=42,
        username="ticket-user",
        full_name="Ticket User",
        role=role,
        permissions=permissions or [],
        use_custom_permissions=use_custom_permissions,
        custom_permissions=permissions or [],
        is_active=True,
    )


def _client_for(user_factory: Callable[[], User]) -> TestClient:
    app = FastAPI()
    app.include_router(tickets_api.router, prefix="/tickets")
    app.dependency_overrides[deps.get_current_active_user] = user_factory
    return TestClient(app)


def test_read_endpoint_requires_tickets_read_permission(monkeypatch):
    called = False

    def _list_requests(*args, **kwargs):
        nonlocal called
        called = True
        raise AssertionError("service should not be called without permission")

    monkeypatch.setattr(tickets_api.tickets_service, "list_requests", _list_requests)
    client = _client_for(lambda: _make_user(permissions=[]))

    response = client.get("/tickets/requests")

    assert response.status_code == 403
    assert called is False


def test_write_endpoint_requires_tickets_write_permission(monkeypatch):
    called = False

    def _create_request(*args, **kwargs):
        nonlocal called
        called = True
        raise AssertionError("service should not be called without write permission")

    monkeypatch.setattr(tickets_api.tickets_service, "create_request", _create_request)
    client = _client_for(lambda: _make_user(permissions=["tickets.read"]))

    response = client.post("/tickets/requests", json={"employee_id": 1, "object_id": 1})

    assert response.status_code == 403
    assert called is False


def test_admin_only_notification_rule_update_rejects_operator(monkeypatch):
    called = False

    def _update_rule(*args, **kwargs):
        nonlocal called
        called = True
        raise AssertionError("service should not be called for non-admin")

    monkeypatch.setattr(tickets_api.tickets_notification_service, "update_rule", _update_rule)
    client = _client_for(
        lambda: _make_user(
            role="operator",
            permissions=["tickets.read", "tickets.write", "tickets.personal_data.read"],
        )
    )

    response = client.patch("/tickets/notifications/rules/1", json={"threshold_days": 2})

    assert response.status_code == 403
    assert called is False


def test_zup_search_requires_tickets_read_permission(monkeypatch):
    called = False

    def _search_zup(*args, **kwargs):
        nonlocal called
        called = True
        raise AssertionError("service should not be called without permission")

    monkeypatch.setattr(tickets_api.tickets_service, "search_zup_employees", _search_zup)
    client = _client_for(lambda: _make_user(permissions=[]))

    response = client.get("/tickets/employees/zup-search", params={"q": "иванов"})

    assert response.status_code == 403
    assert called is False


def test_zup_search_allows_tickets_read(monkeypatch):
    captured = {}

    def _search(*, query="", limit=20, user_permissions=None, **kwargs):
        captured["permissions"] = list(user_permissions or [])
        captured.update(kwargs)
        return {
            "items": [{"full_name": "Иванов", "employee_code": "1"}],
            "total": 1,
            "source": "zup",
            "synced_at": None,
            "include_personal": "tickets.personal_data.read" in (user_permissions or []),
        }

    monkeypatch.setattr(tickets_api.tickets_service, "search_zup_employees", _search)
    client = _client_for(
        lambda: _make_user(permissions=["tickets.read", "tickets.personal_data.read"])
    )

    response = client.get("/tickets/employees/zup-search", params={"q": "иванов", "limit": 10})

    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert response.json()["items"][0]["full_name"] == "Иванов"
    assert captured["permissions"] == ["tickets.read", "tickets.personal_data.read"]
    assert response.json()["include_personal"] is True
    assert captured["include_personal_phones"] is False
    assert captured["include_personal_emails"] is False


def test_zup_search_hides_personal_contacts_without_address_book_rights(monkeypatch):
    captured = {}

    def _search(*, query="", limit=20, user_permissions=None, **kwargs):
        captured.update(kwargs)
        return {"items": [], "total": 0, "source": "zup", "synced_at": None}

    monkeypatch.setattr(tickets_api.tickets_service, "search_zup_employees", _search)
    client = _client_for(lambda: _make_user(permissions=["tickets.read", "tickets.write"]))

    response = client.get("/tickets/employees/zup-search", params={"q": "иванов"})

    assert response.status_code == 200
    assert captured["include_personal_phones"] is False
    assert captured["include_personal_emails"] is False


def test_zup_search_passes_address_book_personal_contact_rights(monkeypatch):
    captured = {}

    def _search(*, query="", limit=20, user_permissions=None, **kwargs):
        captured.update(kwargs)
        return {"items": [], "total": 0, "source": "zup", "synced_at": None}

    monkeypatch.setattr(tickets_api.tickets_service, "search_zup_employees", _search)
    client = _client_for(
        lambda: _make_user(
            permissions=[
                "tickets.read",
                "address_book.personal_phone.read",
                "address_book.personal_email.read",
            ]
        )
    )

    response = client.get("/tickets/employees/zup-search", params={"q": "иванов"})

    assert response.status_code == 200
    assert captured["include_personal_phones"] is True
    assert captured["include_personal_emails"] is True


def test_admin_zup_search_receives_personal_contact_flags(monkeypatch):
    captured = {}

    def _search(*, query="", limit=20, user_permissions=None, **kwargs):
        captured.update(kwargs)
        return {"items": [], "total": 0, "source": "zup", "synced_at": None}

    monkeypatch.setattr(tickets_api.tickets_service, "search_zup_employees", _search)
    client = _client_for(
        lambda: _make_user(role="admin", use_custom_permissions=False)
    )

    response = client.get("/tickets/employees/zup-search", params={"q": "иванов"})

    assert response.status_code == 200
    assert captured["include_personal_phones"] is True
    assert captured["include_personal_emails"] is True


def test_employee_from_zup_forwards_personal_contact_flags(monkeypatch):
    captured = {}

    def _ensure(employee_code, user_permissions=None, **kwargs):
        captured.update({"employee_code": employee_code, **kwargs})
        return {"id": 1, "full_name": "Сидоров Сидор"}

    monkeypatch.setattr(tickets_api.tickets_service, "ensure_employee_from_zup", _ensure)

    client = _client_for(lambda: _make_user(permissions=["tickets.write"]))
    response = client.post("/tickets/employees/from-zup", json={"employee_code": "42"})
    assert response.status_code == 200
    assert captured["employee_code"] == "42"
    assert captured["include_personal_phones"] is False
    assert captured["include_personal_emails"] is False

    client = _client_for(
        lambda: _make_user(
            permissions=[
                "tickets.write",
                "address_book.personal_phone.read",
                "address_book.personal_email.read",
            ]
        )
    )
    response = client.post("/tickets/employees/from-zup", json={"employee_code": "42"})
    assert response.status_code == 200
    assert captured["include_personal_phones"] is True
    assert captured["include_personal_emails"] is True


def test_admin_employee_from_zup_receives_personal_contact_flags(monkeypatch):
    captured = {}

    def _ensure(employee_code, user_permissions=None, **kwargs):
        captured.update({"employee_code": employee_code, **kwargs})
        return {"id": 1, "full_name": "Сидоров Сидор"}

    monkeypatch.setattr(tickets_api.tickets_service, "ensure_employee_from_zup", _ensure)
    client = _client_for(
        lambda: _make_user(role="admin", use_custom_permissions=False)
    )

    response = client.post("/tickets/employees/from-zup", json={"employee_code": "42"})

    assert response.status_code == 200
    assert captured["employee_code"] == "42"
    assert captured["include_personal_phones"] is True
    assert captured["include_personal_emails"] is True


def test_admin_can_reach_notification_rule_update(monkeypatch):
    monkeypatch.setattr(
        tickets_api.tickets_notification_service,
        "update_rule",
        lambda rule_id, data: {
            "id": rule_id,
            "rule_type": "departure_soon",
            "is_enabled": True,
            "threshold_days": data["threshold_days"],
            "notify_roles": "operator",
        },
    )
    client = _client_for(lambda: _make_user(role="admin", permissions=[]))

    response = client.patch("/tickets/notifications/rules/1", json={"threshold_days": 2})

    assert response.status_code == 200
    assert response.json()["threshold_days"] == 2
