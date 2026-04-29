import importlib.util
import sys
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1] / "WEB-itinvent"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

MODULE_PATH = BACKEND_ROOT / "backend" / "api" / "v1" / "inventory.py"
SPEC = importlib.util.spec_from_file_location("inventory_computers_module", MODULE_PATH)
inventory = importlib.util.module_from_spec(SPEC)
assert SPEC is not None and SPEC.loader is not None
SPEC.loader.exec_module(inventory)


class FakeStore:
    def __init__(self, current_data, changes):
        self._current_data = current_data
        self._changes = changes
        self.db_path = Path("fake_inventory.db")

    def load_json(self, name, default_content=None):
        if name == inventory.INVENTORY_FILE:
            return self._current_data
        if name == inventory.CHANGES_FILE:
            return self._changes
        return default_content


def _user():
    return inventory.User(
        id=1,
        username="tester",
        role="admin",
        permissions=["computers.read", "computers.read_all"],
    )


def _make_records(now_ts):
    full_snapshot = {
        "hostname": "PC-01",
        "mac_address": "AA-BB-CC-DD-EE-01",
        "current_user": "CORP\\petrov_aa",
        "user_full_name": "Петров А.А.",
        "network": {"active_ipv4": ["10.10.1.11"]},
        "report_type": "full_snapshot",
        "timestamp": now_ts - 60,
        "last_seen_at": now_ts - 60,
        "health": {
            "cpu_load_percent": 12.34,
            "ram_used_percent": 55.55,
            "uptime_seconds": 3600,
            "last_reboot_at": now_ts - 7200,
        },
        "monitors": [{"manufacturer": "Dell", "serial_number": "MON-001"}],
        "logical_disks": [{"mountpoint": "C:\\", "total_gb": 512, "free_gb": 128, "fstype": "NTFS"}],
        "storage": [{"serial_number": "SSD-001", "health_status": "Warning"}],
        "outlook": {
            "source": "system_scan",
            "confidence": "high",
            "active_store": {
                "path": r"D:\Mail\archive-user1.ost",
                "type": "ost",
                "size_bytes": 52 * (1024 ** 3),
                "last_modified_at": now_ts - 120,
            },
            "archives": [
                {
                    "path": r"D:\Mail\archive-user1.pst",
                    "type": "pst",
                    "size_bytes": 8 * (1024 ** 3),
                    "last_modified_at": now_ts - 600,
                }
            ],
            "total_outlook_size_bytes": 60 * (1024 ** 3),
        },
    }
    heartbeat = {
        "hostname": "PC-02",
        "mac_address": "AA-BB-CC-DD-EE-02",
        "current_user": "CORP\\sidorov_bb",
        "report_type": "heartbeat",
        "timestamp": now_ts - 300,
        "last_seen_at": now_ts - 300,
        "health": {
            "cpu_load_percent": 9.5,
            "ram_used_percent": 32.2,
            "uptime_seconds": 180,
            "boot_time": now_ts - 3600,
        },
        "outlook": {},
    }
    secondary_db = {
        "hostname": "PC-03",
        "mac_address": "AA-BB-CC-DD-EE-03",
        "current_user": "CORP\\ivanov_cc",
        "report_type": "full_snapshot",
        "timestamp": now_ts - 1200,
        "last_seen_at": now_ts - 1200,
        "health": {
            "cpu_load_percent": 22.0,
            "ram_used_percent": 44.0,
            "uptime_seconds": 5400,
            "last_reboot_at": now_ts - 24_000,
        },
        "outlook": {
            "source": "system_scan",
            "confidence": "high",
            "active_store": {
                "path": r"C:\Users\ivanov_cc\Documents\mail.ost",
                "type": "ost",
                "size_bytes": 10 * (1024 ** 3),
                "last_modified_at": now_ts - 90,
            },
            "total_outlook_size_bytes": 10 * (1024 ** 3),
        },
    }
    return {
        full_snapshot["mac_address"]: full_snapshot,
        heartbeat["mac_address"]: heartbeat,
        secondary_db["mac_address"]: secondary_db,
    }


def _make_changes(now_ts):
    return [
        {
            "event_id": "chg-1",
            "detected_at": now_ts - 180,
            "mac_address": "AA-BB-CC-DD-EE-01",
            "hostname": "PC-01",
            "change_types": ["storage"],
            "diff": {"storage": {"before": ["SSD-old"], "after": ["SSD-001"]}},
        }
    ]


