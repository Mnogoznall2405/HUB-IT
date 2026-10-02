"""AG-2: AI tool permission mapping, spec filtering and execute-time checks."""
import sys
from pathlib import Path

import pytest
from pydantic import BaseModel, Field

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.ai_chat.tool_permissions import (
    filter_tools_for_user,
    tool_required_permissions,
    user_can_use_tool,
)
from backend.ai_chat.tools.base import AiTool, AiToolResult
from backend.ai_chat.tools.context import AiToolExecutionContext
from backend.ai_chat.tools.registry import AiToolRegistry
from backend.ai_chat import tools  # noqa: F401  # populate the global registry


ADMIN = {"id": 1, "role": "admin"}
VIEWER = {"id": 2, "role": "viewer"}          # chat.ai.use, tasks.*, mail.access, kb.read, chat.*
OPERATOR = {"id": 3, "role": "operator"}      # + database.*, mfu.read, networks.*, computers.*


def _custom(*permissions):
    return {
        "id": 7,
        "role": "viewer",
        "use_custom_permissions": True,
        "custom_permissions": list(permissions),
    }


def _context(user_payload, enabled_tools):
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


class _EchoArgs(BaseModel):
    query: str = Field(default="ping")


class _EchoTool(AiTool):
    def __init__(self, tool_id: str) -> None:
        self.tool_id = tool_id

    description = "Echo."
    input_model = _EchoArgs

    def execute(self, *, context: AiToolExecutionContext, args: BaseModel) -> AiToolResult:
        return AiToolResult(tool_id=self.tool_id, ok=True, data={"echo": "ok"})


def test_required_permissions_mapping():
    assert tool_required_permissions("itinvent.equipment.search") == ["database.read"]
    assert tool_required_permissions("itinvent.user.full_context") == ["database.read"]
    assert tool_required_permissions("itinvent.action.transfer_draft") == ["database.write"]
    assert tool_required_permissions("ad.user.groups") == ["ad_users.read"]
    assert tool_required_permissions("ad.action.unlock_draft") == ["ad_users.manage"]
    assert tool_required_permissions("network.host.ping") == ["networks.read"]
    assert tool_required_permissions("network.action.wol_draft") == ["networks.write"]
    assert tool_required_permissions("office.mail.search") == ["mail.access"]
    assert tool_required_permissions("office.action.mail_send_draft") == ["mail.access"]
    assert tool_required_permissions("office.tasks.search") == ["tasks.read"]
    assert tool_required_permissions("office.action.task_create_draft") == ["tasks.create"]
    assert tool_required_permissions("office.action.task_comment_draft") == ["tasks.write"]
    assert tool_required_permissions("office.workday.summary") == ["tasks.read"]
    assert tool_required_permissions("office.announcements.list") == ["announcements.read"]
    assert tool_required_permissions("ai.files.create") == ["chat.ai.use"]
    assert tool_required_permissions("kb.articles.search") == ["kb.read"]
    assert tool_required_permissions("mfu.devices.list") == ["mfu.read"]
    assert tool_required_permissions("chat.users.search") == ["chat.read"]
    assert tool_required_permissions("chat.action.message_send_draft") == ["chat.write"]
    assert tool_required_permissions("voice.meetings.search") == ["voice.read"]
    # Unmapped tools keep only the baseline AI permission.
    assert tool_required_permissions("totally.unmapped.tool") == ["chat.ai.use"]


def test_user_can_use_tool_by_role():
    assert not user_can_use_tool("itinvent.equipment.search", VIEWER)
    assert user_can_use_tool("itinvent.equipment.search", OPERATOR)
    assert user_can_use_tool("itinvent.action.transfer_draft", OPERATOR)
    assert not user_can_use_tool("ad.user.groups", OPERATOR)
    assert not user_can_use_tool("network.host.ping", VIEWER)
    assert user_can_use_tool("ai.files.create", VIEWER)
    assert user_can_use_tool("kb.articles.search", VIEWER)
    # Admin sees everything, including the admin-only multi-db search.
    assert user_can_use_tool("itinvent.equipment.search_multi_db", ADMIN)
    assert user_can_use_tool("ad.action.unlock_draft", ADMIN)
    # Admin-only tool stays closed for a full-permission non-admin.
    assert not user_can_use_tool("itinvent.equipment.search_multi_db", OPERATOR)


def test_user_can_use_tool_custom_permissions_both_forms():
    it_user = _custom("ad_users.read", "networks.read")
    assert user_can_use_tool("ad.user.groups", it_user)
    assert user_can_use_tool("network.host.ping", it_user)
    assert not user_can_use_tool("network.action.wol_draft", it_user)
    assert not user_can_use_tool("ad.action.unlock_draft", _custom("ad_users.read"))
    assert user_can_use_tool("ad.action.unlock_draft", _custom("ad_users.manage"))
    assert user_can_use_tool("network.action.wol_draft", _custom("networks.write"))
    # custom_permissions may arrive as a JSON string (AppUser.custom_permissions_json shape).
    json_payload = _custom("database.read")
    json_payload["custom_permissions"] = '["database.read"]'
    assert user_can_use_tool("itinvent.equipment.search", json_payload)


def test_filter_tools_for_user_keeps_order_and_unmapped():
    tool_ids = [
        "itinvent.equipment.search",
        "ai.files.create",
        "ad.user.groups",
        "network.host.ping",
        "office.tasks.search",
        "made.up.tool",
        "itinvent.equipment.search",
    ]
    assert filter_tools_for_user(tool_ids, VIEWER) == [
        "ai.files.create",
        "office.tasks.search",
        "made.up.tool",
    ]
    assert filter_tools_for_user(tool_ids, ADMIN) == tool_ids[:-1]


def test_registry_execute_blocks_without_permission():
    registry = AiToolRegistry()
    registry.register(_EchoTool("itinvent.equipment.search"))
    context = _context(VIEWER, ["itinvent.equipment.search"])
    with pytest.raises(PermissionError, match="Нет доступа"):
        registry.execute(tool_id="itinvent.equipment.search", raw_args={}, context=context)


def test_registry_execute_allows_with_permission():
    registry = AiToolRegistry()
    registry.register(_EchoTool("itinvent.equipment.search"))
    context = _context(_custom("database.read"), ["itinvent.equipment.search"])
    result, audit = registry.execute(
        tool_id="itinvent.equipment.search", raw_args={"query": "ws-1"}, context=context
    )
    assert result.ok
    assert audit["tool_id"] == "itinvent.equipment.search"


def test_registry_execute_blocks_action_draft_without_write_permission():
    registry = AiToolRegistry()
    registry.register(_EchoTool("network.action.wol_draft"))
    context = _context(_custom("networks.read"), ["network.action.wol_draft"])
    with pytest.raises(PermissionError, match="networks.write"):
        registry.execute(tool_id="network.action.wol_draft", raw_args={}, context=context)


def test_specs_for_model_only_contain_permitted_tools():
    from backend.ai_chat.tools.registry import ai_tool_registry

    enabled = [
        "itinvent.equipment.search",
        "ai.files.create",
        "ad.user.groups",
        "office.tasks.search",
        "network.host.ping",
    ]
    permitted = filter_tools_for_user(enabled, VIEWER)
    spec_ids = {spec["tool_id"] for spec in ai_tool_registry.list_specs(tool_ids=permitted)}
    assert spec_ids == {"ai.files.create", "office.tasks.search"}
