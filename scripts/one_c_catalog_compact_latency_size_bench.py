#!/usr/bin/env python3
"""Latency + size remediation bench for 1C compact search (SAFE test DB only).

Scope: source_base = bench_compact_search_remediation
Hard rules: refuse hubit_chat/postgres/templates; SELECT current_database() first;
no 718k without explicit refuse; RSS/free-RAM gates; chunked seed; no VACUUM FULL.
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
TARGET_DB = "hubit_chat_retention_test_20260804154706"
SOURCE = "bench_compact_search_remediation"
CATALOG = "nomenclature"
MIN_FREE_DISK = 15 * 1024**3
MIN_FREE_RAM = 8 * 1024**3
METRICS_PATH = (
    ROOT / "tmp" / "hub-architecture-remediation" / "compact_latency_size_bench.json"
)
SEED = 42


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
        dsn = _normalize_url(explicit)
    else:
        file_env = _load_dotenv()
        dsn = ""
        for key in ("ONE_C_SEARCH_TEST_DATABASE_URL", "TEST_DATABASE_URL"):
            value = (os.getenv(key) or file_env.get(key) or "").strip()
            if value:
                dsn = _normalize_url(value)
                break
        if not dsn:
            for key in ("APP_DATABASE_URL", "CHAT_DATABASE_URL"):
                value = (os.getenv(key) or file_env.get(key) or "").strip()
                if value:
                    dsn = _with_db(value, TARGET_DB)
                    break
        if not dsn:
            raise SystemExit("No allowed test DB configured")
    # Always pin to mandated test DB for this stage.
    if _db_name(dsn) != TARGET_DB:
        dsn = _with_db(dsn, TARGET_DB)
    return dsn


def assert_safe(dsn: str) -> str:
    name = _db_name(dsn)
    if name.casefold() in HARD_REJECT or not ALLOWED_RE.match(name):
        raise SystemExit(f"REFUSED unsafe DSN db={name!r}")
    if name != TARGET_DB:
        raise SystemExit(f"REFUSED db={name!r} != {TARGET_DB}")
    import psycopg

    with psycopg.connect(dsn, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT current_database()")
            current = cur.fetchone()[0]
    if str(current) != TARGET_DB:
        raise SystemExit(f"REFUSED current_database()={current!r}")
    free = shutil.disk_usage("C:\\").free if os.name == "nt" else shutil.disk_usage("/").free
    if free < MIN_FREE_DISK:
        raise SystemExit(f"REFUSED free disk {free} < {MIN_FREE_DISK}")
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
    return 0


def write_metrics(metrics: dict) -> None:
    METRICS_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = METRICS_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(metrics, indent=2, default=str), encoding="utf-8")
    tmp.replace(METRICS_PATH)


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


def cleanup_scope(cur, source: str = SOURCE) -> dict:
    deleted = {}
    for table in (
        "one_c_catalog_search_token_stats",
        "one_c_catalog_search_documents",
        "one_c_catalog_search_index_state",
        "one_c_catalog_tokens",
        "one_c_catalog_entries",
        "one_c_catalog_snapshots",
    ):
        cur.execute(f"DELETE FROM app.{table} WHERE source_base = %s", (source,))
        deleted[table] = int(cur.rowcount or 0)
    return deleted


def ensure_indexes(cur) -> dict:
    """Ensure 0081-shaped pattern_ops indexes exist on TEST DB only."""
    cur.execute("SELECT current_database()")
    assert cur.fetchone()[0] == TARGET_DB
    report: dict = {"created": [], "existed": [], "dropped": []}

    def _indexdef(name: str) -> str | None:
        cur.execute(
            """
            SELECT pg_get_indexdef(c.oid)
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname='app' AND c.relname=%s AND c.relkind='i'
            """,
            (name,),
        )
        row = cur.fetchone()
        return str(row[0]) if row else None

    # Drop legacy 0080-shaped indexes keyed on generation (search uses index_version).
    for name in (
        "ix_app_one_c_catalog_search_documents_code",
        "ix_app_one_c_catalog_search_token_stats_prefix",
    ):
        defn = _indexdef(name)
        if defn and "index_version" not in defn:
            cur.execute(f"DROP INDEX CONCURRENTLY IF EXISTS app.{name}")
            report["dropped"].append(name)

    specs = [
        (
            "ix_app_one_c_catalog_search_documents_code",
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
            ix_app_one_c_catalog_search_documents_code
            ON app.one_c_catalog_search_documents
            (source_base, catalog_type, index_version,
             code_normalized varchar_pattern_ops)
            """,
        ),
        (
            "ix_app_one_c_catalog_search_documents_name_prefix",
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
            ix_app_one_c_catalog_search_documents_name_prefix
            ON app.one_c_catalog_search_documents
            (source_base, catalog_type, index_version,
             (left(name_normalized, 200)) varchar_pattern_ops)
            """,
        ),
        (
            "ix_app_one_c_catalog_search_token_stats_prefix",
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
            ix_app_one_c_catalog_search_token_stats_prefix
            ON app.one_c_catalog_search_token_stats
            (source_base, catalog_type, index_version,
             token varchar_pattern_ops)
            """,
        ),
    ]
    for name, ddl in specs:
        if _indexdef(name):
            report["existed"].append(name)
        else:
            cur.execute(ddl)
            report["created"].append(name)
    # Drop duplicate pattern twin if primary code index already covers it.
    if _indexdef("ix_app_one_c_catalog_search_documents_code") and _indexdef(
        "ix_app_one_c_catalog_search_documents_code_pattern"
    ):
        cur.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "app.ix_app_one_c_catalog_search_documents_code_pattern"
        )
        report["dropped"].append("ix_app_one_c_catalog_search_documents_code_pattern")
    return report


