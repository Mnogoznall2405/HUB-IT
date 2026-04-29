from __future__ import annotations

import io
import importlib
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi import UploadFile
from fastapi.testclient import TestClient
from sqlalchemy import select


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))


def _make_user(*, permissions: list[str], role: str = "viewer"):
    from backend.models.auth import User

    return User(
        id=99,
        username="operator_user",
        email=None,
        full_name="Operator User",
        role=role,
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
    )


def _sqlite_url(tmp_path: Path, name: str) -> str:
    return f"sqlite:///{(tmp_path / name).as_posix()}"


async def _noop_publish(*args, **kwargs):
    return None


def _build_conversation_event_collector(target: list[dict]):
    async def _collector(*args, **kwargs):
        target.append(
            {
                "args": args,
                "kwargs": kwargs,
            }
        )
        return None

    return _collector


def _configure_local_backend_runtime(tmp_path: Path, monkeypatch, name: str = "ai_chat_runtime.db") -> str:
    database_url = _sqlite_url(tmp_path, name)
    monkeypatch.setenv("APP_DATABASE_URL", database_url)
    monkeypatch.setenv("CHAT_DATABASE_URL", database_url)
    monkeypatch.setenv("CHAT_ENABLED", "1")

    backend_config = importlib.import_module("backend.config")
    appdb_db = importlib.import_module("backend.appdb.db")
    chat_db = importlib.import_module("backend.chat.db")

    monkeypatch.setattr(backend_config.config.app_db, "database_url", database_url, raising=False)
    monkeypatch.setattr(backend_config.config.chat, "database_url", database_url, raising=False)
    monkeypatch.setattr(backend_config.config.chat, "enabled", True, raising=False)
    monkeypatch.setattr(appdb_db.config.app_db, "database_url", database_url, raising=False)
    monkeypatch.setattr(chat_db.config.app_db, "database_url", database_url, raising=False)
    monkeypatch.setattr(chat_db.config.chat, "database_url", database_url, raising=False)
    monkeypatch.setattr(chat_db.config.chat, "enabled", True, raising=False)

    appdb_db._engines.clear()
    appdb_db._session_factories.clear()
    appdb_db._initialized_schema_urls.clear()
    chat_db._engines.clear()
    chat_db._session_factories.clear()
    chat_db._engine = None
    chat_db._session_factory = None
    return database_url


def _make_tool_execution_context(*, enabled_tools: list[str], database_id: str = "ITINVENT"):
    tools_context_module = importlib.import_module("backend.ai_chat.tools.context")

    return tools_context_module.AiToolExecutionContext(
        bot_id="bot-test",
        bot_title="AI Ассистент",
        conversation_id="ai-conv-test",
        run_id="run-test",
        user_id=5,
        user_payload={"id": 5, "role": "viewer", "username": "operator"},
        effective_database_id=database_id,
        enabled_tools=enabled_tools,
        tool_settings={
            "multi_db_mode": "single",
            "allowed_databases": [],
        },
    )


def test_chat_ai_routes_require_chat_ai_use_permission(tmp_path, monkeypatch):
    _configure_local_backend_runtime(tmp_path, monkeypatch, "ai_chat_routes.db")
    deps = importlib.import_module("backend.api.deps")
    chat_api = importlib.import_module("backend.api.v1.chat")
    ai_chat_module = importlib.import_module("backend.ai_chat.service")

    app = FastAPI()
    app.include_router(chat_api.router, prefix="/chat")
    app.dependency_overrides[deps.get_current_active_user] = lambda: _make_user(permissions=["chat.ai.use"])
    monkeypatch.setattr(
        ai_chat_module.ai_chat_service,
        "list_bots",
        lambda **kwargs: {
            "items": [{
                "id": "bot-1",
                "slug": "corp-assistant",
                "title": "Corp Assistant",
                "description": "KB bot",
                "conversation_id": "ai-conv-1",
                "model": "",
                "allow_file_input": True,
                "allow_generated_artifacts": True,
                "is_enabled": True,
                "configured": True,
                "bot_user_id": 77,
            }],
            "configured": True,
            "default_model": "",
        },
    )

    response = TestClient(app).get("/chat/ai/bots")

    assert response.status_code == 200
    assert response.json()["items"][0]["slug"] == "corp-assistant"
    assert response.json()["items"][0]["conversation_id"] == "ai-conv-1"

    app.dependency_overrides[deps.get_current_active_user] = lambda: _make_user(permissions=["chat.read"])
    forbidden = TestClient(app).get("/chat/ai/bots")
    assert forbidden.status_code == 403


def test_ai_bot_admin_routes_require_settings_ai_manage(tmp_path, monkeypatch):
    _configure_local_backend_runtime(tmp_path, monkeypatch, "ai_bot_admin_routes.db")
    deps = importlib.import_module("backend.api.deps")
    ai_bots_api = importlib.import_module("backend.api.v1.ai_bots")
    ai_chat_module = importlib.import_module("backend.ai_chat.service")

    app = FastAPI()
    app.include_router(ai_bots_api.router, prefix="/ai-bots")
    app.dependency_overrides[deps.get_current_active_user] = lambda: _make_user(permissions=["settings.ai.manage"])
    monkeypatch.setattr(
        ai_chat_module.ai_chat_service,
        "list_admin_bots",
        lambda: [{
            "id": "bot-1",
            "slug": "corp-assistant",
            "title": "Corp Assistant",
            "description": "KB bot",
            "model": "",
            "allow_file_input": True,
            "allow_generated_artifacts": True,
            "is_enabled": True,
            "configured": True,
            "bot_user_id": 77,
            "system_prompt": "Prompt",
            "temperature": 0.2,
            "max_tokens": 2000,
            "allowed_kb_scope": [],
            "openrouter_configured": True,
            "updated_at": "2026-04-21T00:00:00+00:00",
            "latest_run_status": None,
            "latest_run_error": None,
        }],
    )

    response = TestClient(app).get("/ai-bots")

    assert response.status_code == 200
    assert response.json()[0]["title"] == "Corp Assistant"

    app.dependency_overrides[deps.get_current_active_user] = lambda: _make_user(permissions=["settings.read"])
    forbidden = TestClient(app).get("/ai-bots")
    assert forbidden.status_code == 403


def test_ai_bot_admin_routes_allow_admin_role_without_explicit_custom_permission(tmp_path, monkeypatch):
    _configure_local_backend_runtime(tmp_path, monkeypatch, "ai_bot_admin_routes_admin_override.db")
    deps = importlib.import_module("backend.api.deps")
    ai_bots_api = importlib.import_module("backend.api.v1.ai_bots")
    ai_chat_module = importlib.import_module("backend.ai_chat.service")

    app = FastAPI()
    app.include_router(ai_bots_api.router, prefix="/ai-bots")
    app.dependency_overrides[deps.get_current_active_user] = lambda: _make_user(
        permissions=["settings.read"],
        role="admin",
    )
    monkeypatch.setattr(
        ai_chat_module.ai_chat_service,
        "list_admin_bots",
        lambda: [{
            "id": "bot-1",
            "slug": "corp-assistant",
            "title": "Corp Assistant",
            "description": "KB bot",
            "model": "",
            "allow_file_input": True,
            "allow_generated_artifacts": True,
            "is_enabled": True,
            "configured": True,
            "bot_user_id": 77,
            "system_prompt": "Prompt",
            "temperature": 0.2,
            "max_tokens": 2000,
            "allowed_kb_scope": [],
            "openrouter_configured": True,
            "updated_at": "2026-04-21T00:00:00+00:00",
            "latest_run_status": None,
            "latest_run_error": None,
        }],
    )

    response = TestClient(app).get("/ai-bots")

    assert response.status_code == 200
    assert response.json()[0]["slug"] == "corp-assistant"


def test_ai_bot_admin_patch_persists_tools_and_settings(tmp_path, monkeypatch):
    database_url = _configure_local_backend_runtime(tmp_path, monkeypatch, "ai_bot_admin_patch_persist.db")
    deps = importlib.import_module("backend.api.deps")
    ai_bots_api = importlib.import_module("backend.api.v1.ai_bots")
    ai_chat_module = importlib.import_module("backend.ai_chat.service")
    user_service_module = importlib.import_module("backend.services.user_service")

    temp_user_service = user_service_module.UserService(database_url=database_url)
    monkeypatch.setattr(ai_chat_module, "user_service", temp_user_service)
    monkeypatch.setattr(
        ai_chat_module.openrouter_client,
        "get_status",
        lambda: {"configured": True, "default_model": "openai/gpt-4o-mini"},
    )

    app = FastAPI()
    app.include_router(ai_bots_api.router, prefix="/ai-bots")
    app.dependency_overrides[deps.get_current_active_user] = lambda: _make_user(permissions=["settings.ai.manage"])
    client = TestClient(app)

    listed = client.get("/ai-bots")
    assert listed.status_code == 200
    assert listed.json()

    bot = listed.json()[0]
    payload = {
        "enabled_tools": [
            "itinvent.database.current",
            "itinvent.equipment.search",
        ],
        "tool_settings": {
            "multi_db_mode": "single",
            "allowed_databases": [],
        },
    }

    patched = client.patch(f"/ai-bots/{bot['id']}", json=payload)

    assert patched.status_code == 200
    assert patched.json()["enabled_tools"] == payload["enabled_tools"]
    assert patched.json()["tool_settings"] == payload["tool_settings"]
    assert patched.json()["live_data_enabled"] is True

    reread = client.get("/ai-bots")

    assert reread.status_code == 200
    reread_bot = next(item for item in reread.json() if item["id"] == bot["id"])
    assert reread_bot["enabled_tools"] == payload["enabled_tools"]
    assert reread_bot["tool_settings"] == payload["tool_settings"]
    assert reread_bot["live_data_enabled"] is True


def test_default_bot_backfill_seeds_live_tools_only_once(tmp_path, monkeypatch):
    database_url = _configure_local_backend_runtime(tmp_path, monkeypatch, "ai_default_bot_backfill.db")

    ai_chat_module = importlib.import_module("backend.ai_chat.service")
    tools_context_module = importlib.import_module("backend.ai_chat.tools.context")
    appdb_db = importlib.import_module("backend.appdb.db")
    app_models = importlib.import_module("backend.appdb.models")
    user_service_module = importlib.import_module("backend.services.user_service")

    temp_user_service = user_service_module.UserService(database_url=database_url)
    temp_ai_service = ai_chat_module.AiChatService()

    monkeypatch.setattr(ai_chat_module, "user_service", temp_user_service)
    monkeypatch.setattr(
        ai_chat_module.openrouter_client,
        "get_status",
        lambda: {"configured": True, "default_model": "openai/gpt-4o-mini"},
    )

    appdb_db.initialize_app_schema(database_url)
    with appdb_db.app_session(database_url) as session:
        session.add(
            app_models.AppAiBot(
                id="legacy-default-bot",
                slug=ai_chat_module.DEFAULT_BOT_SLUG,
                title=ai_chat_module.DEFAULT_BOT_TITLE,
                description=ai_chat_module.DEFAULT_BOT_DESCRIPTION,
                system_prompt=ai_chat_module.DEFAULT_BOT_PROMPT,
                model=ai_chat_module.DEFAULT_BOT_MODEL,
                temperature=0.2,
                max_tokens=2000,
                allowed_kb_scope_json="[]",
                enabled_tools_json="[]",
                tool_settings_json=json.dumps({
                    "multi_db_mode": "single",
                    "allowed_databases": [],
                }),
                allow_file_input=True,
                allow_generated_artifacts=True,
                allow_kb_document_delivery=False,
                is_enabled=True,
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )
        )

    backfilled = temp_ai_service.list_admin_bots()[0]

    assert backfilled["slug"] == ai_chat_module.DEFAULT_BOT_SLUG
    assert backfilled["enabled_tools"] == tools_context_module.DEFAULT_ITINVENT_TOOL_IDS
    assert backfilled["live_data_enabled"] is True

    temp_ai_service.update_bot(backfilled["id"], {
        "enabled_tools": [],
        "tool_settings": {
            "multi_db_mode": "single",
            "allowed_databases": [],
        },
    })
    temp_ai_service.ensure_default_bot()

    persisted = temp_ai_service.list_admin_bots()[0]

    assert persisted["enabled_tools"] == []
    assert persisted["live_data_enabled"] is False


def test_itinvent_equipment_search_tool_preserves_extended_payload_fields(monkeypatch):
    tools_module = importlib.import_module("backend.ai_chat.tools.itinvent")

    monkeypatch.setattr(
        "backend.ai_chat.tools.itinvent.queries.search_equipment_by_serial",
        lambda search_term, db_id=None: [
            {
                "INV_NO": "100665.0",
                "SERIAL_NO": "PC25J7G6",
                "HW_SERIAL_NO": "HW-25",
                "TYPE_NAME": "Ноутбук",
                "MODEL_NAME": "Dell Latitude 5430",
                "VENDOR_NAME": "Dell",
                "STATUS_NAME": "В эксплуатации",
                "EMPLOYEE_NAME": "Козловский Максим",
                "EMPLOYEE_EMAIL": "kozlovskiy@example.com",
                "EMPLOYEE_DEPT": "ИТ отдел",
                "BRANCH_NAME": "Тюмень",
                "LOCATION_NAME": "Первомайская 19",
                "IP_ADDRESS": "10.10.10.15",
                "MAC_ADDRESS": "AA-BB-CC-DD-EE-FF",
                "NETBIOS_NAME": "TYM-LT-15",
                "DOMAIN_NAME": "corp.local",
                "DESCR": "Основной ноутбук",
                "PART_NO": "DL-5430",
                "QTY": 1,
            }
        ],
    )

    result = tools_module.EquipmentSearchTool().execute(
        context=_make_tool_execution_context(enabled_tools=["itinvent.equipment.search"]),
        args=tools_module.EquipmentSearchArgs(query="100665"),
    )
    item = result.to_payload()["data"]["items"][0]

    assert item["type_name"] == "Ноутбук"
    assert item["model_name"] == "Dell Latitude 5430"
    assert item["vendor_name"] == "Dell"
    assert item["employee_name"] == "Козловский Максим"
    assert item["employee_email"] == "kozlovskiy@example.com"
    assert item["status"] == "В эксплуатации"
    assert item["ip_address"] == "10.10.10.15"
    assert item["mac_address"] == "AA-BB-CC-DD-EE-FF"
    assert item["domain_name"] == "corp.local"
    assert item["description"] == "Основной ноутбук"
    assert item["qty"] == 1


