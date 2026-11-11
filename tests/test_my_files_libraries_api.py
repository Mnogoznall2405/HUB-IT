from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.deps import get_current_active_user
from backend.api.v1 import my_files_libraries as libraries_api
from backend.models.auth import User
from backend.services.my_files_service import MyFilesNotFoundError


class FakeLibraryService:
    def __init__(self) -> None:
        self.manageable = False
        self.gate_calls: list[tuple[str, int]] = []
        self.set_calls: list[tuple[str, list, int]] = []

    def may_manage_members(self, *, library_id: str, user_id: int) -> bool:
        self.gate_calls.append((library_id, user_id))
        if library_id == "missing":
            raise MyFilesNotFoundError("Library not found")
        return self.manageable

    def list_members(self, *, library_id: str):
        return [{"principal_type": "user", "principal_id": "7", "role": "manage", "name": "Иван", "members_count": 1}]

    def set_members(self, *, library_id: str, members, actor, meta=None):
        self.set_calls.append((library_id, members, int(actor.id)))
        return [
            {"principal_type": principal_type, "principal_id": principal_id, "role": role, "name": "", "members_count": 0}
            for principal_type, principal_id, role in members
        ]


def _viewer() -> User:
    return User(id=8, username="member-8", role="viewer", is_active=True)


def _admin() -> User:
    return User(id=9, username="admin-9", role="admin", is_active=True)


def _client(user: User) -> TestClient:
    app = FastAPI()
    app.include_router(libraries_api.router, prefix="/my-files")
    app.dependency_overrides[get_current_active_user] = lambda: user
    return TestClient(app)


@pytest.fixture
def fake_service(monkeypatch):
    service = FakeLibraryService()
    monkeypatch.setattr(libraries_api, "my_files_library_service", service)
    return service


def test_members_endpoints_allow_library_manage_member(fake_service):
    """A user whose library role is ``manage`` may read and replace the member list."""
    fake_service.manageable = True
    client = _client(_viewer())

    listed = client.get("/my-files/libraries/lib-1/members")
    assert listed.status_code == 200
    assert listed.json()["items"][0]["principal_id"] == "7"
    assert fake_service.gate_calls == [("lib-1", 8)]

    saved = client.put(
        "/my-files/libraries/lib-1/members",
        json={"members": [{"principal_type": "user", "principal_id": "10", "role": "view"}]},
    )
    assert saved.status_code == 200
    assert fake_service.set_calls == [("lib-1", [("user", "10", "view")], 8)]


def test_members_endpoints_reject_lower_roles(fake_service):
    """``edit``/``view`` members and outsiders get an indistinguishable 404."""
    fake_service.manageable = False
    client = _client(_viewer())

    assert client.get("/my-files/libraries/lib-1/members").status_code == 404
    assert (
        client.put(
            "/my-files/libraries/lib-1/members",
            json={"members": [{"principal_type": "user", "principal_id": "10", "role": "view"}]},
        ).status_code
        == 404
    )
    assert fake_service.set_calls == []


def test_members_endpoints_keep_platform_admin_access(fake_service):
    """Global ``my_files.libraries.manage`` holders skip the per-library role check."""
    fake_service.manageable = False
    client = _client(_admin())

    assert client.get("/my-files/libraries/lib-1/members").status_code == 200
    assert (
        client.put(
            "/my-files/libraries/lib-1/members",
            json={"members": [{"principal_type": "user", "principal_id": "10", "role": "view"}]},
        ).status_code
        == 200
    )
    assert fake_service.gate_calls == []  # admin never reaches the role probe
    assert fake_service.set_calls


def test_members_endpoints_missing_library_is_404(fake_service):
    fake_service.manageable = True
    client = _client(_viewer())

    assert client.get("/my-files/libraries/missing/members").status_code == 404
    assert (
        client.put(
            "/my-files/libraries/missing/members",
            json={"members": [{"principal_type": "user", "principal_id": "10", "role": "view"}]},
        ).status_code
        == 404
    )
