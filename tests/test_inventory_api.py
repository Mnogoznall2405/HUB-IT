import importlib.util
from pathlib import Path
import sys
import time

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1] / "WEB-itinvent"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


MODULE_PATH = Path(__file__).resolve().parents[1] / "WEB-itinvent" / "backend" / "api" / "v1" / "inventory.py"
SPEC = importlib.util.spec_from_file_location("inventory_module", MODULE_PATH)
inventory = importlib.util.module_from_spec(SPEC)
assert SPEC is not None and SPEC.loader is not None
SPEC.loader.exec_module(inventory)


def test_normalize_report_type():
    assert inventory._normalize_report_type("heartbeat") == "heartbeat"
    assert inventory._normalize_report_type("HEARTBEAT") == "heartbeat"
    assert inventory._normalize_report_type("full_snapshot") == "full_snapshot"
    assert inventory._normalize_report_type("anything") == "full_snapshot"


def test_enrich_status_online_stale_offline_unknown():
    now_ts = int(time.time())

    online = inventory._enrich_status({"timestamp": now_ts - 60}, now_ts)
    assert online["status"] == "online"

    stale = inventory._enrich_status({"timestamp": now_ts - 900}, now_ts)
    assert stale["status"] == "stale"

    offline = inventory._enrich_status({"timestamp": now_ts - 4000}, now_ts)
    assert offline["status"] == "offline"

    unknown = inventory._enrich_status({}, now_ts)
    assert unknown["status"] == "unknown"


def test_ensure_identity_fields_fallbacks():
    payload = {
        "current_user": "CORP\\john",
        "network": {"active_ipv4": ["10.1.2.3", "10.1.2.3"]},
    }
    inventory._ensure_identity_fields(payload)
    assert payload["user_login"] == "CORP\\john"
    assert payload["current_user"] == "CORP\\john"
    assert payload["ip_primary"] == "10.1.2.3"
    assert payload["ip_list"] == ["10.1.2.3"]


def test_hardware_change_event_detected_on_signature_change():
    previous = {
        "hostname": "PC-01",
        "mac_address": "AA-BB-CC-DD-EE-FF",
        "cpu_model": "CPU1",
        "ram_gb": 16,
        "system_serial": "SYS-1",
        "monitors": [{"serial_number": "MON-1"}],
        "storage": [{"serial_number": "SSD-1"}],
    }
    merged = {
        "hostname": "PC-01",
        "mac_address": "AA-BB-CC-DD-EE-FF",
        "cpu_model": "CPU1",
        "ram_gb": 16,
        "system_serial": "SYS-1",
        "monitors": [{"serial_number": "MON-2"}],
        "storage": [{"serial_number": "SSD-1"}],
        "report_type": "full_snapshot",
    }
    changes = []
    inventory._add_hardware_change_event(changes, previous, merged, current_ts=1_700_000_000)
    assert len(changes) == 1
    assert "monitors" in changes[0]["change_types"]


def test_extract_first_ipv4():
    assert inventory._extract_first_ipv4("10.10.0.1, 10.10.0.2") == "10.10.0.1"
    assert inventory._extract_first_ipv4("no ip here") == ""


def test_extract_mac_candidates_from_multi_value_cell():
    raw = "aa-bb-cc-dd-ee-ff, 11:22:33:44:55:66\n7788.99aa.bbcc"
    tokens = inventory._extract_mac_candidates(raw)
    assert "AABBCCDDEEFF" in tokens
    assert "112233445566" in tokens
    assert "778899AABBCC" in tokens


def test_build_changes_index_counts_recent_window():
    now_ts = 1_700_000_000
    changes = [
        {"detected_at": now_ts - 10, "mac_address": "A1", "hostname": "PC-1"},
        {"detected_at": now_ts - 50, "mac_address": "A1", "hostname": "PC-1"},
        {"detected_at": now_ts - 40 * 24 * 60 * 60, "mac_address": "A1", "hostname": "PC-1"},
    ]
    index = inventory._build_changes_index(changes, now_ts)
    key = inventory._event_host_key("A1", "PC-1")
    assert index[key]["changes_count_30d"] == 2


def test_heartbeat_does_not_overwrite_full_snapshot_fields():
    previous = {
        "hostname": "PC-01",
        "mac_address": "AA-BB-CC-DD-EE-FF",
        "logical_disks": [{"mountpoint": "C:\\", "total_gb": 512}],
        "monitors": [{"serial_number": "MON-1"}],
        "storage": [{"serial_number": "SSD-1"}],
    }

    heartbeat_payload = inventory.InventoryPayload(
        hostname="PC-01",
        mac_address="AA-BB-CC-DD-EE-FF",
        timestamp=1_700_000_000,
        report_type="heartbeat",
        health={"cpu_load_percent": 12},
    )
    incoming = inventory._model_dump(heartbeat_payload)
    merged = inventory._merge_payload(previous, incoming)

    assert merged["logical_disks"] == previous["logical_disks"]
    assert merged["monitors"] == previous["monitors"]
    assert merged["storage"] == previous["storage"]


def test_receive_inventory_rejects_invalid_api_key():
    payload = inventory.InventoryPayload(
        hostname="PC-09",
        mac_address="AA-BB-CC-DD-EE-09",
        timestamp=1_700_000_000,
        report_type="heartbeat",
    )

    with pytest.raises(inventory.HTTPException) as exc_info:
        inventory.receive_inventory(payload, x_api_key="bad-key")

    assert exc_info.value.status_code == 401
