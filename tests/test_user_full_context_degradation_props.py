"""
Property-based tests for Graceful Degradation Under Partial Failures.

Feature: user-full-context
Property 7: Graceful Degradation Under Partial Failures

**Validates: Requirements 5.1, 5.2, 5.3**

For any valid employee query where the employee exists in ITinvent_DB, the tool SHALL
return ok=True with populated employee and equipment sections regardless of
Agent_Snapshot or Active_Directory availability, and SHALL never raise an unhandled
exception.
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
    composite,
    sampled_from,
)

from backend.ai_chat.tools.context import (
    AiToolExecutionContext,
    ITINVENT_TOOL_USER_FULL_CONTEXT,
)
from backend.ai_chat.tools.itinvent import UserFullContextTool, UserFullContextArgs


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


@composite
def equipment_records(draw):
    """Generate random equipment records with MAC addresses."""
    hex_chars = "0123456789ABCDEF"
    mac_parts = []
    for _ in range(6):
        part = draw(text(alphabet=hex_chars, min_size=2, max_size=2))
        mac_parts.append(part)
    mac_address = ":".join(mac_parts)

    inv_no = draw(_non_empty_text(min_size=2, max_size=20))
    serial_no = draw(_non_empty_text(min_size=2, max_size=30))
    type_name = draw(_non_empty_text(min_size=2, max_size=40))
    model_name = draw(_non_empty_text(min_size=2, max_size=60))
    status_name = draw(_non_empty_text(min_size=2, max_size=30))
    hostname = draw(_non_empty_text(min_size=2, max_size=30))
    location_name = draw(_non_empty_text(min_size=2, max_size=40))

    assume(inv_no.strip())
    assume(serial_no.strip())
    assume(type_name.strip())
    assume(model_name.strip())
    assume(status_name.strip())
    assume(hostname.strip())
    assume(location_name.strip())

    return {
        "INV_NO": inv_no,
        "SERIAL_NO": serial_no,
        "TYPE_NAME": type_name,
        "MODEL_NAME": model_name,
        "STATUS_NAME": status_name,
        "NETWORK_NAME": hostname,
        "MAC_ADDRESS": mac_address,
        "LOCATION_NAME": location_name,
    }


# Strategy for failure scenarios
FAILURE_SCENARIOS = sampled_from([
    "agent_only",       # Only Agent_Snapshot fails
    "ad_only",          # Only Active_Directory fails
    "both",             # Both Agent_Snapshot AND Active_Directory fail
])


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


@settings(max_examples=100)
@given(
    emp=employee_records(),
    equip=equipment_records(),
    failure_scenario=FAILURE_SCENARIOS,
)
def test_graceful_degradation_under_partial_failures(
    emp: dict, equip: dict, failure_scenario: str
):
    """Property 7: For any valid employee query where the employee exists in
    ITinvent_DB, the tool SHALL return ok=True with populated employee and equipment
    sections regardless of Agent_Snapshot or Active_Directory availability, and SHALL
    never raise an unhandled exception.

    **Validates: Requirements 5.1, 5.2, 5.3**
    """
    owner_no = emp["OWNER_NO"]
    context = _make_context()
    tool = UserFullContextTool()

    # Determine which services fail based on the scenario
    agent_fails = failure_scenario in ("agent_only", "both")
    ad_fails = failure_scenario in ("ad_only", "both")

    # Configure agent snapshot mock
    if agent_fails:
        agent_patch_kwargs = {"side_effect": Exception("Snapshot service unavailable")}
    else:
        agent_patch_kwargs = {"return_value": {
            "ip_primary": "10.0.0.1",
            "last_seen_at": 1700000000,
            "current_user": "DOMAIN\\user",
            "hostname": "PC-001",
        }}

    # Configure AD mocks
    if ad_fails:
        ad_logon_kwargs = {"side_effect": Exception("LDAP connection refused")}
        ad_lockout_kwargs = {"side_effect": Exception("LDAP connection refused")}
        ad_max_age_kwargs = {"side_effect": Exception("LDAP connection refused")}
    else:
        ad_logon_kwargs = {"return_value": {"status": "not_found"}}
        ad_lockout_kwargs = {"return_value": {"status": "not_found"}}
        ad_max_age_kwargs = {"return_value": 90}

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
            return_value=emp,
        ),
        patch(
            "backend.ai_chat.tools.itinvent.queries.get_owner_email_by_no",
            return_value=emp["OWNER_EMAIL"],
        ),
        patch(
            "backend.ai_chat.tools.itinvent.queries.get_equipment_by_owner",
            return_value=[equip],
        ),
        patch(
            "backend.api.v1.inventory._get_inventory_host",
            **agent_patch_kwargs,
        ),
        patch(
            "backend.services.ad_users_service.get_ad_user_logon_history",
            **ad_logon_kwargs,
        ),
        patch(
            "backend.services.ad_users_service.get_ad_user_lockout_status",
            **ad_lockout_kwargs,
        ),
        patch(
            "backend.services.ad_users_service.get_ad_password_max_age_days",
            **ad_max_age_kwargs,
        ),
    ):
        # This MUST NOT raise an unhandled exception (Requirement 5.3)
        args = UserFullContextArgs(query="test_query")
        result = tool.execute(context=context, args=args)

    # Requirement 5.1 & 5.2: Tool SHALL return ok=True with employee and equipment
    assert result.ok is True, (
        f"Tool returned ok=False under {failure_scenario} failure: {result.error}"
    )

    # Employee section SHALL be populated (not None)
    employee = result.data["employee"]
    assert employee is not None, (
        f"Employee section is None under {failure_scenario} failure"
    )
    assert employee["owner_no"] == owner_no

    # Equipment section SHALL be a list
    equipment_list = result.data["equipment"]
    assert isinstance(equipment_list, list), (
        f"Equipment section is not a list under {failure_scenario} failure, "
        f"got {type(equipment_list)}"
    )
    assert len(equipment_list) == 1, (
        f"Expected 1 equipment item, got {len(equipment_list)}"
    )

    # When agent fails, equipment items should have agent_status="unknown"
    if agent_fails:
        for item in equipment_list:
            assert item["agent_status"] == "unknown", (
                f"agent_status should be 'unknown' when agent fails, "
                f"got {item['agent_status']!r}"
            )

    # When AD fails, ad section should be None with ad_error set
    if ad_fails:
        assert result.data["ad"] is None, (
            f"AD section should be None when AD fails, got {result.data['ad']}"
        )
        assert "ad_error" in result.data, (
            f"ad_error should be present when AD fails"
        )
