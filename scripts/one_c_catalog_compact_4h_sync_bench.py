#!/usr/bin/env python3
"""Memory-safe 4h sync optimization bench for compact search (SAFE test DB only).

HARD RULES:
- Refuses hubit_chat / postgres / templates; SELECT current_database() first
- Never materializes full 718k catalogues in Python
- Seeds via executemany chunks (≤5k), commit + clear each chunk
- Rebuild uses chunked SQL INSERT…SELECT (see compact_rebuild)
- Default --rows 50000; 718k requires --force-scale + free RAM gate
- Aborts if process RSS exceeds --max-rss-mb (default 2500)
- Writes metrics incrementally to JSON
"""
from __future__ import annotations

import argparse
import gc
import json
import math
import os
import random
import re
import shutil
import sys
import time
from pathlib import Path
from urllib.parse import unquote, urlparse, urlunparse


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

HARD_REJECT = frozenset({"hubit_chat", "postgres", "template0", "template1"})
ALLOWED_RE = re.compile(
    r"^(hubit_chat_retention_test_.+|hubit_chat_1c_search_test_.+)$",
    re.IGNORECASE,
)
SOURCE = "bench_4h_sync"
CATALOG = "nomenclature"
MIN_FREE = 15 * 1024**3
METRICS_PATH = ROOT / "tmp" / "hub-architecture-remediation" / "compact_4h_sync_bench.json"
WARMUP_DEFAULT = 50_000
SCALE_DEFAULT = 718_000


def _normalize_url(raw: str) -> str:
    text = (raw or "").strip()
    for prefix in ("postgresql+psycopg://", "postgresql+psycopg2://"):
        if text.startswith(prefix):
            return "postgresql://" + text[len(prefix) :]
    return text


def _db_name(url: str) -> str:
    return unquote(urlparse(_normalize_url(url)).path or "").lstrip("/").split("/")[0]


def _with_db(url: str, database: str) -> str:
    return urlunparse(urlparse(_normalize_url(url))._replace(path="/" + database))


def _load_dotenv() -> dict[str, str]:
    path = ROOT / ".env"
    env: dict[str, str] = {}
    if not path.is_file():
        return env
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        text = line.strip()
        if not text or text.startswith("#") or "=" not in text:
            continue
        key, value = text.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        env[key.strip()] = value
    return env


def resolve_dsn(explicit: str | None) -> str:
    if explicit:
        return _normalize_url(explicit)
    for key in ("ONE_C_SEARCH_TEST_DATABASE_URL", "TEST_DATABASE_URL"):
        value = (os.getenv(key) or "").strip()
        if value:
            return _normalize_url(value)
    file_env = _load_dotenv()
    for key in ("ONE_C_SEARCH_TEST_DATABASE_URL", "TEST_DATABASE_URL"):
        value = (file_env.get(key) or "").strip()
        if value:
            return _normalize_url(value)
    chosen_path = ROOT / "tmp" / "one_c_search_benchmark" / "results" / "chosen_test_db.txt"
    chosen = chosen_path.read_text(encoding="utf-8").strip() if chosen_path.is_file() else ""
    if not chosen or not ALLOWED_RE.match(chosen):
        raise SystemExit("No allowed test DB configured")
    for key in ("APP_DATABASE_URL", "CHAT_DATABASE_URL"):
        value = (os.getenv(key) or file_env.get(key) or "").strip()
        if value:
            return _with_db(value, chosen)
    raise SystemExit("No APP/CHAT URL to rewrite against chosen_test_db")


