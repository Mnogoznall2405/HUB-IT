"""Self-service (me.*, helpdesk.*) and inventory computer tools for ai_chat."""
from __future__ import annotations

import importlib
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

_ROOT = Path(__file__).resolve().parents[1]
for _p in (str(_ROOT), str(_ROOT / "WEB-itinvent")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

service_module = importlib.import_module("backend.ai_chat.service")
context_module = importlib.import_module("backend.ai_chat.tools.context")
self_identity = importlib.import_module("backend.ai_chat.self_identity")
self_service = importlib.import_module("backend.ai_chat.tools.self_service")
computers = importlib.import_module("backend.ai_chat.tools.computers")
action_cards = importlib.import_module("backend.ai_chat.action_cards")
inventory_api = importlib.import_module("backend.api.v1.inventory")
queries = importlib.import_module("backend.database.queries")
user_service_module = importlib.import_module("backend.services.user_service")
permissions_module = importlib.import_module("backend.ai_chat.tool_permissions")


def _ctx(*, user_id: int = 7, role: str = "viewer", custom: list[str] | None = None):
    return context_module.AiToolExecutionContext(
        bot_id="bot",
        bot_title="Ассистент",
        conversation_id="conv-1",
        run_id="run-1",
        user_id=user_id,
        user_payload={
            "id": user_id,
            "role": role,
            "username": "ivanov_ii",
            "use_custom_permissions": custom is not None,
            "custom_permissions": list(custom or []),
        },
        effective_database_id="ITINVENT",
        enabled_tools=[],
        tool_settings={"multi_db_mode": "single", "allowed_databases": []},
    )


def _user(**overrides):
    base = {
        "id": 7,
        "username": "Ivanov_II",
        "full_name": "Иванов Иван Иванович",
        "email": "Ivanov@corp.local",
        "mailbox_email": None,
        "auth_source": "ldap",
    }
    base.update(overrides)
    return base


@pytest.fixture
def portal_user(monkeypatch):
    holder = {"user": _user()}
    monkeypatch.setattr(user_service_module.user_service, "get_by_id", lambda uid: dict(holder["user"]))
    return holder


def _owner_lookup(monkeypatch, *, email=(), name=()):
    calls = []

    def fake(*, email=None, display_name=None, db_id=None, limit=3):
        calls.append({"email": email, "display_name": display_name, "db_id": db_id})
        return {"email": list(email_result) if email else [], "name": list(name_result) if display_name else []}

    email_result, name_result = email, name
    monkeypatch.setattr(queries, "find_owner_nos_by_identity", fake)
    return calls


# ---------- identity ----------


def test_identity_matches_owner_by_exact_email(monkeypatch, portal_user):
    calls = _owner_lookup(monkeypatch, email=[101])
    identity = self_identity.resolve_self_identity(_ctx())
    assert identity.owner_no == 101
    assert identity.owner_match == "email"
    assert identity.ad_login == "ivanov_ii"
    assert calls[0]["email"] == "ivanov@corp.local"
    assert calls[0]["db_id"] == "ITINVENT"


def test_identity_ambiguous_email_is_not_resolved(monkeypatch, portal_user):
    _owner_lookup(monkeypatch, email=[101, 102], name=[101])
    identity = self_identity.resolve_self_identity(_ctx())
    assert identity.owner_no is None
    assert identity.owner_match == "ambiguous"


def test_identity_falls_back_to_unique_exact_name(monkeypatch, portal_user):
    _owner_lookup(monkeypatch, email=[], name=[205])
    identity = self_identity.resolve_self_identity(_ctx())
    assert (identity.owner_no, identity.owner_match) == (205, "name")


def test_identity_namesakes_are_not_resolved(monkeypatch, portal_user):
    _owner_lookup(monkeypatch, email=[], name=[205, 206])
    identity = self_identity.resolve_self_identity(_ctx())
    assert identity.owner_no is None
    assert identity.owner_match == "ambiguous"


def test_identity_local_account_has_no_ad_login(monkeypatch, portal_user):
    portal_user["user"] = _user(auth_source="local")
    _owner_lookup(monkeypatch)
    assert self_identity.resolve_self_identity(_ctx()).ad_login is None


@pytest.mark.parametrize("raw", ["CORP\\Ivanov_II", "ivanov_ii@corp.local", " IVANOV_II "])
def test_normalize_login(raw):
    assert self_identity.normalize_login(raw) == "ivanov_ii"


# ---------- me.equipment ----------


def test_me_equipment_uses_only_resolved_owner(monkeypatch, portal_user):
    _owner_lookup(monkeypatch, email=[101])
    seen = []
    monkeypatch.setattr(
        queries,
        "get_equipment_by_owner",
        lambda owner_no, db_id: seen.append((owner_no, db_id)) or [{"inv_no": "100234", "model_name": "ThinkPad"}],
    )
    result = self_service.MyEquipmentTool().execute(context=_ctx(), args=self_service._NoArgs())
    assert result.ok is True
    assert seen == [(101, "ITINVENT")]
    assert result.data["items"][0]["inv_no"] == "100234"


def test_me_equipment_refuses_when_owner_unresolved(monkeypatch, portal_user):
    _owner_lookup(monkeypatch, email=[], name=[1, 2])
    monkeypatch.setattr(queries, "get_equipment_by_owner", lambda *a, **k: pytest.fail("must not query"))
    result = self_service.MyEquipmentTool().execute(context=_ctx(), args=self_service._NoArgs())
    assert result.ok is False
    assert "однозначно" in result.error


def test_me_tools_take_no_identity_arguments():
    for tool_id in ("me.equipment", "me.computer.health", "me.account.status"):
        tool = importlib.import_module("backend.ai_chat.tools").ai_tool_registry.get(tool_id)
        assert tool.input_model.model_fields == {}


# ---------- me.computer.health ----------


def _host(mac, *, user_login, profiles=(), stores=(), pending=False):
    return {
        "mac_address": mac,
        "hostname": f"WS-{mac[-2:]}",
        "ip_primary": "10.0.0.5",
        "last_seen_at": int(time.time()),
        "user_login": user_login,
        "current_user": user_login,
        "uptime_seconds": 23 * 86400,
        "ram_used_percent": 93.5,
        "ops_health": {"pending_reboot": pending, "pending_reboot_reasons": ["windows_update"] if pending else [], "low_disk": False},
        "outlook": {"active_stores": list(stores), "archives": [], "total_outlook_size_bytes": 5 * 1024 ** 3},
        "user_profile_sizes": {"profiles": list(profiles), "profiles_count": len(profiles), "total_size_bytes": 1},
    }


def _patch_inventory(monkeypatch, hosts: dict[str, dict], user_keys: set[str]):
    store = SimpleNamespace(search_host_keys=lambda query, fields, **kw: set(user_keys))
    monkeypatch.setattr(inventory_api, "_get_inventory_app_store", lambda: store)
    monkeypatch.setattr(inventory_api, "_get_inventory_host", lambda mac: hosts.get(inventory_api._normalize_mac(mac)))


def test_me_computer_health_keeps_only_own_hosts_and_data(monkeypatch, portal_user):
    _owner_lookup(monkeypatch, email=[101])
    monkeypatch.setattr(queries, "get_equipment_by_owner", lambda owner_no, db_id: [{"mac_address": "AA:00:00:00:00:02"}])
    own = _host(
        "AA0000000001",
        user_login="CORP\\ivanov_ii",
        pending=True,
        profiles=[
            {"user_name": "ivanov_ii", "profile_path": "C:\\Users\\ivanov_ii", "total_size_bytes": 2 * 1024 ** 3},
            {"user_name": "petrov_pp", "profile_path": "C:\\Users\\petrov_pp", "total_size_bytes": 9 * 1024 ** 3},
        ],
        stores=[
            {"path": "C:\\Users\\ivanov_ii\\Documents\\mail.pst", "size_bytes": 3 * 1024 ** 3},
            {"path": "C:\\Users\\petrov_pp\\Documents\\boss.pst", "size_bytes": 1024 ** 3},
        ],
    )
    owned_equipment = _host("AA0000000002", user_login="sidorov_ss")
    foreign = _host("AA0000000003", user_login="ivanov_iii")  # LIKE-match of the login, not the same person
    hosts = {"AA0000000001": own, "AA0000000002": owned_equipment, "AA0000000003": foreign}
    _patch_inventory(monkeypatch, hosts, {"AA0000000001", "AA0000000003"})

    result = self_service.MyComputerHealthTool().execute(context=_ctx(), args=self_service._NoArgs())

    assert result.ok is True
    by_host = {item["hostname"]: item for item in result.data["items"]}
    assert set(by_host) == {"WS-01", "WS-02"}
    mine = by_host["WS-01"]
    assert mine["health"]["pending_reboot"] is True
    assert mine["health"]["uptime_days"] == 23.0
    assert [store["path"] for store in mine["outlook"]["stores"]] == ["C:\\Users\\ivanov_ii\\Documents\\mail.pst"]
    assert [item["user_name"] for item in mine["profiles"]["items"]] == ["ivanov_ii"]
    # Someone else logged in on the employee's own equipment is not disclosed.
    assert by_host["WS-02"]["user_login"] is None
    assert by_host["WS-02"]["current_user"] is None


def test_me_computer_health_reports_missing_agent(monkeypatch, portal_user):
    _owner_lookup(monkeypatch, email=[101])
    monkeypatch.setattr(queries, "get_equipment_by_owner", lambda owner_no, db_id: [])
    _patch_inventory(monkeypatch, {}, set())
    result = self_service.MyComputerHealthTool().execute(context=_ctx(), args=self_service._NoArgs())
    assert result.ok is False
    assert "не нашёл" in result.error


# ---------- me.account.status ----------


def _patch_ad(monkeypatch, *, password, lockout):
    ad = importlib.import_module("backend.services.ad_users_service")
    calls = []
    monkeypatch.setattr(ad, "lookup_ad_user_password_status", lambda query, limit=5: calls.append(query) or password)
    monkeypatch.setattr(ad, "get_ad_user_lockout_status", lambda query: calls.append(query) or lockout)
    return calls


def test_me_account_status_returns_own_password_and_lockout(monkeypatch, portal_user):
    _owner_lookup(monkeypatch)
    calls = _patch_ad(
        monkeypatch,
        password={"status": "matched", "policy_days": 90, "user": {"login": "Ivanov_II", "display_name": "Иванов", "days_to_expire": 3, "expired": False}},
        lockout={"status": "ok", "login": "ivanov_ii", "is_locked": True, "bad_password_count": 5},
    )
    result = self_service.MyAccountStatusTool().execute(context=_ctx(), args=self_service._NoArgs())
    assert result.ok is True
    assert calls == ["ivanov_ii", "ivanov_ii"]
    assert result.data["password"]["days_to_expire"] == 3
    assert result.data["lockout"]["is_locked"] is True


def test_me_account_status_rejects_namesake_from_fuzzy_search(monkeypatch, portal_user):
    _owner_lookup(monkeypatch)
    _patch_ad(
        monkeypatch,
        password={"status": "matched", "user": {"login": "ivanov_ia", "days_to_expire": 40}},
        lockout={"status": "ok", "login": "ivanov_ia", "is_locked": False},
    )
    result = self_service.MyAccountStatusTool().execute(context=_ctx(), args=self_service._NoArgs())
    assert result.ok is False


def test_me_account_status_needs_ad_account(monkeypatch, portal_user):
    portal_user["user"] = _user(auth_source="local")
    _owner_lookup(monkeypatch)
    _patch_ad(monkeypatch, password={}, lockout={})
    result = self_service.MyAccountStatusTool().execute(context=_ctx(), args=self_service._NoArgs())
    assert result.ok is False
    assert "Active Directory" in result.error


# ---------- helpdesk.request_draft ----------


def _helpdesk_args(**overrides):
    payload = {"title": "Не печатает принтер", "description": "Принтер в 214 пишет «замятие»", "category": "printer"}
    payload.update(overrides)
    return self_service.HelpdeskRequestDraftArgs(**payload)


def test_helpdesk_draft_requires_configuration(monkeypatch, portal_user):
    # No Hub-task settings and no mail address: nothing to send to.
    monkeypatch.delenv("AI_HELPDESK_PROJECT_ID", raising=False)
    monkeypatch.delenv("AI_HELPDESK_ASSIGNEE_USER_ID", raising=False)
    monkeypatch.delenv("AI_HELPDESK_EMAIL", raising=False)
    monkeypatch.setattr(self_service, "DEFAULT_HELPDESK_EMAIL", "")
    result = self_service.HelpdeskRequestDraftTool().execute(context=_ctx(), args=_helpdesk_args())
    assert result.ok is False
    assert "не настроен" in result.error


def test_helpdesk_draft_without_hub_task_settings_prepares_mail_to_it(monkeypatch, portal_user):
    monkeypatch.delenv("AI_HELPDESK_PROJECT_ID", raising=False)
    monkeypatch.delenv("AI_HELPDESK_ASSIGNEE_USER_ID", raising=False)
    monkeypatch.delenv("AI_HELPDESK_EMAIL", raising=False)
    _owner_lookup(monkeypatch, email=[101])
    monkeypatch.setattr(queries, "get_equipment_by_owner", lambda owner_no, db_id: [])
    _patch_inventory(monkeypatch, {"AA0000000001": _host("AA0000000001", user_login="ivanov_ii")}, {"AA0000000001"})
    captured = {}
    monkeypatch.setattr(
        action_cards,
        "build_office_mail_draft",
        lambda **kw: captured.update(kw) or {"id": "card-mail", "action_type": "office.mail.send"},
    )
    result = self_service.HelpdeskRequestDraftTool().execute(context=_ctx(), args=_helpdesk_args())
    assert result.ok is True
    assert captured["action_type"] == "office.mail.send"
    assert captured["payload"]["to"] == ["it@zsgp.ru"]
    assert captured["payload"]["subject"] == "Заявка в IT: Не печатает принтер"
    assert "замятие" in captured["payload"]["body"] and "WS-01" in captured["payload"]["body"]


def test_helpdesk_draft_asks_for_details_when_description_is_too_short(monkeypatch, portal_user):
    result = self_service.HelpdeskRequestDraftTool().execute(
        context=_ctx(), args=_helpdesk_args(title="Проблема", description="не работает")
    )
    assert result.ok is False
    assert "подробнее" in result.error


def test_helpdesk_draft_builds_card_with_own_computer(monkeypatch, portal_user):
    monkeypatch.setenv("AI_HELPDESK_PROJECT_ID", "proj-it")
    monkeypatch.setenv("AI_HELPDESK_ASSIGNEE_USER_ID", "42")
    monkeypatch.delenv("AI_HELPDESK_EMAIL", raising=False)
    _owner_lookup(monkeypatch, email=[101])
    monkeypatch.setattr(queries, "get_equipment_by_owner", lambda owner_no, db_id: [])
    _patch_inventory(monkeypatch, {"AA0000000001": _host("AA0000000001", user_login="ivanov_ii", pending=True)}, {"AA0000000001"})
    captured = {}
    monkeypatch.setattr(
        action_cards,
        "build_helpdesk_request_draft",
        lambda **kw: captured.update(kw) or {"id": "card-1", "action_type": "helpdesk.request.create"},
    )
    result = self_service.HelpdeskRequestDraftTool().execute(context=_ctx(), args=_helpdesk_args(urgent=True))
    assert result.ok is True
    payload = captured["payload"]
    assert captured["requester_user_id"] == 7
    assert payload["priority"] == "high"
    assert payload["category_label"] == "Принтер / МФУ"
    assert payload["requester_login"] == "ivanov_ii"
    assert "WS-01" in payload["computers"][0] and "ждёт перезагрузки" in payload["computers"][0]


def test_helpdesk_execute_creates_task_from_server_settings(monkeypatch):
    monkeypatch.setenv("AI_HELPDESK_PROJECT_ID", "proj-it")
    monkeypatch.setenv("AI_HELPDESK_ASSIGNEE_USER_ID", "42")
    monkeypatch.setenv("AI_HELPDESK_CONTROLLER_USER_ID", "43")
    created = {}
    monkeypatch.setattr(action_cards.hub_service, "create_task", lambda **kw: created.update(kw) or {"id": "task-9"})
    requester = {"id": 7, "role": "viewer", "username": "ivanov_ii", "use_custom_permissions": True, "custom_permissions": ["chat.ai.use"]}
    result = action_cards._execute_helpdesk_request_create(
        payload={
            "title": "Не печатает принтер",
            "description": "Замятие",
            "category_label": "Принтер / МФУ",
            "priority": "high",
            "requester_name": "Иванов Иван",
            "requester_login": "ivanov_ii",
            "computers": ["WS-01, IP 10.0.0.5"],
            # A forged project in the payload must be ignored.
            "project_id": "proj-finance",
        },
        current_user=requester,
    )
    assert result["task_id"] == "task-9"
    assert created["project_id"] == "proj-it"
    assert created["assignee_user_id"] == 42
    assert created["controller_user_id"] == 43
    assert created["priority"] == "high"
    assert created["title"] == "[IT] Не печатает принтер"
    assert created["actor"]["id"] == 7
    assert "Компьютер: WS-01, IP 10.0.0.5" in created["description"]


def test_helpdesk_execute_requires_assistant_permission(monkeypatch):
    monkeypatch.setenv("AI_HELPDESK_PROJECT_ID", "proj-it")
    monkeypatch.setenv("AI_HELPDESK_ASSIGNEE_USER_ID", "42")
    monkeypatch.setattr(action_cards.hub_service, "create_task", lambda **kw: pytest.fail("must not create"))
    # Every built-in role carries chat.ai.use, so simulate an account without it.
    checked = []
    monkeypatch.setattr(
        action_cards.authorization_service,
        "has_permission",
        lambda role, permission, **kw: checked.append(permission) or False,
    )
    with pytest.raises(PermissionError):
        action_cards._execute_helpdesk_request_create(
            payload={"title": "Тест заявки"},
            current_user={"id": 7, "role": "viewer"},
        )
    assert checked == ["chat.ai.use"]


# ---------- itinvent.computers.* ----------


def test_computers_search_maps_field_and_returns_views(monkeypatch):
    captured = {}

    def fake_payload(**kwargs):
        captured.update(kwargs)
        return {"total": 1, "items": [{"mac_address": "AA0000000001", "hostname": "WS-01"}]}

    monkeypatch.setattr(inventory_api, "_build_computers_search_payload", fake_payload)
    _patch_inventory(
        monkeypatch,
        {"AA0000000001": _host("AA0000000001", user_login="kozlovskii.me", stores=[{"path": "D:\\pst\\kozlovskii.me.pst", "size_bytes": 1}])},
        set(),
    )
    result = computers.ComputersSearchTool().execute(
        context=_ctx(custom=["computers.read"]),
        args=computers.ComputersSearchArgs(query="kozlovskii.me", field="outlook"),
    )
    assert result.ok is True
    assert captured["search_fields"] == "outlook"
    assert captured["scope"] == "selected"
    assert captured["db_id_selected"] == "ITINVENT"
    item = result.data["items"][0]
    assert item["outlook"]["stores"][0]["path"] == "D:\\pst\\kozlovskii.me.pst"


def test_computers_get_rejects_mac_not_visible_to_employee(monkeypatch):
    monkeypatch.setattr(inventory_api, "_build_computers_search_payload", lambda **kw: {"total": 0, "items": []})
    _patch_inventory(monkeypatch, {"AA0000000001": _host("AA0000000001", user_login="x")}, set())
    result = computers.ComputersGetTool().execute(
        context=_ctx(custom=["computers.read"]),
        args=computers.ComputersGetArgs(mac_address="aa:00:00:00:00:01"),
    )
    assert result.ok is False


def test_computers_get_by_exact_hostname(monkeypatch):
    monkeypatch.setattr(
        inventory_api,
        "_build_computers_search_payload",
        lambda **kw: {"total": 2, "items": [{"mac_address": "AA0000000001", "hostname": "WS-01"}, {"mac_address": "AA0000000011", "hostname": "WS-011"}]},
    )
    _patch_inventory(monkeypatch, {"AA0000000001": _host("AA0000000001", user_login="x", pending=True)}, set())
    result = computers.ComputersGetTool().execute(
        context=_ctx(custom=["computers.read"]),
        args=computers.ComputersGetArgs(hostname="ws-01"),
    )
    assert result.ok is True
    assert result.data["hostname"] == "WS-01"
    assert result.data["health"]["pending_reboot_reasons"] == ["windows_update"]


# ---------- permissions, routing ----------


def test_self_tools_need_only_assistant_permission_and_computers_need_computers_read():
    employee = {"role": "viewer", "use_custom_permissions": True, "custom_permissions": ["chat.ai.use"]}
    allowed = permissions_module.filter_tools_for_user(
        ["me.equipment", "me.computer.health", "me.account.status", "helpdesk.request_draft", "itinvent.computers.search"],
        employee,
    )
    assert allowed == ["me.equipment", "me.computer.health", "me.account.status", "helpdesk.request_draft"]
    it_staff = {"role": "viewer", "use_custom_permissions": True, "custom_permissions": ["chat.ai.use", "computers.read"]}
    assert permissions_module.user_can_use_tool("itinvent.computers.get", it_staff) is True


def test_self_group_has_jev_question_and_rules():
    spec = service_module._JEV_GROUP_QUESTIONS["self"]
    assert spec["true_label"] and spec["false_label"]
    assert "ДРУГОГО" in spec["false_label"]
    assert service_module._AI_TOOL_GROUP_ROUTING_GUIDES["self"] == service_module.AI_SELF_TOOL_ROUTING_GUIDE


def test_prompt_no_longer_references_removed_computer_tools():
    assert "outlook_search" not in service_module.AI_ITINVENT_TOOL_ROUTING_GUIDE
    assert "profile_search" not in service_module.AI_ITINVENT_TOOL_ROUTING_GUIDE
    assert "itinvent.computers.search" in service_module.AI_ITINVENT_TOOL_ROUTING_GUIDE


def test_chat_message_send_card_executes(monkeypatch):
    """Regression: PERM_CHAT_WRITE was not imported, so every confirmed chat message failed."""
    chat_service = importlib.import_module("backend.chat.service").chat_service
    sent = []
    monkeypatch.setattr(chat_service, "send_message", lambda **kw: sent.append(kw) or {"id": "msg-1"})
    result = action_cards._execute_chat_message_send(
        payload={"text": "Привет, принтер починили", "conversation_id": "conv-7"},
        current_user={"id": 7, "role": "viewer", "use_custom_permissions": True, "custom_permissions": ["chat.write"]},
    )
    assert result["success"] is True
    assert sent == [{"current_user_id": 7, "conversation_id": "conv-7", "body": "Привет, принтер починили"}]
