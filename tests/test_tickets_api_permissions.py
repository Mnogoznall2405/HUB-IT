from __future__ import annotations

from collections.abc import Callable

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api import deps
from backend.api.v1 import tickets as tickets_api
from backend.models.auth import User


def _make_user(*, role: str = "viewer", permissions: list[str] | None = None) -> User:
    return User(
        id=42,
        username="ticket-user",
        full_name="Ticket User",
        role=role,
        permissions=permissions or [],
        use_custom_permissions=True,
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
