from __future__ import annotations

import sys
import importlib
from pathlib import Path
from types import SimpleNamespace


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

hub_service_module = importlib.import_module("backend.services.hub_service")
from backend.services.department_service import (
    DEPARTMENT_MANAGER_ROLE,
    DEPARTMENT_MEMBER_ROLE,
)


def test_controllers_load_memberships_once_for_all_users(monkeypatch):
    users = [
        {"id": 1, "username": "alice_admin", "full_name": "Admin", "role": "admin", "department": "IT"},
        {"id": 2, "username": "manager", "full_name": "Manager", "role": "viewer", "department": "Sales"},
        {"id": 3, "username": "viewer", "full_name": "Viewer", "role": "viewer", "department": "IT"},
    ]
    batch_calls: list[list[int]] = []

    def get_role_map(user_ids):
        batch_calls.append(list(user_ids))
        return {
            1: {DEPARTMENT_MEMBER_ROLE: {"dept-it"}},
            2: {
                DEPARTMENT_MEMBER_ROLE: {"dept-sales"},
                DEPARTMENT_MANAGER_ROLE: {"dept-sales"},
            },
            3: {DEPARTMENT_MEMBER_ROLE: {"dept-it"}},
        }

    monkeypatch.setattr(hub_service_module, "user_service", SimpleNamespace(list_users=lambda: users))
    monkeypatch.setattr(
        hub_service_module,
        "department_service",
        SimpleNamespace(get_user_department_role_map=get_role_map),
    )
    service = object.__new__(hub_service_module.HubService)
    service._user_can_review_tasks = lambda user: str(user.get("role")) == "admin"

    result = service._build_controllers_list()

    assert [row["id"] for row in result] == [1, 2]
    assert batch_calls == [[1, 2, 3]]
    assert {row["id"]: row["department_id"] for row in result} == {
        1: "dept-it",
        2: "dept-sales",
    }