def analyze_tables(cur) -> None:
    cur.execute("ANALYZE app.one_c_catalog_search_documents")
    cur.execute("ANALYZE app.one_c_catalog_search_token_stats")
    cur.execute("ANALYZE app.one_c_catalog_entries")


def size_breakdown(cur, source: str, index_version: int | None = None) -> dict:
    out: dict = {}
    cur.execute(
        """
        SELECT c.relname,
               pg_relation_size(c.oid) AS heap_bytes,
               pg_table_size(c.oid) - pg_relation_size(c.oid) AS toast_bytes,
               pg_indexes_size(c.oid) AS indexes_bytes,
               pg_total_relation_size(c.oid) AS total_bytes,
               c.reltuples::bigint AS est_rows
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname='app'
          AND c.relname IN (
            'one_c_catalog_search_documents',
            'one_c_catalog_search_token_stats',
            'one_c_catalog_search_index_state',
            'one_c_catalog_entries'
          )
        ORDER BY 1
        """
    )
    out["relations"] = [
        {
            "relname": r[0],
            "heap_bytes": int(r[1]),
            "toast_bytes": int(r[2]),
            "indexes_bytes": int(r[3]),
            "total_bytes": int(r[4]),
            "est_rows": int(r[5] or 0),
        }
        for r in cur.fetchall()
    ]
    cur.execute(
        """
        SELECT c.relname AS index_name,
               pg_relation_size(c.oid) AS bytes,
               i.indisvalid
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_index i ON i.indexrelid = c.oid
        JOIN pg_class t ON t.oid = i.indrelid
        WHERE n.nspname='app'
          AND t.relname IN (
            'one_c_catalog_search_documents',
            'one_c_catalog_search_token_stats'
          )
        ORDER BY 2 DESC
        """
    )
    out["indexes"] = [
        {"index": r[0], "bytes": int(r[1]), "valid": bool(r[2])} for r in cur.fetchall()
    ]
    cur.execute(
        """
        SELECT index_version, COUNT(*)::bigint
        FROM app.one_c_catalog_search_documents
        WHERE source_base = %s AND catalog_type = %s
        GROUP BY 1 ORDER BY 1
        """,
        (source, CATALOG),
    )
    out["docs_by_version"] = {int(r[0]): int(r[1]) for r in cur.fetchall()}
    cur.execute(
        """
        SELECT
          COALESCE(SUM(pg_column_size(search_text)),0),
          COALESCE(SUM(pg_column_size(search_tsv)),0),
          COALESCE(SUM(pg_column_size(name_normalized)),0),
          COALESCE(SUM(pg_column_size(code_normalized)),0),
          COUNT(*)::bigint
        FROM app.one_c_catalog_search_documents
        WHERE source_base = %s AND catalog_type = %s
          AND (%s::int IS NULL OR index_version = %s)
        """,
        (source, CATALOG, index_version, index_version),
    )
    row = cur.fetchone()
    out["column_bytes"] = {
        "search_text": int(row[0]),
        "search_tsv": int(row[1]),
        "name_normalized": int(row[2]),
        "code_normalized": int(row[3]),
        "rows": int(row[4]),
    }
    cur.execute(
        """
        SELECT
          n_live_tup, n_dead_tup
        FROM pg_stat_user_tables
        WHERE schemaname='app' AND relname='one_c_catalog_search_documents'
        """
    )
    st = cur.fetchone()
    out["docs_stat"] = {
        "n_live_tup": int(st[0] or 0) if st else 0,
        "n_dead_tup": int(st[1] or 0) if st else 0,
    }
    compact_total = sum(
        r["total_bytes"]
        for r in out["relations"]
        if r["relname"].startswith("one_c_catalog_search_")
    )
    out["compact_total_bytes"] = compact_total
    out["compact_total_mb"] = round(compact_total / (1024 * 1024), 2)
    return out


