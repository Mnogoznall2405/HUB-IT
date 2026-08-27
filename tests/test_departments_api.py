from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api import deps
from backend.api.v1 import departments as departments_api
from backend.models.auth import User
from backend.services.authorization_service import PERM_DEPARTMENTS_MANAGE, PERM_SETTINGS_READ


def _user(permissions: list[str]) -> User:
    return User(
        id=77,
        username="departments-user",
        role="viewer",
        is_active=True,
        permissions=permissions,
        use_custom_permissions=True,
        custom_permissions=permissions,
    )


def _client(user: User) -> TestClient:
    app = FastAPI()
    app.include_router(departments_api.router, prefix="/departments")
    app.dependency_overrides[deps.get_current_active_user] = lambda: user
    return TestClient(app)


def test_manage_permission_can_read_departments(monkeypatch):
    monkeypatch.setattr(
        departments_api.department_service,
        "get_user_department_ids",
        lambda *_args, **_kwargs: [],
    )
    monkeypatch.setattr(
        departments_api.department_service,
        "list_departments",
        lambda **_kwargs: [{"id": "it", "name": "ИТ", "members_count": 3, "managers_count": 1}],
    )

    response = _client(_user([PERM_DEPARTMENTS_MANAGE])).get("/departments")

    assert response.status_code == 200
    assert response.json()["items"][0]["members_count"] == 3


def test_settings_read_permission_can_read_department_members(monkeypatch):
    monkeypatch.setattr(
        departments_api.department_service,
        "get_department",
        lambda department_id: {"id": department_id, "name": "ИТ"},
    )
    monkeypatch.setattr(
        departments_api.department_service,
        "list_memberships",
        lambda **_kwargs: [],
    )
    monkeypatch.setattr(
        departments_api.user_service,
        "get_users_map_by_ids",
        lambda _ids: {},
    )

    response = _client(_user([PERM_SETTINGS_READ])).get("/departments/it/members")

    assert response.status_code == 200
    assert response.json()["department"]["id"] == "it"


def test_department_read_is_forbidden_without_either_permission():
    response = _client(_user([])).get("/departments")

    assert response.status_code == 403


def test_settings_read_alone_cannot_run_department_sync():
    response = _client(_user([PERM_SETTINGS_READ])).post("/departments/sync-from-users")

    assert response.status_code == 403
