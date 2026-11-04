"""Stale-while-revalidate, single-flight и прогрев кэша списка компьютеров (route-функции, app-db sqlite).

Проверяем через search_computers: устаревшая выдача не ждёт пересборку, статусы пересчитываются
от текущего времени, ошибка фоновой пересборки не портит хороший кэш, параллельные промахи строят
запись один раз, фильтр по статусу не получает устаревших данных, прогрев обновляет горячий ключ.
Возраст записи меняется явно (без sleep); фоновая пересборка держится шлюзом (threading.Event).
"""
from __future__ import annotations

import importlib.util
import sys
import threading
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1] / "WEB-itinvent"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

MODULE_PATH = Path(__file__).resolve().parents[1] / "WEB-itinvent" / "backend" / "api" / "v1" / "inventory.py"
SPEC = importlib.util.spec_from_file_location("inventory_list_swr_module", MODULE_PATH)
inventory = importlib.util.module_from_spec(SPEC)
assert SPEC is not None and SPEC.loader is not None
SPEC.loader.exec_module(inventory)

from backend.appdb.inventory_store import AppInventoryStore  # noqa: E402

TEST_AGENT_API_KEY = "test-inventory-agent-key"
T0 = 1_710_000_500
REBUILD_THREAD_PREFIX = "inventory-list-rebuild"
TTL = inventory.COMPUTERS_RECORDS_CACHE_TTL_SEC


@pytest.fixture(autouse=True)
def _configure_agent_key(monkeypatch):
    monkeypatch.setenv("ITINV_AGENT_API_KEYS", TEST_AGENT_API_KEY)
    monkeypatch.setenv("ITINV_AGENT_API_KEY", "")


def _user():
    return inventory.User(id=1, username="tester", role="admin", permissions=["computers.read", "computers.read_all"])


@pytest.fixture
def app_env(temp_dir, monkeypatch):
    database_url = f"sqlite:///{(Path(temp_dir) / 'inventory_swr.db').as_posix()}"
    clock = {"now": T0}

    monkeypatch.setattr(inventory, "is_app_database_configured", lambda: True)
    monkeypatch.setattr(inventory, "get_app_database_url", lambda: database_url)
    monkeypatch.setattr(inventory.time, "time", lambda: clock["now"])
    monkeypatch.setattr(inventory, "ensure_user_permission", lambda *args, **kwargs: None)
    monkeypatch.setattr(inventory, "_get_database_name_map", lambda: {"DB1": "Main DB"})
    monkeypatch.setattr(inventory, "_get_accessible_db_ids", lambda current_user: ["DB1"])
    monkeypatch.setattr(inventory, "_resolve_network_link", lambda conn, mac_address, ip_list: None)
    # Состояние процесса общее для тестов: каждый тест начинает с пустого кэша, пересборок и горячих ключей.
    monkeypatch.setattr(inventory, "_computers_records_cache", inventory.OrderedDict())
    monkeypatch.setattr(inventory, "_computers_flights", {})
    monkeypatch.setattr(inventory, "_computers_hot_keys", inventory.OrderedDict())
    monkeypatch.setattr(inventory, "_changes_index_cache", None)
    monkeypatch.setattr(inventory, "_network_lookup_index_cache", None)
    return {"url": database_url, "clock": clock}


@pytest.fixture
def rebuild_gate(monkeypatch):
    """Фоновые пересборки блокируются шлюзом до gate.set(); синхронные вызовы в потоке теста проходят сразу."""
    gate = threading.Event()
    background_started = threading.Event()
    original = inventory._compute_scoped_records

    def gated(**kwargs):
        if threading.current_thread().name.startswith(REBUILD_THREAD_PREFIX):
            background_started.set()
            gate.wait(timeout=10)
        return original(**kwargs)

    monkeypatch.setattr(inventory, "_compute_scoped_records", gated)
    yield gate, background_started
    gate.set()


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


