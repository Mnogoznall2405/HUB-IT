"""Кэш и облегчённый список GET /inventory/computers/search на реальной app-db (sqlite).

Проверяем поведение через route-функции: кэш страницы срабатывает (регрессия: внутренний
cache_key перезаписывал ключ записей), инвалидируется при изменении содержимого, ETag не
переживает смену минуты, view=card отдаёт поля карточки, детальная карточка и список дают
одинаковую сводку изменений для MAC в разных форматах.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1] / "WEB-itinvent"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

MODULE_PATH = Path(__file__).resolve().parents[1] / "WEB-itinvent" / "backend" / "api" / "v1" / "inventory.py"
SPEC = importlib.util.spec_from_file_location("inventory_cache_api_module", MODULE_PATH)
inventory = importlib.util.module_from_spec(SPEC)
assert SPEC is not None and SPEC.loader is not None
SPEC.loader.exec_module(inventory)

from backend.appdb.inventory_store import AppInventoryStore  # noqa: E402

TEST_AGENT_API_KEY = "test-inventory-agent-key"
T0 = 1_710_000_500


@pytest.fixture(autouse=True)
def _configure_agent_key(monkeypatch):
    monkeypatch.setenv("ITINV_AGENT_API_KEYS", TEST_AGENT_API_KEY)
    monkeypatch.setenv("ITINV_AGENT_API_KEY", "")


class _Request:
    def __init__(self, headers=None):
        self.headers = dict(headers or {})


class _Response:
    def __init__(self):
        self.headers = {}


def _user():
    return inventory.User(id=1, username="tester", role="admin", permissions=["computers.read", "computers.read_all"])


@pytest.fixture
def app_env(temp_dir, monkeypatch):
    database_url = f"sqlite:///{(Path(temp_dir) / 'inventory_cache.db').as_posix()}"
    clock = {"now": T0}

    monkeypatch.setattr(inventory, "is_app_database_configured", lambda: True)
    monkeypatch.setattr(inventory, "get_app_database_url", lambda: database_url)
    monkeypatch.setattr(inventory.time, "time", lambda: clock["now"])
    monkeypatch.setattr(inventory, "ensure_user_permission", lambda *args, **kwargs: None)
    monkeypatch.setattr(inventory, "_get_database_name_map", lambda: {"DB1": "Main DB"})
    monkeypatch.setattr(inventory, "_get_accessible_db_ids", lambda current_user: ["DB1"])
    monkeypatch.setattr(inventory, "_resolve_network_link", lambda conn, mac_address, ip_list: None)
    # Кэш процесса общий для тестов: каждый тест начинает с пустого состояния.
    monkeypatch.setattr(inventory, "_computers_records_cache", inventory.OrderedDict())
    monkeypatch.setattr(inventory, "_changes_index_cache", None)
    monkeypatch.setattr(inventory, "_network_lookup_index_cache", None)
    return {"url": database_url, "clock": clock}


def _receive(mac: str, hostname: str, *, timestamp: int = T0 - 60, ip: str = "10.10.1.11"):
    payload = inventory.InventoryPayload(
        hostname=hostname,
        system_serial=f"SYS-{hostname}",
        mac_address=mac,
        current_user="CORP\\user",
        user_login="CORP\\user",
        user_full_name="User Name",
        ip_primary=ip,
        ip_list=[ip],
        cpu_model="CPU1",
        ram_gb=16,
        logical_disks=[{"mountpoint": "C:\\", "total_gb": 100, "free_gb": 40, "percent": 60}],
        storage=[{"name": "SSD", "health_status": "Healthy", "size_gb": 256}],
        report_type="full_snapshot",
        timestamp=timestamp,
    )
    assert inventory.receive_inventory(payload, x_api_key=TEST_AGENT_API_KEY)["success"] is True


def _bind(env, mac: str, hostname: str, branch: str = "Tyumen"):
    store = AppInventoryStore(database_url=env["url"])
    assert store.bind_sql_context_row(
        mac_address=mac,
        hostname=hostname,
        db_id="DB1",
        context={"inv_no": f"INV-{hostname}", "branch_no": "101", "branch_name": branch, "model_name": "Dell"},
    )


def _search(request=None, response=None, **overrides):
    params = dict(
        request=request,
        response=response,
        current_user=_user(),
        db_id_selected="DB1",
        scope="selected",
        branch=None,
        status_filter=None,
        outlook_status=None,
        q=None,
        search_fields="",
        sort_by="hostname",
        sort_dir="asc",
        changed_only=False,
        include_hidden=False,
        hidden_only=False,
        hide_vm_172=False,
        limit=50,
        offset=0,
        include_summary=False,
        mobile_safe=False,
        view="",
    )
    params.update(overrides)
    return inventory.search_computers(**params)


def _seed_three_hosts(env):
    for index, hostname in enumerate(["PC-01", "PC-02", "PC-03"], start=1):
        mac = f"AA-BB-CC-DD-EE-0{index}"
        _receive(mac, hostname)
        _bind(env, mac, hostname)


def test_first_page_is_served_from_records_cache_until_content_changes(app_env, monkeypatch):
    _seed_three_hosts(app_env)
    host_reads = []
    original_list_hosts = AppInventoryStore.list_hosts

    def counting_list_hosts(self, *args, **kwargs):
        host_reads.append(1)
        return original_list_hosts(self, *args, **kwargs)

    monkeypatch.setattr(AppInventoryStore, "list_hosts", counting_list_hosts)

    first = _search(limit=2)
    second = _search(limit=2)
    assert [row["hostname"] for row in first["items"]] == ["PC-01", "PC-02"]
    assert second["items"] == first["items"]
    assert len(host_reads) == 1, "вторая страница в пределах TTL должна браться из кэша записей"

    # Полная карточка меняет содержимое: кэш не должен отдать старое имя хоста.
    _receive("AA-BB-CC-DD-EE-01", "PC-01-RENAMED", timestamp=T0 - 30)
    refreshed = _search(limit=2)
    assert refreshed["items"][0]["hostname"] == "PC-01-RENAMED"
    assert len(host_reads) == 2


def test_cached_page_items_are_copies_not_shared_cache_entries(app_env):
    _seed_three_hosts(app_env)
    first = _search(limit=1)
    first["items"][0]["hostname"] = "MUTATED-BY-CALLER"
    first["items"][0]["network_link"] = {"device_code": "X"}

    second = _search(limit=1)
    assert second["items"][0]["hostname"] == "PC-01"
    assert second["items"][0].get("network_link") is None


def test_card_view_keeps_card_fields_and_drops_detail_only_blocks(app_env):
    _seed_three_hosts(app_env)

    full = _search(limit=1)["items"][0]
    card = _search(limit=1, view="card")["items"][0]

    for field in ("hostname", "status", "ip_primary", "inventory_inv_no", "database_name", "branch_name",
                  "network_link", "logical_disks", "storage", "outlook_status", "has_hardware_changes"):
        assert field in card, field
    assert card["logical_disks"][0]["mountpoint"] == full["logical_disks"][0]["mountpoint"]
    for field in ("cpu_model", "ram_gb", "uptime_seconds", "network", "user_profile_sizes", "outlook", "timestamp"):
        assert field in full, field
        assert field not in card, field


def test_etag_is_stable_within_minute_and_changes_on_next_minute(app_env):
    _seed_three_hosts(app_env)
    response = _Response()
    _search(request=_Request(), response=response)
    etag = response.headers["ETag"]

    not_modified = _search(request=_Request({"if-none-match": etag}), response=_Response())
    assert getattr(not_modified, "status_code", None) == 304

    # Статусы зависят от времени: новая минута даёт новый ETag, 304 не должен пережить её.
    app_env["clock"]["now"] = T0 + 61
    moved = _search(request=_Request({"if-none-match": etag}), response=_Response())
    assert not hasattr(moved, "status_code") or moved.status_code != 304
    assert isinstance(moved, dict) and moved["items"]


def test_detail_change_summary_matches_list_for_mac_formats(app_env):
    _seed_three_hosts(app_env)
    store = AppInventoryStore(database_url=app_env["url"])
    events = [
        ("AA-BB-CC-DD-EE-01", T0 - 86_400, "evt-1"),
        ("AABBCCDDEE01", T0 - 2 * 86_400, "evt-2"),
        ("aa:bb:cc:dd:ee:01", T0 - 3 * 86_400, "evt-3"),
        ("AA-BB-CC-DD-EE-02", T0 - 86_400, "evt-4"),
        ("AA-BB-CC-DD-EE-01", T0 - 45 * 86_400, "evt-old"),
    ]
    for mac, detected_at, event_id in events:
        store.append_change_event({
            "event_id": event_id,
            "detected_at": detected_at,
            "mac_address": mac,
            "hostname": "PC-01",
            "change_types": ["storage"],
            "diff": {},
            "before_signature": {},
            "after_signature": {},
            "report_type": "full_snapshot",
        })

    listed = {row["hostname"]: row for row in _search(limit=10)["items"]}
    assert listed["PC-01"]["changes_count_30d"] == 3
    assert listed["PC-02"]["changes_count_30d"] == 1

    for mac, hostname in (("AA-BB-CC-DD-EE-01", "PC-01"), ("AA-BB-CC-DD-EE-02", "PC-02")):
        detail = inventory.get_computer_detail(mac, current_user=_user(), db_id_selected="DB1", scope="selected", mobile_safe=False)
        assert detail["hostname"] == hostname
        assert detail["changes_count_30d"] == listed[hostname]["changes_count_30d"]
        assert detail["has_hardware_changes"] == listed[hostname]["has_hardware_changes"]
        assert detail["last_change_at"] == listed[hostname]["last_change_at"]
