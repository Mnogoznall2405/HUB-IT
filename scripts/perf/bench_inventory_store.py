"""Локальный микро-бенчмарк AppInventoryStore (SQLite, синтетические данные).

Dev-harness для аудита производительности вкладки «Компьютеры»
(documentation/technical/COMPUTERS_PERF_AUDIT_2026-09-18.md, Фаза 0).

Запуск из корня репозитория:
    python scripts/perf/bench_inventory_store.py

Переменные окружения:
    INV_BENCH_DB     — путь к scratch SQLite-файлу (по умолчанию %TEMP%/inv_bench.db)
    INV_BENCH_HOSTS  — число синтетических хостов (по умолчанию 2000)

Скрипт заполняет scratch-БД синтетикой и замеряет старый (полный снапшот)
и новый (кандидат-ключи) пути. Production/внешние БД не трогает.
"""
import os
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "WEB-itinvent"))
os.chdir(str(Path(__file__).resolve().parents[2] / "WEB-itinvent"))

from backend.appdb.inventory_store import AppInventoryStore  # noqa: E402

DB = os.environ.get("INV_BENCH_DB") or os.path.join(tempfile.gettempdir(), "inv_bench.db")
if os.path.exists(DB):
    os.remove(DB)
URL = f"sqlite:///{DB}"

N = int(os.environ.get("INV_BENCH_HOSTS") or "2000")
now = int(time.time())


def mac(i: int) -> str:
    return f"{i:012X}"


def mac_dashed(i: int) -> str:
    raw = mac(i)
    return "-".join(raw[j:j + 2] for j in range(0, 12, 2))


def host_payload(i: int) -> dict:
    bucket = i % 10
    if bucket < 5:
        last_seen = now - (i % 600)          # online (<=720 c)
    elif bucket < 7:
        last_seen = now - 1000 - (i % 2000)  # stale
    elif bucket < 9:
        last_seen = now - 7200 - i           # offline
    else:
        last_seen = None                     # unknown
    login = f"user{i % 300}"
    return {
        "mac_address": mac_dashed(i),
        "hostname": f"WS-{i:05d}",
        "user_login": login,
        "user_full_name": f"Сотрудник {i % 300}",
        "current_user": login,
        "ip_primary": f"10.0.{i % 250}.{i % 200 + 1}",
        "ip_list": [f"10.0.{i % 250}.{i % 200 + 1}"],
        "last_seen_at": last_seen,
        "report_type": "full_snapshot",
        "os_name": "Windows 11 Pro" if i % 3 else "Windows 10 Pro",
        "machine_guid": f"guid-{i}",
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
        "hardware": {"cpu": "Intel i7", "ram_gb": 16, "disks": [{"model": "ssd", "size_gb": 512}]},
        "monitors": [{"manufacturer": "Dell", "serial_number": f"MON{i}"}],
        "_padding": "x" * 400,
    }


store = AppInventoryStore(database_url=URL)

snapshot = {mac(i): host_payload(i) for i in range(N)}

changes = []
for i in range(500):
    changes.append(
        {
            "event_id": f"mac:{mac(i % N)}:{now - i * 1000}",
            "detected_at": now - i * 1000,
            "mac_address": mac(i % N),
            "hostname": f"WS-{i % N:05d}",
            "change_types": ["hardware"],
            "diff": {"cpu": {"before": "a", "after": "b"}},
            "before_signature": {},
            "after_signature": {},
            "report_type": "full_snapshot",
        }
    )
for i in range(100):
    changes.append(
        {
            "event_id": f"mac:{mac(i % N)}:old{i}",
            "detected_at": now - 100 * 86400 - i,
            "mac_address": mac(i % N),
            "hostname": "",
            "change_types": ["hardware"],
            "diff": {},
            "before_signature": {},
            "after_signature": {},
            "report_type": "full_snapshot",
        }
    )

store.replace_from_legacy(snapshot, changes)

branches = [f"Филиал {b}" for b in range(8)]
for i in range(N):
    if i % 5 == 4:  # 20% без контекста
        continue
    db = ["itinv", "msk", "spb"][i % 3]
    store.upsert_sql_context(
        mac_address=mac(i),
        hostname=f"WS-{i:05d}",
        db_id=db,
        context={
            "branch_name": branches[i % 8],
            "location_name": f"Кабинет {i % 50}",
            "employee_name": f"Сотрудник {i % 300}",
        },
    )


def bench(label, fn, repeat=3):
    best = None
    result = None
    for _ in range(repeat):
        t0 = time.perf_counter()
        result = fn()
        dt = (time.perf_counter() - t0) * 1000
        best = dt if best is None else min(best, dt)
    size = len(result) if hasattr(result, "__len__") else "-"
    print(f"{label:58s} {best:9.1f} ms   rows={size}")
    return result


print(f"=== SQLite micro-benchmark, hosts={N}, changes=600, contexts={N - N // 5} ===")
all_hosts = bench("list_hosts() — старый полный путь", lambda: store.list_hosts())

fields = {"identity", "user", "profiles", "outlook", "location", "database"}
k_host = bench(
    "search_host_keys('ws-00042', include_payload)",
    lambda: store.search_host_keys("ws-00042", fields, include_payload=True),
)
bench("list_hosts(host_keys=search hit)", lambda: store.list_hosts(host_keys=k_host))
k_user = bench(
    "search_host_keys('user123')",
    lambda: store.search_host_keys("user123", fields, include_payload=True),
)
k_ctx = bench(
    "list_host_keys_for_context(branch='филиал 3')",
    lambda: store.list_host_keys_for_context(["itinv"], branch_name="филиал 3"),
)
k_unassigned = bench(
    "list_unassigned_host_keys([itinv])",
    lambda: store.list_unassigned_host_keys(["itinv"]),
)
k_branch = k_ctx | k_unassigned
k_status = bench(
    "list_host_keys_by_status('online')",
    lambda: store.list_host_keys_by_status(
        "online", now_ts=now, online_max_age_seconds=720, stale_max_age_seconds=3600
    ),
)
k_changed = bench(
    "list_changed_host_keys(since=30d)",
    lambda: store.list_changed_host_keys(since_ts=now - 30 * 86400),
)
k_combo = k_user & k_branch & k_status
bench("list_hosts(host_keys=combo)", lambda: store.list_hosts(host_keys=k_combo))

bench("list_change_events() — все события", lambda: store.list_change_events())
bench(
    "list_change_events(since_ts=90d)",
    lambda: store.list_change_events(since_ts=now - 90 * 86400),
)
bench(
    "list_sql_contexts(500 hosts, db=itinv)",
    lambda: store.list_sql_contexts(hosts=all_hosts[:500], db_ids=["itinv"]),
)
print("=== done ===")
