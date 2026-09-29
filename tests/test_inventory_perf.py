"""Перф-тесты индексного пути AppInventoryStore на синтетике (~5k хостов).

Проверяют поведение, а не wall-clock: узость кандидатов, число SQL-запросов,
мультитокенный AND, MAC без разделителей. Временные рамки — мягкие (секунды),
чтобы не ловить флейки CI; точные замеры — scripts/perf/bench_inventory_store.py.
"""
from __future__ import annotations

import importlib.util
import sys
import time
from pathlib import Path

import pytest
from sqlalchemy import event

BACKEND_ROOT = Path(__file__).resolve().parents[1] / "WEB-itinvent"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from backend.appdb.db import get_app_engine  # noqa: E402
from backend.appdb.inventory_store import AppInventoryStore  # noqa: E402

MODULE_PATH = BACKEND_ROOT / "backend" / "api" / "v1" / "inventory.py"
SPEC = importlib.util.spec_from_file_location("inventory_perf_module", MODULE_PATH)
inventory = importlib.util.module_from_spec(SPEC)
assert SPEC is not None and SPEC.loader is not None
SPEC.loader.exec_module(inventory)

HOSTS = 5000
ALL_FIELDS = set(inventory.COMPUTER_SEARCH_FIELDS)
STATIC_FIELDS = ALL_FIELDS - {"network"}  # network не индексируется — резолвится отдельно
NOW = int(time.time())


def _mac(i: int) -> str:
    return f"{i:012X}"


def _mac_dashed(i: int) -> str:
    raw = _mac(i)
    return "-".join(raw[j:j + 2] for j in range(0, 12, 2))


def _host_payload(i: int) -> dict:
    bucket = i % 10
    if bucket < 5:
        last_seen = NOW - (i % 600)
    elif bucket < 7:
        last_seen = NOW - 1000 - (i % 2000)
    elif bucket < 9:
        last_seen = NOW - 7200 - i
    else:
        last_seen = None
    login = f"user{i % 300}"
    return {
        "mac_address": _mac_dashed(i),
        "hostname": f"WS-{i:05d}",
        "user_login": login,
        "user_full_name": f"Employee {i % 300}",
        "current_user": login,
        "ip_primary": f"10.0.{i % 250}.{i % 200 + 1}",
        "ip_list": [f"10.0.{i % 250}.{i % 200 + 1}"],
        "last_seen_at": last_seen,
        "report_type": "full_snapshot",
        "user_profile_sizes": {
            "profiles": [
                {
                    "user_name": login,
                    "profile_path": f"C:\\Users\\{login}",
                    "top_level_folders": [
                        {"name": "Documents", "path": f"C:\\Users\\{login}\\Documents"}
                    ],
                }
            ]
        },
        "outlook": {
            "source": "system_scan",
            "confidence": "high",
            "status": "ok",
            "active_stores": [
                {"path": f"D:\\Mail\\u{i}.ost", "type": "ost", "size_bytes": 5_000_000_000}
            ],
            "archives": [
                {"path": f"D:\\Mail\\a{i}.pst", "type": "pst", "size_bytes": 2_000_000_000}
            ],
        },
        "hardware": {"cpu": "Intel i7", "ram_gb": 16},
        "monitors": [{"manufacturer": "Dell", "serial_number": f"MON{i}"}],
        "_padding": "x" * 400,
    }


@pytest.fixture(scope="module")
def store(tmp_path_factory):
    db_path = tmp_path_factory.mktemp("perf") / "inventory_perf.db"
    url = f"sqlite:///{db_path.as_posix()}"
    app_store = AppInventoryStore(database_url=url)
    app_store.replace_from_legacy({_mac(i): _host_payload(i) for i in range(HOSTS)}, [
        {
            "event_id": f"mac:{_mac(i % HOSTS)}:{NOW - i * 1000}",
            "detected_at": NOW - i * 1000,
            "mac_address": _mac(i % HOSTS),
            "hostname": f"WS-{i % HOSTS:05d}",
            "change_types": ["hardware"],
            "diff": {},
            "before_signature": {},
            "after_signature": {},
            "report_type": "full_snapshot",
        }
        for i in range(500)
    ])
    branches = [f"Branch {b}" for b in range(8)]
    for i in range(HOSTS):
        if i % 5 == 4:
            continue
        app_store.upsert_sql_context(
            mac_address=_mac(i),
            hostname=f"WS-{i:05d}",
            db_id=["itinv", "msk", "spb"][i % 3],
            context={
                "branch_name": branches[i % 8],
                "location_name": f"Room {i % 50}",
                "employee_name": f"Employee {i % 300}",
            },
        )
    return app_store


