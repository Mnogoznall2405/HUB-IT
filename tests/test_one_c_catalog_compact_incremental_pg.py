"""PG matrix: incremental compact dual-write — SAFE test DB ONLY.

Proves 100 changed refs do not rewrite ~100k untouched compact docs.
Never touches production. Hard-rejects hubit_chat/postgres/templates.
"""
from __future__ import annotations

import os
import re
import sys
import time
from pathlib import Path
from urllib.parse import unquote, urlparse, urlunparse

import pytest


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

HARD_REJECT = frozenset({"hubit_chat", "postgres", "template0", "template1"})
ALLOWED_RE = re.compile(
    r"^(hubit_chat_retention_test_.+|hubit_chat_1c_search_test_.+)$",
    re.IGNORECASE,
)
REQUIRED_DB = "hubit_chat_retention_test_20260804154706"
SOURCE = "inc_dual_write_bench"
CATALOG = "nomenclature"


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


def _resolve_dsn() -> str | None:
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
        # Prefer the stage-required retention clone when present in dotenv URLs.
        chosen = REQUIRED_DB
    for key in ("APP_DATABASE_URL", "CHAT_DATABASE_URL"):
        value = (os.getenv(key) or file_env.get(key) or "").strip()
        if value:
            return _with_db(value, chosen)
    return None


def _sa_url(dsn: str) -> str:
    if dsn.startswith("postgresql://"):
        return "postgresql+psycopg://" + dsn[len("postgresql://") :]
    return dsn


def _assert_safe(conn) -> None:
    from sqlalchemy import text

    current = conn.execute(text("SELECT current_database()")).scalar_one()
    name = str(current)
    if name.casefold() in HARD_REJECT or not ALLOWED_RE.match(name):
        pytest.fail(f"REFUSED current_database()={name!r}")
    if name != REQUIRED_DB:
        pytest.skip(f"Stage requires {REQUIRED_DB}, got {name}")