def assert_safe(dsn: str) -> str:
    name = _db_name(dsn)
    if name.casefold() in HARD_REJECT or not ALLOWED_RE.match(name):
        raise SystemExit(f"REFUSED unsafe DSN db={name!r}")
    import psycopg

    with psycopg.connect(dsn, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT current_database()")
            current = cur.fetchone()[0]
    if str(current).casefold() in HARD_REJECT or not ALLOWED_RE.match(str(current)):
        raise SystemExit(f"REFUSED current_database()={current!r}")
    free = shutil.disk_usage("C:\\").free if os.name == "nt" else shutil.disk_usage("/").free
    if free < MIN_FREE:
        raise SystemExit(f"REFUSED free disk {free} < {MIN_FREE}")
    return str(current)


def process_rss_bytes() -> int:
    from backend.services.one_c_catalog_compact_rebuild import _process_rss_bytes

    return int(_process_rss_bytes())


def free_ram_bytes() -> int:
    if os.name == "nt":
        try:
            import ctypes

            class MEMORYSTATUSEX(ctypes.Structure):
                _fields_ = [
                    ("dwLength", ctypes.c_ulong),
                    ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", ctypes.c_ulonglong),
                    ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong),
                    ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong),
                    ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
                ]

            stat = MEMORYSTATUSEX()
            stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat)):
                return int(stat.ullAvailPhys)
        except Exception:
            pass
    return shutil.disk_usage("C:\\").free if os.name == "nt" else 0


def write_metrics(metrics: dict) -> None:
    METRICS_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = METRICS_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    tmp.replace(METRICS_PATH)


def relation_bytes(cur, patterns: list[str]) -> int:
    total = 0
    for pat in patterns:
        cur.execute(
            """
            SELECT COALESCE(SUM(pg_total_relation_size(c.oid)), 0)
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'app' AND c.relname LIKE %s
            """,
            (pat,),
        )
        total += int(cur.fetchone()[0] or 0)
    return total


def cleanup_bench_scope(cur) -> dict:
    """Delete only this harness scope (bench_4h_sync / legacy bench_d_lite leftovers optional)."""
    deleted = {}
    for table in (
        "one_c_catalog_search_token_stats",
        "one_c_catalog_search_documents",
        "one_c_catalog_search_index_state",
        "one_c_catalog_tokens",
        "one_c_catalog_entries",
        "one_c_catalog_snapshots",
    ):
        cur.execute(f"DELETE FROM app.{table} WHERE source_base = %s", (SOURCE,))
        deleted[table] = int(cur.rowcount or 0)
    # Also clear aborted d_lite leftovers if present (safe test DB only).
    for legacy in ("bench_d_lite", "bench_ver_rebuild"):
        for table in (
            "one_c_catalog_search_token_stats",
            "one_c_catalog_search_documents",
            "one_c_catalog_search_index_state",
            "one_c_catalog_tokens",
            "one_c_catalog_entries",
            "one_c_catalog_snapshots",
        ):
            cur.execute(f"DELETE FROM app.{table} WHERE source_base = %s", (legacy,))
            deleted[f"{legacy}:{table}"] = int(cur.rowcount or 0)
    return deleted