def _context_map(now_ts):
    return {
        ("AABBCCDDEE01", "DB1"): {
            "branch_no": "101",
            "branch_name": "Тюмень",
            "location_name": "Кабинет 12",
            "employee_name": "Петров А.А.",
            "ip_address": "10.10.1.11",
        },
        ("AABBCCDDEE02", "DB1"): {
            "branch_no": "101",
            "branch_name": "Тюмень",
            "location_name": "Склад",
            "employee_name": "Сидоров Б.Б.",
            "ip_address": "10.10.1.22",
        },
        ("AABBCCDDEE03", "DB2"): {
            "branch_no": "202",
            "branch_name": "Сургут",
            "location_name": "Офис 2",
            "employee_name": "Иванов В.В.",
            "ip_address": "10.20.1.33",
        },
    }


def _network_map():
    return {
        "AABBCCDDEE01": {
            "branch_id": 10,
            "branch_name": "Тюмень",
            "site_name": "Тюмень / 1 этаж",
            "device_code": "SW-01",
            "device_model": "Cisco",
            "port_name": "Gi1/0/12",
            "socket_code": "T-12",
            "endpoint_ip_raw": "10.10.1.11",
            "endpoint_mac_raw": "AA-BB-CC-DD-EE-01",
        },
        "AABBCCDDEE02": {
            "branch_id": 10,
            "branch_name": "Тюмень",
            "site_name": "Тюмень / склад",
            "device_code": "SW-02",
            "device_model": "Cisco",
            "port_name": "Gi1/0/24",
            "socket_code": "S-24",
            "endpoint_ip_raw": "10.10.1.22",
            "endpoint_mac_raw": "AA-BB-CC-DD-EE-02",
        },
        "AABBCCDDEE03": {
            "branch_id": 20,
            "branch_name": "Сургут",
            "site_name": "Сургут / 2 этаж",
            "device_code": "SW-20",
            "device_model": "Cisco",
            "port_name": "Gi1/0/5",
            "socket_code": "SG-05",
            "endpoint_ip_raw": "10.20.1.33",
            "endpoint_mac_raw": "AA-BB-CC-DD-EE-03",
        },
    }


def _patch_environment(monkeypatch, now_ts):
    records = _make_records(now_ts)
    changes = _make_changes(now_ts)
    contexts = _context_map(now_ts)
    network_links = _network_map()
    store = FakeStore(records, changes)

    monkeypatch.setattr(inventory, "is_app_database_configured", lambda: False)
    monkeypatch.setattr(inventory, "get_local_store", lambda: store)
    monkeypatch.setattr(inventory.time, "time", lambda: now_ts)
    monkeypatch.setattr(inventory, "_get_database_name_map", lambda: {"DB1": "Основная БД", "DB2": "Резервная БД"})
    monkeypatch.setattr(inventory, "_get_accessible_db_ids", lambda current_user: ["DB1", "DB2"])
    monkeypatch.setattr(inventory, "ensure_user_permission", lambda *args, **kwargs: None)

    def fake_sql_context(mac_address, hostname, db_id):
        key = (inventory._normalize_mac(mac_address), str(db_id or "").strip())
        return contexts.get(key)

    def fake_network_link(conn, mac_address, ip_list):
        return network_links.get(inventory._normalize_mac(mac_address))

    monkeypatch.setattr(inventory, "_resolve_sql_context", fake_sql_context)
    monkeypatch.setattr(inventory, "_resolve_network_link", fake_network_link)

    def fail_connect(*args, **kwargs):
        raise RuntimeError("skip sqlite in test")

    monkeypatch.setattr(inventory.sqlite3, "connect", fail_connect)


def _get_computers(**overrides):
    params = {
        "current_user": _user(),
        "db_id_selected": "DB1",
        "scope": "selected",
        "branch": None,
        "status_filter": None,
        "outlook_status": None,
        "q": None,
        "sort_by": "hostname",
        "sort_dir": "asc",
        "changed_only": False,
    }
    params.update(overrides)
    return inventory.get_computers(**params)


