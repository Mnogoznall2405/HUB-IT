from __future__ import annotations

from collections.abc import Callable

from fastapi import FastAPI, HTTPException
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
        "include_inn": False,
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


def test_search_forwards_pagination_offset(monkeypatch):
    captured: dict = {}

    def search(q, limit, **kwargs):
        captured.update({"q": q, "limit": limit, **kwargs})
        return {"items": [], "total": 25, "limit": limit, "offset": kwargs.get("offset", 0)}

    monkeypatch.setattr(address_book_api.address_book_service, "search", search)
    client = _client_for(lambda: _make_user(permissions=["address_book.read"]))

    response = client.get("/address-book/search?q=&limit=10&offset=20")

    assert response.status_code == 200
    assert captured["offset"] == 20


def test_search_enables_each_personal_field_only_with_explicit_permissions(monkeypatch):
    captured: dict = {}

    def search(*args, **kwargs):
        captured.update(kwargs)
        return {"items": [], "total": 0, "limit": 50}

    monkeypatch.setattr(address_book_api.address_book_service, "search", search)
    client = _client_for(lambda: _make_user(permissions=[
        "address_book.age.read",
        "address_book.hire_date.read",
        "address_book.inn.read",
        "address_book.personal_email.read",
        "address_book.personal_phone.read",
    ]))

    response = client.get("/address-book/search")

    assert response.status_code == 200
    assert captured == {
        "include_age": True,
        "include_hire_date": True,
        "include_inn": True,
        "include_personal_emails": True,
        "include_personal_phones": True,
    }


