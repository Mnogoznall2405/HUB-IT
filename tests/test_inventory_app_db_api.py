from __future__ import annotations
import importlib.util
from pathlib import Path
import sys

BACKEND_ROOT = Path(__file__).resolve().parents[1] / "WEB-itinvent"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


MODULE_PATH = Path(__file__).resolve().parents[1] / "WEB-itinvent" / "backend" / "api" / "v1" / "inventory.py"
SPEC = importlib.util.spec_from_file_location("inventory_app_db_module", MODULE_PATH)
inventory = importlib.util.module_from_spec(SPEC)
assert SPEC is not None and SPEC.loader is not None
SPEC.loader.exec_module(inventory)


def _sqlite_url(temp_dir: str) -> str:
    return f"sqlite:///{(Path(temp_dir) / 'inventory_app.db').as_posix()}"


def _user():
    return inventory.User(
        id=1,
        username="tester",
        role="admin",
        permissions=["computers.read", "computers.read_all"],
    )


def test_inventory_endpoints_support_app_db_backend(temp_dir, monkeypatch):
    database_url = _sqlite_url(temp_dir)

    monkeypatch.setattr(inventory, "is_app_database_configured", lambda: True)
    monkeypatch.setattr(inventory, "get_app_database_url", lambda: database_url)
    monkeypatch.setattr(inventory, "get_local_store", lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("local_store should not be used")))
    monkeypatch.setattr(inventory.time, "time", lambda: 1_710_000_500)
    monkeypatch.setattr(inventory, "ensure_user_permission", lambda *args, **kwargs: None)
    monkeypatch.setattr(inventory, "_get_database_name_map", lambda: {"DB1": "РћСЃРЅРѕРІРЅР°СЏ Р‘Р”"})
    monkeypatch.setattr(inventory, "_get_accessible_db_ids", lambda current_user: ["DB1"])
    monkeypatch.setattr(
        inventory,
        "_resolve_sql_context",
        lambda mac_address, hostname, db_id: {
            "branch_no": "101",
            "branch_name": "РўСЋРјРµРЅСЊ",
            "location_name": "РљР°Р±РёРЅРµС‚ 12",
            "employee_name": "РџРµС‚СЂРѕРІ Рђ.Рђ.",
            "ip_address": "10.10.1.11",
        },
    )
    monkeypatch.setattr(inventory, "_resolve_network_link", lambda conn, mac_address, ip_list: None)

    first_payload = inventory.InventoryPayload(
        hostname="PC-01",
        system_serial="SYS-1",
        mac_address="AA-BB-CC-DD-EE-01",
        current_user="CORP\\petrov",
        user_login="CORP\\petrov",
        user_full_name="РџРµС‚СЂРѕРІ Рђ.Рђ.",
        ip_primary="10.10.1.11",
        ip_list=["10.10.1.11"],
        cpu_model="CPU1",
        ram_gb=16,
        monitors=[{"serial_number": "MON-1"}],
        storage=[{"serial_number": "SSD-1"}],
        logical_disks=[{"mountpoint": "C:\\"}],
        report_type="full_snapshot",
        timestamp=1_710_000_000,
    )
    second_payload = inventory.InventoryPayload(
        hostname="PC-01",
        system_serial="SYS-1",
        mac_address="AA-BB-CC-DD-EE-01",
        current_user="CORP\\petrov",
        user_login="CORP\\petrov",
        user_full_name="РџРµС‚СЂРѕРІ Рђ.Рђ.",
        ip_primary="10.10.1.11",
        ip_list=["10.10.1.11"],
        cpu_model="CPU1",
        ram_gb=16,
        monitors=[{"serial_number": "MON-2"}],
        storage=[{"serial_number": "SSD-1"}],
        logical_disks=[{"mountpoint": "C:\\"}],
        report_type="full_snapshot",
        timestamp=1_710_000_120,
    )

    assert inventory.receive_inventory(first_payload, x_api_key=inventory.DEFAULT_AGENT_API_KEY)["success"] is True
    assert inventory.receive_inventory(second_payload, x_api_key=inventory.DEFAULT_AGENT_API_KEY)["success"] is True

    changes = inventory.get_inventory_changes(limit=10)
    assert changes["totals"]["changed_24h"] == 1
    assert changes["latest_events"][0]["mac_address"] == "AA-BB-CC-DD-EE-01"
    assert "before_signature" in changes["latest_events"][0]
    assert "after_signature" in changes["latest_events"][0]

    computers = inventory.get_computers(
        current_user=_user(),
        db_id_selected="DB1",
        scope="selected",
        branch=None,
        status_filter=None,
        outlook_status=None,
        q=None,
        sort_by="hostname",
        sort_dir="asc",
        changed_only=False,
    )
    assert len(computers) == 1
    assert computers[0]["hostname"] == "PC-01"
    assert computers[0]["branch_name"] == "РўСЋРјРµРЅСЊ"
    assert computers[0]["has_hardware_changes"] is True