def test_itinvent_employee_search_tool_includes_equipment_count(monkeypatch):
    tools_module = importlib.import_module("backend.ai_chat.tools.itinvent")

    monkeypatch.setattr(
        "backend.ai_chat.tools.itinvent.queries.search_employees",
        lambda search_term, page=1, limit=50, db_id=None: {
            "employees": [
                {
                    "OWNER_NO": 501,
                    "OWNER_DISPLAY_NAME": "Козловский Максим",
                    "OWNER_DEPT": "ИТ отдел",
                    "EQUIPMENT_COUNT": 5,
                }
            ],
            "total": 1,
            "page": page,
            "limit": limit,
            "pages": 1,
        },
    )

    result = tools_module.EmployeeSearchTool().execute(
        context=_make_tool_execution_context(enabled_tools=["itinvent.employee.search"]),
        args=tools_module.EmployeeSearchArgs(query="Козловский Максим"),
    )
    item = result.to_payload()["data"]["items"][0]

    assert item["full_name"] == "Козловский Максим"
    assert item["department"] == "ИТ отдел"
    assert item["equipment_count"] == 5


def test_itinvent_consumables_search_tool_serializes_qty_and_location(monkeypatch):
    tools_module = importlib.import_module("backend.ai_chat.tools.itinvent")

    monkeypatch.setattr(
        "backend.ai_chat.tools.itinvent.queries.get_consumables_lookup",
        lambda **kwargs: [
            {
                "ID": 77,
                "INV_NO": "C-100",
                "TYPE_NO": 4,
                "MODEL_NO": 33,
                "QTY": 12,
                "TYPE_NAME": "Картридж",
                "MODEL_NAME": "HP 85A",
                "DESCRIPTION": "Тонер-картридж",
                "BRANCH_NO": 1,
                "BRANCH_NAME": "Тюмень",
                "LOC_NO": 2,
                "LOCATION_NAME": "Склад",
            }
        ],
    )

    result = tools_module.ConsumablesSearchTool().execute(
        context=_make_tool_execution_context(enabled_tools=["itinvent.consumables.search"]),
        args=tools_module.ConsumablesSearchArgs(query="тонер"),
    )
    item = result.to_payload()["data"]["items"][0]

    assert item["type_name"] == "Картридж"
    assert item["model_name"] == "HP 85A"
    assert item["qty"] == 12
    assert item["branch"] == "Тюмень"
    assert item["location"] == "Склад"


def test_itinvent_list_tools_return_more_than_five_and_mark_truncation(monkeypatch):
    tools_module = importlib.import_module("backend.ai_chat.tools.itinvent")
    context = _make_tool_execution_context(enabled_tools=["itinvent.equipment.search"])

    monkeypatch.setattr(
        "backend.ai_chat.tools.itinvent.queries.search_equipment_by_serial",
        lambda search_term, db_id=None: [{"INV_NO": str(index), "MODEL_NAME": f"Device {index}"} for index in range(6)],
    )

    result = tools_module.EquipmentSearchTool().execute(
        context=context,
        args=tools_module.EquipmentSearchArgs(query="Device"),
    ).to_payload()["data"]

    assert result["count"] == 6
    assert result["returned_count"] == 6
    assert result["total"] == 6
    assert result["limit"] == 250
    assert result["truncated"] is False
    assert len(result["items"]) == 6

    monkeypatch.setattr(
        "backend.ai_chat.tools.itinvent.queries.search_equipment_by_serial",
        lambda search_term, db_id=None: [{"INV_NO": str(index), "MODEL_NAME": f"Device {index}"} for index in range(251)],
    )

    truncated = tools_module.EquipmentSearchTool().execute(
        context=context,
        args=tools_module.EquipmentSearchArgs(query="Device"),
    ).to_payload()["data"]

    assert truncated["count"] == 250
    assert truncated["returned_count"] == 250
    assert truncated["total"] == 251
    assert truncated["limit"] == 250
    assert truncated["truncated"] is True
    assert len(truncated["items"]) == 250


def test_itinvent_analytics_summary_groups_equipment_and_consumable_qty(monkeypatch):
    tools_module = importlib.import_module("backend.ai_chat.tools.itinvent")
    context = _make_tool_execution_context(enabled_tools=["itinvent.analytics.summary"])

    monkeypatch.setattr(
        "backend.ai_chat.tools.itinvent.equipment_db.get_all_equipment_flat",
        lambda db_id=None, limit=10000: [
            {"INV_NO": "1", "BRANCH_NAME": "Tyumen", "TYPE_NAME": "Notebook", "STATUS_NAME": "Active"},
            {"INV_NO": "2", "BRANCH_NAME": "Tyumen", "TYPE_NAME": "Monitor", "STATUS_NAME": "Active"},
            {"INV_NO": "3", "BRANCH_NAME": "Moscow", "TYPE_NAME": "Notebook", "STATUS_NAME": "Repair"},
        ],
    )
    monkeypatch.setattr(
        "backend.ai_chat.tools.itinvent.queries.get_all_equipment",
        lambda page=1, limit=1, db_id=None: {"total": 3},
    )

    equipment = tools_module.AnalyticsSummaryTool().execute(
        context=context,
        args=tools_module.AnalyticsSummaryArgs(scope="equipment", group_by="branch"),
    ).to_payload()["data"]

    assert equipment["scope"] == "equipment"
    assert equipment["group_by"] == "branch"
    assert equipment["source_rows"] == 3
    assert equipment["rows"] == [
        {"key": "Tyumen", "count": 2},
        {"key": "Moscow", "count": 1},
    ]

    monkeypatch.setattr(
        "backend.ai_chat.tools.itinvent.queries.get_consumables_lookup",
        lambda **kwargs: [
            {"BRANCH_NAME": "Tyumen", "MODEL_NAME": "HP 85A", "QTY": 3},
            {"BRANCH_NAME": "Tyumen", "MODEL_NAME": "HP 85A", "QTY": 5},
            {"BRANCH_NAME": "Moscow", "MODEL_NAME": "Canon 725", "QTY": 2},
        ],
    )

    consumables = tools_module.AnalyticsSummaryTool().execute(
        context=context,
        args=tools_module.AnalyticsSummaryArgs(scope="consumables", group_by="model"),
    ).to_payload()["data"]

    assert consumables["scope"] == "consumables"
    assert consumables["group_by"] == "model"
    assert consumables["rows"] == [
        {"key": "HP 85A", "count": 2, "qty_total": 8},
        {"key": "Canon 725", "count": 1, "qty_total": 2},
    ]


def test_itinvent_transfer_draft_creates_pending_action_without_writing(tmp_path, monkeypatch):
    database_url = _configure_local_backend_runtime(tmp_path, monkeypatch, "ai_action_transfer_draft.db")
    appdb_db = importlib.import_module("backend.appdb.db")
    app_models = importlib.import_module("backend.appdb.models")
    tools_module = importlib.import_module("backend.ai_chat.tools.itinvent")

    appdb_db.initialize_app_schema(database_url)
    context = _make_tool_execution_context(enabled_tools=["itinvent.action.transfer_draft"])

    monkeypatch.setattr(
        "backend.ai_chat.action_cards.queries.get_equipment_by_inv",
        lambda inv_no, db_id=None: {"INV_NO": inv_no, "MODEL_NAME": "Dell Latitude", "FIO": "Old Owner"},
    )
    monkeypatch.setattr(
        "backend.ai_chat.action_cards.queries.get_owner_by_no",
        lambda owner_no, db_id=None: {"OWNER_NO": owner_no, "OWNER_DISPLAY_NAME": "New Owner", "OWNER_DEPT": "IT"},
    )

    def fail_if_write_called(**kwargs):
        raise AssertionError("draft tool must not write to ITinvent")

    monkeypatch.setattr(
        "backend.ai_chat.action_cards.queries.transfer_equipment_by_inv_with_history",
        fail_if_write_called,
    )

    result = tools_module.TransferDraftTool().execute(
        context=context,
        args=tools_module.TransferDraftArgs(
            inv_nos=["101"],
            new_employee="New Owner",
            new_employee_no=501,
        ),
    ).to_payload()

    assert result["ok"] is True
    action_card = result["data"]["action_card"]
    assert action_card["status"] == "pending"
    assert action_card["preview"]["summary"] == "Передать 1 поз. сотруднику New Owner"
    assert action_card["preview"]["effects"] == ["перемещение оборудования", "запись в историю", "генерация акта"]

    with appdb_db.app_session(database_url) as session:
        row = session.get(app_models.AppAiPendingAction, action_card["id"])
        assert row is not None
        assert row.status == "pending"
        assert row.message_id is None


def test_ai_tool_admin_can_target_specific_database(monkeypatch):
    tools_module = importlib.import_module("backend.ai_chat.tools.itinvent")
    tools_context_module = importlib.import_module("backend.ai_chat.tools.context")

    calls: list[str] = []

    def fake_search(query, db_id=None):
        calls.append(db_id)
        return [{
            "inv_no": "101",
            "MODEL_NAME": "Dell Latitude",
            "OWNER_DISPLAY_NAME": "Owner",
        }]

    monkeypatch.setattr(tools_module.queries, "search_equipment_by_serial", fake_search)

    context = tools_context_module.AiToolExecutionContext(
        bot_id="bot-test",
        bot_title="AI Assistant",
        conversation_id="conv-1",
        run_id="run-1",
        user_id=1,
        user_payload={"id": 1, "role": "admin", "username": "admin"},
        effective_database_id="ITINVENT",
        enabled_tools=["itinvent.equipment.search"],
        tool_settings={
            "multi_db_mode": "admin_multi_db",
            "allowed_databases": ["OBJ-ITINVENT"],
        },
    )

    result = tools_module.EquipmentSearchTool().execute(
        context=context,
        args=tools_module.EquipmentSearchArgs(query="101", database_id="OBJ-ITINVENT"),
    ).to_payload()

    assert result["ok"] is True
    assert result["database_id"] == "OBJ-ITINVENT"
    assert calls == ["OBJ-ITINVENT"]


def test_ai_tool_non_admin_cannot_override_database(monkeypatch):
    tools_module = importlib.import_module("backend.ai_chat.tools.itinvent")

    context = _make_tool_execution_context(enabled_tools=["itinvent.equipment.search"], database_id="ITINVENT")
    result = tools_module.EquipmentSearchTool().execute(
        context=context,
        args=tools_module.EquipmentSearchArgs(query="101", database_id="OBJ-ITINVENT"),
    ).to_payload()

    assert result["ok"] is False
    assert "not available" in result["error"]


def test_ai_admin_multi_db_empty_allowed_means_all_databases(monkeypatch):
    tools_context_module = importlib.import_module("backend.ai_chat.tools.context")

    monkeypatch.setattr(
        tools_context_module,
        "get_all_db_configs",
        lambda: [
            {"id": "ITINVENT", "name": "Main"},
            {"id": "OBJ-ITINVENT", "name": "Objects"},
        ],
    )
    context = tools_context_module.AiToolExecutionContext(
        bot_id="bot-test",
        bot_title="AI Assistant",
        conversation_id="conv-1",
        run_id="run-1",
        user_id=1,
        user_payload={"id": 1, "role": "admin", "username": "admin"},
        effective_database_id="ITINVENT",
        enabled_tools=["itinvent.equipment.search_multi_db"],
        tool_settings={"multi_db_mode": "admin_multi_db", "allowed_databases": []},
    )

    assert "ITINVENT" in context.resolve_multi_db_targets()
    assert "OBJ-ITINVENT" in context.resolve_multi_db_targets()
    assert context.resolve_tool_database_id("OBJ-ITINVENT") == "OBJ-ITINVENT"


def test_ai_database_current_reports_admin_multi_db_targets(monkeypatch):
    tools_module = importlib.import_module("backend.ai_chat.tools.itinvent")
    tools_context_module = importlib.import_module("backend.ai_chat.tools.context")

    monkeypatch.setattr(
        tools_context_module,
        "get_all_db_configs",
        lambda: [
            {"id": "ITINVENT", "name": "Main"},
            {"id": "OBJ-ITINVENT", "name": "Objects"},
        ],
    )
    monkeypatch.setattr(tools_context_module.config.database, "database", "ITINVENT", raising=False)
    monkeypatch.setattr(tools_module, "get_available_database_options", tools_context_module.get_available_database_options)

    context = tools_context_module.AiToolExecutionContext(
        bot_id="bot-test",
        bot_title="AI Assistant",
        conversation_id="conv-1",
        run_id="run-1",
        user_id=1,
        user_payload={"id": 1, "role": "admin", "username": "admin"},
        effective_database_id="ITINVENT",
        enabled_tools=["itinvent.database.current"],
        tool_settings={"multi_db_mode": "admin_multi_db", "allowed_databases": []},
    )

    result = tools_module.DatabaseCurrentTool().execute(
        context=context,
        args=tools_module.DatabaseCurrentArgs(),
    ).to_payload()

    assert result["ok"] is True
    assert result["data"]["database_id"] == "ITINVENT"
    assert result["data"]["multi_db_mode"] == "admin_multi_db"
    assert result["data"]["multi_db_targets"] == ["ITINVENT", "OBJ-ITINVENT"]
    assert result["data"]["available_databases"] == [
        {"id": "ITINVENT", "name": "Main"},
        {"id": "OBJ-ITINVENT", "name": "Objects"},
    ]


def test_ai_routing_prompt_requires_database_current_for_database_questions():
    service_module = importlib.import_module("backend.ai_chat.service")

    routing_guide = service_module.AI_ITINVENT_TOOL_ROUTING_GUIDE
    assert "available databases" in routing_guide
    assert "use database current" in routing_guide


@pytest.mark.asyncio
async def test_database_dependency_ignores_unknown_database_header(monkeypatch):
    deps = importlib.import_module("backend.api.deps")

    monkeypatch.setattr(
        "backend.api.v1.database.get_all_db_configs",
        lambda: [
            {"id": "ITINVENT", "name": "Main"},
            {"id": "OBJ-ITINVENT", "name": "Objects"},
        ],
    )

    result = await deps.get_current_database_id(
        x_database_id="UNKNOWN-DB",
        selected_database="OBJ-ITINVENT",
        current_user=_make_user(permissions=["database.read"], role="admin"),
    )

    assert result == "OBJ-ITINVENT"


