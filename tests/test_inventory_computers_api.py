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
        "network": {
            "active_ipv4": ["10.10.1.11"],
            "summary": {"total": 3, "enabled": 1, "disabled": 2, "connected": 1},
            "devices": [
                {
                    "name": "Ethernet 1",
                    "device_type": "ethernet",
                    "enabled": True,
                    "connection_status": "up",
                },
                {
                    "name": "Intel Wi-Fi 6 AX201",
                    "device_type": "wifi",
                    "enabled": False,
                    "connection_status": "disabled",
                },
                {
                    "name": "Intel Wireless Bluetooth",
                    "device_type": "bluetooth",
                    "enabled": False,
                    "connection_status": "disabled",
                },
            ],
        },
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
            "inv_no": "101795",
            "model_name": "Dell OptiPlex 7090",
            "ip_address": "10.10.1.11",
        },
        ("AABBCCDDEE02", "DB1"): {
            "branch_no": "101",
            "branch_name": "Тюмень",
            "location_name": "Склад",
            "employee_name": "Сидоров Б.Б.",
            "inv_no": "101796",
            "model_name": "HP ProDesk 400 G6",
            "ip_address": "10.10.1.22",
        },
        ("AABBCCDDEE03", "DB2"): {
            "branch_no": "202",
            "branch_name": "Сургут",
            "location_name": "Офис 2",
            "employee_name": "Иванов В.В.",
            "inv_no": "201001",
            "model_name": "Lenovo ThinkCentre M720q",
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
    return inventory.get_computers(request=_FakeHttp(), response=_FakeHttp(), **params)


class _FakeHttp:
    """Минимальный request/response для ETag-ветки endpoint'ов."""

    def __init__(self):
        self.headers = {}


def test_sql_context_cache_without_inventory_model_is_refreshed(monkeypatch):
    calls = []

    class CacheStore:
        def __init__(self):
            self.saved = None

        def get_sql_context(self, *, mac_address, hostname, db_id):
            return {
                "branch_no": "101",
                "branch_name": "Tyumen",
                "location_name": "Office",
                "employee_name": "Petrov A.A.",
                "ip_address": "10.10.1.11",
            }

        def upsert_sql_context(self, *, mac_address, hostname, db_id, context):
            self.saved = dict(context)

    store = CacheStore()

    def fake_resolve(mac_address, hostname, db_id):
        calls.append((mac_address, hostname, db_id))
        return {
            "branch_no": "101",
            "branch_name": "Tyumen",
            "location_name": "Office",
            "employee_name": "Petrov A.A.",
            "inv_no": "101795",
            "model_name": "Dell OptiPlex 7090",
            "ip_address": "10.10.1.11",
        }

    monkeypatch.setattr(inventory, "_resolve_sql_context", fake_resolve)

    result = inventory._resolve_sql_context_cached(
        store,
        mac_address="AA-BB-CC-DD-EE-01",
        hostname="PC-01",
        db_id="DB1",
    )

    assert calls == [("AA-BB-CC-DD-EE-01", "PC-01", "DB1")]
    assert result["inv_no"] == "101795"
    assert result["model_name"] == "Dell OptiPlex 7090"
    assert store.saved["model_name"] == "Dell OptiPlex 7090"


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
    assert full_row["inventory_inv_no"] == "101795"
    assert full_row["inventory_model_name"] == "Dell OptiPlex 7090"
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
    assert "recent_changes" not in full_row

    detail = inventory.get_computer_detail(
        mac_address=full_row["mac_address"],
        current_user=_user(),
        db_id_selected="DB1",
        scope="selected",
    )
    assert len(detail["recent_changes"]) == 1
    assert detail["network"]["summary"] == {
        "total": 3,
        "enabled": 1,
        "disabled": 2,
        "connected": 1,
    }
    assert [item["device_type"] for item in detail["network"]["devices"]] == [
        "ethernet",
        "wifi",
        "bluetooth",
    ]

    heartbeat_row = result[1]
    assert heartbeat_row["branch_name"] == "Тюмень"
    assert heartbeat_row["location_name"] == "Склад"
    assert heartbeat_row["user_full_name"] == "Сидоров Б.Б."
    assert heartbeat_row["inventory_inv_no"] == "101796"
    assert heartbeat_row["inventory_model_name"] == "HP ProDesk 400 G6"
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
        request=_FakeHttp(),
        response=_FakeHttp(),
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
        request=_FakeHttp(),
        response=_FakeHttp(),
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


def test_get_computers_summary_returns_aggregate_counts(monkeypatch):
    now_ts = 1_710_000_000
    _patch_environment(monkeypatch, now_ts)

    summary = inventory.get_computers_summary(
        current_user=_user(),
        db_id_selected="DB1",
        scope="all",
        branch=None,
        status_filter=None,
        outlook_status=None,
        q=None,
        search_fields="",
        changed_only=False,
    )

    assert summary["total"] == 3
    assert summary["statuses"]["online"] >= 1
    assert "Тюмень" in summary["branches"]


def test_search_pagination_returns_page_slice_without_summary(monkeypatch):
    now_ts = 1_710_000_000
    _patch_environment(monkeypatch, now_ts)

    page_one = inventory.search_computers(
        request=_FakeHttp(),
        response=_FakeHttp(),
        current_user=_user(),
        db_id_selected="DB1",
        scope="all",
        branch=None,
        status_filter=None,
        outlook_status=None,
        q=None,
        search_fields="",
        sort_by="hostname",
        sort_dir="asc",
        changed_only=False,
        limit=1,
        offset=0,
        include_summary=False,
    )
    page_two = inventory.search_computers(
        request=_FakeHttp(),
        response=_FakeHttp(),
        current_user=_user(),
        db_id_selected="DB1",
        scope="all",
        branch=None,
        status_filter=None,
        outlook_status=None,
        q=None,
        search_fields="",
        sort_by="hostname",
        sort_dir="asc",
        changed_only=False,
        limit=1,
        offset=1,
        include_summary=False,
    )

    assert len(page_one["items"]) == 1
    assert len(page_two["items"]) == 1
    assert page_one["items"][0]["hostname"] != page_two["items"][0]["hostname"]
    assert page_one["has_more"] is True
    assert page_two["total"] == 3
    assert "summary" not in page_one


def test_search_list_items_are_trimmed_and_detail_endpoint_is_full(monkeypatch):
    now_ts = 1_710_000_000
    _patch_environment(monkeypatch, now_ts)

    page = inventory.search_computers(
        request=_FakeHttp(),
        response=_FakeHttp(),
        current_user=_user(),
        db_id_selected="DB1",
        scope="all",
        branch=None,
        status_filter=None,
        outlook_status=None,
        q=None,
        search_fields="",
        sort_by="hostname",
        sort_dir="asc",
        changed_only=False,
        limit=1,
        offset=0,
        include_summary=False,
    )
    list_item = page["items"][0]
    assert "recent_changes" not in list_item
    assert "monitors" not in list_item
    assert "devices" not in (list_item.get("network") or {})
    assert list_item.get("logical_disks") is not None
    assert "health_status" in (list_item.get("storage") or [{}])[0]

    detail = inventory.get_computer_detail(
        mac_address=list_item["mac_address"],
        current_user=_user(),
        db_id_selected="DB1",
        scope="all",
    )
    assert detail["hostname"] == list_item["hostname"]
    assert isinstance(detail.get("recent_changes"), list)
    assert isinstance(detail.get("monitors"), list)


def test_mobile_computers_contract_is_allowlisted_and_path_free(monkeypatch):
    now_ts = 1_710_000_000
    _patch_environment(monkeypatch, now_ts)

    page = inventory.search_computers(
        request=_FakeHttp(),
        response=_FakeHttp(),
        current_user=_user(),
        db_id_selected="DB1",
        scope="all",
        branch=None,
        status_filter=None,
        outlook_status=None,
        q=None,
        search_fields="",
        sort_by="hostname",
        sort_dir="asc",
        changed_only=False,
        limit=1,
        offset=0,
        include_summary=False,
        mobile_safe=True,
    )
    list_item = page["items"][0]
    assert set(list_item) <= set(inventory._MOBILE_COMPUTER_LIST_FIELDS) | {"logical_disks", "storage"}
    assert "user_profile_sizes" not in list_item
    assert "outlook_active_path" not in list_item
    assert "network_link" not in list_item

    detail = inventory.get_computer_detail(
        mac_address=list_item["mac_address"],
        current_user=_user(),
        db_id_selected="DB1",
        scope="all",
        mobile_safe=True,
    )
    assert set(detail) <= set(inventory._MOBILE_COMPUTER_DETAIL_FIELDS) | {"logical_disks", "storage", "network"}
    assert "user_profile_sizes" not in detail
    assert "outlook_active_path" not in detail
    assert "recent_changes" not in detail
    assert "network_link" not in detail
    assert set(detail["network"]) == {"devices"}
    assert all(
        set(device) <= set(inventory._MOBILE_NETWORK_DEVICE_FIELDS)
        for device in detail["network"]["devices"]
    )


def test_is_vm_only_172_host_rule():
    assert inventory._is_vm_only_172_host({"ip_list": ["172.16.1.10", "172.31.0.2"]}) is True
    assert inventory._is_vm_only_172_host({"ip_primary": "172.20.0.5", "ip_list": []}) is True
    assert inventory._is_vm_only_172_host({"ip_list": ["10.10.1.11", "172.16.1.10"]}) is False
    assert inventory._is_vm_only_172_host({"ip_list": ["172.15.0.1"]}) is False
    assert inventory._is_vm_only_172_host({"ip_list": []}) is False


def test_hide_vm_172_filters_only_172_hosts(monkeypatch):
    now_ts = 1_710_000_000
    _patch_environment(monkeypatch, now_ts)
    store = inventory.get_local_store()
    records = store.load_json(inventory.INVENTORY_FILE)
    records["AA-BB-CC-DD-EE-01"]["ip_list"] = ["172.16.8.1"]
    records["AA-BB-CC-DD-EE-01"]["ip_primary"] = "172.16.8.1"
    records["AA-BB-CC-DD-EE-01"]["network"] = {"active_ipv4": ["172.16.8.1"]}
    records["AA-BB-CC-DD-EE-02"]["ip_list"] = ["10.10.1.22", "172.16.9.9"]
    records["AA-BB-CC-DD-EE-02"]["ip_primary"] = "10.10.1.22"

    visible = _get_computers(scope="selected", hide_vm_172=True)
    assert [row["hostname"] for row in visible] == ["PC-02"]

    all_rows = _get_computers(scope="selected", hide_vm_172=False)
    assert [row["hostname"] for row in all_rows] == ["PC-01", "PC-02"]


def test_hidden_only_filter_uses_hidden_at(monkeypatch):
    now_ts = 1_710_000_000
    _patch_environment(monkeypatch, now_ts)
    store = inventory.get_local_store()
    records = store.load_json(inventory.INVENTORY_FILE)
    records["AA-BB-CC-DD-EE-01"]["hidden_at"] = now_ts
    records["AA-BB-CC-DD-EE-01"]["hidden_by"] = "tester"

    default_rows = _get_computers(scope="selected")
    assert [row["hostname"] for row in default_rows] == ["PC-02"]

    hidden_rows = _get_computers(scope="selected", hidden_only=True)
    assert [row["hostname"] for row in hidden_rows] == ["PC-01"]
    assert hidden_rows[0]["is_hidden"] is True


def test_hide_unhide_requires_app_store(monkeypatch):
    now_ts = 1_710_000_000
    _patch_environment(monkeypatch, now_ts)
    try:
        inventory.hide_computer(mac_address="AA-BB-CC-DD-EE-01", current_user=_user(), reason="noise")
        assert False, "expected 503"
    except inventory.HTTPException as exc:
        assert exc.status_code == 503

    class FakeAppStore:
        def __init__(self):
            self.calls = []

        def set_host_hidden(self, mac_address, *, hidden, hidden_by=None, hidden_reason=None, hidden_at=None):
            self.calls.append(
                {
                    "mac_address": mac_address,
                    "hidden": hidden,
                    "hidden_by": hidden_by,
                    "hidden_reason": hidden_reason,
                }
            )
            return {
                "mac_address": mac_address,
                "hidden_at": now_ts if hidden else None,
                "hidden_by": hidden_by if hidden else None,
                "hidden_reason": hidden_reason if hidden else None,
                "is_hidden": hidden,
            }

    fake = FakeAppStore()
    monkeypatch.setattr(inventory, "_get_inventory_app_store", lambda: fake)
    hidden = inventory.hide_computer(mac_address="AA-BB-CC-DD-EE-01", current_user=_user(), reason="noise")
    assert hidden["ok"] is True
    assert hidden["is_hidden"] is True
    restored = inventory.unhide_computer(mac_address="AA-BB-CC-DD-EE-01", current_user=_user())
    assert restored["ok"] is True
    assert restored["is_hidden"] is False
    assert [item["hidden"] for item in fake.calls] == [True, False]


def test_delete_computer_requires_app_store_and_deletes(monkeypatch):
    now_ts = 1_710_000_000
    _patch_environment(monkeypatch, now_ts)
    try:
        inventory.delete_computer(mac_address="AA-BB-CC-DD-EE-01", current_user=_user())
        assert False, "expected 503"
    except inventory.HTTPException as exc:
        assert exc.status_code == 503

    class FakeAppStore:
        def __init__(self):
            self.calls = []

        def delete_host(self, mac_address):
            self.calls.append(mac_address)
            if mac_address == "MISSING":
                return None
            return {"mac_address": mac_address}

    fake = FakeAppStore()
    monkeypatch.setattr(inventory, "_get_inventory_app_store", lambda: fake)
    result = inventory.delete_computer(mac_address="AA-BB-CC-DD-EE-01", current_user=_user())
    assert result["ok"] is True
    assert result["deleted"] is True
    try:
        inventory.delete_computer(mac_address="MISSING", current_user=_user())
        assert False, "expected 404"
    except inventory.HTTPException as exc:
        assert exc.status_code == 404
    assert fake.calls == ["AA-BB-CC-DD-EE-01", "MISSING"]


def test_delete_computer_rejects_read_only_user_before_store_access(monkeypatch):
    read_only_user = inventory.User(
        id=2,
        username="operator",
        role="operator",
        permissions=["computers.read"],
        use_custom_permissions=True,
        custom_permissions=["computers.read"],
    )
    monkeypatch.setattr(
        inventory,
        "_get_inventory_app_store",
        lambda: (_ for _ in ()).throw(AssertionError("store must not be reached")),
    )
    try:
        inventory.delete_computer(mac_address="AA-BB-CC-DD-EE-01", current_user=read_only_user)
        assert False, "expected 403"
    except inventory.HTTPException as exc:
        assert exc.status_code == 403


def test_hide_unhide_reject_custom_read_only_user_before_store_access(monkeypatch):
    read_only_user = inventory.User(
        id=2,
        username="operator",
        role="operator",
        permissions=["computers.read"],
        use_custom_permissions=True,
        custom_permissions=["computers.read"],
    )
    monkeypatch.setattr(
        inventory,
        "_get_inventory_app_store",
        lambda: (_ for _ in ()).throw(AssertionError("store must not be reached")),
    )

    for action in (
        lambda: inventory.hide_computer(
            mac_address="AA-BB-CC-DD-EE-01",
            current_user=read_only_user,
            reason="noise",
        ),
        lambda: inventory.unhide_computer(
            mac_address="AA-BB-CC-DD-EE-01",
            current_user=read_only_user,
        ),
    ):
        try:
            action()
            assert False, "expected 403"
        except inventory.HTTPException as exc:
            assert exc.status_code == 403
            assert "computers.manage" in str(exc.detail)


def test_upsert_host_does_not_clear_soft_hide(monkeypatch):
    """Agent ingest must keep operator soft-hide flags on existing rows."""
    from backend.appdb import inventory_store as store_module

    class FakeRow:
        mac_address = "AABBCCDDEE01"
        hostname = "PC-01"
        user_login = None
        user_full_name = None
        ip_primary = None
        report_type = "full_snapshot"
        last_seen_at = 1
        last_full_snapshot_at = 1
        payload_json = "{}"
        hidden_at = 1_710_000_000
        hidden_by = "tester"
        hidden_reason = "noise"
        updated_at = None

    class FakeSession:
        def __init__(self, row):
            self.row = row
            self.get_kwargs = {}

        def get(self, model, key, **kwargs):
            self.get_kwargs = kwargs
            return self.row

        def flush(self):
            return None

        def add(self, row):
            self.row = row

    row = FakeRow()
    session = FakeSession(row)

    class FakeCtx:
        def __enter__(self):
            return session

        def __exit__(self, *args):
            return False

    monkeypatch.setattr(store_module, "app_session", lambda *args, **kwargs: FakeCtx())
    monkeypatch.setattr(
        store_module.AppInventoryStore,
        "_replace_search_indexes",
        lambda self, session, host_key, payload, now: None,
    )

    app_store = store_module.AppInventoryStore(database_url=None)
    app_store._database_url = "postgresql://test"
    app_store.upsert_host(
        {
            "mac_address": "AA-BB-CC-DD-EE-01",
            "hostname": "PC-01",
            "report_type": "full_snapshot",
            "last_seen_at": 1_710_000_100,
            "timestamp": 1_710_000_100,
        }
    )
    assert session.get_kwargs == {"with_for_update": True}
    assert row.hidden_at == 1_710_000_000
    assert row.hidden_by == "tester"
    assert row.hidden_reason == "noise"


def test_inv_lookup_maps_inventory_numbers_to_live_hosts(monkeypatch):
    now_ts = 1_710_003_000
    _patch_environment(monkeypatch, now_ts)

    from backend.database import queries as queries_module

    def fake_items(inv_nos, db_id=None):
        assert set(inv_nos) == {"101795", "201001", "301", "999999"}
        return [
            {
                "inv_no": "101795",
                "mac_address": "AA:BB:CC:DD:EE:01",
                "network_name": "PC-01",
                "domain_name": "",
            },
            {
                "inv_no": "201001",
                "mac_address": "",
                "network_name": "PC-03",
                "domain_name": "",
            },
            {
                "inv_no": "301",
                "mac_address": "",
                "network_name": "",
                "domain_name": "",
                "serial_no": "MON-001",
                "hw_serial_no": "",
            },
        ]

    monkeypatch.setattr(queries_module, "get_equipment_items_by_inv_nos", fake_items)

    payload = inventory.lookup_computers_by_inv_nos(
        current_user=_user(),
        inv_nos="101795,201001,301,999999",
        db_id=None,
    )

    items = payload["items"]
    # MAC match → PC-01 online (last seen 60s ago).
    assert items["101795"]["hostname"] == "PC-01"
    assert items["101795"]["status"] == "online"
    assert items["101795"]["kind"] == "computer"
    assert items["101795"]["user_login"] == "CORP\\petrov_aa"
    # Hostname match → PC-03 stale (last seen 1200s ago).
    assert items["201001"]["hostname"] == "PC-03"
    assert items["201001"]["status"] == "stale"
    # Monitor serial match → attached to PC-01.
    assert items["301"]["kind"] == "monitor"
    assert items["301"]["hostname"] == "PC-01"
    assert items["301"]["monitor_serial_number"] == "MON-001"
    # No agent host matches the fourth inventory number.
    assert "999999" not in items


def test_inv_lookup_returns_empty_map_without_inventory_numbers(monkeypatch):
    _patch_environment(monkeypatch, 1_710_003_000)
    payload = inventory.lookup_computers_by_inv_nos(
        current_user=_user(),
        inv_nos=" , ,",
        db_id=None,
    )
    assert payload == {"items": {}}


def test_inv_lookup_matches_monitor_by_serial_suffix(monkeypatch):
    now_ts = 1_710_003_000
    _patch_environment(monkeypatch, now_ts)
    monkeypatch.setattr(
        inventory,
        "_load_inventory_snapshot",
        lambda: {
            "11:22:33:44:55:66": {
                "hostname": "PC-09",
                "mac_address": "11:22:33:44:55:66",
                "last_seen_at": now_ts - 30,
                "monitors": [
                    {"serial_number": "19352", "manufacturer": "PHL", "product_code": "C156"},
                    {"serial_number": "77777", "manufacturer": "X", "product_code": "X"},
                    {"serial_number": "12", "manufacturer": "Y", "product_code": "Y"},
                    {"serial_number": "7821", "manufacturer": "PHL", "product_code": "C155"},
                    {"serial_number": "UK02145013324", "manufacturer": "PHL", "product_code": "C155"},
                ],
            },
        },
    )

    from backend.database import queries as queries_module

    monkeypatch.setattr(
        queries_module,
        "get_equipment_items_by_inv_nos",
        lambda inv_nos, db_id=None: [
            {"inv_no": "302", "serial_no": "UHBA2227019352", "hw_serial_no": ""},
            {"inv_no": "303", "serial_no": "ZZ77777", "hw_serial_no": ""},
            {"inv_no": "304", "serial_no": "YY77777", "hw_serial_no": ""},
            {"inv_no": "305", "serial_no": "Q12", "hw_serial_no": ""},
            {"inv_no": "306", "serial_no": "UHBA2026007821", "hw_serial_no": ""},
            {"inv_no": "307", "serial_no": "UK0A2145013324", "hw_serial_no": ""},
        ],
    )

    payload = inventory.lookup_computers_by_inv_nos(
        current_user=_user(),
        inv_nos="302,303,304,305,306,307",
        db_id=None,
    )
    items = payload["items"]
    # EDID tail of the sticker serial → suffix match (5- and 4-digit tails).
    assert items["302"]["kind"] == "monitor"
    assert items["302"]["monitor_match"] == "serial_suffix"
    assert items["302"]["hostname"] == "PC-09"
    assert items["306"]["monitor_match"] == "serial_suffix"
    # Typo'd extra char in the stored serial → digit-tail match.
    assert items["307"]["monitor_match"] == "serial_tail"
    # Two different inv_no share the tail → ambiguous → skipped.
    assert "303" not in items
    assert "304" not in items
    # Serial shorter than 4 chars → suffix match disabled; '12' vs 'Q12' is
    # a suffix pair, but exact-only policy leaves it unmatched.
    assert "305" not in items


def test_monitor_inventory_enrichment_by_serial(monkeypatch):
    from backend.database import queries as queries_module

    def fake_items(serials, db_id=None, **kwargs):
        assert db_id == "DB1"
        assert kwargs.get("include_suffix") is True
        assert "MON001" in serials
        return [
            {
                "inv_no": "301",
                "serial_no": "MON-001",
                "hw_serial_no": "",
                "model_name": "Dell U2422H",
                "employee_name": "Петров А.А.",
            },
            {
                "inv_no": "302",
                "serial_no": "UHBA2227019352",
                "hw_serial_no": "",
                "model_name": "Philips 273V7",
                "employee_name": "Иванова Е.Ю.",
            },
            {
                "inv_no": "303",
                "serial_no": "ZZ77777",
                "hw_serial_no": "",
                "model_name": "A",
                "employee_name": "",
            },
            {
                "inv_no": "304",
                "serial_no": "YY77777",
                "hw_serial_no": "",
                "model_name": "B",
                "employee_name": "",
            },
            {
                "inv_no": "305",
                "serial_no": "UHBA2026007821",
                "hw_serial_no": "",
                "model_name": "Philips 243V7",
                "employee_name": "",
            },
            {
                "inv_no": "306",
                "serial_no": "UK0A2145013324",
                "hw_serial_no": "",
                "model_name": "Philips 243V7QDSB",
                "employee_name": "",
            },
        ]

    monkeypatch.setattr(queries_module, "get_equipment_items_by_serials", fake_items)
    monitors = [
        {"manufacturer": "Dell", "product_code": "U2422H", "serial_number": "MON-001"},
        {"manufacturer": "PHL", "product_code": "C156", "serial_number": "19352"},
        {"manufacturer": "X", "product_code": "X", "serial_number": "77777"},
        {"manufacturer": "LG", "product_code": "24MP", "serial_number": "NO-MATCH"},
        {"manufacturer": "PHL", "product_code": "C155", "serial_number": "7821"},
        {"manufacturer": "PHL", "product_code": "C155", "serial_number": "UK02145013324"},
    ]
    enriched = inventory._enrich_monitors_with_inventory(monitors, "DB1")
    assert enriched[0]["inventory_inv_no"] == "301"
    assert enriched[0]["inventory_match"] == "serial"
    # EDID tail of the sticker serial → suffix match.
    assert enriched[1]["inventory_inv_no"] == "302"
    assert enriched[1]["inventory_match"] == "serial_suffix"
    # Two different inv_no end with the same tail → ambiguous → skipped.
    assert "inventory_inv_no" not in enriched[2]
    assert "inventory_inv_no" not in enriched[3]
    # 4-digit EDID tail also suffix-matches when unique.
    assert enriched[4]["inventory_inv_no"] == "305"
    assert enriched[4]["inventory_match"] == "serial_suffix"
    # Stored serial has a typo'd extra char → digit-tail match.
    assert enriched[5]["inventory_inv_no"] == "306"
    assert enriched[5]["inventory_match"] == "serial_tail"
    # Matched rows carry the database they were found in.
    assert enriched[4]["inventory_db_id"] == "DB1"
    assert enriched[5]["inventory_db_id"] == "DB1"

    # Unassigned host: probe accessible databases, same matching rules.
    enriched_unassigned = inventory._enrich_monitors_with_inventory(monitors, "", ["DB1"])
    assert enriched_unassigned[1]["inventory_inv_no"] == "302"
    assert enriched_unassigned[1]["inventory_db_id"] == "DB1"
    assert enriched_unassigned[4]["inventory_inv_no"] == "305"

    monkeypatch.setattr(
        queries_module,
        "get_equipment_items_by_serials",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("should not be called")),
    )
    # Without a resolved database and without candidates the lookup is skipped.
    assert inventory._enrich_monitors_with_inventory(monitors, "") == monitors
