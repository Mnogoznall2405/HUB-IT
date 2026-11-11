from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
import importlib

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.api import deps
from backend.api.v1 import hub
from backend.models.auth import User

hub_service_module = importlib.import_module("backend.services.hub_service")
zup_profile_module = importlib.import_module("backend.services.zup_user_profile_service")
address_book_module = importlib.import_module("backend.services.address_book_service")


DASHBOARD_READ = "dashboard.read"
ANNOUNCEMENTS_WRITE = "announcements.write"

FAKE_BOOK_ITEMS = [
    {"department": "Отдел логистики", "department_code": "D100", "department_location": "Москва"},
    {"department": "Отдел логистики", "department_code": "D100", "department_location": "Казань"},
    {"department": "Отдел продаж", "department_code": "D200", "department_location": "Москва"},
]

GEO_PROFILES = {
    2: {"department": "Отдел логистики", "city": "Москва"},
    3: {"department": "Отдел логистики", "city": "Казань"},
    4: {"department": "Отдел продаж", "city": "Москва"},
}


def _raw_user(
    user_id: int,
    username: str,
    full_name: str,
    role: str,
    permissions: list[str],
) -> dict:
    return {
        "id": user_id,
        "username": username,
        "email": None,
        "full_name": full_name,
        "is_active": True,
        "role": role,
        "permissions": permissions,
        "use_custom_permissions": True,
        "custom_permissions": permissions,
        "auth_source": "local",
        "telegram_id": None,
        "assigned_database": None,
        "mailbox_email": None,
        "mailbox_login": None,
        "mail_profile_mode": "manual",
        "mail_signature_html": None,
        "mail_is_configured": False,
        "created_at": None,
        "updated_at": None,
        "mail_updated_at": None,
    }


def _public_user(raw: dict) -> User:
    permissions = list(raw.get("custom_permissions") or raw.get("permissions") or [])
    return User(
        id=int(raw["id"]),
        username=str(raw["username"]),
        email=None,
        full_name=str(raw["full_name"]),
        role=str(raw["role"]),
        is_active=True,
        permissions=permissions,
        use_custom_permissions=True,
        custom_permissions=permissions,
        auth_source="local",
        telegram_id=None,
        assigned_database=None,
        mailbox_email=None,
        mailbox_login=None,
        mail_profile_mode="manual",
        mail_signature_html=None,
        mail_is_configured=False,
        created_at=None,
        updated_at=None,
        mail_updated_at=None,
    )


@pytest.fixture
def geo_announcement_env(temp_dir, monkeypatch):
    raw_users = {
        1: _raw_user(1, "geo_author", "Geo Author", "operator", [DASHBOARD_READ, ANNOUNCEMENTS_WRITE]),
        2: _raw_user(2, "msk_logistics", "Москва Логистика", "operator", [DASHBOARD_READ]),
        3: _raw_user(3, "kzn_logistics", "Казань Логистика", "operator", [DASHBOARD_READ]),
        4: _raw_user(4, "msk_sales", "Москва Продажи", "operator", [DASHBOARD_READ]),
        5: _raw_user(5, "no_profile", "Без Профиля", "operator", [DASHBOARD_READ]),
        6: _raw_user(6, "geo_admin", "Geo Admin", "admin", [DASHBOARD_READ, ANNOUNCEMENTS_WRITE]),
    }
    users_by_id = dict(raw_users)
    store = SimpleNamespace(
        db_path=str(Path(temp_dir) / "hub_announcements.db"),
        data_dir=str(Path(temp_dir) / "data"),
    )
    Path(store.data_dir).mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(hub_service_module, "get_local_store", lambda: store)
    monkeypatch.setattr(hub_service_module, "is_app_database_configured", lambda: False)
    monkeypatch.setattr(hub_service_module.user_service, "list_users", lambda: list(users_by_id.values()))
    monkeypatch.setattr(hub_service_module.user_service, "get_by_id", lambda user_id: users_by_id.get(int(user_id)))
    monkeypatch.setattr(
        zup_profile_module.zup_user_profile_service,
        "resolve_user",
        lambda user=None: GEO_PROFILES.get(int((user or {}).get("id") or 0)),
    )
    monkeypatch.setattr(
        address_book_module.address_book_service,
        "load_cache",
        lambda: {"items": FAKE_BOOK_ITEMS},
    )

    service = hub_service_module.HubService()
    monkeypatch.setattr(hub, "hub_service", service)

    app = FastAPI()
    app.include_router(hub.router, prefix="/hub")

    current = {"user": _public_user(raw_users[1])}

    def _override_current_user() -> User:
        return current["user"]

    app.dependency_overrides[deps.get_current_active_user] = _override_current_user

    client = TestClient(app)

    def set_user(user_id: int) -> None:
        current["user"] = _public_user(raw_users[user_id])

    return {
        "client": client,
        "set_user": set_user,
        "raw_users": raw_users,
        "service": service,
    }


def _create(client: TestClient, **payload) -> dict:
    body = {
        "title": payload.pop("title", "Geo Announcement"),
        "preview": payload.pop("preview", "Preview"),
        "body": payload.pop("body", "Body"),
        **payload,
    }
    return client.post("/hub/announcements", json=body)


def _feed_post_ids(client: TestClient, set_user, user_id: int) -> set[str]:
    set_user(user_id)
    listing = client.get("/hub/announcements")
    assert listing.status_code == 200, listing.text
    return {str(item["id"]) for item in listing.json()["items"]}