def test_itinvent_transfer_draft_requires_exact_existing_owner(tmp_path, monkeypatch):
    database_url = _configure_local_backend_runtime(tmp_path, monkeypatch, "ai_action_transfer_exact_owner.db")
    appdb_db = importlib.import_module("backend.appdb.db")
    tools_module = importlib.import_module("backend.ai_chat.tools.itinvent")

    appdb_db.initialize_app_schema(database_url)
    context = _make_tool_execution_context(enabled_tools=["itinvent.action.transfer_draft"])

    monkeypatch.setattr(
        "backend.ai_chat.action_cards.queries.get_equipment_by_inv",
        lambda inv_no, db_id=None: {"INV_NO": inv_no, "MODEL_NAME": "Dell Latitude", "FIO": "Old Owner"},
    )
    monkeypatch.setattr(
        "backend.ai_chat.action_cards.queries.get_owner_no_by_name",
        lambda employee_name, strict=True, db_id=None: None,
    )

    def fail_create_owner(*args, **kwargs):
        raise AssertionError("AI draft must not create an owner")

    monkeypatch.setattr("backend.ai_chat.action_cards.queries.create_owner", fail_create_owner, raising=False)

    result = tools_module.TransferDraftTool().execute(
        context=context,
        args=tools_module.TransferDraftArgs(
            inv_nos=["101"],
            new_employee="Unknown Owner",
        ),
    ).to_payload()

    assert result["ok"] is False
    assert "not resolved exactly" in result["error"]


def test_equipment_transfer_execution_service_matches_route_process(monkeypatch):
    service = importlib.import_module("backend.services.equipment_transfer_execution_service")

    captured: dict[str, object] = {}
    invalidated: list[str] = []

    monkeypatch.setattr(
        service.queries,
        "get_owner_by_no",
        lambda owner_no, db_id=None: {
            "OWNER_NO": owner_no,
            "OWNER_DISPLAY_NAME": "New Owner",
            "OWNER_DEPT": "IT",
        },
    )

    def fake_owner_email(owner_no, db_id=None):
        if int(owner_no) == 1:
            return "old@example.test"
        return "new@example.test"

    monkeypatch.setattr(service.queries, "get_owner_email_by_no", fake_owner_email)
    monkeypatch.setattr(service.queries, "get_branch_by_no", lambda branch_no, db_id=None: {"BRANCH_NO": branch_no})
    monkeypatch.setattr(service.queries, "get_location_by_no", lambda loc_no, db_id=None: {"LOC_NO": loc_no})

    def fake_transfer(**kwargs):
        captured["transfer_kwargs"] = kwargs
        return {
            "success": True,
            "inv_no": kwargs["inv_no"],
            "old_employee_no": 1,
            "old_employee_name": "Old Owner",
            "new_employee_no": kwargs["new_employee_no"],
            "new_employee_name": kwargs["new_employee_name"],
            "hist_id": 77,
        }

    def fake_generate(**kwargs):
        captured["generate_kwargs"] = kwargs
        return [{"act_id": "act-1", "old_employee": "Old Owner", "equipment_count": 1, "file_name": "act.pdf", "file_type": "pdf"}]

    def fake_reminder(**kwargs):
        captured["reminder_kwargs"] = kwargs
        return {
            "created": True,
            "task_id": "task-1",
            "reminder_id": "rem-1",
            "warning": None,
            "controller_username": "controller",
            "controller_fallback_used": False,
        }

    monkeypatch.setattr(service.queries, "transfer_equipment_by_inv_with_history", fake_transfer)
    monkeypatch.setattr(service, "generate_transfer_acts", fake_generate)
    monkeypatch.setattr(service.transfer_act_reminder_service, "create_transfer_reminder", fake_reminder)
    monkeypatch.setattr(service, "invalidate_equipment_cache", lambda db_id=None: invalidated.append(db_id))

    result = service.execute_equipment_transfer(
        payload={"inv_nos": ["101"], "new_employee": "New Owner", "new_employee_no": 55, "branch_no": 2, "loc_no": 9},
        db_id="ITINVENT",
        current_user=SimpleNamespace(username="operator"),
        allow_create_owner=True,
    )

    assert result["success_count"] == 1
    assert result["acts"][0]["act_id"] == "act-1"
    assert result["upload_reminder_created"] is True
    assert result["upload_reminder_task_id"] == "task-1"
    assert captured["transfer_kwargs"]["changed_by"] == "operator"
    assert captured["transfer_kwargs"]["new_branch_no"] == 2
    assert captured["generate_kwargs"]["transferred_items"][0]["old_employee_email"] == "old@example.test"
    assert captured["reminder_kwargs"]["new_employee_no"] == 55
    assert invalidated == ["ITINVENT"]


def test_ai_transfer_confirm_uses_shared_service_without_owner_creation(tmp_path, monkeypatch):
    database_url = _configure_local_backend_runtime(tmp_path, monkeypatch, "ai_action_transfer_confirm_service.db")
    appdb_db = importlib.import_module("backend.appdb.db")
    action_cards = importlib.import_module("backend.ai_chat.action_cards")

    appdb_db.initialize_app_schema(database_url)
    card = action_cards.create_pending_action(
        action_type=action_cards.ACTION_TRANSFER,
        conversation_id="conv-1",
        run_id="run-1",
        requester_user_id=5,
        database_id="ITINVENT",
        payload={"inv_nos": ["101"], "new_employee": "New Owner", "new_employee_no": 55},
        preview={"title": "Передача оборудования", "summary": "Передать 1 поз."},
    )

    calls: list[dict[str, object]] = []

    def fake_execute(**kwargs):
        calls.append(kwargs)
        return {
            "success_count": 1,
            "failed_count": 0,
            "transferred": [{"inv_no": "101", "hist_id": 77}],
            "failed": [],
            "acts": [{"act_id": "act-1"}],
            "upload_reminder_created": True,
            "upload_reminder_task_id": "task-1",
            "upload_reminder_id": "rem-1",
            "upload_reminder_warning": None,
            "upload_reminder_controller_username": "controller",
            "upload_reminder_controller_fallback_used": False,
        }

    monkeypatch.setattr(action_cards, "execute_equipment_transfer", fake_execute)

    confirmed = action_cards.confirm_action(action_id=card["id"], current_user=_make_user(permissions=["database.write"]))
    repeated = action_cards.confirm_action(action_id=card["id"], current_user=_make_user(permissions=["database.write"]))

    assert confirmed["status"] == "confirmed"
    assert confirmed["result"]["upload_reminder_created"] is True
    assert confirmed["result"]["upload_reminder_task_id"] == "task-1"
    assert repeated["status"] == "confirmed"
    assert len(calls) == 1
    assert calls[0]["allow_create_owner"] is False
    assert calls[0]["payload"]["new_employee_no"] == 55


def test_ai_transfer_confirm_sends_generated_act_to_chat(tmp_path, monkeypatch):
    database_url = _configure_local_backend_runtime(tmp_path, monkeypatch, "ai_action_transfer_confirm_sends_act.db")
    appdb_db = importlib.import_module("backend.appdb.db")
    action_cards = importlib.import_module("backend.ai_chat.action_cards")

    appdb_db.initialize_app_schema(database_url)
    card = action_cards.create_pending_action(
        action_type=action_cards.ACTION_TRANSFER,
        conversation_id="conv-1",
        run_id="run-1",
        requester_user_id=5,
        database_id="ITINVENT",
        payload={"inv_nos": ["101"], "new_employee": "New Owner", "new_employee_no": 55},
        preview={"title": "Передача оборудования", "summary": "Передать 1 поз."},
    )
    act_path = tmp_path / "act-101.pdf"
    act_path.write_bytes(b"%PDF-1.4\nact")

    monkeypatch.setattr(
        action_cards,
        "execute_equipment_transfer",
        lambda **kwargs: {
            "success_count": 1,
            "failed_count": 0,
            "transferred": [{"inv_no": "101", "hist_id": 77}],
            "failed": [],
            "acts": [{"act_id": "act-1", "file_name": "act-101.pdf"}],
            "upload_reminder_created": True,
            "upload_reminder_task_id": "task-1",
            "upload_reminder_id": "rem-1",
            "upload_reminder_warning": None,
            "upload_reminder_controller_username": "controller",
            "upload_reminder_controller_fallback_used": False,
        },
    )
    monkeypatch.setattr(
        action_cards,
        "get_act_record",
        lambda act_id: {"file_path": str(act_path), "file_name": "act-101.pdf"},
    )

    sent_files: list[dict[str, object]] = []

    class FakeChatService:
        def send_files(self, **kwargs):
            sent_files.append(kwargs)
            upload = kwargs["uploads"][0]
            assert upload.filename == "act-101.pdf"
            assert upload.file.read() == b"%PDF-1.4\nact"
            return {
                "id": "msg-file-1",
                "attachments": [{"id": "att-1", "file_name": "act-101.pdf"}],
            }

    monkeypatch.setattr("backend.chat.service.chat_service", FakeChatService())
    monkeypatch.setattr(action_cards, "_publish_chat_message_created", lambda **kwargs: None)

    confirmed = action_cards.confirm_action(action_id=card["id"], current_user=_make_user(permissions=["database.write"]))
    repeated = action_cards.confirm_action(action_id=card["id"], current_user=_make_user(permissions=["database.write"]))

    assert confirmed["status"] == "confirmed"
    assert confirmed["result"]["chat_act_delivery"]["sent_count"] == 1
    assert confirmed["result"]["chat_act_delivery"]["messages"][0]["message_id"] == "msg-file-1"
    assert repeated["status"] == "confirmed"
    assert len(sent_files) == 1
    assert sent_files[0]["conversation_id"] == "conv-1"
    assert sent_files[0]["body"] == "Акт перемещения техники"


def test_ai_action_confirm_is_idempotent_and_expiry_blocks_execution(tmp_path, monkeypatch):
    database_url = _configure_local_backend_runtime(tmp_path, monkeypatch, "ai_action_confirm.db")
    appdb_db = importlib.import_module("backend.appdb.db")
    app_models = importlib.import_module("backend.appdb.models")
    action_cards = importlib.import_module("backend.ai_chat.action_cards")

    appdb_db.initialize_app_schema(database_url)
    card = action_cards.create_pending_action(
        action_type=action_cards.ACTION_CONSUMABLE_QTY,
        conversation_id="conv-1",
        run_id="run-1",
        requester_user_id=5,
        database_id="ITINVENT",
        payload={"item_id": 10, "inv_no": "C-10", "qty": 7},
        preview={"title": "Изменение остатка", "summary": "Установить 7"},
    )
    calls: list[dict[str, object]] = []

    def fake_set_qty(**kwargs):
        calls.append(kwargs)
        return {"success": True, "item_id": kwargs.get("item_id"), "qty_new": kwargs.get("qty")}

    monkeypatch.setattr("backend.ai_chat.action_cards.queries.set_consumable_stock_qty", fake_set_qty)
    monkeypatch.setattr("backend.ai_chat.action_cards.invalidate_equipment_cache", lambda db_id=None: None)

    user = _make_user(permissions=["database.write"])
    confirmed = action_cards.confirm_action(action_id=card["id"], current_user=user)
    repeated = action_cards.confirm_action(action_id=card["id"], current_user=user)

    assert confirmed["status"] == "confirmed"
    assert repeated["status"] == "confirmed"
    assert len(calls) == 1

    expired = action_cards.create_pending_action(
        action_type=action_cards.ACTION_CONSUMABLE_QTY,
        conversation_id="conv-1",
        run_id="run-2",
        requester_user_id=5,
        database_id="ITINVENT",
        payload={"item_id": 11, "qty": 3},
        preview={"title": "Изменение остатка", "summary": "Установить 3"},
    )
    with appdb_db.app_session(database_url) as session:
        row = session.get(app_models.AppAiPendingAction, expired["id"])
        row.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)

    blocked = action_cards.confirm_action(action_id=expired["id"], current_user=user)
    assert blocked["status"] == "expired"
    assert len(calls) == 1


def test_chat_message_serialization_includes_ai_action_card(tmp_path, monkeypatch):
    database_url = _configure_local_backend_runtime(tmp_path, monkeypatch, "ai_action_message_card.db")
    appdb_db = importlib.import_module("backend.appdb.db")
    action_cards = importlib.import_module("backend.ai_chat.action_cards")
    chat_service_module = importlib.import_module("backend.chat.service")

    appdb_db.initialize_app_schema(database_url)
    card = action_cards.create_pending_action(
        action_type=action_cards.ACTION_CONSUMABLE_CONSUME,
        conversation_id="conv-1",
        run_id="run-1",
        requester_user_id=5,
        database_id="ITINVENT",
        payload={"item_id": 10, "qty": 1},
        preview={"title": "Списание расходника", "summary": "Списать 1 шт."},
    )
    action_cards.attach_run_actions_to_message(run_id="run-1", message_id="msg-action-1")

    message = SimpleNamespace(
        id="msg-action-1",
        conversation_id="conv-1",
        sender_user_id=77,
        kind="text",
        body_format="markdown",
        client_message_id=None,
        body="Подготовил действие.",
        created_at=datetime.now(timezone.utc),
        edited_at=None,
        reply_to_message_id=None,
        forward_from_message_id=None,
        task_preview_json=None,
    )
    serialized = chat_service_module.chat_service._serialize_message(
        conversation_kind="ai",
        message=message,
        current_user_id=5,
        users_by_id={77: {"id": 77, "username": "bot", "full_name": "Bot", "role": "viewer", "is_active": True}},
        attachments=[],
    )

    assert serialized["action_card"]["id"] == card["id"]
    assert serialized["action_card"]["status"] == "pending"
    assert serialized["action_card"]["preview"]["summary"] == "Списать 1 шт."


def test_chat_ai_action_confirm_requires_chat_ai_use_permission(tmp_path, monkeypatch):
    _configure_local_backend_runtime(tmp_path, monkeypatch, "ai_action_route_permission.db")
    deps = importlib.import_module("backend.api.deps")
    chat_api = importlib.import_module("backend.api.v1.chat")
    action_cards = importlib.import_module("backend.ai_chat.action_cards")

    app = FastAPI()
    app.include_router(chat_api.router, prefix="/chat")
    monkeypatch.setattr(action_cards, "confirm_action", lambda **kwargs: {"id": "action-1", "status": "confirmed"})

    app.dependency_overrides[deps.get_current_active_user] = lambda: _make_user(permissions=["chat.read"])
    forbidden = TestClient(app).post("/chat/ai/actions/action-1/confirm")
    assert forbidden.status_code == 403

    app.dependency_overrides[deps.get_current_active_user] = lambda: _make_user(permissions=["chat.ai.use"])
    allowed = TestClient(app).post("/chat/ai/actions/action-1/confirm")
    assert allowed.status_code == 200
    assert allowed.json()["status"] == "confirmed"


