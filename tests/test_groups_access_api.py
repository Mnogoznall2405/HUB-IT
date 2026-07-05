from __future__ import annotations

import sys
from collections.abc import Callable
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.api import deps
from backend.api.v1 import groups_access as groups_access_api
from backend.models.auth import User
from backend.services.authorization_service import PERM_GROUPS_ACCESS_READ


def _make_user(*, role: str = "viewer", permissions: list[str] | None = None) -> User:
    custom_permissions = permissions or []
    return User(
        id=42,
        username="groups-access-user",
        email="groups-access-user@example.com",
        full_name="Groups Access User",
        role=role,
        permissions=custom_permissions,
        use_custom_permissions=bool(custom_permissions),
        custom_permissions=custom_permissions,
        is_active=True,
    )


def _client_for(user_factory: Callable[[], User], *, admin_user_factory: Callable[[], User] | None = None) -> TestClient:
    app = FastAPI()
    app.include_router(groups_access_api.router, prefix="/groups-access")
    app.dependency_overrides[deps.get_current_active_user] = user_factory
    if admin_user_factory is not None:
        app.dependency_overrides[deps.get_current_admin_user] = admin_user_factory
    return TestClient(app)


@pytest.fixture
def snapshot_payload():
    return {
        "synced_at": "2026-07-03T10:00:00Z",
        "base_dn": "OU=Groups,DC=zsgp,DC=corp",
        "branches": ["SPb", "Tyumen"],
        "groups": [
            {
                "dn": "CN=Designers,OU=SPb,OU=Groups,DC=zsgp,DC=corp",
                "cn": "Designers",
                "branch": "SPb",
                "folder_label": "Designers",
                "folder_path": "Designers",
                "access_level": "member",
                "description": "",
                "member_count": 1,
            }
        ],
        "group_members": {
            "CN=Designers,OU=SPb,OU=Groups,DC=zsgp,DC=corp": [
                {"login": "petrov_p", "display_name": "Петров П.П.", "via": "direct"},
            ],
        },
        "users": [
            {
                "login": "petrov_p",
                "display_name": "Петров П.П.",
                "branch": "SPb",
                "access": [
                    {
                        "group_dn": "CN=Designers,OU=SPb,OU=Groups,DC=zsgp,DC=corp",
                        "folder_label": "Designers",
                        "folder_path": "Designers",
                        "branch": "SPb",
                        "access_level": "member",
                        "via": "direct",
                    }
                ],
            }
        ],
        "matrix_summary": {"group_count": 1, "user_count": 1},
    }


def test_groups_access_status_requires_permission(monkeypatch, snapshot_payload):
    monkeypatch.setattr(groups_access_api, "get_status", lambda: {"status": "ok", "summary": snapshot_payload["matrix_summary"]})
    client = _client_for(lambda: _make_user(permissions=[]))
    response = client.get("/groups-access/status")
    assert response.status_code == 403


def test_groups_access_status_allows_custom_permission(monkeypatch, snapshot_payload):
    monkeypatch.setattr(
        groups_access_api,
        "get_status",
        lambda: {
            "status": "ok",
            "last_sync_at": snapshot_payload["synced_at"],
            "summary": snapshot_payload["matrix_summary"],
        },
    )
    client = _client_for(lambda: _make_user(permissions=[PERM_GROUPS_ACCESS_READ]))
    response = client.get("/groups-access/status")
    assert response.status_code == 200
    assert response.json()["summary"]["group_count"] == 1


def test_groups_access_user_search(monkeypatch, snapshot_payload):
    monkeypatch.setattr(
        groups_access_api,
        "search_user_access",
        lambda **kwargs: {
            "items": snapshot_payload["users"],
            "total": 1,
            "synced_at": snapshot_payload["synced_at"],
        },
    )
    client = _client_for(lambda: _make_user(permissions=[PERM_GROUPS_ACCESS_READ]))
    response = client.get("/groups-access/user", params={"q": "petrov"})
    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert response.json()["items"][0]["login"] == "petrov_p"


def test_groups_access_matrix_grid(monkeypatch, snapshot_payload):
    seen_kwargs = {}

    def fake_get_matrix_grid(**kwargs):
        seen_kwargs.update(kwargs)
        return {
            "groups": snapshot_payload["groups"],
            "users": [{"login": "petrov_p", "display_name": "Петров П.П.", "access_count": 1}],
            "cells": [["petrov_p", snapshot_payload["groups"][0]["dn"], "member"]],
            "summary": {
                "group_count": 1,
                "user_count": 1,
                "cell_count": 1,
                "returned_group_count": 1,
                "returned_user_count": 1,
                "truncated": False,
            },
            "synced_at": snapshot_payload["synced_at"],
        }

    monkeypatch.setattr(
        groups_access_api,
        "get_matrix_grid",
        fake_get_matrix_grid,
    )
    client = _client_for(lambda: _make_user(permissions=[PERM_GROUPS_ACCESS_READ]))
    response = client.get(
        "/groups-access/matrix-grid",
        params={"branch": "SPb", "group_limit": 123, "user_limit": 456},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["summary"]["cell_count"] == 1
    assert body["cells"][0][0] == "petrov_p"
    assert seen_kwargs["group_limit"] == 123
    assert seen_kwargs["user_limit"] == 456


def test_groups_access_export_dataset(monkeypatch, snapshot_payload):
    monkeypatch.setattr(
        groups_access_api,
        "get_export_dataset",
        lambda **kwargs: {
            "groups": snapshot_payload["groups"],
            "users": snapshot_payload["users"],
            "summary": snapshot_payload["matrix_summary"],
            "synced_at": snapshot_payload["synced_at"],
        },
    )
    client = _client_for(lambda: _make_user(permissions=[PERM_GROUPS_ACCESS_READ]))
    response = client.get("/groups-access/export", params={"branch": "SPb"})
    assert response.status_code == 200
    body = response.json()
    assert len(body["groups"]) == 1
    assert body["summary"]["user_count"] == 1


def test_groups_access_refresh_admin_only(monkeypatch):
    monkeypatch.setattr(groups_access_api, "sync_snapshot", lambda **kwargs: {"status": "ok", "summary": {"group_count": 1, "user_count": 1}})
    viewer_client = _client_for(lambda: _make_user(permissions=[PERM_GROUPS_ACCESS_READ]))
    assert viewer_client.post("/groups-access/refresh").status_code == 403

    admin_client = _client_for(
        lambda: _make_user(role="admin"),
        admin_user_factory=lambda: _make_user(role="admin"),
    )
    response = admin_client.post("/groups-access/refresh")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