@pytest.fixture(scope="module")
def pg_url():
    dsn = _resolve_dsn()
    if not dsn:
        pytest.skip("No allowed 1C search test DB configured")
    name = _db_name(dsn)
    if name.casefold() in HARD_REJECT or not ALLOWED_RE.match(name):
        pytest.fail(f"REFUSED unsafe DSN db={name!r}")
    import psycopg

    with psycopg.connect(dsn, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT current_database()")
            current = cur.fetchone()[0]
    if str(current).casefold() in HARD_REJECT or not ALLOWED_RE.match(str(current)):
        pytest.fail(f"REFUSED current_database()={current!r}")
    if str(current) != REQUIRED_DB:
        pytest.skip(f"Stage requires {REQUIRED_DB}, got {current}")
    return _sa_url(dsn)


@pytest.fixture(scope="module")
def inc_env(pg_url):
    os.environ["APP_DATABASE_URL"] = pg_url
    os.environ["WAREHOUSE_1C_CATALOG_WRITE_COMPACT"] = "1"
    os.environ["WAREHOUSE_1C_CATALOG_SEARCH_ENGINE"] = "tokens"
    os.environ["WAREHOUSE_1C_CATALOG_SEARCH_CANARY_PERCENT"] = "0"
    os.environ["WAREHOUSE_1C_CATALOG_COMPACT_TOKEN_STATS_MODE"] = "delta"
    os.environ["WAREHOUSE_1C_CATALOG_COMPACT_INCREMENTAL_MAX_CHANGED_ROWS"] = "50000"
    os.environ["WAREHOUSE_1C_CATALOG_COMPACT_INCREMENTAL_MAX_CHANGED_PERCENT"] = "50"
    os.environ["SKIP_PG_SCHEMA_DOCS"] = "1"

    from sqlalchemy import text
    from backend.appdb.db import get_app_engine, initialize_app_schema

    engine = get_app_engine(pg_url)
    with engine.begin() as conn:
        _assert_safe(conn)
        conn.execute(text('CREATE SCHEMA IF NOT EXISTS "app"'))
        conn.execute(text('CREATE SCHEMA IF NOT EXISTS "system"'))
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
    initialize_app_schema(pg_url, force=True)
    yield pg_url


def _cleanup(url: str) -> None:
    from sqlalchemy import text
    from backend.appdb.db import get_app_engine

    engine = get_app_engine(url)
    with engine.begin() as conn:
        _assert_safe(conn)
        for table in (
            "one_c_catalog_search_token_stats",
            "one_c_catalog_search_documents",
            "one_c_catalog_search_index_state",
            "one_c_catalog_tokens",
            "one_c_catalog_entries",
            "one_c_catalog_snapshots",
        ):
            conn.execute(
                text(f"DELETE FROM app.{table} WHERE source_base = :s"),
                {"s": SOURCE},
            )


def _rows(n: int, *, name_prefix: str = "Item") -> list[tuple[str, str, str]]:
    # Stream-friendly generator materialized in chunks by caller size only.
    return [(f"r{i:06d}", f"C{i:06d}", f"{name_prefix} {i:06d}") for i in range(n)]


def test_pg_incremental_100_of_100k_does_not_rewrite_all(inc_env):
    """Scenario proof: 100 changed refs leave 99900 docs untouched (updated_at)."""
    from sqlalchemy import text
    from backend.appdb.db import get_app_engine
    from backend.services.one_c_catalog_snapshot_service import OneCCatalogSnapshotStore
    from backend.services.one_c_catalog_compact_writer import TOKEN_STATS_REBUILD_METRICS

    url = inc_env
    _cleanup(url)
    store = OneCCatalogSnapshotStore(url)
    total = 100_000
    base = _rows(total)
    fp1 = "fp-inc-base-1"

    t0 = time.perf_counter()
    status = store.replace_snapshot(
        nomenclature=base,
        warehouses=[("wh-1", "Warehouse One")],
        source_base=SOURCE,
        nomenclature_fingerprint=fp1,
        warehouses_fingerprint="fp-wh-1",
    )
    bootstrap_ms = (time.perf_counter() - t0) * 1000.0
    assert status and status.get("has_snapshot")

    engine = get_app_engine(url)
    with engine.connect() as conn:
        _assert_safe(conn)
        docs = conn.execute(
            text(
                """
                SELECT COUNT(*), MIN(updated_at), MAX(updated_at)
                FROM app.one_c_catalog_search_documents
                WHERE source_base = :s AND catalog_type = :c
                """
            ),
            {"s": SOURCE, "c": CATALOG},
        ).one()
        assert int(docs[0]) == total
        # Freeze baseline updated_at watermark for untouched proof.
        baseline_max = docs[2]
        ready = conn.execute(
            text(
                """
                SELECT status, active_index_version, source_fingerprint, indexed_count
                FROM app.one_c_catalog_search_index_state
                WHERE source_base = :s AND catalog_type = :c
                """
            ),
            {"s": SOURCE, "c": CATALOG},
        ).one()
        assert str(ready[0]) == "ready"
        assert int(ready[1]) > 0
        assert str(ready[2]) == fp1
        assert int(ready[3]) == total

    # Change 100 refs only.
    changed = 100
    patched = list(base)
    for i in range(changed):
        ref, code, _name = patched[i]
        patched[i] = (ref, code, f"Changed {i:06d}")
    fp2 = "fp-inc-patch-2"
    touched_before = int(TOKEN_STATS_REBUILD_METRICS["documents_touched_total"])

    t1 = time.perf_counter()
    status2 = store.replace_snapshot(
        nomenclature=patched,
        warehouses=[("wh-1", "Warehouse One")],
        source_base=SOURCE,
        nomenclature_fingerprint=fp2,
        warehouses_fingerprint="fp-wh-1",
    )
    patch_ms = (time.perf_counter() - t1) * 1000.0
    assert status2 and status2.get("has_snapshot")
    touched_after = int(TOKEN_STATS_REBUILD_METRICS["documents_touched_total"])

    with engine.connect() as conn:
        _assert_safe(conn)
        total_docs = conn.execute(
            text(
                """
                SELECT COUNT(*) FROM app.one_c_catalog_search_documents
                WHERE source_base = :s AND catalog_type = :c
                """
            ),
            {"s": SOURCE, "c": CATALOG},
        ).scalar_one()
        assert int(total_docs) == total

        rewritten = conn.execute(
            text(
                """
                SELECT COUNT(*) FROM app.one_c_catalog_search_documents
                WHERE source_base = :s AND catalog_type = :c
                  AND updated_at > :baseline
                """
            ),
            {"s": SOURCE, "c": CATALOG, "baseline": baseline_max},
        ).scalar_one()
        untouched = conn.execute(
            text(
                """
                SELECT COUNT(*) FROM app.one_c_catalog_search_documents
                WHERE source_base = :s AND catalog_type = :c
                  AND updated_at <= :baseline
                """
            ),
            {"s": SOURCE, "c": CATALOG, "baseline": baseline_max},
        ).scalar_one()
        assert int(rewritten) == changed
        assert int(untouched) == total - changed

        state = conn.execute(
            text(
                """
                SELECT status, source_fingerprint, previous_index_version
                FROM app.one_c_catalog_search_index_state
                WHERE source_base = :s AND catalog_type = :c
                """
            ),
            {"s": SOURCE, "c": CATALOG},
        ).one()
        assert str(state[0]) == "ready"
        assert str(state[1]) == fp2
        # Previous version invalidated after first incremental.
        assert int(state[2] or 0) == 0

    # Metric upper bound: must not touch ~100k docs for a 100-ref patch.
    docs_touched = touched_after - touched_before
    assert docs_touched <= changed + 5  # small slack for warehouse no-op / retries
    assert docs_touched < 1_000

    # Idempotent redelivery of same sync fingerprint path (empty patch).
    t2 = time.perf_counter()
    store.replace_snapshot(
        nomenclature=patched,
        warehouses=[("wh-1", "Warehouse One")],
        source_base=SOURCE,
        nomenclature_fingerprint=fp2,
        warehouses_fingerprint="fp-wh-1",
    )
    noop_ms = (time.perf_counter() - t2) * 1000.0

    results_dir = ROOT / "tmp" / "hub-architecture-remediation"
    results_dir.mkdir(parents=True, exist_ok=True)
    (results_dir / "incremental_100k_proof.json").write_text(
        (
            "{\n"
            f'  "db": "{REQUIRED_DB}",\n'
            f'  "total_docs": {total},\n'
            f'  "changed_refs": {changed},\n'
            f'  "rewritten_docs": {int(rewritten)},\n'
            f'  "untouched_docs": {int(untouched)},\n'
            f'  "documents_touched_metric": {docs_touched},\n'
            f'  "bootstrap_ms": {bootstrap_ms:.1f},\n'
            f'  "patch_ms": {patch_ms:.1f},\n'
            f'  "noop_ms": {noop_ms:.1f}\n'
            "}\n"
        ),
        encoding="utf-8",
    )


def test_pg_incremental_idempotent_sync_id(inc_env):
    from backend.appdb.db import get_app_session_factory
    from backend.services.one_c_catalog_compact_writer import (
        CompactCatalogPatch,
        OneCCatalogCompactWriter,
    )

    url = inc_env
    _cleanup(url)
    # Bootstrap tiny ready index via writer escalate path.
    factory = get_app_session_factory(url)
    writer = OneCCatalogCompactWriter(enabled=True)
    session = factory()
    try:
        from sqlalchemy import text

        _assert_safe(session.connection())
        # Seed one legacy entry + compact ready state via full_rebuild patch.
        session.execute(
            text(
                """
                INSERT INTO app.one_c_catalog_snapshots (
                    source_base, active_generation, nomenclature_count, warehouses_count,
                    created_at, updated_at, last_attempt_at, last_error,
                    nomenclature_truncated, warehouses_truncated,
                    nomenclature_fingerprint, warehouses_fingerprint
                ) VALUES (
                    :s, 1, 2, 0, NOW(), NOW(), NOW(), '',
                    false, false, 'fp-a', ''
                )
                ON CONFLICT (source_base) DO UPDATE SET
                    active_generation = 1,
                    nomenclature_count = 2,
                    nomenclature_fingerprint = 'fp-a',
                    updated_at = NOW()
                """
            ),
            {"s": SOURCE},
        )
        session.execute(
            text(
                """
                DELETE FROM app.one_c_catalog_entries
                WHERE source_base = :s AND catalog_type = 'nomenclature'
                """
            ),
            {"s": SOURCE},
        )
        session.execute(
            text(
                """
                INSERT INTO app.one_c_catalog_entries (
                    source_base, generation, catalog_type, ref, code, name,
                    code_normalized, name_normalized, created_at
                ) VALUES
                (:s, 1, 'nomenclature', 'r1', 'C1', 'One', 'c1', 'one', NOW()),
                (:s, 1, 'nomenclature', 'r2', 'C2', 'Two', 'c2', 'two', NOW())
                """
            ),
            {"s": SOURCE},
        )
        session.commit()
        report1 = writer.apply_incremental_patch(
            session,
            source_base=SOURCE,
            generation=1,
            patch=CompactCatalogPatch(
                catalog_type=CATALOG,
                expected_count=2,
                incoming_count=2,
                changed_count=2,
                catalog_fingerprint="fp-a",
                sync_id="sync-idem-1",
                full_rebuild=True,
            ),
        )
        session.commit()
        assert report1.ok
        report2 = writer.apply_incremental_patch(
            session,
            source_base=SOURCE,
            generation=1,
            patch=CompactCatalogPatch(
                catalog_type=CATALOG,
                upserts=(("r1", "C1", "One Changed"),),
                expected_count=2,
                changed_count=1,
                incoming_count=2,
                catalog_fingerprint="fp-a",
                sync_id="sync-idem-1",
            ),
        )
        session.commit()
        # Same sync_id already applied after rebuild refresh → noop
        assert report2.outcome in {"noop", "applied"}
        if report2.outcome == "applied":
            # If rebuild did not persist sync_id, second apply may run once;
            # third must noop.
            report3 = writer.apply_incremental_patch(
                session,
                source_base=SOURCE,
                generation=1,
                patch=CompactCatalogPatch(
                    catalog_type=CATALOG,
                    upserts=(("r1", "C1", "One Changed Again"),),
                    expected_count=2,
                    changed_count=1,
                    incoming_count=2,
                    catalog_fingerprint="fp-b",
                    sync_id="sync-idem-2",
                ),
            )
            session.commit()
            assert report3.ok and report3.outcome == "applied"
            report4 = writer.apply_incremental_patch(
                session,
                source_base=SOURCE,
                generation=1,
                patch=CompactCatalogPatch(
                    catalog_type=CATALOG,
                    upserts=(("r1", "C1", "ignored"),),
                    expected_count=2,
                    changed_count=1,
                    incoming_count=2,
                    catalog_fingerprint="fp-b",
                    sync_id="sync-idem-2",
                ),
            )
            session.commit()
            assert report4.outcome == "noop"
    finally:
        session.close()


def test_pg_fingerprint_mismatch_fail_closed_search(inc_env):
    from sqlalchemy import text
    from backend.appdb.db import get_app_engine, get_app_session_factory
    from backend.services.one_c_catalog_compact_search import OneCCatalogCompactSearch
    from backend.services.one_c_catalog_snapshot_service import OneCCatalogSnapshotStore

    url = inc_env
    _cleanup(url)
    store = OneCCatalogSnapshotStore(url)
    store.replace_snapshot(
        nomenclature=_rows(20),
        warehouses=[],
        source_base=SOURCE,
        nomenclature_fingerprint="fp-ready",
        warehouses_fingerprint="",
    )
    engine = get_app_engine(url)
    with engine.begin() as conn:
        _assert_safe(conn)
        conn.execute(
            text(
                """
                UPDATE app.one_c_catalog_search_index_state
                SET source_fingerprint = 'fp-stale'
                WHERE source_base = :s AND catalog_type = :c
                """
            ),
            {"s": SOURCE, "c": CATALOG},
        )
    search = OneCCatalogCompactSearch(url)
    session = get_app_session_factory(url)()
    try:
        ver = search.resolve_ready_version(
            session,
            source_base=SOURCE,
            catalog_type=CATALOG,
            generation=1,
            catalog_fingerprint="fp-ready",
        )
        assert ver is None
    finally:
        session.close()


def test_pg_crash_recovery_on_catalogue_noop(inc_env):
    """Legacy commit + compact not updated → record_attempt_success reconciles."""
    from sqlalchemy import text
    from backend.appdb.db import get_app_engine
    from backend.services.one_c_catalog_snapshot_service import OneCCatalogSnapshotStore

    url = inc_env
    _cleanup(url)
    store = OneCCatalogSnapshotStore(url)
    rows = _rows(50)
    store.replace_snapshot(
        nomenclature=rows,
        warehouses=[],
        source_base=SOURCE,
        nomenclature_fingerprint="fp-v1",
        warehouses_fingerprint="",
    )
    # Simulate legacy advanced fingerprint while compact lagging.
    engine = get_app_engine(url)
    with engine.begin() as conn:
        _assert_safe(conn)
        conn.execute(
            text(
                """
                UPDATE app.one_c_catalog_snapshots
                SET nomenclature_fingerprint = 'fp-v2',
                    nomenclature_count = 50
                WHERE source_base = :s
                """
            ),
            {"s": SOURCE},
        )
        # Mutate one legacy entry as if sync committed a rename.
        conn.execute(
            text(
                """
                UPDATE app.one_c_catalog_entries
                SET name = 'Recovered Name',
                    name_normalized = 'recovered name'
                WHERE source_base = :s AND ref = 'r000000'
                """
            ),
            {"s": SOURCE},
        )
        conn.execute(
            text(
                """
                UPDATE app.one_c_catalog_search_index_state
                SET status = 'stale',
                    source_fingerprint = 'fp-v1',
                    last_error = 'simulated_crash'
                WHERE source_base = :s AND catalog_type = :c
                """
            ),
            {"s": SOURCE, "c": CATALOG},
        )
    store.record_attempt_success(source_base=SOURCE)
    with engine.connect() as conn:
        _assert_safe(conn)
        state = conn.execute(
            text(
                """
                SELECT status, source_fingerprint FROM app.one_c_catalog_search_index_state
                WHERE source_base = :s AND catalog_type = :c
                """
            ),
            {"s": SOURCE, "c": CATALOG},
        ).one()
        assert str(state[0]) == "ready"
        assert str(state[1]) == "fp-v2"
        name = conn.execute(
            text(
                """
                SELECT name_normalized FROM app.one_c_catalog_search_documents
                WHERE source_base = :s AND entry_ref = 'r000000'
                """
            ),
            {"s": SOURCE},
        ).scalar_one()
        assert "recovered" in str(name)