def test_office_mail_draft_sends_only_after_confirm_and_is_idempotent(tmp_path, monkeypatch):
    database_url = _configure_local_backend_runtime(tmp_path, monkeypatch, "ai_office_mail_action.db")
    appdb_db = importlib.import_module("backend.appdb.db")
    action_cards = importlib.import_module("backend.ai_chat.action_cards")

    appdb_db.initialize_app_schema(database_url)
    card = action_cards.build_office_mail_draft(
        action_type=action_cards.ACTION_OFFICE_MAIL_SEND,
        conversation_id="conv-office-1",
        run_id="run-office-1",
        requester_user_id=99,
        payload={
            "to": ["ivanov@example.com"],
            "subject": "Test subject",
            "body": "Test body",
            "is_html": False,
        },
    )

    send_calls: list[dict[str, object]] = []

    def fake_send_message(**kwargs):
        send_calls.append(kwargs)
        return {"ok": True, "message_id": "mail-1", "subject": kwargs["subject"], "recipients": kwargs["to"]}

    monkeypatch.setattr(action_cards.mail_service, "send_message", fake_send_message)

    assert card["status"] == "pending"
    assert send_calls == []

    user = _make_user(permissions=["chat.ai.use", "mail.access"])
    confirmed = action_cards.confirm_action(action_id=card["id"], current_user=user)
    repeated = action_cards.confirm_action(action_id=card["id"], current_user=user)

    assert confirmed["status"] == "confirmed"
    assert repeated["status"] == "confirmed"
    assert len(send_calls) == 1
    assert send_calls[0]["to"] == ["ivanov@example.com"]


def test_office_contacts_resolve_falls_back_to_itinvent_users_when_gal_fails(monkeypatch):
    mail_service_module = importlib.import_module("backend.services.mail_service")
    service = mail_service_module.MailService()

    monkeypatch.setattr(
        service,
        "_resolve_mail_profile",
        lambda **kwargs: (_ for _ in ()).throw(RuntimeError("GAL unavailable")),
    )
    monkeypatch.setattr(
        mail_service_module.user_service,
        "list_users",
        lambda: [
            {
                "id": 10,
                "username": "a.sandu",
                "full_name": "Андрей Олегович Санду",
                "email": "andrey.sandu@example.com",
                "mailbox_email": None,
                "mailbox_login": None,
            }
        ],
    )

    rows = service.search_contacts(user_id=99, q="Санду")

    assert rows == [
        {
            "name": "Андрей Олегович Санду",
            "email": "andrey.sandu@example.com",
            "source": "itinvent_users",
        }
    ]


def test_office_mail_confirm_accepts_overrides_and_chat_attachments(tmp_path, monkeypatch):
    database_url = _configure_local_backend_runtime(tmp_path, monkeypatch, "ai_office_mail_action_overrides.db")
    appdb_db = importlib.import_module("backend.appdb.db")
    chat_db = importlib.import_module("backend.chat.db")
    chat_models = importlib.import_module("backend.chat.models")
    action_cards = importlib.import_module("backend.ai_chat.action_cards")

    appdb_db.initialize_app_schema(database_url)
    chat_db.initialize_chat_schema(database_url)
    card = action_cards.build_office_mail_draft(
        action_type=action_cards.ACTION_OFFICE_MAIL_SEND,
        conversation_id="conv-office-attachments",
        run_id="run-office-attachments",
        requester_user_id=99,
        payload={
            "to": ["old@example.com"],
            "subject": "Old subject",
            "body": "Old body",
            "is_html": True,
        },
    )
    with chat_db.chat_session(database_url) as session:
        session.add(
            chat_models.ChatConversation(
                id="conv-office-attachments",
                kind="ai",
                title="AI",
                created_by_user_id=99,
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )
        )
        session.add(
            chat_models.ChatMember(
                conversation_id="conv-office-attachments",
                user_id=99,
                member_role="member",
                joined_at=datetime.now(timezone.utc),
            )
        )
        session.add(
            chat_models.ChatMessage(
                id="msg-file-office",
                conversation_id="conv-office-attachments",
                sender_user_id=99,
                kind="file",
                body="report",
                body_format="plain",
                conversation_seq=1,
                created_at=datetime.now(timezone.utc),
            )
        )
        session.add(
            chat_models.ChatMessageAttachment(
                id="att-office",
                message_id="msg-file-office",
                conversation_id="conv-office-attachments",
                storage_name="att-office_report.txt",
                file_name="report.txt",
                mime_type="text/plain",
                file_size=6,
                uploaded_by_user_id=99,
                created_at=datetime.now(timezone.utc),
            )
        )

    attachment_path = tmp_path / "report.txt"
    attachment_path.write_bytes(b"report")
    monkeypatch.setattr(
        "backend.chat.service.chat_service.get_attachment_for_download",
        lambda **kwargs: {"path": str(attachment_path), "file_name": "report.txt", "mime_type": "text/plain"},
    )
    send_calls: list[dict[str, object]] = []

    def fake_send_message(**kwargs):
        send_calls.append(kwargs)
        return {"ok": True, "message_id": "mail-override-1", "subject": kwargs["subject"], "recipients": kwargs["to"]}

    monkeypatch.setattr(action_cards.mail_service, "send_message", fake_send_message)

    confirmed = action_cards.confirm_action(
        action_id=card["id"],
        current_user=_make_user(permissions=["chat.ai.use", "mail.access"]),
        payload_overrides={
            "to": ["new@example.com"],
            "cc": ["copy@example.com"],
            "subject": "New subject",
            "body": "New body",
            "attachment_refs": [{"message_id": "msg-file-office", "attachment_id": "att-office"}],
        },
    )

    assert confirmed["status"] == "confirmed"
    assert confirmed["preview"]["mail"]["subject"] == "New subject"
    assert confirmed["preview"]["mail"]["signature_auto"] is True
    assert send_calls[0]["to"] == ["new@example.com"]
    assert send_calls[0]["cc"] == ["copy@example.com"]
    assert send_calls[0]["body"] == "New body"
    assert send_calls[0]["attachments"][0] == ("report.txt", b"report")


def test_office_mail_confirm_attaches_generated_file_specs(tmp_path, monkeypatch):
    database_url = _configure_local_backend_runtime(tmp_path, monkeypatch, "ai_office_mail_generated_attachments.db")
    appdb_db = importlib.import_module("backend.appdb.db")
    action_cards = importlib.import_module("backend.ai_chat.action_cards")

    appdb_db.initialize_app_schema(database_url)
    card = action_cards.build_office_mail_draft(
        action_type=action_cards.ACTION_OFFICE_MAIL_SEND,
        conversation_id="conv-office-generated",
        run_id="run-office-generated",
        requester_user_id=99,
        payload={
            "to": ["sandu@example.com"],
            "subject": "Analytics report",
            "body": "Sending the generated report.",
            "generated_file_specs": [
                {
                    "format": "xlsx",
                    "file_name": "analytics_report.xlsx",
                    "sheets": [
                        {
                            "title": "Report",
                            "rows": [["Metric", "Value"], ["gen55", "12"]],
                        }
                    ],
                }
            ],
        },
    )
    send_calls: list[dict[str, object]] = []

    def fake_send_message(**kwargs):
        send_calls.append(kwargs)
        return {"ok": True, "message_id": "mail-generated-1"}

    monkeypatch.setattr(action_cards.mail_service, "send_message", fake_send_message)

    confirmed = action_cards.confirm_action(
        action_id=card["id"],
        current_user=_make_user(permissions=["chat.ai.use", "mail.access"]),
    )

    assert confirmed["status"] == "confirmed"
    assert confirmed["preview"]["mail"]["generated_file_count"] == 1
    assert confirmed["preview"]["mail"]["attachment_count"] == 1
    assert len(send_calls) == 1
    assert send_calls[0]["attachments"][0][0] == "analytics_report.xlsx"
    assert send_calls[0]["attachments"][0][1].startswith(b"PK")


def test_office_mail_confirm_rejects_attachment_from_other_chat(tmp_path, monkeypatch):
    database_url = _configure_local_backend_runtime(tmp_path, monkeypatch, "ai_office_mail_action_bad_attachment.db")
    appdb_db = importlib.import_module("backend.appdb.db")
    chat_db = importlib.import_module("backend.chat.db")
    chat_models = importlib.import_module("backend.chat.models")
    action_cards = importlib.import_module("backend.ai_chat.action_cards")

    appdb_db.initialize_app_schema(database_url)
    chat_db.initialize_chat_schema(database_url)
    card = action_cards.build_office_mail_draft(
        action_type=action_cards.ACTION_OFFICE_MAIL_SEND,
        conversation_id="conv-office-good",
        run_id="run-office-bad-attachment",
        requester_user_id=99,
        payload={"to": ["ivanov@example.com"], "subject": "Subject", "body": "Body"},
    )
    with chat_db.chat_session(database_url) as session:
        session.add(
            chat_models.ChatMessage(
                id="msg-other",
                conversation_id="conv-office-other",
                sender_user_id=99,
                kind="file",
                body="other",
                body_format="plain",
                conversation_seq=1,
                created_at=datetime.now(timezone.utc),
            )
        )
        session.add(
            chat_models.ChatMessageAttachment(
                id="att-other",
                message_id="msg-other",
                conversation_id="conv-office-other",
                storage_name="att-other.txt",
                file_name="other.txt",
                mime_type="text/plain",
                file_size=5,
                uploaded_by_user_id=99,
                created_at=datetime.now(timezone.utc),
            )
        )
    monkeypatch.setattr(action_cards.mail_service, "send_message", lambda **kwargs: pytest.fail("mail must not be sent"))

    blocked = action_cards.confirm_action(
        action_id=card["id"],
        current_user=_make_user(permissions=["chat.ai.use", "mail.access"]),
        payload_overrides={"attachment_refs": [{"message_id": "msg-other", "attachment_id": "att-other"}]},
    )

    assert blocked["status"] == "failed"
    assert "another chat conversation" in blocked["error_text"]


def test_office_task_create_draft_uses_hub_service_after_confirm(tmp_path, monkeypatch):
    database_url = _configure_local_backend_runtime(tmp_path, monkeypatch, "ai_office_task_action.db")
    appdb_db = importlib.import_module("backend.appdb.db")
    action_cards = importlib.import_module("backend.ai_chat.action_cards")

    appdb_db.initialize_app_schema(database_url)
    card = action_cards.build_office_task_draft(
        action_type=action_cards.ACTION_OFFICE_TASK_CREATE,
        conversation_id="conv-office-2",
        run_id="run-office-2",
        requester_user_id=99,
        payload={
            "title": "Prepare report",
            "description": "Prepare weekly report",
            "assignee_user_id": 15,
            "controller_user_id": 99,
            "project_id": "project-1",
            "priority": "high",
        },
    )
    create_calls: list[dict[str, object]] = []

    def fake_create_task(**kwargs):
        create_calls.append(kwargs)
        return {"id": "task-1", "title": kwargs["title"], "status": "new"}

    monkeypatch.setattr(action_cards.hub_service, "create_task", fake_create_task)

    confirmed = action_cards.confirm_action(
        action_id=card["id"],
        current_user=_make_user(permissions=["chat.ai.use", "tasks.write", "tasks.read"]),
    )
    repeated = action_cards.confirm_action(
        action_id=card["id"],
        current_user=_make_user(permissions=["chat.ai.use", "tasks.write", "tasks.read"]),
    )

    assert confirmed["status"] == "confirmed"
    assert repeated["status"] == "confirmed"
    assert len(create_calls) == 1
    assert create_calls[0]["assignee_user_id"] == 15
    assert create_calls[0]["project_id"] == "project-1"


