"""Resolution chain of office.action.task_create_draft + cyrillic user search.

Covers the A11 cycle-3 act-triage fixes deterministically (no LLM):
assignee resolution by exact full_name, project defaulting parity with the
task-create UI (general project, then first active project), ambiguity
refusal, and Unicode case-insensitive user search on the sqlite runtime
(postgres LOWER parity).

Why unit-level: the chain (tool args -> hub_service directory -> draft
payload) is driven by the LLM in production, so an end-to-end run cannot
reproduce these branches deterministically; the draft builder is captured
to inspect exactly what the confirmation card would carry.
"""
from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

hub_service_module = importlib.import_module("backend.services.hub_service")
office_module = importlib.import_module("backend.ai_chat.tools.office")
user_service_module = importlib.import_module("backend.services.user_service")

from backend.ai_chat.tools.context import AiToolExecutionContext


def _raw_user(user_id: int, username: str, full_name: str, permissions: list[str]) -> dict:
    return {
        "id": user_id,
        "username": username,
        "email": None,
        "full_name": full_name,
        "is_active": True,
        "role": "viewer",
        "permissions": permissions,
        "use_custom_permissions": True,
        "custom_permissions": permissions,
        "auth_source": "local",
        "telegram_id": None,
        "assigned_database": None,
        "mailbox_email": None,
        "mailbox_login": None,
        "created_at": None,
        "updated_at": None,
    }


def _context(user: dict, tools: list[str]) -> AiToolExecutionContext:
    return AiToolExecutionContext(
        bot_id="bot-1",
        bot_title="bench",
        conversation_id="conv-1",
        run_id="run-1",
        user_id=int(user["id"]),
        user_payload=user,
        effective_database_id="ITINVENT",
        enabled_tools=list(tools),
        tool_settings={},
    )