def test_inventory_heartbeat_deferred_updates_presence_without_full_rewrite(temp_dir, monkeypatch):
    database_url = _sqlite_url(temp_dir)

    monkeypatch.setattr(inventory, "is_app_database_configured", lambda: True)
    monkeypatch.setattr(inventory, "get_app_database_url", lambda: database_url)
    monkeypatch.setattr(inventory, "get_local_store", lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("local_store should not be used")))

    first_payload = inventory.InventoryPayload(
        hostname="PC-02",
        system_serial="SYS-2",
        mac_address="AA-BB-CC-DD-EE-02",
        current_user="CORP\\ivanov",
        user_login="CORP\\ivanov",
        user_full_name="Иванов И.И.",
        ip_primary="10.10.1.22",
        ip_list=["10.10.1.22"],
        report_type="heartbeat",
        timestamp=1_710_000_000,
        health={"cpu_load_percent": 11},
    )
    deferred_payload = inventory.InventoryPayload(
        hostname="PC-02",
        system_serial="SYS-2",
        mac_address="AA-BB-CC-DD-EE-02",
        current_user="CORP\\ivanov",
        user_login="CORP\\ivanov",
        user_full_name="Иванов И.И.",
        ip_primary="10.10.1.22",
        ip_list=["10.10.1.22"],
        report_type="heartbeat",
        timestamp=1_710_000_200,
        health={"cpu_load_percent": 33},
    )

    first_result = inventory.receive_inventory(first_payload, x_api_key=inventory.DEFAULT_AGENT_API_KEY)
    deferred_result = inventory.receive_inventory(deferred_payload, x_api_key=inventory.DEFAULT_AGENT_API_KEY)
    host = inventory._get_inventory_host("AA-BB-CC-DD-EE-02")

    assert first_result["success"] is True
    assert first_result["deferred"] is False
    assert deferred_result == {
        "success": True,
        "deferred": True,
        "message": "Inventory heartbeat deferred",
        "retry_after_sec": 400,
    }
    assert host is not None
    assert host["timestamp"] == 1_710_000_000
    assert host["last_seen_at"] == 1_710_000_200
    assert host["report_type"] == "heartbeat"


def test_inventory_heartbeat_after_defer_window_persists_full_write(temp_dir, monkeypatch):
    database_url = _sqlite_url(temp_dir)

    monkeypatch.setattr(inventory, "is_app_database_configured", lambda: True)
    monkeypatch.setattr(inventory, "get_app_database_url", lambda: database_url)
    monkeypatch.setattr(inventory, "get_local_store", lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("local_store should not be used")))

    first_payload = inventory.InventoryPayload(
        hostname="PC-03",
        system_serial="SYS-3",
        mac_address="AA-BB-CC-DD-EE-03",
        current_user="CORP\\sidorov",
        user_login="CORP\\sidorov",
        user_full_name="Сидоров С.С.",
        ip_primary="10.10.1.33",
        ip_list=["10.10.1.33"],
        report_type="heartbeat",
        timestamp=1_710_000_000,
        health={"cpu_load_percent": 9},
    )
    second_payload = inventory.InventoryPayload(
        hostname="PC-03",
        system_serial="SYS-3",
        mac_address="AA-BB-CC-DD-EE-03",
        current_user="CORP\\sidorov",
        user_login="CORP\\sidorov",
        user_full_name="Сидоров С.С.",
        ip_primary="10.10.1.44",
        ip_list=["10.10.1.44"],
        report_type="heartbeat",
        timestamp=1_710_000_700,
        health={"cpu_load_percent": 19},
    )

    inventory.receive_inventory(first_payload, x_api_key=inventory.DEFAULT_AGENT_API_KEY)
    second_result = inventory.receive_inventory(second_payload, x_api_key=inventory.DEFAULT_AGENT_API_KEY)
    host = inventory._get_inventory_host("AA-BB-CC-DD-EE-03")

    assert second_result["success"] is True
    assert second_result["deferred"] is False
    assert second_result["retry_after_sec"] == 0
    assert host is not None
    assert host["timestamp"] == 1_710_000_700
    assert host["last_seen_at"] == 1_710_000_700
    assert host["ip_primary"] == "10.10.1.44"


