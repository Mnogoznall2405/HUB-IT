from __future__ import annotations

from collections.abc import Callable

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api import deps
from backend.api.v1 import address_book as address_book_api
from backend.models.auth import User


def _make_user(*, role: str = "viewer", permissions: list[str] | None = None) -> User:
    return User(
        id=7,
        username="address-user",
        full_name="Address User",
        role=role,
        permissions=permissions or [],
        use_custom_permissions=True,
        custom_permissions=permissions or [],
        is_active=True,
    )


def _client_for(user_factory: Callable[[], User]) -> TestClient:
    app = FastAPI()
    app.include_router(address_book_api.router, prefix="/address-book")
    app.dependency_overrides[deps.get_current_active_user] = user_factory
    return TestClient(app)


def test_search_is_available_to_user_without_custom_permissions(monkeypatch):
    captured: dict = {}

    def search(*args, **kwargs):
        captured.update(kwargs)
        return {"items": [], "total": 0, "limit": 50}

    monkeypatch.setattr(address_book_api.address_book_service, "search", search)
    client = _client_for(lambda: _make_user(permissions=[]))

    response = client.get("/address-book/search?q=ivanov")

    assert response.status_code == 200
    assert captured == {
        "include_age": False,
        "include_hire_date": False,
        "include_personal_emails": False,
        "include_personal_phones": False,
    }


def test_search_returns_items_for_user_with_permission(monkeypatch):
    monkeypatch.setattr(
        address_book_api.address_book_service,
        "search",
        lambda q, limit, **kwargs: {
            "items": [{"full_name": "Иванов Иван", "work_phones": [], "personal_phones": []}],
            "total": 1,
            "limit": limit,
            "updated_at": "now",
            "last_error": "",
        },
    )
    client = _client_for(lambda: _make_user(permissions=["address_book.read"]))

    response = client.get("/address-book/search?q=ivanov&limit=10")

    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert response.json()["items"][0]["full_name"] == "Иванов Иван"


def test_search_enables_each_personal_field_only_with_explicit_permissions(monkeypatch):
    captured: dict = {}

    def search(*args, **kwargs):
        captured.update(kwargs)
        return {"items": [], "total": 0, "limit": 50}

    monkeypatch.setattr(address_book_api.address_book_service, "search", search)
    client = _client_for(lambda: _make_user(permissions=[
        "address_book.age.read",
        "address_book.hire_date.read",
        "address_book.personal_email.read",
        "address_book.personal_phone.read",
    ]))

    response = client.get("/address-book/search")

    assert response.status_code == 200
    assert captured == {
        "include_age": True,
        "include_hire_date": True,
        "include_personal_emails": True,
        "include_personal_phones": True,
    }


def test_sync_is_admin_only(monkeypatch):
    called = False

    def sync_from_1c():
        nonlocal called
        called = True
        return {"count": 1}

    monkeypatch.setattr(address_book_api.address_book_service, "sync_from_1c", sync_from_1c)
    client = _client_for(lambda: _make_user(role="operator", permissions=["address_book.read"]))

    response = client.post("/address-book/sync")

    assert response.status_code == 403
    assert called is False


def test_admin_can_trigger_sync(monkeypatch):
    monkeypatch.setattr(
        address_book_api.address_book_service,
        "sync_from_1c",
        lambda: {"count": 2, "updated_at": "now"},
    )
    client = _client_for(lambda: _make_user(role="admin", permissions=[]))

    response = client.post("/address-book/sync")

    assert response.status_code == 200
    assert response.json()["count"] == 2
