#!/usr/bin/env python3
"""Production-scale D-lite-only synthetic benchmark on a SAFE test DB.

HARD RULES:
- Refuses hubit_chat / postgres / templates
- Allows only hubit_chat_retention_test_% or hubit_chat_1c_search_test_%
- Verifies current_database() before DDL
- Synthetic data only (no prod copy / PII)
- Caps: schema+data estimate ≤2GB; free disk ≥15GB
- Cleans up only objects this script created (bench_* scopes)
- Does NOT enable production dual-write/shadow/canary/engine
"""
from __future__ import annotations

import argparse
import json
import os
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
SOURCE_BASE = "bench_d_lite"
CATALOG = "nomenclature"
MIN_FREE = 15 * 1024**3
MAX_SCHEMA_BYTES = 2 * 1024**3


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


def cleanup(cur) -> None:
    cur.execute(
        "DELETE FROM app.one_c_catalog_search_token_stats WHERE source_base = %s",
        (SOURCE_BASE,),
    )
    cur.execute(
        "DELETE FROM app.one_c_catalog_search_documents WHERE source_base = %s",
        (SOURCE_BASE,),
    )
    cur.execute(
        "DELETE FROM app.one_c_catalog_search_index_state WHERE source_base = %s",
        (SOURCE_BASE,),
    )
    cur.execute(
        "DELETE FROM app.one_c_catalog_tokens WHERE source_base = %s",
        (SOURCE_BASE,),
    )
    cur.execute(
        "DELETE FROM app.one_c_catalog_entries WHERE source_base = %s",
        (SOURCE_BASE,),
    )
    cur.execute(
        "DELETE FROM app.one_c_catalog_snapshots WHERE source_base = %s",
        (SOURCE_BASE,),
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rows", type=int, default=50_000)
    parser.add_argument("--dsn", default="")
    parser.add_argument("--keep", action="store_true", help="Keep synthetic rows")
    parser.add_argument("--batch", type=int, default=5_000)
    parser.add_argument(
        "--force-scale",
        action="store_true",
        help="Allow rows>=200000 (prefer scripts/one_c_catalog_compact_4h_sync_bench.py)",
    )
    args = parser.parse_args()

    if args.rows >= 200_000 and not args.force_scale:
        raise SystemExit(
            f"REFUSED rows={args.rows}: this legacy d_lite harness is OOM-prone. "
            "Use scripts/one_c_catalog_compact_4h_sync_bench.py (memory-safe) "
            "or pass --force-scale only after warmup."
        )

    dsn = resolve_dsn(args.dsn or None)
    dbname = assert_safe(dsn)
    print(f"SAFE DB={dbname} rows={args.rows}")

    import psycopg

    metrics: dict = {"database": dbname, "rows": args.rows}
    with psycopg.connect(dsn, autocommit=False) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT current_database()")
            assert ALLOWED_RE.match(cur.fetchone()[0])
            cleanup(cur)
            conn.commit()

            # Snapshot row
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
                    updated_at=NOW(),
                    last_error=''
                """,
                (SOURCE_BASE, args.rows),
            )
            conn.commit()

            t0 = time.perf_counter()
            for offset in range(0, args.rows, args.batch):
                n = min(args.batch, args.rows - offset)
                rows = [
                    (
                        SOURCE_BASE,
                        1,
                        CATALOG,
                        f"b{offset + i:08d}",
                        f"C{offset + i:06d}",
                        f"Synth Item {offset + i} Model M-{i % 100} Ippon",
                        f"c{offset + i:06d}",
                        f"synth item {offset + i} model m{i % 100} ippon",
                    )
                    for i in range(n)
                ]
                cur.executemany(
                    """
                    INSERT INTO app.one_c_catalog_entries (
                        source_base, generation, catalog_type, ref, code, name,
                        code_normalized, name_normalized, created_at
                    ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s, NOW())
                    ON CONFLICT (source_base, generation, catalog_type, ref)
                    DO NOTHING
                    """,
                    rows,
                )
                conn.commit()
                used = relation_bytes(
                    cur,
                    [
                        "one_c_catalog_entries",
                        "one_c_catalog_search_%",
                    ],
                )
                if used > MAX_SCHEMA_BYTES:
                    cleanup(cur)
                    conn.commit()
                    raise SystemExit(f"ABORT schema/data size {used} > {MAX_SCHEMA_BYTES}")
            metrics["seed_entries_seconds"] = round(time.perf_counter() - t0, 3)

            # Build compact docs via writer path (raw SQL for speed)
            os.environ["WAREHOUSE_1C_CATALOG_WRITE_COMPACT"] = "1"
            from backend.services.one_c_catalog_compact_docs import build_search_document_fields

            t1 = time.perf_counter()
            cur.execute(
                """
                SELECT ref, code, name FROM app.one_c_catalog_entries
                WHERE source_base=%s AND generation=1 AND catalog_type=%s
                ORDER BY ref
                """,
                (SOURCE_BASE, CATALOG),
            )
            batch: list = []
            built = 0
            while True:
                chunk = cur.fetchmany(args.batch)
                if not chunk:
                    break
                for ref, code, name in chunk:
                    fields = build_search_document_fields(code, name)
                    batch.append(
                        (
                            SOURCE_BASE,
                            1,
                            CATALOG,
                            ref,
                            fields["code_normalized"],
                            fields["name_normalized"],
                            fields["search_text"],
                            fields["tsv_source"],
                        )
                    )
                with conn.cursor() as wcur:
                    wcur.executemany(
                        """
                        INSERT INTO app.one_c_catalog_search_documents (
                            source_base, generation, catalog_type, entry_ref,
                            code_normalized, name_normalized, search_text, search_tsv,
                            created_at, updated_at
                        ) VALUES (
                            %s,%s,%s,%s,%s,%s,%s, to_tsvector('simple', %s), NOW(), NOW()
                        )
                        ON CONFLICT (source_base, generation, catalog_type, entry_ref)
                        DO UPDATE SET
                            code_normalized=EXCLUDED.code_normalized,
                            name_normalized=EXCLUDED.name_normalized,
                            search_text=EXCLUDED.search_text,
                            search_tsv=EXCLUDED.search_tsv,
                            updated_at=NOW()
                        """,
                        batch,
                    )
                conn.commit()
                built += len(batch)
                batch.clear()
                if built % 50_000 == 0:
                    print(f"docs built={built}")
            metrics["build_documents_seconds"] = round(time.perf_counter() - t1, 3)
            metrics["documents_built"] = built

            # token_stats rebuild
            from backend.services.one_c_catalog_compact_writer import OneCCatalogCompactWriter
            from backend.appdb.db import get_app_session_factory

            sa_url = (
                "postgresql+psycopg://" + dsn[len("postgresql://") :]
                if dsn.startswith("postgresql://")
                else dsn
            )
            os.environ["APP_DATABASE_URL"] = sa_url
            writer = OneCCatalogCompactWriter(enabled=True)
            session = get_app_session_factory(sa_url)()
            try:
                t2 = time.perf_counter()
                rows_stats = writer.rebuild_token_stats(
                    session,
                    source_base=SOURCE_BASE,
                    generation=1,
                    catalog_type=CATALOG,
                )
                writer.refresh_state_counts(
                    session,
                    source_base=SOURCE_BASE,
                    catalog_type=CATALOG,
                    generation=1,
                    expected_count=built,
                    status="ready",
                )
                session.commit()
                metrics["token_stats_rebuild_seconds"] = round(time.perf_counter() - t2, 3)
                metrics["token_stats_rows"] = rows_stats
            finally:
                session.close()

            # Search latency sample
            from backend.services.one_c_catalog_compact_flags import parse_compact_flags
            from backend.services.one_c_catalog_compact_search import OneCCatalogCompactSearch

            flags = parse_compact_flags({"WAREHOUSE_1C_CATALOG_SEARCH_ENGINE": "compact"})
            searcher = OneCCatalogCompactSearch(sa_url, flags=flags)
            samples = []
            for q in ("C000001", "C00010", "ippon", "m70", "synth"):
                times = []
                for _ in range(5):
                    st = time.perf_counter()
                    searcher.search_entries(
                        catalog_type=CATALOG,
                        text_query=q,
                        limit=20,
                        source_base=SOURCE_BASE,
                        generation=1,
                    )
                    times.append((time.perf_counter() - st) * 1000)
                times.sort()
                samples.append(
                    {
                        "q_shape_len": len(q),
                        "p50": round(times[len(times) // 2], 2),
                        "p95": round(times[-1], 2),
                    }
                )
            metrics["search_ms"] = samples

            with conn.cursor() as cur2:
                metrics["heap_index_bytes"] = relation_bytes(
                    cur2,
                    [
                        "one_c_catalog_search_documents",
                        "one_c_catalog_search_token_stats",
                        "one_c_catalog_search_index_state",
                        "ix_app_one_c_catalog_search_%",
                    ],
                )
                cur2.execute(
                    """
                    SELECT pg_current_wal_lsn()::text
                    """
                )
                metrics["wal_lsn"] = cur2.fetchone()[0]

            if not args.keep:
                cleanup(cur)
                conn.commit()
                metrics["cleaned"] = True
            else:
                metrics["cleaned"] = False

    out = ROOT / "tmp" / "hub-architecture-remediation" / "compact_d_lite_bench.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    print(json.dumps(metrics, indent=2))
    print(f"Wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
