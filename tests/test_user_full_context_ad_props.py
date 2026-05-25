"""
Property-based tests for AD Section Completeness.

Feature: user-full-context
Property 6: AD Section Completeness

**Validates: Requirement 4.2**

For any valid AD response containing logon history and lockout status, the AD section
in the output SHALL contain all seven required fields (login, display_name, account_type,
last_logon, logon_count, password_expires_in_days, is_locked).
"""

import sys
from pathlib import Path
from unittest.mock import patch

# Ensure WEB-itinvent is on the path (backend lives there)
PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from hypothesis import given, settings, assume
from hypothesis.strategies import (
    text,
    integers,
    booleans,
    composite,
    datetimes,
    one_of,
    just,
)
from datetime import datetime, timezone, timedelta

from backend.ai_chat.tools.context import (
    AiToolExecutionContext,
    ITINVENT_TOOL_USER_FULL_CONTEXT,
)
from backend.ai_chat.tools.itinvent import UserFullContextTool, UserFullContextArgs


# --- Strategies ---

_LATIN = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
_CYRILLIC = "АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЩЭЮЯабвгдежзиклмнопрстуфхцчшщэюя"
_DIGITS = "0123456789"
_NAME_CHARS = _LATIN + _CYRILLIC + _DIGITS + " _.-"


def _non_empty_text(min_size=1, max_size=60):
    """Generate non-empty text strings."""
    return text(alphabet=_NAME_CHARS, min_size=min_size, max_size=max_size)


@composite
def ad_responses(draw):
    """Generate random AD logon history and lockout status responses.

    Returns a tuple of (login, logon_data, lockout_data, max_age_days).
    """
    login = draw(text(alphabet=_LATIN + _DIGITS + "_.", min_size=3, max_size=20))
    assume(login.strip())

    display_name = draw(_non_empty_text(min_size=2, max_size=50))
    assume(display_name.strip())

    account_type = draw(one_of(just("user"), just("mailbox")))

    # Generate a last_logon datetime as ISO string
    last_logon_dt = draw(datetimes(
        min_value=datetime(2020, 1, 1),
        max_value=datetime(2025, 12, 31),
    ))
    last_logon = last_logon_dt.replace(tzinfo=timezone.utc).isoformat()

    logon_count = draw(integers(min_value=0, max_value=100000))

    # Generate last_password_change as ISO string (within reasonable range)
    pwd_change_dt = draw(datetimes(
        min_value=datetime(2024, 1, 1),
        max_value=datetime(2025, 7, 20),
    ))
    last_password_change = pwd_change_dt.replace(tzinfo=timezone.utc).isoformat()

    is_locked = draw(booleans())

    max_age_days = draw(integers(min_value=30, max_value=365))

    logon_data = {
        "status": "ok",
        "login": login,
        "display_name": display_name,
        "account_type": account_type,
        "last_logon": last_logon,
        "logon_count": logon_count,
        "last_password_change": last_password_change,
    }

    lockout_data = {
        "status": "ok",
        "login": login,
        "display_name": display_name,
        "is_locked": is_locked,
        "lockout_time": None,
        "bad_pwd_count": draw(integers(min_value=0, max_value=10)),
    }

    return (login, logon_data, lockout_data, max_age_days)


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


def _make_employee_row(login: str):
    """Create a minimal employee row with the given login."""
    return {
        "OWNER_NO": 12345,
        "OWNER_DISPLAY_NAME": "Test User",
        "OWNER_LOGIN": login,
        "OWNER_DEPT": "IT Department",
        "BRANCH_NAME": "Main Office",
        "OWNER_EMAIL": f"{login}@example.com",
    }


# --- Property Tests ---

REQUIRED_AD_FIELDS = {
    "login",
    "display_name",
    "account_type",
    "last_logon",
    "logon_count",
    "password_expires_in_days",
    "is_locked",
}


@settings(max_examples=100)
@given(ad_data=ad_responses())
def test_ad_section_contains_all_seven_required_fields(ad_data):
    """Property 6: For any valid AD response containing logon history and lockout
    status, the AD section in the output SHALL contain all seven required fields
    (login, display_name, account_type, last_logon, logon_count,
    password_expires_in_days, is_locked).

    **Validates: Requirement 4.2**
    """
    login, logon_data, lockout_data, max_age_days = ad_data
    employee_row = _make_employee_row(login)
    context = _make_context()
    tool = UserFullContextTool()

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
            return_value=employee_row["OWNER_EMAIL"],
        ),
        patch(
            "backend.ai_chat.tools.itinvent.queries.get_equipment_by_owner",
            return_value=[],
        ),
        patch(
            "backend.services.ad_users_service.get_ad_user_logon_history",
            return_value=logon_data,
        ),
        patch(
            "backend.services.ad_users_service.get_ad_user_lockout_status",
            return_value=lockout_data,
        ),
        patch(
            "backend.services.ad_users_service.get_ad_password_max_age_days",
            return_value=max_age_days,
        ),
    ):
        args = UserFullContextArgs(query="test_query")
        result = tool.execute(context=context, args=args)

    # The tool should succeed
    assert result.ok is True, f"Tool returned ok=False: {result.error}"

    # AD section must be present (both logon and lockout returned status=ok)
    ad_section = result.data.get("ad")
    assert ad_section is not None, (
        f"AD section is None despite valid AD responses. "
        f"data={result.data}"
    )

    # Verify all 7 required fields are present as keys
    actual_fields = set(ad_section.keys())
    missing = REQUIRED_AD_FIELDS - actual_fields
    assert not missing, f"Missing required AD fields: {missing}. Got: {actual_fields}"

    # Verify field types/values are reasonable
    assert ad_section["login"] == login
    assert isinstance(ad_section["logon_count"], int)
    assert isinstance(ad_section["is_locked"], bool)
    assert ad_section["is_locked"] == lockout_data["is_locked"]
    assert ad_section["logon_count"] == logon_data["logon_count"]
