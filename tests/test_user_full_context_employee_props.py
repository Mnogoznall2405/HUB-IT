"""
Property-based tests for Employee Search Result Completeness.

Feature: user-full-context
Property 2: Employee Search Result Completeness

**Validates: Requirements 1.1, 1.2**

For any valid employee record returned by the database, the employee section in the
tool output SHALL contain all six required fields (name, login, department, branch,
email, owner_no) with values mapped from the source record.
"""

import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

# Ensure WEB-itinvent is on the path (backend lives there)
PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from hypothesis import given, settings, assume
from hypothesis.strategies import text, integers, composite, none, one_of, just

from backend.ai_chat.tools.context import (
    AiToolExecutionContext,
    ITINVENT_TOOL_USER_FULL_CONTEXT,
)
from backend.ai_chat.tools.itinvent import UserFullContextTool


# --- Strategies ---

_CYRILLIC = "АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЩЭЮЯабвгдежзиклмнопрстуфхцчшщэюя"
_LATIN = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
_DIGITS = "0123456789"
_SPECIAL = " _.-@"
_NAME_CHARS = _CYRILLIC + _LATIN + _DIGITS + _SPECIAL


def _non_empty_text(min_size=1, max_size=80):
    """Generate non-empty text strings."""
    return text(alphabet=_NAME_CHARS, min_size=min_size, max_size=max_size)


@composite
def employee_records(draw):
    """Generate random employee records as they would come from the database."""
    owner_no = draw(integers(min_value=1, max_value=999999))
    display_name = draw(_non_empty_text(min_size=2, max_size=60))
    login = draw(_non_empty_text(min_size=2, max_size=30))
    department = draw(_non_empty_text(min_size=2, max_size=60))
    branch = draw(_non_empty_text(min_size=2, max_size=80))
    email = draw(_non_empty_text(min_size=5, max_size=50))

    # Ensure values are non-whitespace-only
    assume(display_name.strip())
    assume(login.strip())
    assume(department.strip())
    assume(branch.strip())
    assume(email.strip())

    return {
        "OWNER_NO": owner_no,
        "OWNER_DISPLAY_NAME": display_name,
        "OWNER_LOGIN": login,
        "OWNER_DEPT": department,
        "BRANCH_NAME": branch,
        "OWNER_EMAIL": email,
    }


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


# --- Property Tests ---

REQUIRED_EMPLOYEE_FIELDS = {"name", "login", "department", "branch", "email", "owner_no"}


@settings(max_examples=100)
@given(record=employee_records())
def test_employee_section_contains_all_six_required_fields(record: dict):
    """Property 2: For any valid employee record, the output employee section
    SHALL contain all six required fields (name, login, department, branch, email, owner_no).

    **Validates: Requirements 1.1, 1.2**
    """
    owner_no = record["OWNER_NO"]
    context = _make_context()
    tool = UserFullContextTool()

    with (
        patch(
            "backend.ai_chat.tools.itinvent._resolve_tool_database_id",
            return_value="test-db",
        ),
        patch(
            "backend.ai_chat.tools.itinvent.queries.get_owner_no_by_name",
            return_value=owner_no,
        ),
        patch(
            "backend.ai_chat.tools.itinvent.queries.get_owner_by_no",
            return_value=record,
        ),
        patch(
            "backend.ai_chat.tools.itinvent.queries.get_owner_email_by_no",
            return_value=record["OWNER_EMAIL"],
        ),
        patch(
            "backend.ai_chat.tools.itinvent.queries.get_equipment_by_owner",
            return_value=[],
        ),
        patch(
            "backend.ai_chat.tools.itinvent.queries.search_employees",
            return_value={"employees": []},
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
        from backend.ai_chat.tools.itinvent import UserFullContextArgs

        args = UserFullContextArgs(query="test_query")
        result = tool.execute(context=context, args=args)

    # The tool should succeed
    assert result.ok is True, f"Tool returned ok=False: {result.error}"

    # Extract employee section
    employee = result.data["employee"]
    assert employee is not None, "Employee section is None"

    # Verify all 6 required fields are present
    actual_fields = set(employee.keys())
    missing = REQUIRED_EMPLOYEE_FIELDS - actual_fields
    assert not missing, f"Missing required fields: {missing}"

    # Verify values are mapped from the source record
    assert employee["owner_no"] == owner_no
    assert employee["name"] == record["OWNER_DISPLAY_NAME"].strip()
    assert employee["login"] == record["OWNER_LOGIN"].strip()
    assert employee["department"] == record["OWNER_DEPT"].strip()
    assert employee["branch"] == record["BRANCH_NAME"].strip()
    assert employee["email"] == record["OWNER_EMAIL"].strip()


@settings(max_examples=100)
@given(record=employee_records())
def test_employee_section_fields_via_search_employees_fallback(record: dict):
    """Property 2 (fallback path): When get_owner_no_by_name returns None and
    search_employees finds the employee, the output SHALL still contain all six
    required fields mapped from the source record.

    **Validates: Requirements 1.1, 1.2**
    """
    owner_no = record["OWNER_NO"]
    context = _make_context()
    tool = UserFullContextTool()

    # search_employees returns the record in its result format
    search_result = {"employees": [record]}

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
            return_value=search_result,
        ),
        patch(
            "backend.ai_chat.tools.itinvent.queries.get_owner_by_no",
            return_value=record,
        ),
        patch(
            "backend.ai_chat.tools.itinvent.queries.get_owner_email_by_no",
            return_value=record["OWNER_EMAIL"],
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
        from backend.ai_chat.tools.itinvent import UserFullContextArgs

        args = UserFullContextArgs(query="test_query")
        result = tool.execute(context=context, args=args)

    # The tool should succeed
    assert result.ok is True, f"Tool returned ok=False: {result.error}"

    # Extract employee section
    employee = result.data["employee"]
    assert employee is not None, "Employee section is None"

    # Verify all 6 required fields are present
    actual_fields = set(employee.keys())
    missing = REQUIRED_EMPLOYEE_FIELDS - actual_fields
    assert not missing, f"Missing required fields: {missing}"

    # Verify owner_no is correctly extracted
    assert employee["owner_no"] == owner_no
