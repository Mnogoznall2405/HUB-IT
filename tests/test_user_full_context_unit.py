"""
Example-based unit tests for UserFullContextTool error cases and smoke checks.

Feature: user-full-context
Task 5.8: Write example-based unit tests for error cases and smoke checks

**Validates: Requirements 1.3, 4.3, 4.4, 6.1, 6.2, 6.3, 8.1, 8.2**
"""

import sys
from pathlib import Path
from unittest.mock import patch

# Ensure WEB-itinvent is on the path (backend lives there)
PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.ai_chat.tools.context import (
    AiToolExecutionContext,
    ITINVENT_TOOL_USER_FULL_CONTEXT,
    DEFAULT_ITINVENT_TOOL_IDS,
)
from backend.ai_chat.tools.itinvent import UserFullContextTool, UserFullContextArgs
from backend.ai_chat.tools.registry import ai_tool_registry


# --- Helpers ---


def _make_context() -> AiToolExecutionContext:
    """Create a minimal AiToolExecutionContext for testing."""
    return AiToolExecutionContext(
        bot_id="bot-test",
        bot_title="Test Bot",
        conversation_id="conv-test",
        run_id="run-test",
        user_id=1,
        user_payload={"id": 1, "role": "viewer", "username": "tester"},
        effective_database_id="test-db",
        enabled_tools=[ITINVENT_TOOL_USER_FULL_CONTEXT],
        tool_settings={
            "multi_db_mode": "single",
            "allowed_databases": [],
        },
    )


# --- Test a: Employee not found returns ok=False with query in error ---


def test_employee_not_found_returns_ok_false_with_query_in_error():
    """When neither search strategy finds an employee, the tool returns
    ok=False with the original query in the error message.

    **Validates: Requirement 1.3**
    """
    context = _make_context()
    tool = UserFullContextTool()

    with (
        patch(
            "backend.ai_chat.tools.itinvent._resolve_tool_database_id",
            return_value="test-db",
        ),
        patch(
            "backend.ai_chat.tools.itinvent.queries.get_owner_no_by_name",
            return_value=None,
        ),
        patch(
            "backend.ai_chat.tools.itinvent.queries.search_employees",
            return_value={"employees": []},
        ),
    ):
        args = UserFullContextArgs(query="Несуществующий")
        result = tool.execute(context=context, args=args)

    assert result.ok is False
    assert "Несуществующий" in result.error


# --- Test b: Old tool IDs not in registry ---


def test_old_tool_ids_not_in_registry():
    """After migration, the four old tool IDs must NOT be registered
    in the ai_tool_registry.

    **Validates: Requirement 6.1**
    """
    old_tool_ids = [
        "itinvent.user.computer",
        "itinvent.computers.profile_search",
        "itinvent.computers.outlook_search",
        "itinvent.equipment.online_status",
    ]
    for tool_id in old_tool_ids:
        assert ai_tool_registry.get(tool_id) is None, (
            f"Old tool '{tool_id}' should NOT be registered in ai_tool_registry"
        )


# --- Test c: ITINVENT_TOOL_USER_FULL_CONTEXT constant exists and in DEFAULT_ITINVENT_TOOL_IDS ---


def test_user_full_context_constant_exists_and_in_default_ids():
    """The ITINVENT_TOOL_USER_FULL_CONTEXT constant must have the correct value
    and be present in DEFAULT_ITINVENT_TOOL_IDS.

    **Validates: Requirements 6.3, 8.1**
    """
    assert ITINVENT_TOOL_USER_FULL_CONTEXT == "itinvent.user.full_context"
    assert ITINVENT_TOOL_USER_FULL_CONTEXT in DEFAULT_ITINVENT_TOOL_IDS


# --- Test d: UserFullContextTool is registered ---


def test_user_full_context_tool_registered():
    """The UserFullContextTool must be registered in the ai_tool_registry.

    **Validates: Requirement 8.2**
    """
    tool = ai_tool_registry.get(ITINVENT_TOOL_USER_FULL_CONTEXT)
    assert tool is not None, (
        f"Tool '{ITINVENT_TOOL_USER_FULL_CONTEXT}' should be registered in ai_tool_registry"
    )
    assert isinstance(tool, UserFullContextTool)


