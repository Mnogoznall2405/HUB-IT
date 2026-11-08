"""Поиск программы по парку: маршрут /computers/software/search на настоящей app-db (sqlite).

Агент присылает software_inventory, маршрут отдаёт установки по видимым пользователю компьютерам,
фильтрует по имени и по «версия ниже»; компьютер вне доступной базы в выдачу не попадает.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1] / "WEB-itinvent"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

MODULE_PATH = BACKEND_ROOT / "backend" / "api" / "v1" / "inventory.py"
SPEC = importlib.util.spec_from_file_location("inventory_software_search_module", MODULE_PATH)
inventory = importlib.util.module_from_spec(SPEC)
assert SPEC is not None and SPEC.loader is not None
SPEC.loader.exec_module(inventory)

from backend.appdb.inventory_store import AppInventoryStore  # noqa: E402

AGENT_KEY = "test-inventory-agent-key"
T0 = 1_710_000_500


@pytest.fixture
def app_env(temp_dir, monkeypatch):
    database_url = f"sqlite:///{(Path(temp_dir) / 'inventory_software.db').as_posix()}"
    monkeypatch.setenv("ITINV_AGENT_API_KEYS", AGENT_KEY)
    monkeypatch.setenv("ITINV_AGENT_API_KEY", "")
    monkeypatch.setattr(inventory, "is_app_database_configured", lambda: True)
    monkeypatch.setattr(inventory, "get_app_database_url", lambda: database_url)
    monkeypatch.setattr(inventory.time, "time", lambda: T0)
    monkeypatch.setattr(inventory, "ensure_user_permission", lambda *args, **kwargs: None)
    monkeypatch.setattr(inventory, "_get_database_name_map", lambda: {"DB1": "Main DB"})
    monkeypatch.setattr(inventory, "_get_accessible_db_ids", lambda current_user: ["DB1"])
    monkeypatch.setattr(inventory, "_resolve_network_link", lambda conn, mac_address, ip_list: None)
    monkeypatch.setattr(inventory, "_computers_records_cache", inventory.OrderedDict())
    monkeypatch.setattr(inventory, "_computers_flights", {})
    monkeypatch.setattr(inventory, "_computers_hot_keys", inventory.OrderedDict())
    monkeypatch.setattr(inventory, "_changes_index_cache", None)
    monkeypatch.setattr(inventory, "_network_lookup_index_cache", None)
    return {"url": database_url}


def _user():
    return inventory.User(id=1, username="tester", role="admin", permissions=["computers.read", "computers.read_all"])


def _receive(mac: str, hostname: str, programs: list[tuple[str, str]]):
    payload = inventory.InventoryPayload(
        hostname=hostname,
        system_serial=f"SYS-{hostname}",
        mac_address=mac,
        current_user="CORP\\user",
        user_login="CORP\\user",
        user_full_name="User Name",
        ip_primary="10.10.1.11",
        ip_list=["10.10.1.11"],
        cpu_model="CPU1",
        ram_gb=16,
        logical_disks=[{"mountpoint": "C:\\", "total_gb": 100, "free_gb": 40, "percent": 60}],
        storage=[{"name": "SSD", "health_status": "Healthy", "size_gb": 256}],
        report_type="full_snapshot",
        timestamp=T0 - 60,
        software_inventory={
            "collected_at": T0 - 30,
            "items": [
                {"display_name": name, "display_version": version, "publisher": "Vendor", "install_date": "20260301"}
                for name, version in programs
            ],
        },
    )
    assert inventory.receive_inventory(payload, x_api_key=AGENT_KEY)["success"] is True


def _bind(env, mac: str, hostname: str, branch: str):
    store = AppInventoryStore(database_url=env["url"])
    assert store.bind_sql_context_row(
        mac_address=mac,
        hostname=hostname,
        db_id="DB1",
        context={"inv_no": f"INV-{hostname}", "branch_no": "101", "branch_name": branch, "model_name": "Dell"},
    )


def _search(**overrides):
    params = dict(
        current_user=_user(),
        db_id_selected="DB1",
        scope="selected",
        q="reader",
        version_below=None,
        limit=200,
    )
    params.update(overrides)
    return inventory.search_computers_software(**params)


def test_software_search_finds_installs_across_computers_and_filters_old_versions(app_env):
    _receive("AA-BB-CC-DD-EE-01", "PC-01", [("Adobe Reader", "23.8.1"), ("7-Zip", "23.01")])
    _receive("AA-BB-CC-DD-EE-02", "PC-02", [("Adobe Reader", "24.2.0")])
    _receive("AA-BB-CC-DD-EE-03", "PC-03", [("Notepad++", "8.6")])
    _bind(app_env, "AA-BB-CC-DD-EE-01", "PC-01", "Tyumen")
    _bind(app_env, "AA-BB-CC-DD-EE-02", "PC-02", "Moscow")
    _bind(app_env, "AA-BB-CC-DD-EE-03", "PC-03", "Tyumen")

    found = _search()
    assert [(row["hostname"], row["version"]) for row in found["items"]] == [("PC-01", "23.8.1"), ("PC-02", "24.2.0")]
    assert found["items"][0]["branch_name"] == "Tyumen"
    assert found["total"] == 2
    assert found["computers_checked"] == 3
    assert found["computers_with_software"] == 3

    outdated = _search(version_below="24.0")
    assert [row["hostname"] for row in outdated["items"]] == ["PC-01"]

    limited = _search(limit=1)
    assert limited["total"] == 2 and limited["truncated"] is True and len(limited["items"]) == 1


def test_computer_detail_carries_software_list_for_the_card(app_env):
    _receive("AA-BB-CC-DD-EE-01", "PC-01", [("Adobe Reader", "23.8.1"), ("7-Zip", "23.01")])
    _bind(app_env, "AA-BB-CC-DD-EE-01", "PC-01", "Tyumen")

    detail = inventory.get_computer_detail(
        mac_address="AA-BB-CC-DD-EE-01",
        current_user=_user(),
        db_id_selected="DB1",
        scope="selected",
        mobile_safe=False,
    )
    software = detail["software_inventory"]
    assert {(row["display_name"], row["display_version"]) for row in software["items"]} == {
        ("Adobe Reader", "23.8.1"),
        ("7-Zip", "23.01"),
    }


def _receive_with_usb(mac: str, hostname: str, usb_items: list[dict]):
    payload = inventory.InventoryPayload(
        hostname=hostname,
        system_serial=f"SYS-{hostname}",
        mac_address=mac,
        current_user="CORP\\user",
        user_login="CORP\\user",
        user_full_name="User Name",
        ip_primary="10.10.1.11",
        ip_list=["10.10.1.11"],
        cpu_model="CPU1",
        ram_gb=16,
        logical_disks=[{"mountpoint": "C:\\", "total_gb": 100, "free_gb": 40, "percent": 60}],
        storage=[{"name": "SSD", "health_status": "Healthy", "size_gb": 256}],
        report_type="full_snapshot",
        timestamp=T0 - 60,
        usb_devices={"collected_at": T0 - 30, "items": usb_items},
    )
    assert inventory.receive_inventory(payload, x_api_key=AGENT_KEY)["success"] is True


def _usb_search(**overrides):
    params = dict(
        current_user=_user(),
        db_id_selected="DB1",
        scope="selected",
        q="sandisk",
        present_only=False,
        limit=200,
    )
    params.update(overrides)
    return inventory.search_computers_usb(**params)


def test_usb_search_finds_the_same_flash_drive_on_different_computers(app_env):
    flash = {"kind": "storage", "vendor": "SanDisk", "product": "Ultra", "friendly_name": "SanDisk Ultra USB Device",
             "serial": "4C530001", "has_unique_serial": True, "present": False, "last_connected_at": T0 - 500}
    _receive_with_usb("AA-BB-CC-DD-EE-01", "PC-01", [flash])
    _receive_with_usb("AA-BB-CC-DD-EE-02", "PC-02", [{**flash, "present": True, "last_connected_at": T0 - 10}])
    _receive_with_usb("AA-BB-CC-DD-EE-03", "PC-03", [{"kind": "storage", "vendor": "Kingston", "serial": "KK1"}])
    for mac, host in (("AA-BB-CC-DD-EE-01", "PC-01"), ("AA-BB-CC-DD-EE-02", "PC-02"), ("AA-BB-CC-DD-EE-03", "PC-03")):
        _bind(app_env, mac, host, "Tyumen")

    by_serial = _usb_search(q="4C530001")
    assert [row["hostname"] for row in by_serial["items"]] == ["PC-02", "PC-01"]
    assert by_serial["computers_with_usb_data"] == 3

    assert [row["hostname"] for row in _usb_search(present_only=True)["items"]] == ["PC-02"]
    assert _usb_search(q="kingston")["total"] == 1


def _receive_with_runtime(mac: str, hostname: str, runtime: dict | None, timestamp: int):
    payload = inventory.InventoryPayload(
        hostname=hostname,
        system_serial=f"SYS-{hostname}",
        mac_address=mac,
        current_user="CORP\\user",
        user_login="CORP\\user",
        user_full_name="User Name",
        ip_primary="10.10.1.11",
        ip_list=["10.10.1.11"],
        cpu_model="CPU1",
        ram_gb=16,
        logical_disks=[{"mountpoint": "C:\\", "total_gb": 100, "free_gb": 40, "percent": 60}],
        storage=[{"name": "SSD", "health_status": "Healthy", "size_gb": 256}],
        report_type="full_snapshot",
        timestamp=timestamp,
        last_seen_at=timestamp,
        agent_runtime=runtime,
    )
    assert inventory.receive_inventory(payload, x_api_key=AGENT_KEY)["success"] is True


def test_fleet_health_flags_silent_old_and_broken_agents(app_env):
    healthy = {
        "agent_version": "1.4.14",
        "sidecars": {"fs_egress": {"enabled": True, "alive": True, "pending": 0, "dead_letter": 0}, "scan": {"alive": True}},
    }
    broken = {
        "agent_version": "1.4.14",
        "sidecars": {"fs_egress": {"enabled": True, "alive": False, "pending": 0, "dead_letter": 40}, "scan": {"alive": True}},
    }
    _receive_with_runtime("AA-BB-CC-DD-EE-01", "PC-OK", healthy, T0 - 60)
    _receive_with_runtime("AA-BB-CC-DD-EE-02", "PC-BROKEN", broken, T0 - 120)
    _receive_with_runtime("AA-BB-CC-DD-EE-03", "PC-OLD", {"agent_version": "1.4.11"}, T0 - 90)
    _receive_with_runtime("AA-BB-CC-DD-EE-04", "PC-SILENT", healthy, T0 - 20 * 86400)
    for index, host in enumerate(("PC-OK", "PC-BROKEN", "PC-OLD", "PC-SILENT"), start=1):
        _bind(app_env, f"AA-BB-CC-DD-EE-0{index}", host, "Tyumen")

    result = inventory.get_fleet_health(current_user=_user(), db_id_selected="DB1", scope="selected", limit=500)

    assert result["computers_total"] == 4
    assert result["latest_version"] == "1.4.14"
    assert result["age_buckets"]["silent"] == 1 and result["age_buckets"]["online"] == 3
    issues = {row["hostname"]: set(row["issues"]) for row in result["problems"]}
    assert "PC-OK" not in issues
    assert issues["PC-BROKEN"] == {"fs_dead", "dead_letter"}
    assert issues["PC-OLD"] == {"old_version", "no_egress"}
    assert issues["PC-SILENT"] == {"silent"}
    assert result["sidecars"]["dead_letter_total"] == 40
    assert [row["hostname"] for row in result["problems"]][0] == "PC-SILENT"