def test_get_computers_enriches_contract_and_keeps_heartbeat_safe(monkeypatch):
    now_ts = 1_710_000_000
    _patch_environment(monkeypatch, now_ts)

    result = _get_computers()

    assert [row["hostname"] for row in result] == ["PC-01", "PC-02"]

    full_row = result[0]
    assert full_row["branch_name"] == "Тюмень"
    assert full_row["location_name"] == "Кабинет 12"
    assert full_row["database_id"] == "DB1"
    assert full_row["database_name"] == "Основная БД"
    assert full_row["network_link"]["device_code"] == "SW-01"
    assert full_row["ip_primary"] == "10.10.1.11"
    assert full_row["cpu_load_percent"] == 12.3
    assert full_row["ram_used_percent"] == 55.5
    assert full_row["uptime_seconds"] == 3600
    assert full_row["outlook_status"] == "critical"
    assert full_row["outlook_confidence"] == "high"
    assert full_row["outlook_active_path"] == r"D:\Mail\archive-user1.ost"
    assert full_row["outlook_archives_count"] == 1
    assert full_row["has_hardware_changes"] is True
    assert full_row["changes_count_30d"] == 1
    assert len(full_row["recent_changes"]) == 1

    heartbeat_row = result[1]
    assert heartbeat_row["branch_name"] == "Тюмень"
    assert heartbeat_row["location_name"] == "Склад"
    assert heartbeat_row["user_full_name"] == "Сидоров Б.Б."
    assert heartbeat_row["cpu_load_percent"] == 9.5
    assert heartbeat_row["ram_used_percent"] == 32.2
    assert heartbeat_row["uptime_seconds"] == 180
    assert heartbeat_row["last_reboot_at"] == now_ts - 3600
    assert heartbeat_row["outlook_status"] == "unknown"
    assert heartbeat_row.get("monitors") in (None, [])
    assert heartbeat_row.get("storage") in (None, [])
    assert heartbeat_row.get("logical_disks") in (None, [])


def test_get_computers_applies_scope_filters_search_and_sort(monkeypatch):
    now_ts = 1_710_000_000
    _patch_environment(monkeypatch, now_ts)

    selected_scope = _get_computers()
    assert [row["hostname"] for row in selected_scope] == ["PC-01", "PC-02"]

    all_scope = _get_computers(scope="all")
    assert [row["hostname"] for row in all_scope] == ["PC-01", "PC-02", "PC-03"]

    branch_filtered = _get_computers(scope="all", branch="Сургут")
    assert [row["hostname"] for row in branch_filtered] == ["PC-03"]

    status_filtered = _get_computers(scope="all", status_filter="online")
    assert [row["hostname"] for row in status_filtered] == ["PC-01", "PC-02"]

    outlook_filtered = _get_computers(scope="all", outlook_status="critical")
    assert [row["hostname"] for row in outlook_filtered] == ["PC-01"]

    changed_only = _get_computers(scope="all", changed_only=True)
    assert [row["hostname"] for row in changed_only] == ["PC-01"]

    by_current_user = _get_computers(scope="all", q="CORP\\sidorov_bb")
    assert [row["hostname"] for row in by_current_user] == ["PC-02"]

    by_network_link = _get_computers(scope="all", q="SG-05")
    assert [row["hostname"] for row in by_network_link] == ["PC-03"]

    sorted_rows = _get_computers(scope="all", sort_by="outlook_total_size_bytes", sort_dir="desc")
    assert [row["hostname"] for row in sorted_rows] == ["PC-01", "PC-03", "PC-02"]


def test_computer_search_defers_network_lookup_until_page_items(monkeypatch):
    now_ts = 1_710_000_000
    _patch_environment(monkeypatch, now_ts)
    network_links = _network_map()
    network_calls = []

    def fake_network_link(conn, mac_address, ip_list):
        network_calls.append(inventory._normalize_mac(mac_address))
        return network_links.get(inventory._normalize_mac(mac_address))

    monkeypatch.setattr(inventory, "_resolve_network_link", fake_network_link)

    by_user = inventory.search_computers(
        current_user=_user(),
        db_id_selected="DB1",
        scope="all",
        branch=None,
        status_filter=None,
        outlook_status=None,
        q="CORP\\sidorov_bb",
        search_fields="user",
        sort_by="hostname",
        sort_dir="asc",
        changed_only=False,
        limit=1,
        offset=0,
        include_summary=True,
    )

    assert [row["hostname"] for row in by_user["items"]] == ["PC-02"]
    assert network_calls == ["AABBCCDDEE02"]

    network_calls.clear()
    by_network = inventory.search_computers(
        current_user=_user(),
        db_id_selected="DB1",
        scope="all",
        branch=None,
        status_filter=None,
        outlook_status=None,
        q="SG-05",
        search_fields="network",
        sort_by="hostname",
        sort_dir="asc",
        changed_only=False,
        limit=1,
        offset=0,
        include_summary=True,
    )

    assert [row["hostname"] for row in by_network["items"]] == ["PC-03"]
    assert network_calls == ["AABBCCDDEE01", "AABBCCDDEE02", "AABBCCDDEE03"]