def test_inventory_app_db_indexes_profiles_and_outlook_files_for_fielded_search(temp_dir, monkeypatch):
    database_url = _sqlite_url(temp_dir)

    monkeypatch.setattr(inventory, "is_app_database_configured", lambda: True)
    monkeypatch.setattr(inventory, "get_app_database_url", lambda: database_url)
    monkeypatch.setattr(inventory, "get_local_store", lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("local_store should not be used")))
    monkeypatch.setattr(inventory.time, "time", lambda: 1_710_000_500)
    monkeypatch.setattr(inventory, "ensure_user_permission", lambda *args, **kwargs: None)
    monkeypatch.setattr(inventory, "_get_database_name_map", lambda: {"DB1": "Main DB"})
    monkeypatch.setattr(inventory, "_get_accessible_db_ids", lambda current_user: ["DB1"])
    monkeypatch.setattr(
        inventory,
        "_resolve_sql_context",
        lambda mac_address, hostname, db_id: {
            "branch_no": "101",
            "branch_name": "Tyumen",
            "location_name": "Office 12",
            "employee_name": "Petrov A.A.",
            "ip_address": "10.10.1.11",
        },
    )
    monkeypatch.setattr(inventory, "_resolve_network_link", lambda conn, mac_address, ip_list: None)

    full_payload = inventory.InventoryPayload(
        hostname="PC-PROFILE-01",
        system_serial="SYS-P1",
        mac_address="AA-BB-CC-DD-EE-71",
        current_user="CORP\\active_user",
        user_login="CORP\\active_user",
        user_full_name="Active User",
        ip_primary="10.10.1.71",
        ip_list=["10.10.1.71"],
        report_type="full_snapshot",
        timestamp=1_710_000_000,
        user_profile_sizes={
            "profiles": [
                {
                    "user_name": "old.account",
                    "profile_path": r"C:\Users\old.account",
                    "total_size_bytes": 1234,
                    "files_count": 12,
                    "dirs_count": 3,
                    "partial": True,
                }
            ]
        },
        outlook={
            "source": "system_scan",
            "confidence": "high",
            "active_store": {
                "path": r"C:\Users\active_user\AppData\Local\Microsoft\Outlook\active.ost",
                "type": "ost",
                "size_bytes": 2048,
                "last_modified_at": 1_710_000_010,
            },
            "archives": [
                {
                    "path": r"D:\Mail\archive-2023.pst",
                    "type": "pst",
                    "size_bytes": 4096,
                    "last_modified_at": 1_710_000_020,
                }
            ],
            "total_outlook_size_bytes": 6144,
        },
    )
    heartbeat_payload = inventory.InventoryPayload(
        hostname="PC-PROFILE-01",
        system_serial="SYS-P1",
        mac_address="AA-BB-CC-DD-EE-71",
        current_user="CORP\\active_user",
        user_login="CORP\\active_user",
        user_full_name="Active User",
        ip_primary="10.10.1.71",
        ip_list=["10.10.1.71"],
        report_type="heartbeat",
        timestamp=1_710_000_200,
    )

    assert inventory.receive_inventory(full_payload, x_api_key=inventory.DEFAULT_AGENT_API_KEY)["success"] is True
    assert inventory.receive_inventory(heartbeat_payload, x_api_key=inventory.DEFAULT_AGENT_API_KEY)["success"] is True

    by_profile = inventory.search_computers(
        current_user=_user(),
        db_id_selected="DB1",
        scope="selected",
        branch=None,
        status_filter=None,
        outlook_status=None,
        q="old.account",
        search_fields="profiles",
        sort_by="hostname",
        sort_dir="asc",
        changed_only=False,
        limit=50,
        offset=0,
        include_summary=True,
    )
    by_outlook = inventory.search_computers(
        current_user=_user(),
        db_id_selected="DB1",
        scope="selected",
        branch=None,
        status_filter=None,
        outlook_status=None,
        q="archive-2023.pst",
        search_fields="outlook",
        sort_by="hostname",
        sort_dir="asc",
        changed_only=False,
        limit=50,
        offset=0,
        include_summary=True,
    )
    profile_does_not_match_identity = inventory.search_computers(
        current_user=_user(),
        db_id_selected="DB1",
        scope="selected",
        branch=None,
        status_filter=None,
        outlook_status=None,
        q="old.account",
        search_fields="identity",
        sort_by="hostname",
        sort_dir="asc",
        changed_only=False,
        limit=50,
        offset=0,
        include_summary=True,
    )
    hostname_does_not_match_profiles = inventory.search_computers(
        current_user=_user(),
        db_id_selected="DB1",
        scope="selected",
        branch=None,
        status_filter=None,
        outlook_status=None,
        q="PC-PROFILE-01",
        search_fields="profiles",
        sort_by="hostname",
        sort_dir="asc",
        changed_only=False,
        limit=50,
        offset=0,
        include_summary=True,
    )

    assert [row["hostname"] for row in by_profile["items"]] == ["PC-PROFILE-01"]
    assert by_profile["items"][0]["user_profile_sizes"]["profiles"][0]["user_name"] == "old.account"
    assert [row["hostname"] for row in by_outlook["items"]] == ["PC-PROFILE-01"]
    assert profile_does_not_match_identity["items"] == []
    assert hostname_does_not_match_profiles["items"] == []