def test_ai_chat_service_opens_one_dialog_queues_run_and_filters_hidden_bot_users(tmp_path, monkeypatch):
    database_url = _configure_local_backend_runtime(tmp_path, monkeypatch, "ai_chat_runtime_service.db")

    ai_chat_module = importlib.import_module("backend.ai_chat.service")
    chat_service_module = importlib.import_module("backend.chat.service")
    chat_db = importlib.import_module("backend.chat.db")
    chat_models = importlib.import_module("backend.chat.models")
    app_models = importlib.import_module("backend.appdb.models")
    user_service_module = importlib.import_module("backend.services.user_service")

    monkeypatch.setattr(chat_service_module.hub_service, "data_dir", tmp_path, raising=False)

    temp_user_service = user_service_module.UserService(database_url=database_url)
    temp_chat_service = chat_service_module.ChatService()
    temp_chat_service._attachments_root = tmp_path / "chat_message_attachments"
    temp_chat_service._attachments_root.mkdir(parents=True, exist_ok=True)
    temp_chat_service._upload_sessions_root = tmp_path / "chat_upload_sessions"
    temp_chat_service._upload_sessions_root.mkdir(parents=True, exist_ok=True)
    temp_ai_service = ai_chat_module.AiChatService()

    monkeypatch.setattr(ai_chat_module, "user_service", temp_user_service)
    monkeypatch.setattr(chat_service_module, "user_service", temp_user_service)
    monkeypatch.setattr(ai_chat_module, "chat_service", temp_chat_service)
    monkeypatch.setattr(
        ai_chat_module,
        "_utc_now",
        lambda: datetime.now(timezone.utc),
    )
    monkeypatch.setattr(
        ai_chat_module.openrouter_client,
        "complete_json",
        lambda **kwargs: ({"answer_markdown": "## AI reply\nReady.", "artifacts": []}, {"output_tokens": 12}),
    )
    monkeypatch.setattr(ai_chat_module.openrouter_client, "get_status", lambda: {"configured": True, "default_model": "openai/gpt-4o-mini"})
    monkeypatch.setattr(ai_chat_module.ai_kb_retrieval_service, "ensure_index_fresh", lambda **kwargs: None)
    monkeypatch.setattr(ai_chat_module.ai_kb_retrieval_service, "retrieve", lambda **kwargs: [])
    monkeypatch.setattr(
        ai_chat_module,
        "extract_text_from_path",
        lambda *args, **kwargs: "Extracted attachment context",
    )
    direct_push_calls: list[dict] = []
    monkeypatch.setattr(
        chat_service_module.chat_push_service,
        "send_chat_message_notification",
        lambda *args, **kwargs: direct_push_calls.append({"args": args, "kwargs": kwargs}),
        raising=False,
    )

    chat_db.initialize_chat_schema(database_url)

    actor = temp_user_service.create_user(
        username="operator",
        password="secret-pass",
        role="viewer",
        auth_source="local",
        full_name="Operator",
        is_active=True,
        use_custom_permissions=True,
        custom_permissions=["chat.read", "chat.write", "chat.ai.use", "kb.read"],
    )

    bot = temp_ai_service.ensure_default_bot()
    opened = temp_ai_service.open_bot_conversation(bot_id=bot["id"], current_user_id=int(actor["id"]))
    reopened = temp_ai_service.open_bot_conversation(bot_id=bot["id"], current_user_id=int(actor["id"]))
    listed_bots = temp_ai_service.list_bots(current_user_id=int(actor["id"]))

    assert opened["id"] == reopened["id"]
    assert opened["kind"] == "ai"
    assert listed_bots["items"][0]["conversation_id"] == opened["id"]

    with chat_db.chat_session(database_url) as session:
        conversation = session.get(chat_models.ChatConversation, opened["id"])
        assert conversation is not None
        user_message = chat_models.ChatMessage(
            id="msg-human-1",
            conversation_id=opened["id"],
            sender_user_id=int(actor["id"]),
            body="Summarize the KB context",
            body_format="plain",
            conversation_seq=1,
            created_at=datetime.now(timezone.utc),
        )
        conversation.last_message_id = user_message.id
        conversation.last_message_seq = 1
        conversation.last_message_at = user_message.created_at
        conversation.updated_at = user_message.created_at
        session.add(user_message)
        session.add(
            chat_models.ChatMessageAttachment(
                id="att-1",
                message_id=user_message.id,
                conversation_id=opened["id"],
                storage_name="att-1.bin",
                file_name="request.txt",
                mime_type="text/plain",
                file_size=32,
                uploaded_by_user_id=int(actor["id"]),
                created_at=user_message.created_at,
            )
        )

    queued = temp_ai_service.queue_run_for_message(
        conversation_id=opened["id"],
        trigger_message_id="msg-human-1",
        current_user_id=int(actor["id"]),
    )

    assert queued is not None
    assert queued["status"] == "queued"
    assert queued["stage"] == "queued"
    assert queued["status_text"] == "Запрос принят. Ставлю задачу в очередь."

    assert temp_ai_service.process_next_run() is True

    status = temp_ai_service.get_conversation_status(
        conversation_id=opened["id"],
        current_user_id=int(actor["id"]),
    )
    assert status["status"] == "completed"

    with chat_db.chat_session(database_url) as session:
        messages = list(
            session.execute(
                select(chat_models.ChatMessage)
                .where(chat_models.ChatMessage.conversation_id == opened["id"])
                .order_by(chat_models.ChatMessage.conversation_seq.asc())
            ).scalars()
        )
        runs = list(session.execute(select(app_models.AppAiBotRun)).scalars())
        status_outbox = list(
            session.execute(
                select(chat_models.ChatEventOutbox)
                .where(chat_models.ChatEventOutbox.event_type == "chat.ai.run.updated")
                .order_by(chat_models.ChatEventOutbox.id.asc())
            ).scalars()
        )
        message_outbox = list(
            session.execute(
                select(chat_models.ChatEventOutbox)
                .where(chat_models.ChatEventOutbox.event_type == "chat.message.created")
                .order_by(chat_models.ChatEventOutbox.id.asc())
            ).scalars()
        )
        typing_outbox = list(
            session.execute(
                select(chat_models.ChatEventOutbox)
                .where(chat_models.ChatEventOutbox.event_type.in_(["chat.typing.started", "chat.typing.stopped"]))
                .order_by(chat_models.ChatEventOutbox.id.asc())
            ).scalars()
        )
        push_outbox = list(
            session.execute(select(chat_models.ChatPushOutbox)).scalars()
        )

    assert len(messages) == 2
    assert messages[1].body_format == "markdown"
    assert messages[1].body.startswith("## AI reply")
    assert len(runs) == 1
    assert runs[0].status == "completed"
    assert runs[0].stage == "completed"
    assert direct_push_calls == []
    assert len(push_outbox) >= 1
    assert len(message_outbox) >= 1
    assert [item.event_type for item in typing_outbox] == ["chat.typing.started", "chat.typing.stopped"]
    assert all(str(item.target_scope) == "conversation" for item in typing_outbox)

    stage_events = [
        json.loads(str(item.payload_json or "{}"))
        for item in status_outbox
    ]
    stage_names = [item.get("stage") for item in stage_events]

    assert stage_names[:5] == [
        "queued",
        "analyzing_request",
        "reading_files",
        "retrieving_kb",
        "generating_answer",
    ]
    assert stage_names[-1] == "completed"
    assert "generating_files" not in stage_names
    assert stage_events[0]["status_text"] == "Запрос принят. Ставлю задачу в очередь."
    assert any(item.get("status_text") == "Изучаю вложенные файлы и контекст." for item in stage_events)
    assert any(item.get("status_text") == "Проверяю базу знаний и документы." for item in stage_events)
    assert any(item.get("status_text") == "Формирую ответ." for item in stage_events)

    public_users = temp_user_service.list_users()
    assert all(not str(item["username"]).startswith(user_service_module.SYSTEM_BOT_USERNAME_PREFIX) for item in public_users)
    assert any(str(item["username"]) == "operator" for item in public_users)


def test_ai_files_create_tool_sends_generated_attachment_from_runtime(tmp_path, monkeypatch):
    database_url = _configure_local_backend_runtime(tmp_path, monkeypatch, "ai_chat_runtime_files.db")

    ai_chat_module = importlib.import_module("backend.ai_chat.service")
    chat_service_module = importlib.import_module("backend.chat.service")
    chat_db = importlib.import_module("backend.chat.db")
    chat_models = importlib.import_module("backend.chat.models")
    app_models = importlib.import_module("backend.appdb.models")
    user_service_module = importlib.import_module("backend.services.user_service")

    monkeypatch.setattr(chat_service_module.hub_service, "data_dir", tmp_path, raising=False)

    temp_user_service = user_service_module.UserService(database_url=database_url)
    temp_chat_service = chat_service_module.ChatService()
    temp_chat_service._attachments_root = tmp_path / "chat_message_attachments"
    temp_chat_service._attachments_root.mkdir(parents=True, exist_ok=True)
    temp_chat_service._upload_sessions_root = tmp_path / "chat_upload_sessions"
    temp_chat_service._upload_sessions_root.mkdir(parents=True, exist_ok=True)
    temp_ai_service = ai_chat_module.AiChatService()

    monkeypatch.setattr(ai_chat_module, "user_service", temp_user_service)
    monkeypatch.setattr(chat_service_module, "user_service", temp_user_service)
    monkeypatch.setattr(ai_chat_module, "chat_service", temp_chat_service)
    monkeypatch.setattr(ai_chat_module.ai_kb_retrieval_service, "ensure_index_fresh", lambda **kwargs: None)
    monkeypatch.setattr(ai_chat_module.ai_kb_retrieval_service, "retrieve", lambda **kwargs: [])
    monkeypatch.setattr(
        chat_service_module.chat_push_service,
        "send_chat_message_notification",
        lambda *args, **kwargs: None,
        raising=False,
    )

    completion_calls: list[dict[str, object]] = []

    def fake_complete_json(**kwargs):
        completion_calls.append(kwargs)
        if len(completion_calls) == 1:
            return {
                "answer_markdown": "",
                "artifacts": [],
                "kb_attachment_send": None,
                "tool_calls": [
                    {
                        "tool_id": "ai.files.create",
                        "args": {
                            "files": [
                                {
                                    "format": "txt",
                                    "file_name": "summary.txt",
                                    "content": "Файл создан из контекста чата.",
                                }
                            ]
                        },
                    }
                ],
            }, {"output_tokens": 12}
        return {
            "answer_markdown": "Готово, файл приложен к чату.",
            "artifacts": [],
            "kb_attachment_send": None,
            "tool_calls": [],
        }, {"output_tokens": 8}

    monkeypatch.setattr(ai_chat_module.openrouter_client, "complete_json", fake_complete_json)
    monkeypatch.setattr(ai_chat_module.openrouter_client, "get_status", lambda: {"configured": True, "default_model": "openai/gpt-4o-mini"})

    chat_db.initialize_chat_schema(database_url)

    actor = temp_user_service.create_user(
        username="operator_files",
        password="secret-pass",
        role="viewer",
        auth_source="local",
        full_name="Operator Files",
        is_active=True,
        use_custom_permissions=True,
        custom_permissions=["chat.read", "chat.write", "chat.ai.use"],
    )

    bot = temp_ai_service.ensure_default_bot()
    updated_bot = temp_ai_service.update_bot(bot["id"], {
        "enabled_tools": ["ai.files.create"],
        "allow_generated_artifacts": True,
    })
    assert updated_bot["live_data_enabled"] is False
    opened = temp_ai_service.open_bot_conversation(bot_id=bot["id"], current_user_id=int(actor["id"]))

    with chat_db.chat_session(database_url) as session:
        conversation = session.get(chat_models.ChatConversation, opened["id"])
        user_message = chat_models.ChatMessage(
            id="msg-human-files-1",
            conversation_id=opened["id"],
            sender_user_id=int(actor["id"]),
            body="Создай txt файл с кратким итогом",
            body_format="plain",
            conversation_seq=1,
            created_at=datetime.now(timezone.utc),
        )
        conversation.last_message_id = user_message.id
        conversation.last_message_seq = 1
        conversation.last_message_at = user_message.created_at
        conversation.updated_at = user_message.created_at
        session.add(user_message)

    queued = temp_ai_service.queue_run_for_message(
        conversation_id=opened["id"],
        trigger_message_id="msg-human-files-1",
        current_user_id=int(actor["id"]),
    )

    assert queued is not None
    assert temp_ai_service.process_next_run() is True

    with chat_db.chat_session(database_url) as session:
        messages = list(
            session.execute(
                select(chat_models.ChatMessage)
                .where(chat_models.ChatMessage.conversation_id == opened["id"])
                .order_by(chat_models.ChatMessage.conversation_seq.asc())
            ).scalars()
        )
        attachments = list(session.execute(select(chat_models.ChatMessageAttachment)).scalars())
        runs = list(session.execute(select(app_models.AppAiBotRun)).scalars())

    assert [message.kind for message in messages] == ["text", "text", "file"]
    assert messages[1].body == "Готово, файл приложен к чату."
    assert len(attachments) == 1
    assert attachments[0].file_name == "summary.txt"
    result_payload = json.loads(str(runs[0].result_json or "{}"))
    assert result_payload["generated_files_count"] == 1
    assert result_payload["generated_files"][0]["file_name"] == "summary.txt"
    first_system_prompt = str(completion_calls[0].get("system_prompt") or "")
    first_user_prompt = str(completion_calls[0].get("user_prompt") or "")
    assert "ITinvent live-data lookups/actions or file generation" in first_system_prompt
    assert "ITinvent live-data tools are disabled for this bot." in first_user_prompt
    assert "Enabled file tools:" in first_user_prompt
    assert "ai.files.create" in first_user_prompt
    assert "Use artifacts only as a legacy fallback" in first_user_prompt
    assert "User request understanding and query coaching" in first_system_prompt
    assert "ready-to-copy example requests" in first_system_prompt
    assert "Live ITinvent tools enabled" not in first_user_prompt


def test_ai_run_prompt_keeps_attachment_metadata_when_extraction_is_empty(tmp_path, monkeypatch):
    database_url = _configure_local_backend_runtime(tmp_path, monkeypatch, "ai_chat_prompt_attachment_metadata.db")

    ai_chat_module = importlib.import_module("backend.ai_chat.service")
    chat_service_module = importlib.import_module("backend.chat.service")
    chat_db = importlib.import_module("backend.chat.db")
    user_service_module = importlib.import_module("backend.services.user_service")

    monkeypatch.setattr(chat_service_module.hub_service, "data_dir", tmp_path, raising=False)

    temp_user_service = user_service_module.UserService(database_url=database_url)
    temp_chat_service = chat_service_module.ChatService()
    temp_chat_service._attachments_root = tmp_path / "chat_message_attachments"
    temp_chat_service._attachments_root.mkdir(parents=True, exist_ok=True)
    temp_chat_service._upload_sessions_root = tmp_path / "chat_upload_sessions"
    temp_chat_service._upload_sessions_root.mkdir(parents=True, exist_ok=True)
    temp_ai_service = ai_chat_module.AiChatService()

    monkeypatch.setattr(ai_chat_module, "user_service", temp_user_service)
    monkeypatch.setattr(chat_service_module, "user_service", temp_user_service)
    monkeypatch.setattr(ai_chat_module, "chat_service", temp_chat_service)
    monkeypatch.setattr(ai_chat_module.ai_kb_retrieval_service, "ensure_index_fresh", lambda **kwargs: None)
    monkeypatch.setattr(ai_chat_module.ai_kb_retrieval_service, "retrieve", lambda **kwargs: [])

    captured_prompt: dict[str, str] = {}

    def fake_complete_json(**kwargs):
        captured_prompt["user_prompt"] = str(kwargs.get("user_prompt") or "")
        return {"answer_markdown": "Done", "artifacts": []}, {"output_tokens": 8}

    monkeypatch.setattr(ai_chat_module.openrouter_client, "complete_json", fake_complete_json)
    monkeypatch.setattr(temp_ai_service, "_extract_chat_attachment_text", lambda **kwargs: "")

    chat_db.initialize_chat_schema(database_url)

    actor = temp_user_service.create_user(
        username="operator_prompt",
        password="secret-pass",
        role="viewer",
        auth_source="local",
        full_name="Operator Prompt",
        is_active=True,
        use_custom_permissions=True,
        custom_permissions=["chat.read", "chat.write", "chat.ai.use"],
    )

    bot = temp_ai_service.ensure_default_bot()
    conversation = temp_ai_service.open_bot_conversation(bot_id=bot["id"], current_user_id=int(actor["id"]))
    upload = UploadFile(
        filename="request.pdf",
        file=io.BytesIO(b"%PDF-1.4 mock"),
        headers={"content-type": "application/pdf"},
    )
    try:
        message = temp_chat_service.send_files(
            current_user_id=int(actor["id"]),
            conversation_id=conversation["id"],
            body="Проверь документ",
            uploads=[upload],
            defer_push_notifications=True,
        )
    finally:
        upload.file.close()

    queued = temp_ai_service.queue_run_for_message(
        conversation_id=conversation["id"],
        trigger_message_id=message["id"],
        current_user_id=int(actor["id"]),
    )

    assert queued is not None
    assert temp_ai_service.process_next_run() is True

    prompt = captured_prompt["user_prompt"]
    assert "Current user request:\nПроверь документ" in prompt
    assert "Attached file context:\nSource: current message" in prompt
    assert "File: request.pdf" in prompt
    assert "MIME: application/pdf" in prompt
    assert "Caption: Проверь документ" in prompt
    assert "Extracted text: unavailable" in prompt