def test_snapshot_uses_one_permission_filtered_service_call(monkeypatch):
    captured: dict = {}

    def snapshot(**kwargs):
        captured.update(kwargs)
        return {"items": [{"full_name": "Snapshot User"}], "total": 1}

    monkeypatch.setattr(address_book_api.address_book_service, "snapshot", snapshot, raising=False)
    client = _client_for(lambda: _make_user(permissions=[
        "address_book.read",
        "address_book.hire_date.read",
        "address_book.personal_email.read",
    ]))

    response = client.get("/address-book/snapshot")

    assert response.status_code == 200
    assert response.json()["items"] == [{"full_name": "Snapshot User"}]
    assert response.headers["cache-control"] == "private, no-store"
    assert captured == {
        "include_age": False,
        "include_hire_date": True,
        "include_inn": False,
        "include_personal_emails": True,
        "include_personal_phones": False,
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


def test_dismissed_search_requires_dismissed_permission(monkeypatch):
    monkeypatch.setattr(
        address_book_api.address_book_service,
        "search",
        lambda q, limit, **kwargs: {"items": [], "total": 0, "limit": limit},
    )
    client = _client_for(lambda: _make_user(permissions=["address_book.read"]))

    response = client.get("/address-book/search?dismissed=true")

    assert response.status_code == 403


def test_dismissed_search_forwards_dismissed_flag(monkeypatch):
    captured: dict = {}

    def search(q, limit, **kwargs):
        captured.update({"q": q, "limit": limit, **kwargs})
        return {"items": [], "total": 0, "limit": limit, "dismissed": True}

    monkeypatch.setattr(address_book_api.address_book_service, "search", search)
    client = _client_for(lambda: _make_user(permissions=["address_book.dismissed.read"]))

    response = client.get("/address-book/search?dismissed=true")

    assert response.status_code == 200
    assert captured.get("dismissed") is True


def test_status_available_with_only_dismissed_permission(monkeypatch):
    monkeypatch.setattr(
        address_book_api.address_book_service,
        "get_status",
        lambda: {"count": 1, "dismissed_count": 2},
    )
    client = _client_for(lambda: _make_user(permissions=["address_book.dismissed.read"]))

    response = client.get("/address-book/status")

    assert response.status_code == 200
    assert response.json()["dismissed_count"] == 2


def test_status_exposes_raw_last_error_only_to_admin(monkeypatch):
    monkeypatch.setattr(
        address_book_api.address_book_service,
        "get_status",
        lambda: {
            "count": 1,
            "dismissed_count": 0,
            "last_error": "COM error: сервер 1С SRV-1C недоступен",
            "sync_in_progress": False,
        },
    )

    admin_response = _client_for(lambda: _make_user(role="admin", permissions=[])).get(
        "/address-book/status"
    )
    assert admin_response.status_code == 200
    assert admin_response.headers["cache-control"] == "private, no-store"
    assert admin_response.json()["last_error"] == "COM error: сервер 1С SRV-1C недоступен"
    assert admin_response.json()["last_sync_failed"] is True

    user_response = _client_for(lambda: _make_user(permissions=["address_book.read"])).get(
        "/address-book/status"
    )
    assert user_response.status_code == 200
    assert user_response.headers["cache-control"] == "private, no-store"
    assert user_response.json()["last_error"] == ""
    assert user_response.json()["last_sync_failed"] is True
    assert user_response.json()["count"] == 1


def test_status_without_last_error_reports_no_sync_failure(monkeypatch):
    monkeypatch.setattr(
        address_book_api.address_book_service,
        "get_status",
        lambda: {"count": 3, "dismissed_count": 0, "last_error": "", "sync_in_progress": False},
    )
    client = _client_for(lambda: _make_user(permissions=["address_book.read"]))

    response = client.get("/address-book/status")

    assert response.status_code == 200
    assert response.json()["last_error"] == ""
    assert response.json()["last_sync_failed"] is False


def test_search_flags_sync_failure_and_hides_raw_error_from_non_admin(monkeypatch):
    monkeypatch.setattr(
        address_book_api.address_book_service,
        "search",
        lambda q, limit, **kwargs: {
            "items": [],
            "total": 0,
            "limit": limit,
            "last_error": "raw 1C exception",
        },
    )

    admin_response = _client_for(lambda: _make_user(role="admin", permissions=[])).get(
        "/address-book/search"
    )
    assert admin_response.status_code == 200
    assert admin_response.headers["cache-control"] == "private, no-store"
    assert admin_response.json()["last_error"] == "raw 1C exception"
    assert admin_response.json()["last_sync_failed"] is True

    user_response = _client_for(lambda: _make_user(permissions=["address_book.read"])).get(
        "/address-book/search"
    )
    assert user_response.status_code == 200
    assert user_response.headers["cache-control"] == "private, no-store"
    assert user_response.json()["last_error"] == ""
    assert user_response.json()["last_sync_failed"] is True


def test_search_without_sync_failure_reports_false(monkeypatch):
    monkeypatch.setattr(
        address_book_api.address_book_service,
        "search",
        lambda q, limit, **kwargs: {"items": [], "total": 0, "limit": limit, "last_error": ""},
    )
    client = _client_for(lambda: _make_user(permissions=["address_book.read"]))

    response = client.get("/address-book/search")

    assert response.status_code == 200
    assert response.json()["last_error"] == ""
    assert response.json()["last_sync_failed"] is False


def test_snapshot_flags_sync_failure_and_hides_raw_error_from_non_admin(monkeypatch):
    monkeypatch.setattr(
        address_book_api.address_book_service,
        "snapshot",
        lambda **kwargs: {
            "items": [{"full_name": "Snapshot User"}],
            "total": 1,
            "last_error": "raw snapshot error",
        },
        raising=False,
    )

    admin_response = _client_for(lambda: _make_user(role="admin", permissions=[])).get(
        "/address-book/snapshot"
    )
    assert admin_response.status_code == 200
    assert admin_response.headers["cache-control"] == "private, no-store"
    assert admin_response.json()["last_error"] == "raw snapshot error"
    assert admin_response.json()["last_sync_failed"] is True
    assert admin_response.json()["items"] == [{"full_name": "Snapshot User"}]

    user_response = _client_for(lambda: _make_user(permissions=["address_book.read"])).get(
        "/address-book/snapshot"
    )
    assert user_response.status_code == 200
    assert user_response.headers["cache-control"] == "private, no-store"
    assert user_response.json()["last_error"] == ""
    assert user_response.json()["last_sync_failed"] is True


def test_snapshot_without_sync_failure_reports_false(monkeypatch):
    monkeypatch.setattr(
        address_book_api.address_book_service,
        "snapshot",
        lambda **kwargs: {"items": [], "total": 0, "last_error": ""},
        raising=False,
    )
    client = _client_for(lambda: _make_user(permissions=["address_book.read"]))

    response = client.get("/address-book/snapshot")

    assert response.status_code == 200
    assert response.json()["last_error"] == ""
    assert response.json()["last_sync_failed"] is False


def test_search_forwards_department_and_city_filters(monkeypatch):
    captured: dict = {}

    def search(q, limit, **kwargs):
        captured.update(kwargs)
        return {"items": [], "total": 0, "limit": limit, "last_error": ""}

    monkeypatch.setattr(address_book_api.address_book_service, "search", search)
    client = _client_for(lambda: _make_user(permissions=["address_book.read"]))

    response = client.get(
        "/address-book/search?department=%D0%98%D0%A2%20%D0%BE%D1%82%D0%B4%D0%B5%D0%BB&city=%D0%A2%D1%8E%D0%BC%D0%B5%D0%BD%D1%8C"
    )

    assert response.status_code == 200
    assert captured["department"] == "ИТ отдел"
    assert captured["city"] == "Тюмень"


def test_search_omits_filter_kwargs_when_absent(monkeypatch):
    captured: dict = {}

    def search(*args, **kwargs):
        captured.update(kwargs)
        return {"items": [], "total": 0, "limit": 50}

    monkeypatch.setattr(address_book_api.address_book_service, "search", search)
    client = _client_for(lambda: _make_user(permissions=["address_book.read"]))

    response = client.get("/address-book/search?q=x&department=&city=%20%20")

    assert response.status_code == 200
    assert captured == {
        "include_age": False,
        "include_hire_date": False,
        "include_inn": False,
        "include_personal_emails": False,
        "include_personal_phones": False,
    }


def test_search_forwards_employee_codes(monkeypatch):
    captured: dict = {}

    def search(q, limit, **kwargs):
        captured.update(kwargs)
        return {"items": [], "total": 0, "limit": limit}

    monkeypatch.setattr(address_book_api.address_book_service, "search", search)
    client = _client_for(lambda: _make_user(permissions=["address_book.read"]))

    response = client.get("/address-book/search?employee_codes=E1&employee_codes=E2")

    assert response.status_code == 200
    assert captured["employee_codes"] == ["E1", "E2"]


def test_search_rejects_more_than_50_employee_codes(monkeypatch):
    called = False

    def search(*args, **kwargs):
        nonlocal called
        called = True
        return {"items": []}

    monkeypatch.setattr(address_book_api.address_book_service, "search", search)
    client = _client_for(lambda: _make_user(permissions=["address_book.read"]))

    query = "&".join(f"employee_codes=E{index}" for index in range(51))
    response = client.get(f"/address-book/search?{query}")

    assert response.status_code == 422
    assert called is False


def test_filters_endpoint_returns_shape_and_no_store_headers(monkeypatch):
    captured: dict = {}

    def list_filters(*, dismissed=False):
        captured["dismissed"] = dismissed
        return {
            "departments": [{"name": "ИТ отдел", "count": 3}],
            "cities": [{"name": "Тюмень", "count": 5}],
            "dismissed": dismissed,
            "updated_at": "2026-10-01T00:00:00Z",
            "last_error": "",
        }

    monkeypatch.setattr(
        address_book_api.address_book_service, "list_filters", list_filters, raising=False
    )
    client = _client_for(lambda: _make_user(permissions=["address_book.read"]))

    response = client.get("/address-book/filters")

    assert response.status_code == 200
    assert response.headers["cache-control"] == "private, no-store"
    body = response.json()
    assert body["departments"] == [{"name": "ИТ отдел", "count": 3}]
    assert body["cities"] == [{"name": "Тюмень", "count": 5}]
    assert captured["dismissed"] is False


def test_filters_is_gated_by_address_book_read_permission(monkeypatch):
    """address_book.read is always-granted; the test pins the gate wiring itself."""
    checked: list[str] = []

    def ensure(user, permission):
        checked.append(permission)
        if permission == "address_book.read":
            raise HTTPException(status_code=403, detail="denied")

    monkeypatch.setattr(address_book_api, "ensure_user_permission", ensure)
    monkeypatch.setattr(
        address_book_api.address_book_service,
        "list_filters",
        lambda *, dismissed=False: {"departments": [], "cities": []},
        raising=False,
    )
    client = _client_for(lambda: _make_user(permissions=["address_book.read"]))

    response = client.get("/address-book/filters")

    assert response.status_code == 403
    assert checked == ["address_book.read"]


def test_filters_dismissed_requires_dismissed_permission(monkeypatch):
    captured: dict = {}

    def list_filters(*, dismissed=False):
        captured["dismissed"] = dismissed
        return {"departments": [], "cities": [], "dismissed": dismissed, "last_error": ""}

    monkeypatch.setattr(
        address_book_api.address_book_service, "list_filters", list_filters, raising=False
    )

    forbidden = _client_for(lambda: _make_user(permissions=["address_book.read"])).get(
        "/address-book/filters?dismissed=true"
    )
    assert forbidden.status_code == 403

    allowed = _client_for(lambda: _make_user(permissions=["address_book.dismissed.read"])).get(
        "/address-book/filters?dismissed=true"
    )
    assert allowed.status_code == 200
    assert allowed.headers["cache-control"] == "private, no-store"
    assert captured["dismissed"] is True


def test_filters_hides_raw_last_error_from_non_admin(monkeypatch):
    monkeypatch.setattr(
        address_book_api.address_book_service,
        "list_filters",
        lambda *, dismissed=False: {
            "departments": [],
            "cities": [],
            "last_error": "COM error: сервер 1С недоступен",
        },
        raising=False,
    )
    client = _client_for(lambda: _make_user(permissions=["address_book.read"]))

    response = client.get("/address-book/filters")

    assert response.status_code == 200
    assert response.json()["last_error"] == ""
    assert response.json()["last_sync_failed"] is True


class _MemoryManager:
    def __init__(self, payload):
        self.payload = payload or {}

    def load_json(self, filename, default_content=None):
        return self.payload or default_content

    def save_json(self, filename, data):
        self.payload = data
        return True


def test_snapshot_endpoint_is_read_only_over_shared_cache(monkeypatch):
    """R2: snapshot rows share nested structures with the parsed cache by design
    (deep detach measured too costly on 51k records). The API layer must
    therefore be read-only — verify that serving the endpoint twice yields
    identical payloads and leaves the cache pristine."""
    from backend.services.address_book_service import AddressBookService

    service = AddressBookService(
        data_manager=_MemoryManager(
            {
                "items": [
                    {
                        "full_name": "Иванов Иван",
                        "employee_code": "E1",
                        "work_phones": [{"kind": "Рабочий", "value": "+7 900 111-22-33"}],
                        "work_emails": [{"kind": "E-mail", "value": "ivanov@example.com"}],
                        "personal_phones": [],
                        "personal_emails": [],
                    }
                ],
                "dismissed_items": [],
                "updated_at": "2026-09-30T10:00:00+00:00",
            }
        )
    )
    monkeypatch.setattr(address_book_api, "address_book_service", service)
    client = _client_for(lambda: _make_user(permissions=[]))

    first = client.get("/address-book/snapshot")
    second = client.get("/address-book/snapshot")

    assert first.status_code == 200
    assert first.json() == second.json()
    assert service.search("иванов")["items"][0]["work_phones"] == [
        {"kind": "Рабочий", "value": "+7 900 111-22-33"}
    ]