def test_inventory_computers_uses_overlay_last_seen_after_deferred_heartbeat(temp_dir, monkeypatch):
    database_url = _sqlite_url(temp_dir)

    monkeypatch.setattr(inventory, "is_app_database_configured", lambda: True)
    monkeypatch.setattr(inventory, "get_app_database_url", lambda: database_url)
    monkeypatch.setattr(inventory, "get_local_store", lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("local_store should not be used")))
    monkeypatch.setattr(inventory.time, "time", lambda: 1_710_000_500)
    monkeypatch.setattr(inventory, "ensure_user_permission", lambda *args, **kwargs: None)
    monkeypatch.setattr(inventory, "_get_database_name_map", lambda: {"DB1": "Основная БД"})
    monkeypatch.setattr(inventory, "_get_accessible_db_ids", lambda current_user: ["DB1"])
    monkeypatch.setattr(
        inventory,
        "_resolve_sql_context",
        lambda mac_address, hostname, db_id: {
            "branch_no": "101",
            "branch_name": "Тюмень",
            "location_name": "Кабинет 12",
            "employee_name": "Иванов И.И.",
            "ip_address": "10.10.1.22",
        },
    )
    monkeypatch.setattr(inventory, "_resolve_network_link", lambda conn, mac_address, ip_list: None)

    first_payload = inventory.InventoryPayload(
        hostname="PC-04",
        system_serial="SYS-4",
        mac_address="AA-BB-CC-DD-EE-04",
        current_user="CORP\\ivanov",
        user_login="CORP\\ivanov",
        user_full_name="Иванов И.И.",
        ip_primary="10.10.1.22",
        ip_list=["10.10.1.22"],
        report_type="heartbeat",
        timestamp=1_710_000_000,
        health={"cpu_load_percent": 11},
    )
    deferred_payload = inventory.InventoryPayload(
        hostname="PC-04",
        system_serial="SYS-4",
        mac_address="AA-BB-CC-DD-EE-04",
        current_user="CORP\\ivanov",
        user_login="CORP\\ivanov",
        user_full_name="Иванов И.И.",
        ip_primary="10.10.1.22",
        ip_list=["10.10.1.22"],
        report_type="heartbeat",
        timestamp=1_710_000_200,
        health={"cpu_load_percent": 15},
    )

    inventory.receive_inventory(first_payload, x_api_key=inventory.DEFAULT_AGENT_API_KEY)
    inventory.receive_inventory(deferred_payload, x_api_key=inventory.DEFAULT_AGENT_API_KEY)

    computers = inventory.get_computers(
        current_user=_user(),
        db_id_selected="DB1",
        scope="selected",
        branch=None,
        status_filter=None,
        outlook_status=None,
        q=None,
        sort_by="hostname",
        sort_dir="asc",
        changed_only=False,
    )

    assert len(computers) == 1
    assert computers[0]["hostname"] == "PC-04"
    assert computers[0]["last_seen_at"] == 1_710_000_200
    assert computers[0]["status"] == "online"