def test_departments_scope_visibility_matrix(geo_announcement_env):
    client = geo_announcement_env["client"]
    set_user = geo_announcement_env["set_user"]

    set_user(1)
    response = _create(
        client,
        title="Логистика: новости отдела",
        audience_scope="departments",
        audience_department_codes=["D100"],
    )
    assert response.status_code == 200, response.text
    post = response.json()
    assert post["audience_scope"] == "departments"
    assert post["audience_department_codes"] == ["d100"]
    assert post["recipients_summary"] == "Отдел логистики"

    for user_id in (1, 2, 3):
        assert post["id"] in _feed_post_ids(client, set_user, user_id), user_id

    for user_id in (4, 5):
        assert post["id"] not in _feed_post_ids(client, set_user, user_id), user_id
        set_user(user_id)
        assert client.get(f"/hub/announcements/{post['id']}").status_code == 403

    set_user(6)
    assert client.get(f"/hub/announcements/{post['id']}").status_code == 200

    set_user(1)
    reads = client.get(f"/hub/announcements/{post['id']}/reads")
    assert reads.status_code == 200, reads.text
    assert reads.json()["summary"]["recipients_total"] == 2


def test_cities_scope_visibility_matrix(geo_announcement_env):
    client = geo_announcement_env["client"]
    set_user = geo_announcement_env["set_user"]

    set_user(1)
    response = _create(
        client,
        title="Москва: городские новости",
        audience_scope="cities",
        audience_cities=["Москва"],
    )
    assert response.status_code == 200, response.text
    post = response.json()
    assert post["audience_scope"] == "cities"
    assert post["recipients_summary"] == "Москва"

    for user_id in (2, 4):
        assert post["id"] in _feed_post_ids(client, set_user, user_id), user_id

    for user_id in (3, 5):
        assert post["id"] not in _feed_post_ids(client, set_user, user_id), user_id


def test_departments_cities_scope_requires_both(geo_announcement_env):
    client = geo_announcement_env["client"]
    set_user = geo_announcement_env["set_user"]

    set_user(1)
    response = _create(
        client,
        title="Логистика в Казани",
        audience_scope="departments_cities",
        audience_department_codes=["D100"],
        audience_cities=["Казань"],
    )
    assert response.status_code == 200, response.text
    post = response.json()
    assert post["recipients_summary"] == "Отдел логистики · Казань"

    assert post["id"] in _feed_post_ids(client, set_user, 3)
    for user_id in (2, 4, 5):
        assert post["id"] not in _feed_post_ids(client, set_user, user_id), user_id


def test_geo_scope_validation_rejects_empty_audience(geo_announcement_env):
    client = geo_announcement_env["client"]
    set_user = geo_announcement_env["set_user"]

    set_user(1)
    for payload in (
        {"audience_scope": "departments", "audience_department_codes": []},
        {"audience_scope": "cities", "audience_cities": []},
        {"audience_scope": "departments_cities", "audience_department_codes": ["D100"]},
        {"audience_scope": "departments_cities", "audience_cities": ["Москва"]},
    ):
        response = _create(client, title="Пустая аудитория", **payload)
        assert response.status_code == 400, (payload, response.text)


def test_audience_targeted_filter_returns_only_my_geo_posts(geo_announcement_env):
    client = geo_announcement_env["client"]
    set_user = geo_announcement_env["set_user"]

    set_user(1)
    everyone = _create(client, title="Общая новость")
    departments = _create(
        client,
        title="Новость логистики",
        audience_scope="departments",
        audience_department_codes=["D100"],
    )
    cities = _create(
        client,
        title="Новость Москвы",
        audience_scope="cities",
        audience_cities=["Москва"],
    )
    direct = _create(
        client,
        title="Адресная новость",
        audience_scope="users",
        audience_user_ids=[2],
    )
    for response in (everyone, departments, cities, direct):
        assert response.status_code == 200, response.text
    everyone_post = everyone.json()
    departments_post = departments.json()
    cities_post = cities.json()
    direct_post = direct.json()

    set_user(2)
    listing = client.get("/hub/announcements", params={"audience_targeted": True})
    assert listing.status_code == 200, listing.text
    ids = {item["id"] for item in listing.json()["items"]}
    assert departments_post["id"] in ids
    assert cities_post["id"] in ids
    assert everyone_post["id"] not in ids
    assert direct_post["id"] not in ids

    set_user(4)
    other_listing = client.get("/hub/announcements", params={"audience_targeted": True})
    assert other_listing.status_code == 200, other_listing.text
    other_ids = {item["id"] for item in other_listing.json()["items"]}
    assert cities_post["id"] in other_ids
    assert departments_post["id"] not in other_ids

    set_user(5)
    empty_listing = client.get("/hub/announcements", params={"audience_targeted": True})
    assert empty_listing.status_code == 200, empty_listing.text
    assert empty_listing.json()["items"] == []


def test_recipients_catalog_lists_departments_and_cities(geo_announcement_env):
    client = geo_announcement_env["client"]
    set_user = geo_announcement_env["set_user"]

    set_user(1)
    response = client.get("/hub/users/announcement-recipients")
    assert response.status_code == 200, response.text
    payload = response.json()

    departments = {item["code"]: item["name"] for item in payload["departments"]}
    assert departments.get("d100") == "Отдел логистики"
    assert departments.get("d200") == "Отдел продаж"

    cities = {item["value"]: item["label"] for item in payload["cities"]}
    assert cities.get("москва") == "Москва"
    assert cities.get("казань") == "Казань"