def test_ai_run_prompt_uses_file_summary_when_caption_is_empty(tmp_path, monkeypatch):
    database_url = _configure_local_backend_runtime(tmp_path, monkeypatch, "ai_chat_prompt_attachment_fallback.db")

    ai_chat_module = importlib.import_module("backend.ai_chat.service")
    chat_service_module = importlib.import_module("backend.chat.service")
    chat_db = importlib.import_module("backend.chat.db")
    user_service_module = importlib.import_module("backend.services.user_service")

    monkeypatch.setattr(chat_service_module.hub_service, "data_dir", tmp_path, raising=False)

    temp_user_service = user_service_module.UserService(database_url=database_url)
    temp_chat_service = chat_service_module.ChatService()
    temp_chat_service._attachments_root = tmp_path / "chat_message_attachments"
    temp_chat_service._attachments_root.mkdir(parents=True, exist_ok=True)
    temp_chat_service._upload_sessions_root = tmp_path / "chat_upload_sessions"
    temp_chat_service._upload_sessions_root.mkdir(parents=True, exist_ok=True)
    temp_ai_service = ai_chat_module.AiChatService()

    monkeypatch.setattr(ai_chat_module, "user_service", temp_user_service)
    monkeypatch.setattr(chat_service_module, "user_service", temp_user_service)
    monkeypatch.setattr(ai_chat_module, "chat_service", temp_chat_service)
    monkeypatch.setattr(ai_chat_module.ai_kb_retrieval_service, "ensure_index_fresh", lambda **kwargs: None)
    monkeypatch.setattr(ai_chat_module.ai_kb_retrieval_service, "retrieve", lambda **kwargs: [])

    captured_prompt: dict[str, str] = {}

    def fake_complete_json(**kwargs):
        captured_prompt["user_prompt"] = str(kwargs.get("user_prompt") or "")
        return {"answer_markdown": "Done", "artifacts": []}, {"output_tokens": 5}

    monkeypatch.setattr(ai_chat_module.openrouter_client, "complete_json", fake_complete_json)
    monkeypatch.setattr(temp_ai_service, "_extract_chat_attachment_text", lambda **kwargs: "")

    chat_db.initialize_chat_schema(database_url)

    actor = temp_user_service.create_user(
        username="operator_fallback",
        password="secret-pass",
        role="viewer",
        auth_source="local",
        full_name="Operator Fallback",
        is_active=True,
        use_custom_permissions=True,
        custom_permissions=["chat.read", "chat.write", "chat.ai.use"],
    )

    bot = temp_ai_service.ensure_default_bot()
    conversation = temp_ai_service.open_bot_conversation(bot_id=bot["id"], current_user_id=int(actor["id"]))
    upload = UploadFile(
        filename="request.pdf",
        file=io.BytesIO(b"%PDF-1.4 mock"),
        headers={"content-type": "application/pdf"},
    )
    try:
        message = temp_chat_service.send_files(
            current_user_id=int(actor["id"]),
            conversation_id=conversation["id"],
            body="",
            uploads=[upload],
            defer_push_notifications=True,
        )
    finally:
        upload.file.close()

    queued = temp_ai_service.queue_run_for_message(
        conversation_id=conversation["id"],
        trigger_message_id=message["id"],
        current_user_id=int(actor["id"]),
    )

    assert queued is not None
    assert temp_ai_service.process_next_run() is True

    prompt = captured_prompt["user_prompt"]
    assert "Current user request:\nUser sent file: request.pdf." in prompt
    assert "Attached file context:\nSource: current message" in prompt
    assert "File: request.pdf" in prompt
    assert "Extracted text: unavailable" in prompt


def test_ai_chat_tools_use_effective_database_context(tmp_path, monkeypatch):
    database_url = _configure_local_backend_runtime(tmp_path, monkeypatch, "ai_chat_tools_runtime.db")

    ai_chat_module = importlib.import_module("backend.ai_chat.service")
    chat_service_module = importlib.import_module("backend.chat.service")
    chat_db = importlib.import_module("backend.chat.db")
    chat_models = importlib.import_module("backend.chat.models")
    app_models = importlib.import_module("backend.appdb.models")
    user_service_module = importlib.import_module("backend.services.user_service")

    monkeypatch.setattr(chat_service_module.hub_service, "data_dir", tmp_path, raising=False)

    temp_user_service = user_service_module.UserService(database_url=database_url)
    temp_chat_service = chat_service_module.ChatService()
    temp_chat_service._attachments_root = tmp_path / "chat_message_attachments"
    temp_chat_service._attachments_root.mkdir(parents=True, exist_ok=True)
    temp_chat_service._upload_sessions_root = tmp_path / "chat_upload_sessions"
    temp_chat_service._upload_sessions_root.mkdir(parents=True, exist_ok=True)
    temp_ai_service = ai_chat_module.AiChatService()

    monkeypatch.setattr(ai_chat_module, "user_service", temp_user_service)
    monkeypatch.setattr(chat_service_module, "user_service", temp_user_service)
    monkeypatch.setattr(ai_chat_module, "chat_service", temp_chat_service)
    monkeypatch.setattr(ai_chat_module.ai_kb_retrieval_service, "ensure_index_fresh", lambda **kwargs: None)
    monkeypatch.setattr(ai_chat_module.ai_kb_retrieval_service, "retrieve", lambda **kwargs: [])

    completion_calls: list[dict[str, object]] = []

    def fake_complete_json(**kwargs):
        completion_calls.append({
            "system_prompt": str(kwargs.get("system_prompt") or ""),
            "user_prompt": str(kwargs.get("user_prompt") or ""),
            "schema_name": str(kwargs.get("schema_name") or ""),
            "response_schema": kwargs.get("response_schema"),
        })
        if len(completion_calls) == 1:
            return {
                "answer_markdown": "",
                "tool_calls": [
                    {
                        "tool_id": "itinvent.equipment.search",
                        "args": {"query": "WS-42"},
                    }
                ],
            }, {
                "model": "openai/gpt-4o-mini",
                "prompt_tokens": 12,
                "completion_tokens": 6,
            "total_tokens": 18,
        }
        if len(completion_calls) > 1:
            raise ai_chat_module.OpenRouterClientError("LLM returned invalid JSON payload.")
        return {
            "answer_markdown": "Найдено устройство.\n\nИсточник: ITinvent / OBJ-ITINVENT",
            "artifacts": [],
        }, {
            "model": "openai/gpt-4o-mini",
            "prompt_tokens": 7,
            "completion_tokens": 9,
            "total_tokens": 16,
        }

    query_calls: list[dict[str, str]] = []

    def fake_search_equipment(search_term, db_id=None):
        query_calls.append({"search_term": str(search_term), "db_id": str(db_id or "")})
        return [
            {
                "inv_no": "WS-42",
                "serial_no": "SN-42",
                "name": "Ноутбук Lenovo",
                "owner_name": "Иван Иванов",
                "department": "ИТ отдел",
            }
        ]

    monkeypatch.setattr(ai_chat_module.openrouter_client, "complete_json", fake_complete_json)
    monkeypatch.setattr(ai_chat_module.openrouter_client, "get_status", lambda: {"configured": True, "default_model": "openai/gpt-4o-mini"})
    monkeypatch.setattr("backend.ai_chat.tools.itinvent.queries.search_equipment_by_serial", fake_search_equipment)

    chat_db.initialize_chat_schema(database_url)

    actor = temp_user_service.create_user(
        username="operator_tools",
        password="secret-pass",
        role="viewer",
        auth_source="local",
        full_name="Operator Tools",
        is_active=True,
        use_custom_permissions=True,
        custom_permissions=["chat.read", "chat.write", "chat.ai.use"],
    )

    bot = temp_ai_service.ensure_default_bot()
    updated_bot = temp_ai_service.update_bot(bot["id"], {
        "enabled_tools": ["itinvent.equipment.search"],
        "tool_settings": {
            "multi_db_mode": "single",
            "allowed_databases": [],
        },
    })
    assert updated_bot["enabled_tools"] == ["itinvent.equipment.search"]

    opened = temp_ai_service.open_bot_conversation(bot_id=bot["id"], current_user_id=int(actor["id"]))

    with chat_db.chat_session(database_url) as session:
        conversation = session.get(chat_models.ChatConversation, opened["id"])
        user_message = chat_models.ChatMessage(
            id="msg-human-tools-1",
            conversation_id=opened["id"],
            sender_user_id=int(actor["id"]),
            body="Найди устройство WS-42",
            body_format="plain",
            conversation_seq=1,
            created_at=datetime.now(timezone.utc),
        )
        conversation.last_message_id = user_message.id
        conversation.last_message_seq = 1
        conversation.last_message_at = user_message.created_at
        conversation.updated_at = user_message.created_at
        session.add(user_message)

    queued = temp_ai_service.queue_run_for_message(
        conversation_id=opened["id"],
        trigger_message_id="msg-human-tools-1",
        current_user_id=int(actor["id"]),
        effective_database_id="OBJ-ITINVENT",
    )

    assert queued is not None
    assert temp_ai_service.process_next_run() is True
    assert query_calls == [{"search_term": "WS-42", "db_id": "OBJ-ITINVENT"}]
    assert len(completion_calls) == 2
    assert "itinvent.equipment.search" in completion_calls[0]["user_prompt"]
    assert "Accumulated tool results JSON" in completion_calls[1]["user_prompt"]
    assert "matching the provided schema" in completion_calls[0]["system_prompt"]
    assert completion_calls[0]["schema_name"] == "ai_chat_response_with_tools"
    assert completion_calls[1]["schema_name"] == "ai_chat_response_with_tools"
    assert "tool_calls" in completion_calls[0]["response_schema"]["properties"]

    with chat_db.chat_session(database_url) as session:
        runs = list(session.execute(select(app_models.AppAiBotRun)).scalars())
        messages = list(
            session.execute(
                select(chat_models.ChatMessage)
                .where(chat_models.ChatMessage.conversation_id == opened["id"])
                .order_by(chat_models.ChatMessage.conversation_seq.asc())
            ).scalars()
        )

    assert len(runs) == 1
    assert json.loads(str(runs[0].request_json or "{}")).get("effective_database_id") == "OBJ-ITINVENT"
    result_payload = json.loads(str(runs[0].result_json or "{}"))
    assert result_payload.get("tool_traces")
    assert result_payload["tool_traces"][0]["tool_id"] == "itinvent.equipment.search"
    serialized_runs = temp_ai_service.list_recent_runs(bot_id=bot["id"])
    assert serialized_runs[0]["effective_database_id"] == "OBJ-ITINVENT"
    assert serialized_runs[0]["tool_traces_count"] == 1
    assert serialized_runs[0]["tool_trace_errors_count"] == 0
    assert "`itinvent.equipment.search`" in messages[-1].body
    assert messages[-1].body.endswith("Источник: ITinvent / OBJ-ITINVENT")