def _search(**overrides):
    params = dict(
        request=None,
        response=None,
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


def _only_key():
    keys = list(inventory._computers_records_cache.keys())
    assert len(keys) == 1, keys
    return keys[0]


def _age_cache(seconds: float):
    """Сдвигает момент сборки записей назад: эквивалент того, что TTL истёк, без ожидания."""
    cache = inventory._computers_records_cache
    for key, (built_at, version, records) in list(cache.items()):
        cache[key] = (built_at - seconds, version, records)


def _by_host(payload):
    return {item["hostname"]: item for item in payload["items"]}


def test_expired_entry_is_served_without_waiting_for_background_rebuild(app_env, rebuild_gate):
    gate, background_started = rebuild_gate
    _seed_three_hosts(app_env)
    first = _search(limit=2)
    key = _only_key()
    _age_cache(TTL + 1)
    aged_built_at = inventory._computers_records_cache[key][0]

    # Пересборка заблокирована шлюзом: ответ должен прийти без неё, а пересборка должна идти в фоне.
    stale = _search(limit=2)
    assert [row["hostname"] for row in stale["items"]] == [row["hostname"] for row in first["items"]]
    assert background_started.wait(timeout=10)
    flight = inventory._computers_flights[key][1]
    assert not flight.done()
    assert inventory._computers_records_cache[key][0] == aged_built_at, "старая запись не должна заменяться до конца пересборки"

    gate.set()
    flight.result(timeout=10)
    assert key not in inventory._computers_flights
    assert inventory._computers_records_cache[key][0] > aged_built_at


def test_stale_response_recomputes_status_from_current_time(app_env, rebuild_gate):
    gate, _ = rebuild_gate
    _receive("AA-BB-CC-DD-EE-01", "PC-01", timestamp=T0 - 700)
    _bind(app_env, "AA-BB-CC-DD-EE-01", "PC-01")
    first = _search(limit=10)
    assert _by_host(first)["PC-01"]["status"] == "online"

    # Данных от ПК нет; запись устарела по TTL. Статус не должен остаться online.
    app_env["clock"]["now"] = T0 + 60
    _age_cache(TTL + 1)
    stale = _search(limit=10)
    item = _by_host(stale)["PC-01"]
    assert item["status"] == "stale"
    assert item["age_seconds"] == 760

    key = _only_key()
    cached_records = inventory._computers_records_cache[key][2]
    assert cached_records[0]["status"] == "online", "статус в кэше не должен переписываться при выдаче"

    flight = inventory._computers_flights[key][1]
    gate.set()
    flight.result(timeout=10)


def test_failed_background_rebuild_keeps_good_cache_and_still_serves(app_env, monkeypatch):
    _seed_three_hosts(app_env)
    _search(limit=2)
    key = _only_key()
    _age_cache(TTL + 1)
    good_entry = inventory._computers_records_cache[key]

    gate = threading.Event()
    original = inventory._compute_scoped_records

    def failing(**kwargs):
        if threading.current_thread().name.startswith(REBUILD_THREAD_PREFIX):
            gate.wait(timeout=10)
            raise RuntimeError("app db is unavailable")
        return original(**kwargs)

    monkeypatch.setattr(inventory, "_compute_scoped_records", failing)
    served = _search(limit=2)
    assert [row["hostname"] for row in served["items"]] == ["PC-01", "PC-02"]

    flight = inventory._computers_flights[key][1]
    gate.set()
    error = flight.exception(timeout=10)
    assert isinstance(error, RuntimeError)
    assert inventory._computers_records_cache[key] is good_entry, "ошибка пересборки не должна затирать запись"
    assert key not in inventory._computers_flights
    again = _search(limit=2)
    assert [row["hostname"] for row in again["items"]] == ["PC-01", "PC-02"]


def test_concurrent_misses_share_one_rebuild(app_env, monkeypatch):
    _seed_three_hosts(app_env)
    original = inventory._compute_scoped_records
    calls = []
    owner_entered = threading.Event()
    release = threading.Event()
    calls_lock = threading.Lock()

    def counted(**kwargs):
        with calls_lock:
            calls.append(1)
        owner_entered.set()
        release.wait(timeout=10)
        return original(**kwargs)

    monkeypatch.setattr(inventory, "_compute_scoped_records", counted)
    results = []
    results_lock = threading.Lock()

    def worker():
        page = _search(limit=2)["items"]
        with results_lock:
            results.append([row["hostname"] for row in page])

    owner = threading.Thread(target=worker)
    owner.start()
    assert owner_entered.wait(timeout=10)
    waiters = [threading.Thread(target=worker) for _ in range(3)]
    for thread in waiters:
        thread.start()
    release.set()
    owner.join(timeout=10)
    for thread in waiters:
        thread.join(timeout=10)

    assert len(calls) == 1, "параллельные промахи одного ключа должны строить запись один раз"
    assert len(results) == 4
    assert all(result == ["PC-01", "PC-02"] for result in results)


def test_status_filter_is_rebuilt_synchronously_instead_of_served_stale(app_env, monkeypatch):
    _seed_three_hosts(app_env)
    original = inventory._compute_scoped_records
    calls = []

    def counted(**kwargs):
        calls.append(kwargs.get("status_filter"))
        return original(**kwargs)

    monkeypatch.setattr(inventory, "_compute_scoped_records", counted)
    _search(status_filter="online")
    _age_cache(TTL + 1)
    _search(status_filter="online")

    assert calls == ["online", "online"], "фильтр по статусу зависит от времени: устаревшую выборку не отдаём"
    assert not inventory._computers_flights


def test_warmup_refreshes_hot_key_without_any_request(app_env, rebuild_gate):
    gate, background_started = rebuild_gate
    _seed_three_hosts(app_env)
    _search(limit=2)
    key = _only_key()
    _age_cache(TTL + 1)
    aged_built_at = inventory._computers_records_cache[key][0]

    assert inventory.warm_hot_list_keys() == 1
    assert background_started.wait(timeout=10)
    flight = inventory._computers_flights[key][1]
    gate.set()
    flight.result(timeout=10)
    assert inventory._computers_records_cache[key][0] > aged_built_at


def test_warmup_does_not_register_keys_as_hot(app_env):
    _seed_three_hosts(app_env)
    inventory._collect_scoped_computer_records(
        current_user=_user(),
        db_id_selected="DB1",
        scope="selected",
        branch=None,
        status_filter=None,
        outlook_status=None,
        q=None,
        track_hot=False,
    )
    assert not inventory._computers_hot_keys


def test_search_after_list_filters_cached_records_without_rebuilding(app_env, monkeypatch):
    _receive("AA-BB-CC-DD-EE-01", "PC-01", ip="10.10.1.11")
    _bind(app_env, "AA-BB-CC-DD-EE-01", "PC-01")
    _receive("AA-BB-CC-DD-EE-02", "PC-02", ip="10.20.2.22")
    _bind(app_env, "AA-BB-CC-DD-EE-02", "PC-02")
    cold = _by_host(_search(q="10.20", search_fields="identity"))
    assert list(cold) == ["PC-02"]

    # Свежий список в кэше: поиск не должен собирать записи заново (SQL-скан payload).
    _search(search_fields="identity")
    calls = []
    original = inventory._compute_scoped_records

    def counting(**kwargs):
        calls.append(kwargs["q"])
        return original(**kwargs)

    monkeypatch.setattr(inventory, "_compute_scoped_records", counting)
    inventory._computers_records_cache.pop(
        next(key for key in inventory._computers_records_cache if key[7] == "10.20"), None
    )
    derived = _by_host(_search(q="10.20", search_fields="identity"))
    assert list(derived) == ["PC-02"]
    assert derived["PC-02"]["ip_primary"] == cold["PC-02"]["ip_primary"]
    assert calls == []

    # Новый хост меняет версию содержимого: поиск обязан его увидеть, а не отдать производную от старого списка.
    _receive("AA-BB-CC-DD-EE-03", "PC-03", ip="10.20.3.33")
    _bind(app_env, "AA-BB-CC-DD-EE-03", "PC-03")
    fresh = _by_host(_search(q="10.20", search_fields="identity"))
    assert sorted(fresh) == ["PC-02", "PC-03"]
    assert calls == ["10.20"]