def ensure_0081(dsn: str) -> dict:
    import psycopg

    report: dict = {"applied": False, "already": False}
    with psycopg.connect(dsn, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT current_database()")
            assert ALLOWED_RE.match(cur.fetchone()[0])
            cur.execute(
                """
                SELECT 1 FROM information_schema.columns
                WHERE table_schema='app'
                  AND table_name='one_c_catalog_search_index_state'
                  AND column_name='active_index_version'
                """
            )
            if cur.fetchone():
                report["already"] = True
                return report
            for ddl in (
                "ALTER TABLE app.one_c_catalog_search_index_state "
                "ADD COLUMN IF NOT EXISTS active_index_version INTEGER NOT NULL DEFAULT 0",
                "ALTER TABLE app.one_c_catalog_search_index_state "
                "ADD COLUMN IF NOT EXISTS building_index_version INTEGER NOT NULL DEFAULT 0",
                "ALTER TABLE app.one_c_catalog_search_index_state "
                "ADD COLUMN IF NOT EXISTS previous_index_version INTEGER NOT NULL DEFAULT 0",
                "ALTER TABLE app.one_c_catalog_search_index_state "
                "ADD COLUMN IF NOT EXISTS source_fingerprint VARCHAR(64) NOT NULL DEFAULT ''",
                "ALTER TABLE app.one_c_catalog_search_index_state "
                "ADD COLUMN IF NOT EXISTS previous_cleanup_after TIMESTAMPTZ NULL",
                "ALTER TABLE app.one_c_catalog_search_documents "
                "ADD COLUMN IF NOT EXISTS index_version INTEGER NOT NULL DEFAULT 1",
                "ALTER TABLE app.one_c_catalog_search_token_stats "
                "ADD COLUMN IF NOT EXISTS index_version INTEGER NOT NULL DEFAULT 1",
            ):
                cur.execute(ddl)
            cur.execute(
                "ALTER TABLE app.one_c_catalog_search_documents "
                "DROP CONSTRAINT IF EXISTS uq_app_one_c_catalog_search_documents_ref"
            )
            cur.execute(
                "ALTER TABLE app.one_c_catalog_search_documents "
                "ADD CONSTRAINT uq_app_one_c_catalog_search_documents_ref "
                "UNIQUE (source_base, catalog_type, index_version, entry_ref)"
            )
            cur.execute(
                "ALTER TABLE app.one_c_catalog_search_token_stats "
                "DROP CONSTRAINT IF EXISTS uq_app_one_c_catalog_search_token_stats"
            )
            cur.execute(
                "ALTER TABLE app.one_c_catalog_search_token_stats "
                "ADD CONSTRAINT uq_app_one_c_catalog_search_token_stats "
                "UNIQUE (source_base, catalog_type, index_version, token)"
            )
            report["applied"] = True
    return report


def seed_zipf_chunked(cur, rows: int, batch: int, *, max_rss: int, metrics: dict) -> None:
    """Seed entries in small chunks; never hold the full catalogue in RAM."""
    cur.execute(
        """
        INSERT INTO app.one_c_catalog_snapshots (
            source_base, active_generation,
            nomenclature_count, warehouses_count,
            nomenclature_truncated, warehouses_truncated,
            nomenclature_fingerprint, warehouses_fingerprint,
            updated_at, last_attempt_at, last_error, created_at
        ) VALUES (%s, 1, %s, 0, false, false, 'bench', 'bench', NOW(), NOW(), '', NOW())
        ON CONFLICT (source_base) DO UPDATE SET
            active_generation=1,
            nomenclature_count=EXCLUDED.nomenclature_count,
            updated_at=NOW()
        """,
        (SOURCE, rows),
    )
    brands = ["ippon", "apc", "eaton", "cyberpower", "delta", "huawei"]
    peak = process_rss_bytes()
    for offset in range(0, rows, batch):
        n = min(batch, rows - offset)
        payload = []
        for i in range(n):
            brand = brands[min(int(abs(random.gauss(0, 1.4))), len(brands) - 1)]
            extra = "ippon" if (offset + i) % 7 == 0 else brand
            code = f"C{offset + i:06d}"
            name = (
                f"Synth {offset + i} Model M-{(offset + i) % 100} "
                f"{extra} Кабель-Ёлка {offset + i}"
            )
            payload.append(
                (
                    SOURCE,
                    1,
                    CATALOG,
                    f"b{offset + i:08d}",
                    code,
                    name,
                    code.lower(),
                    name.lower().replace("ё", "е"),
                )
            )
        cur.executemany(
            """
            INSERT INTO app.one_c_catalog_entries (
                source_base, generation, catalog_type, ref, code, name,
                code_normalized, name_normalized, created_at
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s, NOW())
            ON CONFLICT (source_base, generation, catalog_type, ref) DO NOTHING
            """,
            payload,
        )
        del payload
        # Caller commits per outer loop — here we rely on connection commit after call.
        rss = process_rss_bytes()
        peak = max(peak, rss)
        if max_rss and rss >= max_rss:
            raise SystemExit(f"ABORT seed RSS {rss} >= {max_rss} at offset={offset}")
        if offset and offset % (batch * 10) == 0:
            gc.collect()
            metrics["seed_progress"] = offset
            metrics["peak_rss_bytes"] = peak
            write_metrics(metrics)
            print(f"seed progress={offset}/{rows} rss_mb={rss/1e6:.1f}")
    metrics["peak_rss_bytes"] = peak


def mutate_pct_sql(cur, rows: int, pct: float) -> int:
    changed = max(1, int(rows * pct)) if pct > 0 else 0
    # Set-based update by ref prefix range — no Python row list of all refs.
    cur.execute(
        """
        UPDATE app.one_c_catalog_entries e
        SET name = e.name || ' x',
            name_normalized = e.name_normalized || ' x'
        FROM (
            SELECT ref FROM app.one_c_catalog_entries
            WHERE source_base = %s AND generation = 1 AND catalog_type = %s
            ORDER BY ref
            LIMIT %s
        ) s
        WHERE e.source_base = %s AND e.generation = 1 AND e.catalog_type = %s
          AND e.ref = s.ref
        """,
        (SOURCE, CATALOG, changed, SOURCE, CATALOG),
    )
    return changed


def percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    k = (len(ordered) - 1) * p
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return ordered[int(k)]
    return ordered[f] * (c - k) + ordered[c] * (k - f)


def measure_token_stats_variants_sql(cur, index_version: int) -> dict:
    """Count token_stats candidates by frequency threshold without Python lists."""
    out = {}
    for min_freq in (1, 2, 3):
        cur.execute(
            """
            SELECT COUNT(*) FROM (
                SELECT trim(both FROM u.token) AS token, COUNT(*)::int AS frequency
                FROM app.one_c_catalog_search_documents d
                CROSS JOIN LATERAL unnest(string_to_array(d.search_text, ' ')) AS u(token)
                WHERE d.source_base = %s
                  AND d.catalog_type = %s
                  AND d.index_version = %s
                  AND length(trim(both FROM u.token)) BETWEEN 2 AND 64
                GROUP BY 1
            ) a
            WHERE frequency >= %s
            """,
            (SOURCE, CATALOG, index_version, min_freq),
        )
        out[f"freq_ge_{min_freq}"] = {"rows": int(cur.fetchone()[0] or 0)}
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rows", type=int, default=WARMUP_DEFAULT)
    parser.add_argument("--dsn", default="")
    parser.add_argument("--batch", type=int, default=5_000)
    parser.add_argument("--keep", action="store_true")
    parser.add_argument("--cleanup-only", action="store_true")
    parser.add_argument("--force-scale", action="store_true",
                        help="Allow rows>=200000 (still RSS-gated)")
    parser.add_argument("--max-rss-mb", type=int, default=2500)
    parser.add_argument("--min-free-ram-mb", type=int, default=4096)
    args = parser.parse_args()

    max_rss = int(args.max_rss_mb) * 1024 * 1024
    os.environ["WAREHOUSE_1C_CATALOG_COMPACT_REBUILD_MAX_RSS_BYTES"] = str(max_rss)

    dsn = resolve_dsn(args.dsn or None)
    dbname = assert_safe(dsn)
    print(f"SAFE DB={dbname} rows={args.rows}")

    metrics: dict = {
        "database": dbname,
        "rows": args.rows,
        "source_base": SOURCE,
        "memory_safe": True,
        "max_rss_mb": args.max_rss_mb,
        "oom_root_cause_notes": [
            "Prior harness: string_agg(full code||name) for fingerprint → multi-GB PG/backend RAM",
            "Prior harness: Python build_search_document_fields for every row → huge batch lists",
            "Prior d_lite: long single txn + token_stats LATERAL over 718k without RSS gates",
        ],
        "prior_gaps": {
            "docs_build_s": 317.1,
            "token_stats_s": 453.7,
            "exact_p95_ms": 4.6,
            "prefix_p95_ms": 247,
            "dense_fts_p95_ms": 1484,
            "model_p95_ms": 286,
            "compact_gb": 1.78,
            "tokens_gb": 5.9,
        },
    }
    write_metrics(metrics)

    import psycopg

    if args.cleanup_only:
        with psycopg.connect(dsn, autocommit=False) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT current_database()")
                assert ALLOWED_RE.match(cur.fetchone()[0])
                metrics["cleanup"] = cleanup_bench_scope(cur)
                conn.commit()
        metrics["cleaned"] = True
        write_metrics(metrics)
        print(json.dumps(metrics, indent=2))
        return 0

    if args.rows >= 200_000 and not args.force_scale:
        raise SystemExit(
            f"REFUSED rows={args.rows}: use warmup ≤{WARMUP_DEFAULT} first, "
            f"or pass --force-scale only after memory-safe warmup succeeds"
        )
    if args.rows >= 200_000:
        avail = free_ram_bytes()
        need = int(args.min_free_ram_mb) * 1024 * 1024
        if avail and avail < need:
            raise SystemExit(
                f"REFUSED scale: free RAM {avail} < {need}. "
                f"HOLD_1C_PROD_SCALE_SIZE — do not OOM the server."
            )

    metrics["ddl_0081"] = ensure_0081(dsn)
    metrics["free_ram_before"] = free_ram_bytes()
    metrics["rss_before"] = process_rss_bytes()
    write_metrics(metrics)

    with psycopg.connect(dsn, autocommit=False) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT current_database()")
            assert ALLOWED_RE.match(cur.fetchone()[0])
            metrics["cleanup_pre"] = cleanup_bench_scope(cur)
            conn.commit()

            t0 = time.perf_counter()
            # Commit every batch inside seed loop via nested commits.
            for offset in range(0, args.rows, args.batch):
                # seed one chunk using a tiny helper range
                end = min(offset + args.batch, args.rows)
                n = end - offset
                if offset == 0:
                    cur.execute(
                        """
                        INSERT INTO app.one_c_catalog_snapshots (
                            source_base, active_generation,
                            nomenclature_count, warehouses_count,
                            nomenclature_truncated, warehouses_truncated,
                            nomenclature_fingerprint, warehouses_fingerprint,
                            updated_at, last_attempt_at, last_error, created_at
                        ) VALUES (%s, 1, %s, 0, false, false, 'bench', 'bench',
                                  NOW(), NOW(), '', NOW())
                        ON CONFLICT (source_base) DO UPDATE SET
                            active_generation=1,
                            nomenclature_count=EXCLUDED.nomenclature_count,
                            updated_at=NOW()
                        """,
                        (SOURCE, args.rows),
                    )
                brands = ["ippon", "apc", "eaton", "cyberpower", "delta", "huawei"]
                payload = []
                for i in range(n):
                    idx = offset + i
                    brand = brands[min(int(abs(random.gauss(0, 1.4))), len(brands) - 1)]
                    extra = "ippon" if idx % 7 == 0 else brand
                    code = f"C{idx:06d}"
                    name = f"Synth {idx} Model M-{idx % 100} {extra} Кабель-Ёлка {idx}"
                    payload.append(
                        (
                            SOURCE, 1, CATALOG, f"b{idx:08d}", code, name,
                            code.lower(), name.lower().replace("ё", "е"),
                        )
                    )
                cur.executemany(
                    """
                    INSERT INTO app.one_c_catalog_entries (
                        source_base, generation, catalog_type, ref, code, name,
                        code_normalized, name_normalized, created_at
                    ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s, NOW())
                    ON CONFLICT (source_base, generation, catalog_type, ref) DO NOTHING
                    """,
                    payload,
                )
                del payload
                conn.commit()
                rss = process_rss_bytes()
                metrics["peak_rss_bytes"] = max(int(metrics.get("peak_rss_bytes") or 0), rss)
                if rss >= max_rss:
                    cleanup_bench_scope(cur)
                    conn.commit()
                    raise SystemExit(f"ABORT seed RSS {rss} >= {max_rss}")
                if offset and offset % (args.batch * 20) == 0:
                    gc.collect()
                    write_metrics(metrics)
                    print(f"seed {offset}/{args.rows} rss_mb={rss/1e6:.1f}")
            metrics["seed_seconds"] = round(time.perf_counter() - t0, 3)
            write_metrics(metrics)

    sa_url = (
        "postgresql+psycopg://" + dsn[len("postgresql://") :]
        if dsn.startswith("postgresql://")
        else dsn
    )
    os.environ["APP_DATABASE_URL"] = sa_url
    os.environ["WAREHOUSE_1C_CATALOG_WRITE_COMPACT"] = "1"

    from backend.appdb.db import get_app_session_factory
    from backend.services.one_c_catalog_compact_flags import parse_compact_flags
    from backend.services.one_c_catalog_compact_rebuild import (
        OneCCatalogCompactVersionedRebuild,
    )
    from backend.services.one_c_catalog_compact_search import OneCCatalogCompactSearch

    factory = get_app_session_factory(sa_url)
    session = factory()
    orch = OneCCatalogCompactVersionedRebuild(
        enabled=True,
        cleanup_grace_seconds=0,
        doc_batch_size=min(args.batch, 10_000),
        max_rss_bytes=max_rss,
    )
    try:
        t_build = time.perf_counter()
        r0 = orch.rebuild_after_sync(
            session,
            source_base=SOURCE,
            generation=1,
            catalog_type=CATALOG,
            expected_count=args.rows,
        )
        if r0.outcome == "oom":
            session.rollback()
            metrics["initial_rebuild"] = {
                "outcome": "oom",
                "error": r0.error,
                "peak_rss_bytes": r0.peak_rss_bytes,
                "seconds": round(time.perf_counter() - t_build, 3),
            }
            metrics["verdict_hint"] = "HOLD_1C_PROD_SCALE_SIZE"
            write_metrics(metrics)
            with psycopg.connect(dsn, autocommit=False) as conn:
                with conn.cursor() as cur:
                    cleanup_bench_scope(cur)
                    conn.commit()
            print(json.dumps(metrics, indent=2))
            return 2
        session.commit()
        metrics["initial_rebuild"] = {
            "outcome": r0.outcome,
            "duration_ms": round(r0.duration_ms, 1),
            "fingerprint_ms": round(r0.fingerprint_ms, 1),
            "build_ms": round(r0.build_ms, 1),
            "token_stats_ms": round(r0.token_stats_ms, 1),
            "validate_ms": round(r0.validate_ms, 1),
            "switch_ms": round(r0.switch_ms, 1),
            "docs": r0.documents_built,
            "stats_rows": r0.token_stats_rows,
            "version": r0.active_index_version,
            "peak_rss_bytes": r0.peak_rss_bytes,
            "seconds": round(time.perf_counter() - t_build, 3),
        }
        metrics["peak_rss_bytes"] = max(
            int(metrics.get("peak_rss_bytes") or 0), int(r0.peak_rss_bytes or 0)
        )
        write_metrics(metrics)
        if r0.outcome != "built":
            raise SystemExit(f"initial rebuild failed: {r0.outcome} {r0.error}")

        with psycopg.connect(dsn, autocommit=True) as conn:
            with conn.cursor() as cur:
                metrics["token_stats_variants"] = measure_token_stats_variants_sql(
                    cur, r0.active_index_version
                )
        write_metrics(metrics)

        r_noop = orch.rebuild_after_sync(
            session,
            source_base=SOURCE,
            generation=1,
            catalog_type=CATALOG,
            expected_count=args.rows,
        )
        session.commit()
        metrics["sync_noop"] = {
            "outcome": r_noop.outcome,
            "duration_ms": round(r_noop.duration_ms, 1),
            "peak_rss_bytes": r_noop.peak_rss_bytes,
        }
        write_metrics(metrics)

        with psycopg.connect(dsn, autocommit=False) as conn:
            with conn.cursor() as cur:
                changed = mutate_pct_sql(cur, args.rows, 0.01)
                conn.commit()
        t1 = time.perf_counter()
        r1 = orch.rebuild_after_sync(
            session,
            source_base=SOURCE,
            generation=1,
            catalog_type=CATALOG,
            expected_count=args.rows,
        )
        session.commit()
        metrics["sync_1pct"] = {
            "changed_rows": changed,
            "outcome": r1.outcome,
            "duration_ms": round(r1.duration_ms, 1),
            "seconds": round(time.perf_counter() - t1, 3),
            "active_version": r1.active_index_version,
            "previous_version": r1.previous_index_version,
            "peak_rss_bytes": r1.peak_rss_bytes,
        }
        metrics["peak_rss_bytes"] = max(
            int(metrics.get("peak_rss_bytes") or 0), int(r1.peak_rss_bytes or 0)
        )
        write_metrics(metrics)

        with psycopg.connect(dsn, autocommit=False) as conn:
            with conn.cursor() as cur:
                changed10 = mutate_pct_sql(cur, args.rows, 0.10)
                conn.commit()
        t10 = time.perf_counter()
        r10 = orch.rebuild_after_sync(
            session,
            source_base=SOURCE,
            generation=1,
            catalog_type=CATALOG,
            expected_count=args.rows,
        )
        session.commit()
        metrics["sync_10pct"] = {
            "changed_rows": changed10,
            "outcome": r10.outcome,
            "duration_ms": round(r10.duration_ms, 1),
            "seconds": round(time.perf_counter() - t10, 3),
            "active_version": r10.active_index_version,
            "previous_version": r10.previous_index_version,
            "peak_rss_bytes": r10.peak_rss_bytes,
        }
        metrics["peak_rss_bytes"] = max(
            int(metrics.get("peak_rss_bytes") or 0), int(r10.peak_rss_bytes or 0)
        )
        write_metrics(metrics)

        flags = parse_compact_flags({"WAREHOUSE_1C_CATALOG_SEARCH_ENGINE": "compact"})
        searcher = OneCCatalogCompactSearch(sa_url, flags=flags)
        queries = {
            "exact_code": "C000001",
            "code_prefix": "C00010",
            "model": "m70",
            "multiword": "кабель ippon",
            "cyr_yo": "елка",
            "dense_common": "ippon",
            "rare": f"C{max(args.rows - 3, 0):06d}",
            "hyphen_model": "m-70",
        }
        search_ms: dict = {}
        for label, q in queries.items():
            times: list[float] = []
            for _ in range(6):
                st = time.perf_counter()
                searcher.search_entries(
                    catalog_type=CATALOG,
                    text_query=q,
                    limit=20,
                    source_base=SOURCE,
                    generation=1,
                )
                times.append((time.perf_counter() - st) * 1000)
            search_ms[label] = {
                "cold_ms": round(times[0], 2),
                "p50": round(percentile(times, 0.50), 2),
                "p95": round(percentile(times, 0.95), 2),
                "p99": round(percentile(times, 0.99), 2),
            }
            write_metrics({**metrics, "search_ms": search_ms})
        metrics["search_ms"] = search_ms

        with psycopg.connect(dsn, autocommit=True) as conn:
            with conn.cursor() as cur:
                metrics["compact_heap_index_bytes"] = relation_bytes(
                    cur,
                    [
                        "one_c_catalog_search_documents",
                        "one_c_catalog_search_token_stats",
                        "one_c_catalog_search_index_state",
                    ],
                )

        targets = {
            "exact_p95_le_20": search_ms["exact_code"]["p95"] <= 20,
            "prefix_p95_le_100": search_ms["code_prefix"]["p95"] <= 100,
            "model_p95_le_100": search_ms["model"]["p95"] <= 100,
            "dense_p95_le_250": search_ms["dense_common"]["p95"] <= 250,
            "multiword_p95_le_100": search_ms["multiword"]["p95"] <= 100,
            "noop_no_rebuild": metrics["sync_noop"]["outcome"] == "no_op",
            "changed_rebuild_le_15min": metrics["sync_10pct"]["seconds"] <= 900,
            "rss_under_cap": int(metrics.get("peak_rss_bytes") or 0) < max_rss,
        }
        metrics["targets"] = targets
        metrics["all_targets_met"] = all(targets.values())
        metrics["rss_after"] = process_rss_bytes()
        metrics["free_ram_after"] = free_ram_bytes()

        if not args.keep:
            with psycopg.connect(dsn, autocommit=False) as conn:
                with conn.cursor() as cur:
                    cleanup_bench_scope(cur)
                    conn.commit()
            metrics["cleaned"] = True
        else:
            metrics["cleaned"] = False
        write_metrics(metrics)
    finally:
        session.close()
        gc.collect()

    print(json.dumps(metrics, indent=2))
    print(f"Wrote {METRICS_PATH}")
    return 0 if metrics.get("all_targets_met") else 1


if __name__ == "__main__":
    raise SystemExit(main())