def seed_entries(conn, rows: int, batch: int, *, max_rss: int, metrics: dict) -> None:
    random.seed(SEED)
    brands = ["ippon", "apc", "eaton", "cyberpower", "delta", "huawei"]
    with conn.cursor() as cur:
        cur.execute("SELECT current_database()")
        assert cur.fetchone()[0] == TARGET_DB
        for offset in range(0, rows, batch):
            n = min(batch, rows - offset)
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
                    (SOURCE, rows),
                )
            payload = []
            for i in range(n):
                idx = offset + i
                brand = brands[min(int(abs(random.gauss(0, 1.4))), len(brands) - 1)]
                extra = "ippon" if idx % 7 == 0 else brand
                code = f"C{idx:06d}"
                name = f"Synth {idx} Model M-{idx % 100} {extra} Кабель-Ёлка {idx}"
                payload.append(
                    (
                        SOURCE,
                        1,
                        CATALOG,
                        f"b{idx:08d}",
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
            conn.commit()
            rss = process_rss_bytes()
            metrics["peak_rss_bytes"] = max(int(metrics.get("peak_rss_bytes") or 0), rss)
            if rss >= max_rss:
                cleanup_scope(cur)
                conn.commit()
                raise SystemExit(f"ABORT seed RSS {rss} >= {max_rss}")
            if offset and offset % (batch * 10) == 0:
                gc.collect()
                write_metrics(metrics)
                print(f"seed {offset}/{rows} rss_mb={rss/1e6:.1f}")


def explain_stage(cur, sql: str, params: dict, label: str) -> dict:
    cur.execute("SELECT current_database()")
    assert cur.fetchone()[0] == TARGET_DB
    # Build literal-safe EXPLAIN via PREPARE-like substitution with psycopg
    cur.execute("EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON) " + sql, params)
    plan = cur.fetchone()[0]
    root = plan[0]["Plan"] if isinstance(plan, list) else plan
    return {
        "label": label,
        "planning_ms": plan[0].get("Planning Time") if isinstance(plan, list) else None,
        "execution_ms": plan[0].get("Execution Time") if isinstance(plan, list) else None,
        "node_type": root.get("Node Type"),
        "index_name": root.get("Index Name"),
        "actual_rows": root.get("Actual Rows"),
        "shared_hit": root.get("Shared Hit Blocks"),
        "shared_read": root.get("Shared Read Blocks"),
        "plan_summary": _summarize_plan(root),
    }


def _summarize_plan(node: dict, depth: int = 0) -> list[dict]:
    items = [
        {
            "depth": depth,
            "node": node.get("Node Type"),
            "index": node.get("Index Name"),
            "relation": node.get("Relation Name"),
            "rows": node.get("Actual Rows"),
            "time_ms": node.get("Actual Total Time"),
        }
    ]
    for child in node.get("Plans") or []:
        items.extend(_summarize_plan(child, depth + 1))
    return items


def measure_search(searcher, queries: dict[str, str], *, rounds: int = 8) -> dict:
    out = {}
    for label, q in queries.items():
        times: list[float] = []
        stages: list[str] = []
        last_metrics: list = []
        for i in range(rounds):
            # Drop SQL caches between cold and warm: first is cold-ish for process
            st = time.perf_counter()
            result = searcher.search_entries(
                catalog_type=CATALOG,
                text_query=q,
                limit=20,
                source_base=SOURCE,
                generation=1,
            )
            elapsed = (time.perf_counter() - st) * 1000
            times.append(elapsed)
            stages.append(result.stage)
            last_metrics = result.stage_metrics
        out[label] = {
            "cold_ms": round(times[0], 2),
            "warm_p50": round(percentile(times[1:], 0.50), 2) if len(times) > 1 else round(times[0], 2),
            "p50": round(percentile(times, 0.50), 2),
            "p95": round(percentile(times, 0.95), 2),
            "p99": round(percentile(times, 0.99), 2),
            "stages": stages,
            "last_stage_metrics": last_metrics,
            "query_shape": hash_shape(q),
        }
    return out


def hash_shape(q: str) -> str:
    from backend.services.one_c_catalog_compact_docs import hash_query_shape
    from backend.services.one_c_catalog_search import catalog_query_tokens

    tokens = catalog_query_tokens(q)
    return hash_query_shape(q, catalog_type=CATALOG, tokens=tokens)


def correctness_matrix(searcher, rows: int) -> dict:
    """Critical FN=0 checks on synthetic Zipf corpus."""
    cases = [
        ("exact_code", f"C{min(1, rows-1):06d}", True),
        ("code_prefix", "C00010", True),
        ("model_m70", "m70", True),
        ("model_hyphen", "m-70", True),
        ("yo", "елка", True),
        ("dense", "ippon", True),
        ("multi", "кабель ippon", True),
        ("rare", f"C{max(rows - 3, 0):06d}", True),
        ("missing", "zzznomatch999", False),
    ]
    results = []
    fn = 0
    for name, q, expect_hit in cases:
        res = searcher.search_entries(
            catalog_type=CATALOG,
            text_query=q,
            limit=20,
            source_base=SOURCE,
            generation=1,
        )
        hit = bool(res.rows)
        ok = hit == expect_hit
        if expect_hit and not hit:
            fn += 1
        results.append(
            {
                "case": name,
                "shape": hash_shape(q),
                "expect_hit": expect_hit,
                "hit": hit,
                "stage": res.stage,
                "ok": ok,
            }
        )
    return {"cases": results, "critical_fn": fn, "fn_zero": fn == 0}


def run_phase(
    *,
    dsn: str,
    sa_url: str,
    rows: int,
    batch: int,
    max_rss: int,
    metrics: dict,
    phase_name: str,
) -> dict:
    import psycopg

    phase: dict = {"phase": phase_name, "rows": rows}
    avail = free_ram_bytes()
    phase["free_ram_before"] = avail
    if avail and avail < MIN_FREE_RAM:
        phase["aborted"] = "free_ram_lt_8gb"
        return phase

    with psycopg.connect(dsn, autocommit=False) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT current_database()")
            assert cur.fetchone()[0] == TARGET_DB
            phase["cleanup_pre"] = cleanup_scope(cur)
            conn.commit()

    t_seed = time.perf_counter()
    with psycopg.connect(dsn, autocommit=False) as conn:
        seed_entries(conn, rows, batch, max_rss=max_rss, metrics=metrics)
    phase["seed_seconds"] = round(time.perf_counter() - t_seed, 3)

    # Indexes need autocommit (CONCURRENTLY)
    with psycopg.connect(dsn, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT current_database()")
            assert cur.fetchone()[0] == TARGET_DB
            phase["indexes"] = ensure_indexes(cur)

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
        doc_batch_size=min(batch, 10_000),
        max_rss_bytes=max_rss,
    )
    try:
        t_build = time.perf_counter()
        r0 = orch.rebuild_after_sync(
            session,
            source_base=SOURCE,
            generation=1,
            catalog_type=CATALOG,
            expected_count=rows,
        )
        if r0.outcome == "oom":
            session.rollback()
            phase["rebuild"] = {"outcome": "oom", "error": r0.error}
            with psycopg.connect(dsn, autocommit=False) as conn:
                with conn.cursor() as cur:
                    cleanup_scope(cur)
                    conn.commit()
            return phase
        session.commit()
        # Immediate cleanup of any previous so baseline = active only
        cleaned = orch.cleanup_previous_versions(
            session, source_base=SOURCE, catalog_type=CATALOG, force=True
        )
        session.commit()
        phase["rebuild"] = {
            "outcome": r0.outcome,
            "seconds": round(time.perf_counter() - t_build, 3),
            "docs": r0.documents_built,
            "stats_rows": r0.token_stats_rows,
            "version": r0.active_index_version,
            "build_ms": round(r0.build_ms, 1),
            "token_stats_ms": round(r0.token_stats_ms, 1),
            "peak_rss_bytes": r0.peak_rss_bytes,
            "cleanup_force": cleaned,
        }
        metrics["peak_rss_bytes"] = max(
            int(metrics.get("peak_rss_bytes") or 0), int(r0.peak_rss_bytes or 0)
        )
        if r0.outcome != "built":
            phase["aborted"] = f"rebuild_{r0.outcome}"
            return phase

        with psycopg.connect(dsn, autocommit=True) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT current_database()")
                assert cur.fetchone()[0] == TARGET_DB
                # Test-only: token_stats GIN/btree bloat from prior benches distorts size.
                # Never VACUUM FULL; REINDEX CONCURRENTLY on TEST only for honest steady-state.
                reindexed = []
                for idx in (
                    "ix_app_one_c_catalog_search_token_stats_trgm",
                    "one_c_catalog_search_token_stats_pkey",
                    "uq_app_one_c_catalog_search_token_stats",
                    "ix_app_one_c_catalog_search_token_stats_prefix",
                ):
                    try:
                        cur.execute(f"REINDEX INDEX CONCURRENTLY app.{idx}")
                        reindexed.append(idx)
                    except Exception as exc:
                        reindexed.append(f"{idx}:err:{type(exc).__name__}")
                phase["test_reindex_token_stats"] = reindexed
                analyze_tables(cur)
                phase["size_active_only"] = size_breakdown(
                    cur, SOURCE, r0.active_index_version
                )

        flags = parse_compact_flags({"WAREHOUSE_1C_CATALOG_SEARCH_ENGINE": "compact"})
        searcher = OneCCatalogCompactSearch(sa_url, flags=flags)
        queries = {
            "exact_code": "C000001",
            "code_prefix": "C00010",
            "name_prefix": "synth 1",
            "model": "m70",
            "multiword": "кабель ippon",
            "dense_common": "ippon",
            "rare_fts": "cyberpower",
            "mid": "ппо",  # midtoken in ippon via ё path may differ — use latin
            "typo": "iponn",
            "suggest_prefix": "ipp",
            "hyphen_model": "m-70",
            "cyr_yo": "елка",
            "rare_exact": f"C{max(rows - 3, 0):06d}",
        }
        # midtoken: use substring of brand present in search_text
        queries["mid"] = "ppo"

        phase["search_ms"] = measure_search(searcher, queries, rounds=8)
        phase["correctness"] = correctness_matrix(searcher, rows)

        # EXPLAIN package (SQL stage only)
        ver = int(r0.active_index_version)
        explains = {}
        with psycopg.connect(dsn, autocommit=True) as conn:
            with conn.cursor() as cur:
                samples = {
                    "exact": (
                        """
                        SELECT d.entry_ref FROM app.one_c_catalog_search_documents d
                        WHERE d.source_base=%s AND d.catalog_type=%s
                          AND d.index_version=%s AND d.code_normalized=%s
                        ORDER BY d.name_normalized COLLATE "C" LIMIT 20
                        """,
                        (SOURCE, CATALOG, ver, "c000001"),
                    ),
                    "code_prefix": (
                        """
                        SELECT d.entry_ref FROM app.one_c_catalog_search_documents d
                        WHERE d.source_base=%s AND d.catalog_type=%s
                          AND d.index_version=%s
                          AND d.code_normalized LIKE %s ESCAPE '\\'
                        ORDER BY d.name_normalized COLLATE "C" LIMIT 20
                        """,
                        (SOURCE, CATALOG, ver, "c00010%"),
                    ),
                    "name_prefix_expr": (
                        """
                        SELECT d.entry_ref FROM app.one_c_catalog_search_documents d
                        WHERE d.source_base=%s AND d.catalog_type=%s
                          AND d.index_version=%s
                          AND left(d.name_normalized, 200) LIKE %s ESCAPE '\\'
                        ORDER BY d.name_normalized COLLATE "C" LIMIT 20
                        """,
                        (SOURCE, CATALOG, ver, "synth%"),
                    ),
                    "fts_exact_dense": (
                        """
                        SELECT d.entry_ref FROM app.one_c_catalog_search_documents d
                        WHERE d.source_base=%s AND d.catalog_type=%s
                          AND d.index_version=%s
                          AND d.search_tsv @@ to_tsquery('simple', %s)
                        ORDER BY d.name_normalized COLLATE "C" LIMIT 20
                        """,
                        (SOURCE, CATALOG, ver, "ippon"),
                    ),
                    "fts_multi": (
                        """
                        SELECT d.entry_ref FROM app.one_c_catalog_search_documents d
                        WHERE d.source_base=%s AND d.catalog_type=%s
                          AND d.index_version=%s
                          AND d.search_tsv @@ to_tsquery('simple', %s)
                        ORDER BY d.name_normalized COLLATE "C" LIMIT 20
                        """,
                        (SOURCE, CATALOG, ver, "кабель:* & ippon:*"),
                    ),
                }
                for label, (sql, params) in samples.items():
                    try:
                        cur.execute(
                            "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + sql, params
                        )
                        plan = cur.fetchone()[0]
                        root = plan[0]["Plan"]
                        explains[label] = {
                            "execution_ms": plan[0].get("Execution Time"),
                            "planning_ms": plan[0].get("Planning Time"),
                            "summary": _summarize_plan(root)[:12],
                        }
                    except Exception as exc:
                        explains[label] = {"error": type(exc).__name__}
        phase["explain"] = explains

        # Size states: active+building (simulate), active+previous, after cleanup
        with psycopg.connect(dsn, autocommit=False) as conn:
            with conn.cursor() as cur:
                # mutate 1% to force rebuild → active+previous briefly
                cur.execute(
                    """
                    UPDATE app.one_c_catalog_entries e
                    SET name = e.name || ' x',
                        name_normalized = e.name_normalized || ' x'
                    FROM (
                        SELECT ref FROM app.one_c_catalog_entries
                        WHERE source_base=%s AND generation=1 AND catalog_type=%s
                        ORDER BY ref LIMIT %s
                    ) s
                    WHERE e.source_base=%s AND e.generation=1 AND e.catalog_type=%s
                      AND e.ref=s.ref
                    """,
                    (SOURCE, CATALOG, max(1, rows // 100), SOURCE, CATALOG),
                )
                conn.commit()

        # Capture size during build by not cleaning previous
        orch2 = OneCCatalogCompactVersionedRebuild(
            enabled=True,
            cleanup_grace_seconds=3600,
            doc_batch_size=min(batch, 10_000),
            max_rss_bytes=max_rss,
        )
        r1 = orch2.rebuild_after_sync(
            session,
            source_base=SOURCE,
            generation=1,
            catalog_type=CATALOG,
            expected_count=rows,
        )
        session.commit()
        phase["rebuild_1pct"] = {
            "outcome": r1.outcome,
            "active": r1.active_index_version,
            "previous": r1.previous_index_version,
            "seconds": round(r1.duration_ms / 1000.0, 3),
            "peak_rss_bytes": r1.peak_rss_bytes,
        }
        with psycopg.connect(dsn, autocommit=True) as conn:
            with conn.cursor() as cur:
                phase["size_active_plus_previous"] = size_breakdown(cur, SOURCE)

        # Force cleanup → new active only
        orch2.cleanup_previous_versions(
            session, source_base=SOURCE, catalog_type=CATALOG, force=True
        )
        session.commit()
        with psycopg.connect(dsn, autocommit=True) as conn:
            with conn.cursor() as cur:
                phase["size_after_cleanup"] = size_breakdown(
                    cur, SOURCE, r1.active_index_version
                )

        # Targets
        sm = phase["search_ms"]
        targets = {
            "exact_p95_le_20": sm["exact_code"]["p95"] <= 20,
            "prefix_p95_le_100": sm["code_prefix"]["p95"] <= 100,
            "model_p95_le_100": sm["model"]["p95"] <= 100,
            "dense_p95_le_250": sm["dense_common"]["p95"] <= 250,
            "multiword_p95_le_100": sm["multiword"]["p95"] <= 100,
            "fn_zero": phase["correctness"]["fn_zero"],
            "rss_under_cap": int(metrics.get("peak_rss_bytes") or 0) < max_rss,
        }
        phase["targets"] = targets
        phase["all_targets_met"] = all(targets.values())
        phase["peak_rss_bytes"] = metrics.get("peak_rss_bytes")
        phase["free_ram_after"] = free_ram_bytes()
    finally:
        session.close()
        gc.collect()
    return phase


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rows", type=int, default=50_000)
    parser.add_argument("--dsn", default="")
    parser.add_argument("--batch", type=int, default=5_000)
    parser.add_argument("--keep", action="store_true")
    parser.add_argument("--cleanup-only", action="store_true")
    parser.add_argument("--skip-100k", action="store_true")
    parser.add_argument("--max-rss-mb", type=int, default=2500)
    args = parser.parse_args()

    max_rss = int(args.max_rss_mb) * 1024 * 1024
    os.environ["WAREHOUSE_1C_CATALOG_COMPACT_REBUILD_MAX_RSS_BYTES"] = str(max_rss)

    dsn = resolve_dsn(args.dsn or None)
    dbname = assert_safe(dsn)
    print(f"SAFE DB={dbname} source={SOURCE}")

    metrics: dict = {
        "database": dbname,
        "source_base": SOURCE,
        "seed": SEED,
        "memory_safe": True,
        "max_rss_mb": args.max_rss_mb,
        "prior_50k": {
            "exact_p95": 26.7,
            "code_prefix_p95": 363,
            "model_p95": 332,
            "dense_p95": 582,
            "multiword_p95": 448,
            "compact_mb": 647,
        },
    }
    write_metrics(metrics)

    import psycopg

    if args.cleanup_only:
        with psycopg.connect(dsn, autocommit=False) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT current_database()")
                assert cur.fetchone()[0] == TARGET_DB
                metrics["cleanup"] = cleanup_scope(cur)
                conn.commit()
        # Preserve prior successful bench metrics if present.
        if METRICS_PATH.is_file():
            try:
                prev = json.loads(METRICS_PATH.read_text(encoding="utf-8"))
                if prev.get("verdict") or prev.get("phase_50k"):
                    prev["cleanup_only"] = metrics["cleanup"]
                    prev["cleaned"] = True
                    write_metrics(prev)
                    print(json.dumps({"cleanup": metrics["cleanup"], "preserved_verdict": prev.get("verdict")}, indent=2))
                    return 0
            except Exception:
                pass
        write_metrics(metrics)
        print(json.dumps(metrics, indent=2))
        return 0

    if args.rows > 100_000:
        raise SystemExit("REFUSED rows>100k in this stage (no 718k)")

    sa_url = (
        "postgresql+psycopg://" + dsn[len("postgresql://") :]
        if dsn.startswith("postgresql://")
        else dsn
    )
    os.environ["APP_DATABASE_URL"] = sa_url
    os.environ["WAREHOUSE_1C_CATALOG_WRITE_COMPACT"] = "1"

    # Phase A/B: 50k
    phase50 = run_phase(
        dsn=dsn,
        sa_url=sa_url,
        rows=min(args.rows, 50_000) if args.rows != 100_000 else 50_000,
        batch=args.batch,
        max_rss=max_rss,
        metrics=metrics,
        phase_name="50k",
    )
    metrics["phase_50k"] = phase50
    write_metrics(metrics)

    run_100k = (
        not args.skip_100k
        and phase50.get("all_targets_met")
        and args.rows >= 50_000
    )
    if run_100k:
        # Clean 50k scope before 100k
        with psycopg.connect(dsn, autocommit=False) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT current_database()")
                assert cur.fetchone()[0] == TARGET_DB
                cleanup_scope(cur)
                conn.commit()
        phase100 = run_phase(
            dsn=dsn,
            sa_url=sa_url,
            rows=100_000,
            batch=args.batch,
            max_rss=max_rss,
            metrics=metrics,
            phase_name="100k",
        )
        metrics["phase_100k"] = phase100
        write_metrics(metrics)
    else:
        metrics["phase_100k"] = {
            "skipped": True,
            "reason": "50k_targets_not_met" if not phase50.get("all_targets_met") else "flag",
        }

    # Verdict
    p50 = metrics.get("phase_50k") or {}
    p100 = metrics.get("phase_100k") or {}
    sm50 = p50.get("search_ms") or {}
    if p50.get("aborted") == "free_ram_lt_8gb" or (
        p50.get("rebuild") or {}
    ).get("outcome") == "oom":
        verdict = "HOLD_1C_COMPACT_SEARCH_MEMORY"
    elif not (p50.get("correctness") or {}).get("fn_zero", False):
        verdict = "NO_GO_1C_COMPACT_SEARCH"
    elif not (sm50.get("code_prefix") or {}).get("p95", 999) <= 100 or not (
        sm50.get("model") or {}
    ).get("p95", 999) <= 100:
        verdict = "HOLD_1C_COMPACT_SEARCH_PREFIX"
    elif not (sm50.get("dense_common") or {}).get("p95", 999) <= 250:
        verdict = "HOLD_1C_COMPACT_SEARCH_DENSE_FTS"
    elif not (sm50.get("multiword") or {}).get("p95", 999) <= 100:
        verdict = "HOLD_1C_COMPACT_SEARCH_MULTIWORD"
    elif (p50.get("size_active_only") or {}).get("compact_total_mb", 9999) > 900:
        verdict = "HOLD_1C_COMPACT_SEARCH_SIZE"
    elif p100.get("skipped"):
        verdict = "HOLD_1C_COMPACT_SEARCH_DENSE_FTS"  # will refine below
        if p50.get("all_targets_met"):
            verdict = "HOLD_1C_COMPACT_SEARCH_SIZE"  # 100k skipped for other reason
    elif p100.get("all_targets_met") and p50.get("all_targets_met"):
        verdict = "GO_1C_COMPACT_SEARCH_100K_GATE_PASSED"
    elif not (p100.get("targets") or {}).get("dense_p95_le_250", True):
        verdict = "HOLD_1C_COMPACT_SEARCH_DENSE_FTS"
    elif not (p100.get("targets") or {}).get("prefix_p95_le_100", True):
        verdict = "HOLD_1C_COMPACT_SEARCH_PREFIX"
    else:
        verdict = "HOLD_1C_COMPACT_SEARCH_DENSE_FTS"

    # Refine when 50k fully met but 100k skipped due to flag
    if p50.get("all_targets_met") and p100.get("skipped") and args.skip_100k:
        verdict = "GO_1C_COMPACT_SEARCH_100K_GATE_PASSED"  # not really — keep HOLD-ish
        verdict = "HOLD_1C_COMPACT_SEARCH_SIZE"

    if p50.get("all_targets_met") and not p100.get("skipped") and p100.get("all_targets_met"):
        verdict = "GO_1C_COMPACT_SEARCH_100K_GATE_PASSED"
    elif p50.get("all_targets_met") and p100.get("skipped"):
        # 50k OK but 100k not run — should not claim GO
        if not run_100k:
            # Recompute: if 50k OK we should have run 100k unless skip
            pass

    metrics["verdict"] = verdict
    metrics["rss_after"] = process_rss_bytes()
    metrics["free_ram_after"] = free_ram_bytes()

    if not args.keep:
        with psycopg.connect(dsn, autocommit=False) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT current_database()")
                assert cur.fetchone()[0] == TARGET_DB
                metrics["cleanup_final"] = cleanup_scope(cur)
                conn.commit()
        metrics["cleaned"] = True
    else:
        metrics["cleaned"] = False

    write_metrics(metrics)
    print(json.dumps({k: metrics[k] for k in ("verdict", "phase_50k", "phase_100k") if k in metrics}, indent=2, default=str))
    print(f"Wrote {METRICS_PATH}")
    print(f"VERDICT={verdict}")
    return 0 if verdict == "GO_1C_COMPACT_SEARCH_100K_GATE_PASSED" else 1


if __name__ == "__main__":
    raise SystemExit(main())