# --- Test e: AD connection failure returns ad=None with ad_error ---


def test_ad_connection_failure_returns_ad_none_with_error():
    """When LDAP connection fails (exception raised), the tool returns
    ok=True with ad=None and ad_error='LDAP connection unavailable'.

    **Validates: Requirement 4.3**
    """
    context = _make_context()
    tool = UserFullContextTool()

    employee_row = {
        "OWNER_NO": 12345,
        "OWNER_DISPLAY_NAME": "Тестов Тест Тестович",
        "OWNER_LOGIN": "testov_tt",
        "OWNER_DEPT": "IT отдел",
        "BRANCH_NAME": "г.Тюмень",
        "OWNER_EMAIL": "testov_tt@example.com",
    }

    with (
        patch(
            "backend.ai_chat.tools.itinvent._resolve_tool_database_id",
            return_value="test-db",
        ),
        patch(
            "backend.ai_chat.tools.itinvent.queries.get_owner_no_by_name",
            return_value=12345,
        ),
        patch(
            "backend.ai_chat.tools.itinvent.queries.get_owner_by_no",
            return_value=employee_row,
        ),
        patch(
            "backend.ai_chat.tools.itinvent.queries.get_owner_email_by_no",
            return_value="testov_tt@example.com",
        ),
        patch(
            "backend.ai_chat.tools.itinvent.queries.get_equipment_by_owner",
            return_value=[],
        ),
        patch(
            "backend.services.ad_users_service.get_ad_user_logon_history",
            side_effect=Exception("LDAP connection refused"),
        ),
        patch(
            "backend.services.ad_users_service.get_ad_user_lockout_status",
            side_effect=Exception("LDAP connection refused"),
        ),
    ):
        args = UserFullContextArgs(query="Тестов")
        result = tool.execute(context=context, args=args)

    assert result.ok is True
    assert result.data["ad"] is None
    assert result.data["ad_error"] == "LDAP connection unavailable"


# --- Test f: AD user not found returns ad=None with ad_error ---


def test_ad_user_not_found_returns_ad_none_with_error():
    """When the employee login is not found in AD, the tool returns
    ok=True with ad=None and ad_error='User not found in AD'.

    **Validates: Requirement 4.4**
    """
    context = _make_context()
    tool = UserFullContextTool()

    employee_row = {
        "OWNER_NO": 67890,
        "OWNER_DISPLAY_NAME": "Иванов Иван Иванович",
        "OWNER_LOGIN": "ivanov_ii",
        "OWNER_DEPT": "Бухгалтерия",
        "BRANCH_NAME": "г.Москва",
        "OWNER_EMAIL": "ivanov_ii@example.com",
    }

    with (
        patch(
            "backend.ai_chat.tools.itinvent._resolve_tool_database_id",
            return_value="test-db",
        ),
        patch(
            "backend.ai_chat.tools.itinvent.queries.get_owner_no_by_name",
            return_value=67890,
        ),
        patch(
            "backend.ai_chat.tools.itinvent.queries.get_owner_by_no",
            return_value=employee_row,
        ),
        patch(
            "backend.ai_chat.tools.itinvent.queries.get_owner_email_by_no",
            return_value="ivanov_ii@example.com",
        ),
        patch(
            "backend.ai_chat.tools.itinvent.queries.get_equipment_by_owner",
            return_value=[],
        ),
        patch(
            "backend.services.ad_users_service.get_ad_user_logon_history",
            return_value={"status": "not_found"},
        ),
        patch(
            "backend.services.ad_users_service.get_ad_user_lockout_status",
            return_value={"status": "not_found"},
        ),
        patch(
            "backend.services.ad_users_service.get_ad_password_max_age_days",
            return_value=90,
        ),
    ):
        args = UserFullContextArgs(query="Иванов")
        result = tool.execute(context=context, args=args)

    assert result.ok is True
    assert result.data["ad"] is None
    assert result.data["ad_error"] == "User not found in AD"