@pytest.fixture
def draft_env(temp_dir, monkeypatch):
    """Real HubService on local sqlite + cyrillic user directory + captured draft builder."""
    monkeypatch.setenv("TASK_DISCUSSION_CHAT_ENABLED", "0")
    monkeypatch.setenv("CHAT_MODULE_ENABLED", "0")
    monkeypatch.setenv("TASK_EMAIL_AUTODISPATCH_ENABLED", "0")

    raw_users = {
        1: _raw_user(1, "actor", "Актор Тестовый", ["tasks.read", "tasks.create", "tasks.write", "tasks.review"]),
        2: _raw_user(2, "bench_emp002", "Бенч Сотрудник 002", ["tasks.read"]),
        3: _raw_user(3, "bench_emp003", "Бенч Сотрудник 003", ["tasks.read"]),
    }
    from types import SimpleNamespace

    store = SimpleNamespace(
        db_path=str(Path(temp_dir) / "draft_tasks.db"),
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

    captured: dict = {}

    def _capture_build(**kwargs):
        captured.update(kwargs)
        return {"id": "action-1", "action_type": kwargs["action_type"], "payload": kwargs["payload"]}

    import backend.ai_chat.action_cards as action_cards

    monkeypatch.setattr(action_cards, "build_office_task_draft", _capture_build)
    monkeypatch.setattr(office_module, "build_office_task_draft", _capture_build, raising=False)

    yield {"service": service, "users": raw_users, "captured": captured}


def _execute_create_draft(env, **kwargs):
    tool = office_module.TaskCreateDraftTool()
    args = office_module.TaskCreateDraftArgs(**kwargs)
    return tool.execute(context=_context(env["users"][1], ["office.action.task_create_draft"]), args=args)


def test_assignee_resolves_by_exact_cyrillic_full_name(draft_env):
    result = _execute_create_draft(
        draft_env, title="Подготовить отчёт", assignee_query="Бенч Сотрудник 002",
    )
    assert result.ok is True
    payload = draft_env["captured"]["payload"]
    assert int(payload["assignee_user_id"]) == 2
    assert payload["assignee_name"] == "Бенч Сотрудник 002"


def test_project_defaults_to_general_tasks(draft_env):
    result = _execute_create_draft(
        draft_env, title="Подготовить отчёт", assignee_query="Бенч Сотрудник 002",
    )
    assert result.ok is True
    payload = draft_env["captured"]["payload"]
    # UI parity: useTaskCreateForm pre-selects the general project when the
    # user does not choose one; the draft must not die on a missing project.
    assert payload["project_id"] == "general-tasks"
    assert payload["project_name"]


def test_project_query_wins_over_default(draft_env):
    service = draft_env["service"]
    project = service.create_task_project(name="Бенч-проект", code="BENCH")
    result = _execute_create_draft(
        draft_env, title="Подготовить отчёт", assignee_query="Бенч Сотрудник 002", project_query="Бенч-проект",
    )
    assert result.ok is True
    payload = draft_env["captured"]["payload"]
    assert payload["project_id"] == str(project["id"])
    assert payload["project_name"] == "Бенч-проект"


def test_project_defaults_to_first_active_when_general_inactive(draft_env):
    service = draft_env["service"]
    service.update_task_project("general-tasks", {"is_active": False})
    project = service.create_task_project(name="Запасной проект", code="FALLBACK")
    result = _execute_create_draft(
        draft_env, title="Подготовить отчёт", assignee_query="Бенч Сотрудник 002",
    )
    assert result.ok is True
    payload = draft_env["captured"]["payload"]
    assert payload["project_id"] == str(project["id"])


def test_assignee_ambiguous_refuses(draft_env):
    with pytest.raises(ValueError, match="ambiguous or was not found"):
        _execute_create_draft(draft_env, title="Подготовить отчёт", assignee_query="Бенч Сотрудник")


def test_controller_defaults_to_reviewer_actor(draft_env):
    result = _execute_create_draft(
        draft_env, title="Подготовить отчёт", assignee_query="Бенч Сотрудник 002",
    )
    assert result.ok is True
    payload = draft_env["captured"]["payload"]
    assert int(payload["controller_user_id"]) == 1


# --- Unicode LOWER parity on the sqlite app-db runtime -------------------------


def test_search_users_cyrillic_case_insensitive_on_sqlite(prebuilt_app_db):
    """func.lower() in the SQL search path must lowercase Cyrillic on sqlite too.

    SQLite's built-in lower() is ASCII-only; production PostgreSQL is
    Unicode-aware. Without parity the app-db search path never matches a
    Russian full name typed in lowercase — the act_08 class of failures.
    """
    url = f"sqlite:///{prebuilt_app_db.as_posix()}"
    service = user_service_module.UserService(database_url=url)
    service.create_user(
        username="bench_emp002", password=None, role="viewer", auth_source="local",
        full_name="Бенч Сотрудник 002", is_active=True,
    )
    for query in ("бенч сотрудник 002", "Бенч Сотрудник 002", "СОТРУДНИК 002"):
        result = service.search_users(query=query, limit=8, status="active")
        items = result.get("items") or []
        matches = [u for u in items if u.get("username") == "bench_emp002"]
        assert matches, f"query {query!r} did not find the cyrillic user on sqlite"


def test_search_users_cyrillic_unique_match_on_sqlite(prebuilt_app_db):
    url = f"sqlite:///{prebuilt_app_db.as_posix()}"
    service = user_service_module.UserService(database_url=url)
    for i in range(1, 4):
        service.create_user(
            username=f"bench_emp{i:03d}", password=None, role="viewer", auth_source="local",
            full_name=f"Бенч Сотрудник {i:03d}", is_active=True,
        )
    result = service.search_users(query="Бенч Сотрудник 002", limit=8, status="active")
    usernames = [u.get("username") for u in (result.get("items") or [])]
    assert usernames == ["bench_emp002"]
    broad = service.search_users(query="Бенч Сотрудник", limit=8, status="active")
    assert len(broad.get("items") or []) == 3