def test_ai_chat_tools_chain_employee_search_into_equipment_lookup(tmp_path, monkeypatch):
    database_url = _configure_local_backend_runtime(tmp_path, monkeypatch, "ai_chat_runtime_chain.db")
    ai_chat_module = importlib.import_module("backend.ai_chat.service")
    chat_service_module = importlib.import_module("backend.chat.service")
    chat_db = importlib.import_module("backend.chat.db")
    chat_models = importlib.import_module("backend.chat.models")
    app_models = importlib.import_module("backend.appdb.models")
    user_service_module = importlib.import_module("backend.services.user_service")

    monkeypatch.setattr(chat_service_module.hub_service, "data_dir", tmp_path, raising=False)

    temp_user_service = user_service_module.UserService(database_url=database_url)
    temp_chat_service = chat_service_module.ChatService()
    temp_chat_service._attachments_root = tmp_path / "chat_message_attachments"
    temp_chat_service._attachments_root.mkdir(parents=True, exist_ok=True)
    temp_chat_service._upload_sessions_root = tmp_path / "chat_upload_sessions"
    temp_chat_service._upload_sessions_root.mkdir(parents=True, exist_ok=True)
    temp_ai_service = ai_chat_module.AiChatService()

    monkeypatch.setattr(ai_chat_module, "user_service", temp_user_service)
    monkeypatch.setattr(chat_service_module, "user_service", temp_user_service)
    monkeypatch.setattr(ai_chat_module, "chat_service", temp_chat_service)
    monkeypatch.setattr(ai_chat_module.ai_kb_retrieval_service, "ensure_index_fresh", lambda **kwargs: None)
    monkeypatch.setattr(ai_chat_module.ai_kb_retrieval_service, "retrieve", lambda **kwargs: [])

    completion_calls: list[dict[str, object]] = []

    def fake_complete_json(**kwargs):
        completion_calls.append({
            "system_prompt": str(kwargs.get("system_prompt") or ""),
            "user_prompt": str(kwargs.get("user_prompt") or ""),
            "schema_name": str(kwargs.get("schema_name") or ""),
            "response_schema": kwargs.get("response_schema"),
        })
        if len(completion_calls) == 1:
            return {
                "answer_markdown": "",
                "tool_calls": [
                    {
                        "tool_id": "itinvent.employee.search",
                        "args": {"query": "Козловский Максим"},
                    }
                ],
            }, {
                "model": "openai/gpt-4o-mini",
                "prompt_tokens": 15,
                "completion_tokens": 6,
                "total_tokens": 21,
            }
        if len(completion_calls) == 2:
            return {
                "answer_markdown": "",
                "tool_calls": [
                    {
                        "tool_id": "itinvent.employee.list_equipment",
                        "args": {"owner_no": 501},
                    }
                ],
            }, {
                "model": "openai/gpt-4o-mini",
                "prompt_tokens": 11,
                "completion_tokens": 7,
                "total_tokens": 18,
            }
        return {
            "answer_markdown": (
                "## Итог\n"
                "За Козловским Максимом закреплено 1 устройство.\n\n"
                "## Устройства\n"
                "- Ноутбук Dell Latitude 5430\n"
                "  Инв. № 101\n"
                "  S/N: SN-101\n"
                "  Статус: В эксплуатации\n"
                "  Локация: Тюмень / Первомайская 19\n\n"
                "Источник: ITinvent / ITINVENT"
            ),
            "artifacts": [],
        }, {
            "model": "openai/gpt-4o-mini",
            "prompt_tokens": 10,
            "completion_tokens": 14,
            "total_tokens": 24,
        }

    employee_search_calls: list[dict[str, object]] = []
    employee_equipment_calls: list[dict[str, object]] = []

    def fake_search_employees(search_term, page=1, limit=50, db_id=None):
        employee_search_calls.append({
            "search_term": str(search_term),
            "page": int(page),
            "limit": int(limit),
            "db_id": str(db_id or ""),
        })
        return {
            "employees": [
                {
                    "OWNER_NO": 501,
                    "FIO": "Козловский Максим",
                    "DEPARTMENT": "ИТ отдел",
                    "POSITION": "Системный администратор",
                }
            ],
            "total": 1,
            "page": int(page),
            "limit": int(limit),
            "pages": 1,
        }

    def fake_get_equipment_by_owner(owner_no, db_id=None):
        employee_equipment_calls.append({
            "owner_no": int(owner_no),
            "db_id": str(db_id or ""),
        })
        return [
            {
                "INV_NO": "101",
                "TYPE_NAME": "Ноутбук",
                "ITEM_NAME": "Ноутбук Dell Latitude 5430",
                "SERIAL_NO": "SN-101",
                "STATUS_NAME": "В эксплуатации",
                "BRANCH_NAME": "Тюмень",
                "LOCATION_NAME": "Первомайская 19",
                "FIO": "Козловский Максим",
                "DEPARTMENT": "ИТ отдел",
            }
        ]

    monkeypatch.setattr(ai_chat_module.openrouter_client, "complete_json", fake_complete_json)
    monkeypatch.setattr(
        ai_chat_module.openrouter_client,
        "get_status",
        lambda: {"configured": True, "default_model": "openai/gpt-4o-mini"},
    )
    monkeypatch.setattr("backend.ai_chat.tools.itinvent.queries.search_employees", fake_search_employees)
    monkeypatch.setattr("backend.ai_chat.tools.itinvent.queries.get_equipment_by_owner", fake_get_equipment_by_owner)

    chat_db.initialize_chat_schema(database_url)

    actor = temp_user_service.create_user(
        username="operator_chain",
        password="secret-pass",
        role="viewer",
        auth_source="local",
        full_name="Operator Chain",
        is_active=True,
        use_custom_permissions=True,
        custom_permissions=["chat.read", "chat.write", "chat.ai.use"],
    )

    bot = temp_ai_service.ensure_default_bot()
    updated_bot = temp_ai_service.update_bot(bot["id"], {
        "enabled_tools": ["itinvent.employee.search", "itinvent.employee.list_equipment"],
        "tool_settings": {
            "multi_db_mode": "single",
            "allowed_databases": [],
        },
    })
    assert updated_bot["enabled_tools"] == ["itinvent.employee.search", "itinvent.employee.list_equipment"]

    opened = temp_ai_service.open_bot_conversation(bot_id=bot["id"], current_user_id=int(actor["id"]))

    with chat_db.chat_session(database_url) as session:
        conversation = session.get(chat_models.ChatConversation, opened["id"])
        user_message = chat_models.ChatMessage(
            id="msg-human-tools-chain-1",
            conversation_id=opened["id"],
            sender_user_id=int(actor["id"]),
            body="Какая техника числится на сотруднике Козловском Максиме",
            body_format="plain",
            conversation_seq=1,
            created_at=datetime.now(timezone.utc),
        )
        conversation.last_message_id = user_message.id
        conversation.last_message_seq = 1
        conversation.last_message_at = user_message.created_at
        conversation.updated_at = user_message.created_at
        session.add(user_message)

    queued = temp_ai_service.queue_run_for_message(
        conversation_id=opened["id"],
        trigger_message_id="msg-human-tools-chain-1",
        current_user_id=int(actor["id"]),
        effective_database_id="ITINVENT",
    )

    assert queued is not None
    assert temp_ai_service.process_next_run() is True
    assert employee_search_calls == [
        {
            "search_term": "Козловский Максим",
            "page": 1,
            "limit": 250,
            "db_id": "ITINVENT",
        }
    ]
    assert employee_equipment_calls == [
        {"owner_no": 501, "db_id": "ITINVENT"},
    ]
    assert len(completion_calls) == 3
    assert "structured detailed markdown answer in Russian" in completion_calls[0]["user_prompt"]
    assert "Accumulated tool results JSON" in completion_calls[1]["user_prompt"]
    assert '"owner_no": 501' in completion_calls[1]["user_prompt"]
    assert "Accumulated tool results JSON" in completion_calls[2]["user_prompt"]
    assert '"tool_id": "itinvent.employee.list_equipment"' in completion_calls[2]["user_prompt"]
    assert completion_calls[0]["schema_name"] == "ai_chat_response_with_tools"
    assert completion_calls[2]["schema_name"] == "ai_chat_response_with_tools"

    with chat_db.chat_session(database_url) as session:
        runs = list(session.execute(select(app_models.AppAiBotRun)).scalars())
        messages = list(
            session.execute(
                select(chat_models.ChatMessage)
                .where(chat_models.ChatMessage.conversation_id == opened["id"])
                .order_by(chat_models.ChatMessage.conversation_seq.asc())
            ).scalars()
        )

    assert len(runs) == 1
    result_payload = json.loads(str(runs[0].result_json or "{}"))
    assert [item["tool_id"] for item in result_payload.get("tool_traces") or []] == [
        "itinvent.employee.search",
        "itinvent.employee.list_equipment",
    ]
    serialized_runs = temp_ai_service.list_recent_runs(bot_id=bot["id"])
    assert serialized_runs[0]["effective_database_id"] == "ITINVENT"
    assert serialized_runs[0]["tool_traces_count"] == 2
    assert serialized_runs[0]["tool_trace_errors_count"] == 0
    assert "## Итог" in messages[-1].body
    assert "Dell Latitude 5430" in messages[-1].body
    assert "Статус: В эксплуатации" in messages[-1].body
    assert messages[-1].body.endswith("Источник: ITinvent / ITINVENT")


def test_ai_chat_tools_route_broad_equipment_queries_through_universal_search(tmp_path, monkeypatch):
    database_url = _configure_local_backend_runtime(tmp_path, monkeypatch, "ai_chat_runtime_universal.db")

    ai_chat_module = importlib.import_module("backend.ai_chat.service")
    chat_service_module = importlib.import_module("backend.chat.service")
    chat_db = importlib.import_module("backend.chat.db")
    chat_models = importlib.import_module("backend.chat.models")
    app_models = importlib.import_module("backend.appdb.models")
    user_service_module = importlib.import_module("backend.services.user_service")

    monkeypatch.setattr(chat_service_module.hub_service, "data_dir", tmp_path, raising=False)

    temp_user_service = user_service_module.UserService(database_url=database_url)
    temp_chat_service = chat_service_module.ChatService()
    temp_chat_service._attachments_root = tmp_path / "chat_message_attachments"
    temp_chat_service._attachments_root.mkdir(parents=True, exist_ok=True)
    temp_chat_service._upload_sessions_root = tmp_path / "chat_upload_sessions"
    temp_chat_service._upload_sessions_root.mkdir(parents=True, exist_ok=True)
    temp_ai_service = ai_chat_module.AiChatService()

    monkeypatch.setattr(ai_chat_module, "user_service", temp_user_service)
    monkeypatch.setattr(chat_service_module, "user_service", temp_user_service)
    monkeypatch.setattr(ai_chat_module, "chat_service", temp_chat_service)
    monkeypatch.setattr(ai_chat_module.ai_kb_retrieval_service, "ensure_index_fresh", lambda **kwargs: None)
    monkeypatch.setattr(ai_chat_module.ai_kb_retrieval_service, "retrieve", lambda **kwargs: [])

    completion_calls: list[dict[str, str]] = []

    def fake_complete_json(**kwargs):
        completion_calls.append({
            "system_prompt": str(kwargs.get("system_prompt") or ""),
            "user_prompt": str(kwargs.get("user_prompt") or ""),
        })
        if len(completion_calls) == 1:
            return {
                "answer_markdown": "",
                "tool_calls": [
                    {
                        "tool_id": "itinvent.equipment.search_universal",
                        "args": {"query": "мониторы"},
                    }
                ],
            }, {
                "model": "openai/gpt-4o-mini",
                "prompt_tokens": 16,
                "completion_tokens": 7,
                "total_tokens": 23,
            }
        return {
            "answer_markdown": (
                "## Найдено\n"
                "Найдено 2 монитора в текущей базе.\n\n"
                "## Сводка\n"
                "- LG 24MK430H-B, Тюмень / Первомайская 19\n"
                "- Dell P2422H, Тюмень / Первомайская 19\n\n"
                "## Что можно уточнить\n"
                "Могу сузить выборку по филиалу, сотруднику или точной модели.\n\n"
                "Источник: ITinvent / ITINVENT"
            ),
            "artifacts": [],
        }, {
            "model": "openai/gpt-4o-mini",
            "prompt_tokens": 12,
            "completion_tokens": 16,
            "total_tokens": 28,
        }

    universal_search_calls: list[dict[str, object]] = []

    def fake_search_equipment_universal(search_term, page=1, limit=50, db_id=None):
        universal_search_calls.append({
            "search_term": str(search_term),
            "page": int(page),
            "limit": int(limit),
            "db_id": str(db_id or ""),
        })
        return {
            "equipment": [
                {
                    "INV_NO": "201",
                    "TYPE_NAME": "Монитор",
                    "MODEL_NAME": "LG 24MK430H-B",
                    "VENDOR_NAME": "LG",
                    "STATUS_NAME": "В эксплуатации",
                    "BRANCH_NAME": "Тюмень",
                    "LOCATION_NAME": "Первомайская 19",
                },
                {
                    "INV_NO": "202",
                    "TYPE_NAME": "Монитор",
                    "MODEL_NAME": "Dell P2422H",
                    "VENDOR_NAME": "Dell",
                    "STATUS_NAME": "В эксплуатации",
                    "BRANCH_NAME": "Тюмень",
                    "LOCATION_NAME": "Первомайская 19",
                },
            ],
            "total": 2,
            "page": int(page),
            "limit": int(limit),
            "pages": 1,
        }

    monkeypatch.setattr(ai_chat_module.openrouter_client, "complete_json", fake_complete_json)
    monkeypatch.setattr(ai_chat_module.openrouter_client, "get_status", lambda: {"configured": True, "default_model": "openai/gpt-4o-mini"})
    monkeypatch.setattr("backend.ai_chat.tools.itinvent.queries.search_equipment_universal", fake_search_equipment_universal)

    chat_db.initialize_chat_schema(database_url)

    actor = temp_user_service.create_user(
        username="operator_universal",
        password="secret-pass",
        role="viewer",
        auth_source="local",
        full_name="Operator Universal",
        is_active=True,
        use_custom_permissions=True,
        custom_permissions=["chat.read", "chat.write", "chat.ai.use"],
    )

    bot = temp_ai_service.ensure_default_bot()
    updated_bot = temp_ai_service.update_bot(bot["id"], {
        "enabled_tools": ["itinvent.equipment.search_universal"],
        "tool_settings": {
            "multi_db_mode": "single",
            "allowed_databases": [],
        },
    })
    assert updated_bot["enabled_tools"] == ["itinvent.equipment.search_universal"]

    opened = temp_ai_service.open_bot_conversation(bot_id=bot["id"], current_user_id=int(actor["id"]))

    with chat_db.chat_session(database_url) as session:
        conversation = session.get(chat_models.ChatConversation, opened["id"])
        user_message = chat_models.ChatMessage(
            id="msg-human-tools-universal-1",
            conversation_id=opened["id"],
            sender_user_id=int(actor["id"]),
            body="Найди мониторы",
            body_format="plain",
            conversation_seq=1,
            created_at=datetime.now(timezone.utc),
        )
        conversation.last_message_id = user_message.id
        conversation.last_message_seq = 1
        conversation.last_message_at = user_message.created_at
        conversation.updated_at = user_message.created_at
        session.add(user_message)

    queued = temp_ai_service.queue_run_for_message(
        conversation_id=opened["id"],
        trigger_message_id="msg-human-tools-universal-1",
        current_user_id=int(actor["id"]),
        effective_database_id="ITINVENT",
    )

    assert queued is not None
    assert temp_ai_service.process_next_run() is True
    assert universal_search_calls == [{
        "search_term": "мониторы",
        "page": 1,
        "limit": 250,
        "db_id": "ITINVENT",
    }]
    assert "Broad equipment questions about categories" in completion_calls[0]["user_prompt"]

    with chat_db.chat_session(database_url) as session:
        runs = list(session.execute(select(app_models.AppAiBotRun)).scalars())
        messages = list(
            session.execute(
                select(chat_models.ChatMessage)
                .where(chat_models.ChatMessage.conversation_id == opened["id"])
                .order_by(chat_models.ChatMessage.conversation_seq.asc())
            ).scalars()
        )

    assert len(runs) == 1
    result_payload = json.loads(str(runs[0].result_json or "{}"))
    assert [item["tool_id"] for item in result_payload.get("tool_traces") or []] == [
        "itinvent.equipment.search_universal",
    ]
    assert "## Найдено" in messages[-1].body
    assert "LG 24MK430H-B" in messages[-1].body
    assert messages[-1].body.endswith("Источник: ITinvent / ITINVENT")


def test_itinvent_universal_search_handles_type_plus_location_phrase(monkeypatch):
    it_module = importlib.import_module("backend.ai_chat.tools.itinvent")
    context_module = importlib.import_module("backend.ai_chat.tools.context")

    calls: list[str] = []

    def fake_search_equipment_universal(search_term, page=1, limit=50, db_id=None):
        calls.append(str(search_term))
        if search_term == "монитор":
            return {
                "equipment": [
                    {
                        "inv_no": "1001",
                        "serial_no": "SN-1001",
                        "type_name": "Монитор",
                        "model_name": "Dell P2422H",
                        "branch_name": "Грибоедова, 64",
                        "location_name": "Кабинет 201",
                    },
                    {
                        "inv_no": "1002",
                        "serial_no": "SN-1002",
                        "type_name": "Монитор",
                        "model_name": "LG 24MK430H-B",
                        "branch_name": "Ленина 1",
                        "location_name": "Кабинет 101",
                    },
                ],
                "total": 2,
            }
        if search_term == "грибоедова 64":
            return {
                "equipment": [
                    {
                        "inv_no": "1001",
                        "serial_no": "SN-1001",
                        "type_name": "Монитор",
                        "model_name": "Dell P2422H",
                        "branch_name": "Грибоедова, 64",
                        "location_name": "Кабинет 201",
                    },
                    {
                        "inv_no": "1003",
                        "serial_no": "SN-1003",
                        "type_name": "Принтер",
                        "model_name": "HP LaserJet",
                        "branch_name": "Грибоедова, 64",
                        "location_name": "Кабинет 201",
                    },
                ],
                "total": 2,
            }
        return {"equipment": [], "total": 0}

    monkeypatch.setattr(it_module.queries, "search_equipment_universal", fake_search_equipment_universal)

    context = context_module.AiToolExecutionContext(
        bot_id="bot-1",
        bot_title="Bot",
        conversation_id="conv-1",
        run_id="run-1",
        user_id=1,
        user_payload={"role": "viewer"},
        effective_database_id="ITINVENT",
        enabled_tools=["itinvent.equipment.search_universal"],
        tool_settings={},
    )
    tool = it_module.EquipmentSearchUniversalTool()
    args = tool.validate_args({"query": "найди мне все мониторы на грибоедова 64"})

    payload = tool.execute(context=context, args=args).to_payload()

    assert calls == ["найди мне все мониторы на грибоедова 64", "монитор", "грибоедова 64"]
    assert payload["ok"] is True
    assert payload["data"]["query_hints"] == {"type": "монитор", "place": "грибоедова 64"}
    assert payload["data"]["returned_count"] == 1
    assert payload["data"]["items"][0]["inv_no"] == "1001"
    assert payload["data"]["items"][0]["serial_no"] == "SN-1001"


