"""ACL matrix for office.tasks.* AI tools on a real HubService (sqlite).

Covers the A10 sign-off ACL scenarios deterministically (no LLM):
no extra permission / own tasks only / reviewer without manage_all /
tasks.manage_all delegate / admin / foreign task by id /
permission change between calls / registry-level re-check.

Why unit-level: these checks exercise the shared execution pipeline
(registry.execute -> user_can_use_tool -> tool.execute -> hub_service
access checks) which cannot be driven reliably through an LLM run.
"""
from __future__ import annotations

import importlib
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

hub_service_module = importlib.import_module("backend.services.hub_service")
office_module = importlib.import_module("backend.ai_chat.tools.office")
user_service_module = importlib.import_module("backend.services.user_service")

from backend.ai_chat.tool_permissions import filter_tools_for_user, user_can_use_tool
from backend.ai_chat.tools.context import AiToolExecutionContext
from backend.ai_chat.tools.registry import ai_tool_registry
from backend.ai_chat import tools  # noqa: F401  # populate the global registry

TASKS_READ = "tasks.read"
TASKS_REVIEW = "tasks.review"
TASKS_MANAGE_ALL = "tasks.manage_all"


def _raw_user(user_id: int, username: str, role: str, permissions: list[str]) -> dict:
    return {
        "id": user_id,
        "username": username,
        "email": None,
        "full_name": username.title(),
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


def _context(user_payload: dict, enabled_tools: list[str]) -> AiToolExecutionContext:
    return AiToolExecutionContext(
        bot_id="bot",
        bot_title="Bot",
        conversation_id="conv",
        run_id="run",
        user_id=int(user_payload.get("id") or 0),
        user_payload=user_payload,
        effective_database_id="ITINVENT",
        enabled_tools=list(enabled_tools),
        tool_settings={"multi_db_mode": "single", "allowed_databases": []},
    )


@pytest.fixture
def acl_env(temp_dir, monkeypatch):
    monkeypatch.setenv("TASK_DISCUSSION_CHAT_ENABLED", "0")
    monkeypatch.setenv("CHAT_MODULE_ENABLED", "0")
    monkeypatch.setenv("TASK_EMAIL_AUTODISPATCH_ENABLED", "0")
    task_discussion_module = importlib.import_module("backend.chat.task_discussion")
    monkeypatch.setattr(task_discussion_module, "is_task_discussion_chat_enabled", lambda: False)

    raw_users = {
        # Baseline viewer (tasks.read comes from the viewer baseline set).
        2: _raw_user(2, "assignee", "viewer", [TASKS_READ]),
        # Same rights as the assignee but participates in no tasks.
        4: _raw_user(4, "outsider", "viewer", [TASKS_READ]),
        # Reviewer WITHOUT tasks.manage_all — scope=all must degrade to "my".
        3: _raw_user(3, "reviewer", "viewer", [TASKS_READ, TASKS_REVIEW]),
        # Delegate with tasks.manage_all — matches GET /tasks?scope=all parity.
        10: _raw_user(10, "manager", "viewer", [TASKS_READ, TASKS_MANAGE_ALL]),
        # Portal admin — everything.
        5: _raw_user(5, "admin", "admin", [TASKS_READ, TASKS_MANAGE_ALL]),
    }
    store = SimpleNamespace(
        db_path=str(Path(temp_dir) / "acl_tasks.db"),
        data_dir=str(Path(temp_dir) / "data"),
    )
    Path(store.data_dir).mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(hub_service_module, "get_local_store", lambda: store)
    monkeypatch.setattr(hub_service_module, "is_app_database_configured", lambda: False)
    monkeypatch.setattr(user_service_module.user_service, "list_users", lambda: list(raw_users.values()))
    monkeypatch.setattr(user_service_module.user_service, "get_by_id", lambda user_id: raw_users.get(int(user_id)))

    service = hub_service_module.HubService()
    monkeypatch.setattr(hub_service_module, "hub_service", service)
    # office.py binds `hub_service` at module level.
    monkeypatch.setattr(office_module, "hub_service", service)
    monkeypatch.setattr(service, "_schedule_task_email_outbox_dispatch", lambda: None)

    admin = raw_users[5]
    project = service.create_task_project(name="ACL-проект", code="ACL-T")
    own_task = service.create_task(
        title="Задача сотрудника-исполнителя",
        description="Принадлежит пользователю 2.",
        assignee_user_id=2,
        controller_user_id=5,
        due_at=None,
        project_id=project["id"],
        actor=admin,
        initial_status="new",
    )
    foreign_task = service.create_task(
        title="Чужая задача исполнителя",
        description="Принадлежит пользователю 4.",
        assignee_user_id=4,
        controller_user_id=5,
        due_at=None,
        project_id=project["id"],
        actor=admin,
        initial_status="new",
    )
    yield {
        "service": service,
        "users": raw_users,
        "own_task_id": str(own_task["id"]),
        "foreign_task_id": str(foreign_task["id"]),
    }


def _search(context: AiToolExecutionContext, scope: str = "my") -> dict:
    tool = ai_tool_registry.get("office.tasks.search")
    args = tool.input_model(scope=scope, q="задача", limit=50)
    return tool.execute(context=context, args=args)


def _titles(result) -> list[str]:
    return [str(item.get("title") or "") for item in result.data.get("items") or []]


def test_viewer_sees_only_own_tasks(acl_env):
    result = _search(_context(acl_env["users"][2], ["office.tasks.search"]))
    titles = _titles(result)
    assert "Задача сотрудника-исполнителя" in titles
    assert "Чужая задача исполнителя" not in titles


def test_scope_all_requires_manage_all_reviewer_degrades(acl_env):
    """Parity with GET /tasks: tasks.review alone must NOT unlock scope=all."""
    result = _search(_context(acl_env["users"][3], ["office.tasks.search"]), scope="all")
    data = result.data
    assert data.get("scope_downgraded") is True
    assert data.get("notice")
    titles = _titles(result)
    assert "Чужая задача исполнителя" not in titles
    assert "Задача сотрудника-исполнителя" not in titles  # reviewer participates in nothing


def test_scope_all_manage_all_delegate_sees_everything(acl_env):
    result = _search(_context(acl_env["users"][10], ["office.tasks.search"]), scope="all")
    data = result.data
    assert not data.get("scope_downgraded")
    titles = _titles(result)
    assert "Задача сотрудника-исполнителя" in titles
    assert "Чужая задача исполнителя" in titles


def test_scope_all_admin_sees_everything(acl_env):
    result = _search(_context(acl_env["users"][5], ["office.tasks.search"]), scope="all")
    titles = _titles(result)
    assert "Задача сотрудника-исполнителя" in titles
    assert "Чужая задача исполнителя" in titles


def test_foreign_task_by_id_not_visible(acl_env):
    """hub_service._task_access_or_raise denies non-participants."""
    tool = ai_tool_registry.get("office.tasks.get")
    args = tool.input_model(task_id=acl_env["foreign_task_id"])
    with pytest.raises(PermissionError):
        tool.execute(context=_context(acl_env["users"][2], ["office.tasks.get"]), args=args)


def test_own_task_by_id_visible(acl_env):
    tool = ai_tool_registry.get("office.tasks.get")
    args = tool.input_model(task_id=acl_env["own_task_id"])
    result = tool.execute(context=_context(acl_env["users"][2], ["office.tasks.get"]), args=args)
    assert result.ok
    assert str(result.data.get("task", {}).get("title") or "") == "Задача сотрудника-исполнителя"


def test_permission_change_between_calls_is_per_call(acl_env):
    """Rights are re-evaluated on every call — no caching in the pipeline."""
    base = acl_env["users"][10]
    with_manage = dict(base, custom_permissions=[TASKS_READ, TASKS_MANAGE_ALL])
    stripped = dict(base, custom_permissions=[TASKS_READ])

    first = _search(_context(with_manage, ["office.tasks.search"]), scope="all")
    assert "Чужая задача исполнителя" in _titles(first)

    second = _search(_context(stripped, ["office.tasks.search"]), scope="all")
    assert second.data.get("scope_downgraded") is True
    assert "Чужая задача исполнителя" not in _titles(second)


def test_registry_rechecks_permission_per_call(acl_env):
    """Even if the tool id slipped into enabled_tools, execute blocks it."""
    context = _context(acl_env["users"][4], ["mfu.devices.list"])
    assert not user_can_use_tool("mfu.devices.list", acl_env["users"][4])
    assert filter_tools_for_user(["mfu.devices.list"], acl_env["users"][4]) == []
    with pytest.raises(PermissionError):
        ai_tool_registry.execute(tool_id="mfu.devices.list", raw_args={}, context=context)


def test_baseline_permissions_cannot_be_revoked_documented(acl_env):
    """tasks.read is in the viewer baseline — EVERY active user sees own tasks.

    This is intended portal behavior (custom permissions are unioned with the
    viewer baseline), not an AI-tool defect. The AI must therefore never leak
    OTHER users' tasks — covered by the remaining tests in this file.
    """
    payload = acl_env["users"][4]
    assert user_can_use_tool("office.tasks.search", payload)
    result = _search(_context(payload, ["office.tasks.search"]))
    titles = _titles(result)
    assert "Чужая задача исполнителя" in titles  # outsider IS the assignee here
    assert "Задача сотрудника-исполнителя" not in titles
