"""
Property-based tests for Agent Enrichment Correctness.

Feature: user-full-context
Property 4: Agent Enrichment Correctness

**Validates: Requirements 3.1, 3.2, 3.3**

For any equipment item with a MAC address, if Agent_Snapshot returns data, the item
SHALL be enriched with ip_address, agent_status, agent_last_seen, and current_user;
if Agent_Snapshot is unavailable or returns no data, the item SHALL have
agent_status="unknown" and ip_address=null, current_user=null.
"""

import sys
import time
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
    none,
    one_of,
    just,
    booleans,
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
def snapshot_responses(draw):
    """Generate random Agent_Snapshot responses with ip_primary, last_seen_at,
    current_user, and hostname fields."""
    ip_parts = [
        draw(integers(min_value=1, max_value=255)),
        draw(integers(min_value=0, max_value=255)),
        draw(integers(min_value=0, max_value=255)),
        draw(integers(min_value=1, max_value=254)),
    ]
    ip_primary = ".".join(str(p) for p in ip_parts)

    # Generate a recent timestamp (within last 2 hours to cover online/stale/offline)
    last_seen_at = draw(integers(min_value=1, max_value=int(time.time())))

    current_user = draw(_non_empty_text(min_size=3, max_size=40))
    assume(current_user.strip())

    hostname = draw(_non_empty_text(min_size=3, max_size=30))
    assume(hostname.strip())

    return {
        "ip_primary": ip_primary,
        "last_seen_at": last_seen_at,
        "current_user": current_user,
        "hostname": hostname,
    }


@composite
def equipment_record_with_mac(draw):
    """Generate an equipment record that has a MAC address."""
    # Generate a valid-looking MAC address
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


@composite
def employee_record(draw):
    """Generate a minimal employee record to satisfy the employee search step."""
    owner_no = draw(integers(min_value=1, max_value=999999))
    display_name = draw(_non_empty_text(min_size=2, max_size=30))
    login = draw(_non_empty_text(min_size=2, max_size=20))
    department = draw(_non_empty_text(min_size=2, max_size=30))
    branch = draw(_non_empty_text(min_size=2, max_size=30))
    email = draw(_non_empty_text(min_size=5, max_size=30))

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


@settings(max_examples=100)
@given(
    emp=employee_record(),
    equip=equipment_record_with_mac(),
    snapshot=snapshot_responses(),
)
def test_agent_enrichment_when_snapshot_returns_data(
    emp: dict, equip: dict, snapshot: dict
):
    """Property 4a: For any equipment item with a MAC address, if Agent_Snapshot
    returns data, the item SHALL be enriched with ip_address, agent_status,
    agent_last_seen, and current_user.

    **Validates: Requirements 3.1, 3.2**
    """
    owner_no = emp["OWNER_NO"]
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
            return_value=snapshot,
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
        args = UserFullContextArgs(query="test_query")
        result = tool.execute(context=context, args=args)

    # The tool should succeed
    assert result.ok is True, f"Tool returned ok=False: {result.error}"

    # Extract equipment list
    equipment_list = result.data["equipment"]
    assert len(equipment_list) == 1, f"Expected 1 equipment item, got {len(equipment_list)}"

    item = equipment_list[0]

    # Verify enrichment fields are populated
    assert item["ip_address"] is not None, (
        f"ip_address should be populated when snapshot returns data, got None"
    )
    assert item["ip_address"] == snapshot["ip_primary"], (
        f"ip_address mismatch: {item['ip_address']!r} != {snapshot['ip_primary']!r}"
    )

    assert item["agent_status"] in ("online", "stale", "offline"), (
        f"agent_status should be online/stale/offline when snapshot has data, "
        f"got {item['agent_status']!r}"
    )

    assert item["agent_last_seen"] is not None, (
        f"agent_last_seen should be populated when snapshot returns data, got None"
    )

    assert item["current_user"] is not None, (
        f"current_user should be populated when snapshot returns data, got None"
    )
    assert item["current_user"] == snapshot["current_user"].strip(), (
        f"current_user mismatch: {item['current_user']!r} != "
        f"{snapshot['current_user'].strip()!r}"
    )


@settings(max_examples=100)
@given(
    emp=employee_record(),
    equip=equipment_record_with_mac(),
    use_none=booleans(),
)
def test_agent_enrichment_when_snapshot_unavailable(
    emp: dict, equip: dict, use_none: bool
):
    """Property 4b: For any equipment item with a MAC address, if Agent_Snapshot
    is unavailable or returns no data, the item SHALL have agent_status="unknown"
    and ip_address=None, current_user=None.

    **Validates: Requirements 3.1, 3.3**
    """
    owner_no = emp["OWNER_NO"]
    context = _make_context()
    tool = UserFullContextTool()

    # Simulate either None response or an exception from _get_inventory_host
    if use_none:
        snapshot_side_effect = None
        snapshot_return = None
    else:
        snapshot_side_effect = Exception("Snapshot service unavailable")
        snapshot_return = None

    patch_kwargs = (
        {"side_effect": snapshot_side_effect}
        if snapshot_side_effect
        else {"return_value": snapshot_return}
    )

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
            **patch_kwargs,
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
        args = UserFullContextArgs(query="test_query")
        result = tool.execute(context=context, args=args)

    # The tool should still succeed (graceful degradation)
    assert result.ok is True, f"Tool returned ok=False: {result.error}"

    # Extract equipment list
    equipment_list = result.data["equipment"]
    assert len(equipment_list) == 1, f"Expected 1 equipment item, got {len(equipment_list)}"

    item = equipment_list[0]

    # Verify fallback values when snapshot is unavailable
    assert item["agent_status"] == "unknown", (
        f"agent_status should be 'unknown' when snapshot unavailable, "
        f"got {item['agent_status']!r}"
    )
    assert item["ip_address"] is None, (
        f"ip_address should be None when snapshot unavailable, "
        f"got {item['ip_address']!r}"
    )
    assert item["current_user"] is None, (
        f"current_user should be None when snapshot unavailable, "
        f"got {item['current_user']!r}"
    )