def test_ai_chat_tools_route_consumables_queries_through_consumables_search(tmp_path, monkeypatch):
    database_url = _configure_local_backend_runtime(tmp_path, monkeypatch, "ai_chat_runtime_consumables.db")

    ai_chat_module = importlib.import_module("backend.ai_chat.service")
    chat_service_module = importlib.import_module("backend.chat.service")
    chat_db = importlib.import_module("backend.chat.db")
    chat_models = importlib.import_module("backend.chat.models")
    app_models = importlib.import_module("backend.appdb.models")
    user_service_module = importlib.import_module("backend.services.user_service")

    monkeypatch.setattr(chat_service_module.hub_service, "data_dir", tmp_path, raising=False)

    temp_user_service = user_service_module.UserService(database_url=database_url)
    temp_chat_service = chat_service_module.ChatService()
    temp_chat_service._attachments_root = tmp_path / "chat_message_attachments"
    temp_chat_service._attachments_root.mkdir(parents=True, exist_ok=True)
    temp_chat_service._upload_sessions_root = tmp_path / "chat_upload_sessions"
    temp_chat_service._upload_sessions_root.mkdir(parents=True, exist_ok=True)
    temp_ai_service = ai_chat_module.AiChatService()

    monkeypatch.setattr(ai_chat_module, "user_service", temp_user_service)
    monkeypatch.setattr(chat_service_module, "user_service", temp_user_service)
    monkeypatch.setattr(ai_chat_module, "chat_service", temp_chat_service)
    monkeypatch.setattr(ai_chat_module.ai_kb_retrieval_service, "ensure_index_fresh", lambda **kwargs: None)
    monkeypatch.setattr(ai_chat_module.ai_kb_retrieval_service, "retrieve", lambda **kwargs: [])

    completion_calls: list[dict[str, str]] = []

    def fake_complete_json(**kwargs):
        completion_calls.append({
            "system_prompt": str(kwargs.get("system_prompt") or ""),
            "user_prompt": str(kwargs.get("user_prompt") or ""),
        })
        if len(completion_calls) == 1:
            return {
                "answer_markdown": "",
                "tool_calls": [
                    {
                        "tool_id": "itinvent.consumables.search",
                        "args": {"query": "картриджи"},
                    }
                ],
            }, {
                "model": "openai/gpt-4o-mini",
                "prompt_tokens": 16,
                "completion_tokens": 7,
                "total_tokens": 23,
            }
        return {
            "answer_markdown": (
                "## Найдено\n"
                "Доступно 2 позиции расходников.\n\n"
                "## Позиции\n"
                "- HP 85A, тип: Картридж, количество: 12, Тюмень / Склад\n"
                "- Canon 725, тип: Картридж, количество: 7, Тюмень / Склад\n\n"
                "Источник: ITinvent / ITINVENT"
            ),
            "artifacts": [],
        }, {
            "model": "openai/gpt-4o-mini",
            "prompt_tokens": 11,
            "completion_tokens": 14,
            "total_tokens": 25,
        }

    consumable_calls: list[dict[str, object]] = []

    def fake_get_consumables_lookup(**kwargs):
        consumable_calls.append(dict(kwargs))
        return [
            {
                "ID": 77,
                "INV_NO": "C-100",
                "TYPE_NAME": "Картридж",
                "MODEL_NAME": "HP 85A",
                "QTY": 12,
                "BRANCH_NAME": "Тюмень",
                "LOCATION_NAME": "Склад",
                "DESCRIPTION": "Лазерный картридж",
            },
            {
                "ID": 78,
                "INV_NO": "C-101",
                "TYPE_NAME": "Картридж",
                "MODEL_NAME": "Canon 725",
                "QTY": 7,
                "BRANCH_NAME": "Тюмень",
                "LOCATION_NAME": "Склад",
                "DESCRIPTION": "Тонер картридж",
            },
        ]

    monkeypatch.setattr(ai_chat_module.openrouter_client, "complete_json", fake_complete_json)
    monkeypatch.setattr(ai_chat_module.openrouter_client, "get_status", lambda: {"configured": True, "default_model": "openai/gpt-4o-mini"})
    monkeypatch.setattr("backend.ai_chat.tools.itinvent.queries.get_consumables_lookup", fake_get_consumables_lookup)

    chat_db.initialize_chat_schema(database_url)

    actor = temp_user_service.create_user(
        username="operator_consumables",
        password="secret-pass",
        role="viewer",
        auth_source="local",
        full_name="Operator Consumables",
        is_active=True,
        use_custom_permissions=True,
        custom_permissions=["chat.read", "chat.write", "chat.ai.use"],
    )

    bot = temp_ai_service.ensure_default_bot()
    updated_bot = temp_ai_service.update_bot(bot["id"], {
        "enabled_tools": ["itinvent.consumables.search"],
        "tool_settings": {
            "multi_db_mode": "single",
            "allowed_databases": [],
        },
    })
    assert updated_bot["enabled_tools"] == ["itinvent.consumables.search"]

    opened = temp_ai_service.open_bot_conversation(bot_id=bot["id"], current_user_id=int(actor["id"]))

    with chat_db.chat_session(database_url) as session:
        conversation = session.get(chat_models.ChatConversation, opened["id"])
        user_message = chat_models.ChatMessage(
            id="msg-human-tools-consumables-1",
            conversation_id=opened["id"],
            sender_user_id=int(actor["id"]),
            body="Найди комплектующие и картриджи",
            body_format="plain",
            conversation_seq=1,
            created_at=datetime.now(timezone.utc),
        )
        conversation.last_message_id = user_message.id
        conversation.last_message_seq = 1
        conversation.last_message_at = user_message.created_at
        conversation.updated_at = user_message.created_at
        session.add(user_message)

    queued = temp_ai_service.queue_run_for_message(
        conversation_id=opened["id"],
        trigger_message_id="msg-human-tools-consumables-1",
        current_user_id=int(actor["id"]),
        effective_database_id="ITINVENT",
    )

    assert queued is not None
    assert temp_ai_service.process_next_run() is True
    assert consumable_calls == [{
        "db_id": "ITINVENT",
        "model_name": None,
        "branch_no": None,
        "only_positive_qty": True,
        "limit": 1000,
    }]

    with chat_db.chat_session(database_url) as session:
        runs = list(session.execute(select(app_models.AppAiBotRun)).scalars())
        messages = list(
            session.execute(
                select(chat_models.ChatMessage)
                .where(chat_models.ChatMessage.conversation_id == opened["id"])
                .order_by(chat_models.ChatMessage.conversation_seq.asc())
            ).scalars()
        )

    assert len(runs) == 1
    result_payload = json.loads(str(runs[0].result_json or "{}"))
    assert [item["tool_id"] for item in result_payload.get("tool_traces") or []] == [
        "itinvent.consumables.search",
    ]
    assert "количество: 12" in messages[-1].body
    assert messages[-1].body.endswith("Источник: ITinvent / ITINVENT")


def test_ai_chat_tools_route_branch_queries_through_branch_inventory_tool(tmp_path, monkeypatch):
    database_url = _configure_local_backend_runtime(tmp_path, monkeypatch, "ai_chat_runtime_branch.db")

    ai_chat_module = importlib.import_module("backend.ai_chat.service")
    chat_service_module = importlib.import_module("backend.chat.service")
    chat_db = importlib.import_module("backend.chat.db")
    chat_models = importlib.import_module("backend.chat.models")
    app_models = importlib.import_module("backend.appdb.models")
    user_service_module = importlib.import_module("backend.services.user_service")

    monkeypatch.setattr(chat_service_module.hub_service, "data_dir", tmp_path, raising=False)

    temp_user_service = user_service_module.UserService(database_url=database_url)
    temp_chat_service = chat_service_module.ChatService()
    temp_chat_service._attachments_root = tmp_path / "chat_message_attachments"
    temp_chat_service._attachments_root.mkdir(parents=True, exist_ok=True)
    temp_chat_service._upload_sessions_root = tmp_path / "chat_upload_sessions"
    temp_chat_service._upload_sessions_root.mkdir(parents=True, exist_ok=True)
    temp_ai_service = ai_chat_module.AiChatService()

    monkeypatch.setattr(ai_chat_module, "user_service", temp_user_service)
    monkeypatch.setattr(chat_service_module, "user_service", temp_user_service)
    monkeypatch.setattr(ai_chat_module, "chat_service", temp_chat_service)
    monkeypatch.setattr(ai_chat_module.ai_kb_retrieval_service, "ensure_index_fresh", lambda **kwargs: None)
    monkeypatch.setattr(ai_chat_module.ai_kb_retrieval_service, "retrieve", lambda **kwargs: [])

    completion_calls: list[dict[str, str]] = []

    def fake_complete_json(**kwargs):
        completion_calls.append({
            "system_prompt": str(kwargs.get("system_prompt") or ""),
            "user_prompt": str(kwargs.get("user_prompt") or ""),
        })
        if len(completion_calls) == 1:
            return {
                "answer_markdown": "",
                "tool_calls": [
                    {
                        "tool_id": "itinvent.equipment.list_by_branch",
                        "args": {"branch_name": "Тюмень"},
                    }
                ],
            }, {
                "model": "openai/gpt-4o-mini",
                "prompt_tokens": 15,
                "completion_tokens": 6,
                "total_tokens": 21,
            }
        return {
            "answer_markdown": (
                "## Найдено\n"
                "Во филиале Тюмень найдено 2 устройства.\n\n"
                "## Примеры\n"
                "- Ноутбук Dell Latitude 5430, инв. 101, Тюмень / Первомайская 19\n"
                "- Монитор Dell P2422H, инв. 202, Тюмень / Первомайская 19\n\n"
                "## Что можно уточнить\n"
                "Могу показать только мониторы, только ноутбуки или технику конкретного сотрудника.\n\n"
                "Источник: ITinvent / ITINVENT"
            ),
            "artifacts": [],
        }, {
            "model": "openai/gpt-4o-mini",
            "prompt_tokens": 11,
            "completion_tokens": 15,
            "total_tokens": 26,
        }

    branch_calls: list[dict[str, object]] = []

    def fake_get_equipment_by_branch(branch_name, page=1, limit=10000, db_id=None):
        branch_calls.append({
            "branch_name": str(branch_name),
            "page": int(page),
            "limit": int(limit),
            "db_id": str(db_id or ""),
        })
        return {
            "equipment": [
                {
                    "INV_NO": "101",
                    "TYPE_NAME": "Ноутбук",
                    "MODEL_NAME": "Dell Latitude 5430",
                    "BRANCH_NAME": "Тюмень",
                    "LOCATION": "Первомайская 19",
                    "STATUS": "В эксплуатации",
                },
                {
                    "INV_NO": "202",
                    "TYPE_NAME": "Монитор",
                    "MODEL_NAME": "Dell P2422H",
                    "BRANCH_NAME": "Тюмень",
                    "LOCATION": "Первомайская 19",
                    "STATUS": "В эксплуатации",
                },
            ],
            "total": 2,
            "page": int(page),
            "limit": int(limit),
            "pages": 1,
        }

    monkeypatch.setattr(ai_chat_module.openrouter_client, "complete_json", fake_complete_json)
    monkeypatch.setattr(ai_chat_module.openrouter_client, "get_status", lambda: {"configured": True, "default_model": "openai/gpt-4o-mini"})
    monkeypatch.setattr("backend.ai_chat.tools.itinvent.equipment_db.get_equipment_by_branch", fake_get_equipment_by_branch)

    chat_db.initialize_chat_schema(database_url)

    actor = temp_user_service.create_user(
        username="operator_branch",
        password="secret-pass",
        role="viewer",
        auth_source="local",
        full_name="Operator Branch",
        is_active=True,
        use_custom_permissions=True,
        custom_permissions=["chat.read", "chat.write", "chat.ai.use"],
    )

    bot = temp_ai_service.ensure_default_bot()
    updated_bot = temp_ai_service.update_bot(bot["id"], {
        "enabled_tools": ["itinvent.equipment.list_by_branch"],
        "tool_settings": {
            "multi_db_mode": "single",
            "allowed_databases": [],
        },
    })
    assert updated_bot["enabled_tools"] == ["itinvent.equipment.list_by_branch"]

    opened = temp_ai_service.open_bot_conversation(bot_id=bot["id"], current_user_id=int(actor["id"]))

    with chat_db.chat_session(database_url) as session:
        conversation = session.get(chat_models.ChatConversation, opened["id"])
        user_message = chat_models.ChatMessage(
            id="msg-human-tools-branch-1",
            conversation_id=opened["id"],
            sender_user_id=int(actor["id"]),
            body="Что стоит в филиале Тюмень",
            body_format="plain",
            conversation_seq=1,
            created_at=datetime.now(timezone.utc),
        )
        conversation.last_message_id = user_message.id
        conversation.last_message_seq = 1
        conversation.last_message_at = user_message.created_at
        conversation.updated_at = user_message.created_at
        session.add(user_message)

    queued = temp_ai_service.queue_run_for_message(
        conversation_id=opened["id"],
        trigger_message_id="msg-human-tools-branch-1",
        current_user_id=int(actor["id"]),
        effective_database_id="ITINVENT",
    )

    assert queued is not None
    assert temp_ai_service.process_next_run() is True
    assert branch_calls == [{
        "branch_name": "Тюмень",
        "page": 1,
        "limit": 250,
        "db_id": "ITINVENT",
    }]

    with chat_db.chat_session(database_url) as session:
        runs = list(session.execute(select(app_models.AppAiBotRun)).scalars())
        messages = list(
            session.execute(
                select(chat_models.ChatMessage)
                .where(chat_models.ChatMessage.conversation_id == opened["id"])
                .order_by(chat_models.ChatMessage.conversation_seq.asc())
            ).scalars()
        )

    assert len(runs) == 1
    result_payload = json.loads(str(runs[0].result_json or "{}"))
    assert [item["tool_id"] for item in result_payload.get("tool_traces") or []] == [
        "itinvent.equipment.list_by_branch",
    ]
    assert "## Найдено" in messages[-1].body
    assert "Dell Latitude 5430" in messages[-1].body
    assert messages[-1].body.endswith("Источник: ITinvent / ITINVENT")
