"""
Property-based tests for Equipment Field Mapping.

Feature: user-full-context
Property 3: Equipment Field Mapping

**Validates: Requirement 2.2**

For any equipment record returned by `get_equipment_by_owner`, the corresponding item
in the output equipment list SHALL contain all required fields (inv_no, serial_no, type,
model, status, hostname, mac_address, location) mapped from the source record.
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
from hypothesis.strategies import text, integers, composite, lists, none, one_of, just

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


def _mac_address():
    """Generate MAC address strings in AA:BB:CC:DD:EE:FF format."""
    return text(
        alphabet="0123456789ABCDEFabcdef:",
        min_size=17,
        max_size=17,
    ).filter(lambda s: len(s) == 17)


@composite
def equipment_records(draw):
    """Generate random equipment records as they would come from the database."""
    inv_no = draw(_non_empty_text(min_size=2, max_size=20))
    serial_no = draw(_non_empty_text(min_size=2, max_size=30))
    type_name = draw(_non_empty_text(min_size=2, max_size=40))
    model_name = draw(_non_empty_text(min_size=2, max_size=60))
    status_name = draw(_non_empty_text(min_size=2, max_size=30))
    hostname = draw(_non_empty_text(min_size=2, max_size=30))
    mac_address = draw(_non_empty_text(min_size=2, max_size=17))
    location_name = draw(_non_empty_text(min_size=2, max_size=40))

    # Ensure values are non-whitespace-only
    assume(inv_no.strip())
    assume(serial_no.strip())
    assume(type_name.strip())
    assume(model_name.strip())
    assume(status_name.strip())
    assume(hostname.strip())
    assume(mac_address.strip())
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
def employee_record_for_equipment(draw):
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

REQUIRED_EQUIPMENT_FIELDS = {
    "inv_no", "serial_no", "type", "model", "status",
    "hostname", "mac_address", "location",
}


@settings(max_examples=100)
@given(
    emp=employee_record_for_equipment(),
    equip=equipment_records(),
)
def test_equipment_items_contain_all_required_fields(emp: dict, equip: dict):
    """Property 3: For any equipment record returned by get_equipment_by_owner,
    the corresponding item in the output equipment list SHALL contain all required
    fields (inv_no, serial_no, type, model, status, hostname, mac_address, location)
    mapped from the source record.

    **Validates: Requirement 2.2**
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
            return_value=None,
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

    # Verify all required fields are present
    actual_fields = set(item.keys())
    missing = REQUIRED_EQUIPMENT_FIELDS - actual_fields
    assert not missing, f"Missing required equipment fields: {missing}"

    # Verify values are correctly mapped from the source record
    assert item["inv_no"] == equip["INV_NO"].strip(), (
        f"inv_no mismatch: {item['inv_no']!r} != {equip['INV_NO'].strip()!r}"
    )
    assert item["serial_no"] == equip["SERIAL_NO"].strip(), (
        f"serial_no mismatch: {item['serial_no']!r} != {equip['SERIAL_NO'].strip()!r}"
    )
    assert item["type"] == equip["TYPE_NAME"].strip(), (
        f"type mismatch: {item['type']!r} != {equip['TYPE_NAME'].strip()!r}"
    )
    assert item["model"] == equip["MODEL_NAME"].strip(), (
        f"model mismatch: {item['model']!r} != {equip['MODEL_NAME'].strip()!r}"
    )
    assert item["status"] == equip["STATUS_NAME"].strip(), (
        f"status mismatch: {item['status']!r} != {equip['STATUS_NAME'].strip()!r}"
    )
    assert item["hostname"] == equip["NETWORK_NAME"].strip(), (
        f"hostname mismatch: {item['hostname']!r} != {equip['NETWORK_NAME'].strip()!r}"
    )
    assert item["mac_address"] == equip["MAC_ADDRESS"].strip(), (
        f"mac_address mismatch: {item['mac_address']!r} != {equip['MAC_ADDRESS'].strip()!r}"
    )
    assert item["location"] == equip["LOCATION_NAME"].strip(), (
        f"location mismatch: {item['location']!r} != {equip['LOCATION_NAME'].strip()!r}"
    )