def test_indexed_search_narrows_candidates(store):
    keys = store.search_host_keys("ws-00042", STATIC_FIELDS, include_payload=True)
    assert keys is not None
    assert 0 < len(keys) <= 5


def test_indexed_search_multi_token_and(store):
    single = store.search_host_keys("ws-00042", STATIC_FIELDS, include_payload=True)
    narrowed = store.search_host_keys("ws-00042 user14", STATIC_FIELDS, include_payload=True)
    assert narrowed is not None
    assert narrowed <= (single or set())
    # токен, которого нет в записи — пустой результат
    empty = store.search_host_keys("ws-00042 zzz-no-such-token", STATIC_FIELDS, include_payload=True)
    assert empty == set()


def test_indexed_search_mac_without_separators(store):
    token = _mac(42).lower()  # '00000000002a' — хекс без разделителей
    keys = store.search_host_keys(token, {"identity"}, include_payload=True)
    assert keys is not None
    assert _mac(42) in keys


def test_non_ascii_token_falls_back_on_sqlite(store):
    # SQLite lower() — только ASCII: кириллический токен честно просит полный
    # скан (None), а не пустой кандидат-набор. На PostgreSQL — folded LIKE.
    assert store.search_host_keys("сотрудник", STATIC_FIELDS, include_payload=True) is None


def test_yo_folding_python_side():
    # Python-фолдинг (ё→е + casefold) работает на любом диалекте.
    records = [
        {"hostname": "WS-1", "user_full_name": "Ёлкин А.А."},
        {"hostname": "WS-2", "user_full_name": "Петров И.И."},
    ]
    matched = inventory._apply_search_filter(records, "елкин")
    assert [item["hostname"] for item in matched] == ["WS-1"]


def test_multi_token_python_side():
    records = [
        {"hostname": "WS-1", "user_full_name": "Петров И.И."},
        {"hostname": "WS-2", "user_full_name": "Петров А.А."},
        {"hostname": "WS-3", "user_full_name": "Сидоров И.И."},
    ]
    matched = inventory._apply_search_filter(records, "ws-2 петров")
    assert [item["hostname"] for item in matched] == ["WS-2"]


def test_status_and_changed_keys(store):
    online = store.list_host_keys_by_status(
        "online",
        now_ts=NOW,
        online_max_age_seconds=inventory.ONLINE_MAX_AGE_SECONDS,
        stale_max_age_seconds=inventory.STALE_MAX_AGE_SECONDS,
    )
    changed = store.list_changed_host_keys(NOW - 30 * 86400)
    assert len(online) >= HOSTS // 2  # 50% online + NULL bucket
    assert len(changed) == 500


def test_context_branch_keys(store):
    keys = store.list_host_keys_for_context(["itinv", "msk", "spb"], branch_name="branch 3")
    assert len(keys) >= 400


def test_search_query_count_bounded(store):
    # один проход search_host_keys — не более ~6 SQL-запросов на токен
    engine = get_app_engine(store._database_url)
    counter = {"n": 0}

    @event.listens_for(engine, "before_cursor_execute")
    def _count(*_args):
        counter["n"] += 1

    try:
        store.search_host_keys("ws-00042", STATIC_FIELDS, include_payload=True)
    finally:
        event.remove(engine, "before_cursor_execute", _count)
    assert 0 < counter["n"] <= 6


def test_search_soft_time_budget(store):
    started = time.perf_counter()
    keys = store.search_host_keys("user1", STATIC_FIELDS, include_payload=True)
    elapsed = time.perf_counter() - started
    assert keys
    # мягкий потолок: полный скан с decode payload на 5k занял бы >>5с
    assert elapsed < 5.0
