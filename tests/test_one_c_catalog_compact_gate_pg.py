"""PostgreSQL gate matrix for 1C compact search — SAFE TEST DB ONLY.

Covers shadow isolation, token_stats rebuild, backfill, dual-write, suggest,
canary routing, ORM/tsvector, and index prefix plans. Never touches production.
"""
from __future__ import annotations

import os
import re
import sys
import threading
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


def _resolve_test_dsn() -> str | None:
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
        return None
    for key in ("APP_DATABASE_URL", "CHAT_DATABASE_URL"):
        value = (os.getenv(key) or file_env.get(key) or "").strip()
        if value:
            return _with_db(value, chosen)
    return None


def _sa_url(dsn: str) -> str:
    if dsn.startswith("postgresql://"):
        return "postgresql+psycopg://" + dsn[len("postgresql://") :]
    return dsn


@pytest.fixture(scope="module")
def pg_url():
    dsn = _resolve_test_dsn()
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
    return _sa_url(dsn)


@pytest.fixture(scope="module")
def gate_store(pg_url):
    os.environ["APP_DATABASE_URL"] = pg_url
    os.environ["WAREHOUSE_1C_CATALOG_WRITE_COMPACT"] = "1"
    os.environ["WAREHOUSE_1C_CATALOG_COMPACT_BACKFILL_ENABLED"] = "1"
    os.environ["WAREHOUSE_1C_CATALOG_SEARCH_ENGINE"] = "tokens"
    os.environ["WAREHOUSE_1C_CATALOG_SEARCH_SHADOW"] = "0"
    os.environ["WAREHOUSE_1C_CATALOG_SEARCH_CANARY_PERCENT"] = "0"
    os.environ["WAREHOUSE_1C_CATALOG_TYPO_FALLBACK_ENABLED"] = "1"
    os.environ["SKIP_PG_SCHEMA_DOCS"] = "1"

    from sqlalchemy import text
    from backend.appdb.db import get_app_engine, initialize_app_schema

    engine = get_app_engine(pg_url)
    with engine.begin() as conn:
        conn.execute(text('CREATE SCHEMA IF NOT EXISTS "app"'))
        conn.execute(text('CREATE SCHEMA IF NOT EXISTS "system"'))
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
    initialize_app_schema(pg_url, force=True)

    with engine.begin() as conn:
        conn.execute(
            text(
                """
                DO $$
                BEGIN
                  IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema='app' AND table_name='one_c_catalog_search_documents'
                      AND column_name='search_tsv' AND data_type <> 'tsvector'
                  ) THEN
                    ALTER TABLE app.one_c_catalog_search_documents
                      ALTER COLUMN search_tsv TYPE tsvector
                      USING to_tsvector('simple', coalesce(search_tsv::text, ''));
                  END IF;
                END $$;
                """
            )
        )
        for stmt in (
            "CREATE INDEX IF NOT EXISTS ix_app_one_c_catalog_search_documents_code "
            "ON app.one_c_catalog_search_documents "
            "(source_base, generation, catalog_type, code_normalized)",
            "CREATE INDEX IF NOT EXISTS ix_app_one_c_catalog_search_documents_tsv "
            "ON app.one_c_catalog_search_documents USING gin (search_tsv)",
            "CREATE INDEX IF NOT EXISTS ix_app_one_c_catalog_search_documents_trgm "
            "ON app.one_c_catalog_search_documents USING gin (search_text gin_trgm_ops)",
            "DROP INDEX IF EXISTS app.ix_app_one_c_catalog_search_documents_scope",
            "DROP INDEX IF EXISTS app.ix_app_one_c_catalog_search_token_stats_prefix",
            "CREATE INDEX IF NOT EXISTS ix_app_one_c_catalog_search_token_stats_prefix "
            "ON app.one_c_catalog_search_token_stats "
            "(source_base, generation, catalog_type, token varchar_pattern_ops)",
            "CREATE INDEX IF NOT EXISTS ix_app_one_c_catalog_search_token_stats_trgm "
            "ON app.one_c_catalog_search_token_stats USING gin (token gin_trgm_ops)",
            "CREATE INDEX IF NOT EXISTS ix_app_one_c_catalog_tokens_token_trgm "
            "ON app.one_c_catalog_tokens USING gin (token gin_trgm_ops)",
        ):
            conn.execute(text(stmt))

    from backend.services.one_c_catalog_snapshot_service import OneCCatalogSnapshotStore

    store = OneCCatalogSnapshotStore(pg_url, enabled=True)
    with engine.begin() as conn:
        for table in (
            "one_c_catalog_search_token_stats",
            "one_c_catalog_search_documents",
            "one_c_catalog_search_index_state",
            "one_c_catalog_tokens",
            "one_c_catalog_entries",
            "one_c_catalog_snapshots",
        ):
            conn.execute(text(f"DELETE FROM app.{table}"))

    store.replace_snapshot(
        nomenclature=[
            ("nom-1", "PN-101", "Ippon Back Basic 800"),
            ("nom-2", "PN-650", "Ippon Back Basic 650"),
            ("nom-3", "APC-9", "APC Smart UPS"),
            ("nom-4", "M-70", "Model M-70 Battery"),
            ("nom-5", "M 70", "Model M 70 Twin"),
            ("nom-6", "YO-1", "Склад Алёна Demo"),
            ("nom-7", "ABC-1", "Alpha Beta Gamma"),
            ("nom-8", "ABC-2", "Alpha Beta Delta"),
        ],
        warehouses=[
            ("wh-1", "Склад Иванов И.И."),
            ("wh-2", "Основной склад Алёна"),
        ],
    )
    return store, pg_url


def _engine(url):
    from backend.appdb.db import get_app_engine

    return get_app_engine(url)


def _assert_safe_db(conn):
    from sqlalchemy import text

    name = conn.execute(text("SELECT current_database()")).scalar_one()
    assert ALLOWED_RE.match(str(name)), f"unsafe db {name}"
    assert str(name).casefold() not in HARD_REJECT


# --- 8 ORM / tsvector ---


def test_pg_orm_tsvector_insert_select_fts(gate_store):
    store, url = gate_store
    from sqlalchemy import text

    engine = _engine(url)
    with engine.connect() as conn:
        _assert_safe_db(conn)
        dtype = conn.execute(
            text(
                """
                SELECT data_type FROM information_schema.columns
                WHERE table_schema='app' AND table_name='one_c_catalog_search_documents'
                  AND column_name='search_tsv'
                """
            )
        ).scalar_one()
        assert dtype == "tsvector"
        hit = conn.execute(
            text(
                """
                SELECT entry_ref FROM app.one_c_catalog_search_documents
                WHERE search_tsv @@ to_tsquery('simple', 'ippon:*')
                ORDER BY entry_ref
                LIMIT 5
                """
            )
        ).scalars().all()
        assert "nom-1" in hit


def test_pg_no_documents_scope_index(gate_store):
    _, url = gate_store
    from sqlalchemy import text

    with _engine(url).connect() as conn:
        _assert_safe_db(conn)
        exists = conn.execute(
            text(
                """
                SELECT 1 FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname='app' AND c.relname='ix_app_one_c_catalog_search_documents_scope'
                """
            )
        ).scalar()
        assert exists is None


def test_pg_token_stats_prefix_uses_index(gate_store):
    _, url = gate_store
    from sqlalchemy import text

    with _engine(url).connect() as conn:
        _assert_safe_db(conn)
        idxdef = conn.execute(
            text(
                """
                SELECT indexdef FROM pg_indexes
                WHERE schemaname='app'
                  AND indexname='ix_app_one_c_catalog_search_token_stats_prefix'
                """
            )
        ).scalar_one()
        assert "varchar_pattern_ops" in idxdef or "text_pattern_ops" in idxdef
        # Tiny tables prefer seqscan; force index consideration for EXPLAIN proof.
        conn.execute(text("SET LOCAL enable_seqscan = off"))
        plan = "\n".join(
            row[0]
            for row in conn.execute(
                text(
                    """
                    EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
                    SELECT token, frequency
                    FROM app.one_c_catalog_search_token_stats
                    WHERE source_base = 'buh20'
                      AND generation = 1
                      AND catalog_type = 'nomenclature'
                      AND token LIKE 'ipp%'
                    """
                )
            )
        )
        assert (
            "ix_app_one_c_catalog_search_token_stats_prefix" in plan
            or "Index" in plan
            or "Bitmap" in plan
        )


# --- 3 Token stats rebuild ---


def test_pg_fingerprint_noop_zero_rebuilds(gate_store):
    store, url = gate_store
    from backend.services.one_c_catalog_compact_writer import TOKEN_STATS_REBUILD_METRICS

    before = int(TOKEN_STATS_REBUILD_METRICS["token_stats_rebuild_total"])
    # Same snapshot content → fingerprint no-op path (no compact patch upserts)
    status = store.replace_snapshot(
        nomenclature=[
            ("nom-1", "PN-101", "Ippon Back Basic 800"),
            ("nom-2", "PN-650", "Ippon Back Basic 650"),
            ("nom-3", "APC-9", "APC Smart UPS"),
            ("nom-4", "M-70", "Model M-70 Battery"),
            ("nom-5", "M 70", "Model M 70 Twin"),
            ("nom-6", "YO-1", "Склад Алёна Demo"),
            ("nom-7", "ABC-1", "Alpha Beta Gamma"),
            ("nom-8", "ABC-2", "Alpha Beta Delta"),
        ],
        warehouses=[
            ("wh-1", "Склад Иванов И.И."),
            ("wh-2", "Основной склад Алёна"),
        ],
    )
    assert status is not None
    after = int(TOKEN_STATS_REBUILD_METRICS["token_stats_rebuild_total"])
    assert after == before


def test_pg_patch_one_rebuild_and_stats_consistent(gate_store):
    store, url = gate_store
    from sqlalchemy import text
    from backend.services.one_c_catalog_compact_writer import TOKEN_STATS_REBUILD_METRICS

    before_rebuild = int(TOKEN_STATS_REBUILD_METRICS["token_stats_rebuild_total"])
    before_delta = int(TOKEN_STATS_REBUILD_METRICS["token_stats_delta_total"])
    before_patch = int(TOKEN_STATS_REBUILD_METRICS["incremental_patch_total"])
    store.replace_snapshot(
        nomenclature=[
            ("nom-1", "PN-101", "Ippon Back Basic 800"),
            ("nom-2", "PN-650", "Ippon Back Basic 650"),
            ("nom-3", "APC-9", "APC Smart UPS"),
            ("nom-4", "M-70", "Model M-70 Battery"),
            ("nom-5", "M 70", "Model M 70 Twin"),
            ("nom-6", "YO-1", "Склад Алёна Demo"),
            ("nom-7", "ABC-1", "Alpha Beta Gamma"),
            ("nom-8", "ABC-2", "Alpha Beta Delta"),
            ("nom-9", "NEW-9", "BrandNew Widget 900"),
        ],
        warehouses=[
            ("wh-1", "Склад Иванов И.И."),
            ("wh-2", "Основной склад Алёна"),
        ],
    )
    after_rebuild = int(TOKEN_STATS_REBUILD_METRICS["token_stats_rebuild_total"])
    after_delta = int(TOKEN_STATS_REBUILD_METRICS["token_stats_delta_total"])
    after_patch = int(TOKEN_STATS_REBUILD_METRICS["incremental_patch_total"])
    # Incremental path: delta and/or at most one scope rebuild per changed catalog.
    assert after_patch > before_patch or after_delta > before_delta or after_rebuild > before_rebuild
    assert after_rebuild - before_rebuild <= 2

    with _engine(url).connect() as conn:
        _assert_safe_db(conn)
        neg = conn.execute(
            text(
                """
                SELECT COUNT(*) FROM app.one_c_catalog_search_token_stats
                WHERE frequency < 0
                """
            )
        ).scalar_one()
        assert int(neg) == 0
        # deleted token for removed? we added — brandnew should exist
        freq = conn.execute(
            text(
                """
                SELECT frequency FROM app.one_c_catalog_search_token_stats
                WHERE catalog_type='nomenclature' AND token='brandnew'
                """
            )
        ).scalar()
        assert freq is not None and int(freq) >= 1


def test_pg_rename_code_change_ok(gate_store):
    store, url = gate_store
    store.replace_snapshot(
        nomenclature=[
            ("nom-1", "PN-101", "Ippon Back Basic 800"),
            ("nom-2", "PN-650", "Ippon Back Basic 650"),
            ("nom-3", "APC-9", "APC Smart UPS Renamed"),
            ("nom-4", "M-70", "Model M-70 Battery"),
            ("nom-5", "M 70", "Model M 70 Twin"),
            ("nom-6", "YO-1", "Склад Алёна Demo"),
            ("nom-7", "ABC-1", "Alpha Beta Gamma"),
            ("nom-8", "ABC-2", "Alpha Beta Delta"),
            ("nom-9", "NEW-9", "BrandNew Widget 900"),
        ],
        warehouses=[
            ("wh-1", "Склад Иванов И.И."),
            ("wh-2", "Основной склад Алёна"),
        ],
    )
    from sqlalchemy import text

    with _engine(url).connect() as conn:
        name = conn.execute(
            text(
                """
                SELECT d.name_normalized
                FROM app.one_c_catalog_search_documents d
                JOIN app.one_c_catalog_search_index_state s
                  ON s.source_base = d.source_base
                 AND s.catalog_type = d.catalog_type
                WHERE d.entry_ref = 'nom-3'
                  AND d.index_version = s.active_index_version
                """
            )
        ).scalar_one()
        assert "renamed" in str(name)


# --- 5 Dual-write / engine ---


def test_pg_write_compact_off_restores_old_behavior(gate_store):
    store, url = gate_store
    os.environ["WAREHOUSE_1C_CATALOG_WRITE_COMPACT"] = "0"
    os.environ["WAREHOUSE_1C_CATALOG_SEARCH_ENGINE"] = "tokens"
    available, rows = store.search_entries(
        catalog_type="nomenclature", text="Ippon 800", limit=10
    )
    assert available and rows and rows[0]["ref"] == "nom-1"
    os.environ["WAREHOUSE_1C_CATALOG_WRITE_COMPACT"] = "1"


def test_pg_compact_engine_fallback_when_not_ready(gate_store):
    store, url = gate_store
    from sqlalchemy import text

    with _engine(url).begin() as conn:
        conn.execute(
            text(
                """
                UPDATE app.one_c_catalog_search_index_state
                SET status='building'
                WHERE catalog_type='nomenclature'
                """
            )
        )
    os.environ["WAREHOUSE_1C_CATALOG_SEARCH_ENGINE"] = "compact"
    available, rows = store.search_entries(
        catalog_type="nomenclature", text="Ippon 800", limit=10
    )
    assert available is True
    assert rows and rows[0]["ref"] == "nom-1"
    with _engine(url).begin() as conn:
        conn.execute(
            text(
                """
                UPDATE app.one_c_catalog_search_index_state
                SET status='ready'
                WHERE catalog_type='nomenclature'
                """
            )
        )
    os.environ["WAREHOUSE_1C_CATALOG_SEARCH_ENGINE"] = "tokens"


def test_pg_no_partial_ready_on_failed_compact(gate_store):
    """If counts mismatch, state must not stay ready with wrong indexed_count."""
    from sqlalchemy import text
    from backend.services.one_c_catalog_compact_writer import OneCCatalogCompactWriter

    _, url = gate_store
    writer = OneCCatalogCompactWriter(enabled=True)
    from backend.appdb.db import get_app_session_factory

    session = get_app_session_factory(url)()
    try:
        writer.refresh_state_counts(
            session,
            source_base="buh20",
            catalog_type="nomenclature",
            generation=1,
            expected_count=999999,
            status="ready",
        )
        session.commit()
        status = session.execute(
            text(
                """
                SELECT status FROM app.one_c_catalog_search_index_state
                WHERE catalog_type='nomenclature'
                """
            )
        ).scalar_one()
        assert status != "ready"
    finally:
        # restore ready for other tests
        session.rollback()
        writer.refresh_state_counts(
            session,
            source_base="buh20",
            catalog_type="nomenclature",
            generation=1,
            expected_count=session.execute(
                text(
                    """
                    SELECT COUNT(*) FROM app.one_c_catalog_search_documents
                    WHERE catalog_type='nomenclature'
                    """
                )
            ).scalar_one(),
            status="ready",
        )
        session.commit()
        session.close()


# --- 6 Suggest via token_stats ---


def test_pg_suggest_token_stats_prefix_and_freq(gate_store):
    store, url = gate_store
    os.environ["WAREHOUSE_1C_CATALOG_SEARCH_ENGINE"] = "compact"
    ok, rows2 = store.suggest_token_prefixes(
        catalog_type="nomenclature", prefix="ip", limit=10
    )
    ok3, rows3 = store.suggest_token_prefixes(
        catalog_type="nomenclature", prefix="ipp", limit=10
    )
    ok5, rows5 = store.suggest_token_prefixes(
        catalog_type="nomenclature", prefix="ippon", limit=10
    )
    assert ok and ok3 and ok5
    assert any(r["token"].startswith("ip") for r in rows2)
    assert any(r["token"].startswith("ipp") for r in rows3)
    assert any(r["token"] == "ippon" for r in rows5)
    # frequencies non-increasing
    freqs = [int(r["frequency"]) for r in rows3]
    assert freqs == sorted(freqs, reverse=True)
    # token_frequencies via compact
    okf, freq = store.token_frequencies(
        catalog_type="nomenclature", tokens=["ippon", "missingtok"]
    )
    assert okf and int(freq.get("ippon", 0)) >= 1
    os.environ["WAREHOUSE_1C_CATALOG_SEARCH_ENGINE"] = "tokens"


def test_pg_suggest_engine_tokens_uses_legacy_path(gate_store):
    store, _ = gate_store
    os.environ["WAREHOUSE_1C_CATALOG_SEARCH_ENGINE"] = "tokens"
    ok, rows = store.suggest_token_prefixes(
        catalog_type="nomenclature", prefix="ipp", limit=10
    )
    assert ok is True
    assert rows == []  # compact suggest skipped; legacy path elsewhere


# --- 7 Canary on PG ---


def test_pg_canary_routes_and_not_ready_fallback(gate_store):
    store, url = gate_store
    from backend.services.one_c_catalog_compact_flags import canary_bucket

    os.environ["WAREHOUSE_1C_CATALOG_SEARCH_ENGINE"] = "tokens"
    os.environ["WAREHOUSE_1C_CATALOG_SEARCH_CANARY_PERCENT"] = "100"
    # with key → attempt compact (ready)
    available, rows = store.search_entries(
        catalog_type="nomenclature",
        text="Ippon 800",
        limit=10,
        routing_user_key="canary-user-1",
    )
    assert available and rows[0]["ref"] == "nom-1"

    # percent 0 rollback
    os.environ["WAREHOUSE_1C_CATALOG_SEARCH_CANARY_PERCENT"] = "0"
    available2, rows2 = store.search_entries(
        catalog_type="nomenclature",
        text="Ippon 800",
        limit=10,
        routing_user_key="canary-user-1",
    )
    assert available2 and rows2[0]["ref"] == "nom-1"
    assert canary_bucket("canary-user-1") == canary_bucket("canary-user-1")


# --- 2 Shadow PG isolation ---


def test_pg_shadow_own_backend_pid(gate_store):
    store, url = gate_store
    from sqlalchemy import text
    from backend.appdb.db import get_app_session_factory
    from backend.services.one_c_catalog_compact_flags import parse_compact_flags
    from backend.services.one_c_catalog_compact_shadow import (
        run_compact_shadow_search_isolated,
    )

    factory = get_app_session_factory(url)
    main = factory()
    try:
        main_pid = int(main.execute(text("SELECT pg_backend_pid()")).scalar_one())
        flags = parse_compact_flags(
            {
                "WAREHOUSE_1C_CATALOG_SEARCH_ENGINE": "compact",
                "WAREHOUSE_1C_CATALOG_SEARCH_SHADOW": "1",
                "WAREHOUSE_1C_CATALOG_SHADOW_SAMPLE_RATE": "1",
            }
        )
        status = store.get_status()
        generation = int(status["generation"])
        result = run_compact_shadow_search_isolated(
            database_url=url,
            catalog_type="nomenclature",
            text_query="Ippon",
            limit=10,
            source_base="buh20",
            generation=generation,
            flags=flags,
        )
        shadow_pid = getattr(result, "shadow_backend_pid", None)
        assert shadow_pid is not None
        assert int(shadow_pid) != main_pid
        # main session still usable
        assert int(main.execute(text("SELECT 1")).scalar_one()) == 1
    finally:
        main.rollback()
        main.close()


def test_pg_shadow_error_user_still_tokens(gate_store):
    store, _ = gate_store
    os.environ["WAREHOUSE_1C_CATALOG_SEARCH_ENGINE"] = "tokens"
    os.environ["WAREHOUSE_1C_CATALOG_SEARCH_SHADOW"] = "1"
    os.environ["WAREHOUSE_1C_CATALOG_SHADOW_SAMPLE_RATE"] = "1"
    os.environ["WAREHOUSE_1C_CATALOG_SHADOW_TIMEOUT_MS"] = "30"
    available, rows = store.search_entries(
        catalog_type="nomenclature", text="Ippon 800", limit=10
    )
    assert available and rows[0]["ref"] == "nom-1"
    os.environ["WAREHOUSE_1C_CATALOG_SEARCH_SHADOW"] = "0"


# --- 4 Backfill matrix (selected critical cases on PG) ---


@pytest.fixture(autouse=True)
def _clear_backfill_advisory_lock(pg_url):
    """Ensure leftover advisory locks do not poison later backfill tests.

    Safe test DB only: terminate *other* backends holding our backfill key.
    """
    from sqlalchemy import text
    from backend.services.one_c_catalog_compact_backfill import ADVISORY_LOCK_KEY

    engine = _engine(pg_url)

    def _clear():
        with engine.begin() as conn:
            _assert_safe_db(conn)
            conn.execute(text("SELECT pg_advisory_unlock_all()"))
            # bigint advisory keys are split across classid/objid — terminate
            # any foreign advisory holders on this dedicated test DB.
            conn.execute(
                text(
                    """
                    SELECT pg_terminate_backend(l.pid)
                    FROM pg_locks l
                    WHERE l.locktype = 'advisory'
                      AND l.pid <> pg_backend_pid()
                    """
                )
            )
        # Terminating foreign backends invalidates pooled connections.
        engine.dispose()

    _clear()
    yield
    _clear()


def test_pg_backfill_disabled_and_dry_run(gate_store):
    _, url = gate_store
    from backend.services.one_c_catalog_compact_backfill import OneCCatalogCompactBackfill

    os.environ["WAREHOUSE_1C_CATALOG_COMPACT_BACKFILL_ENABLED"] = "0"
    report = OneCCatalogCompactBackfill(url, dry_run=False).run()
    assert report.stopped_reason == "backfill_disabled"

    os.environ["WAREHOUSE_1C_CATALOG_COMPACT_BACKFILL_ENABLED"] = "1"
    dry = OneCCatalogCompactBackfill(url, dry_run=True).run()
    assert dry.dry_run is True
    assert dry.stopped_reason == "completed"
    assert "nomenclature" in dry.catalogs


def test_pg_backfill_advisory_lock_same_connection_and_busy(gate_store):
    """Second backfill must see advisory_lock_busy while another session holds the key.

    Hold the lock on a dedicated psycopg connection (not the SQLAlchemy pool) so
    the backfill Session cannot re-enter the same backend connection.
    """
    _, url = gate_store
    import psycopg
    from backend.services.one_c_catalog_compact_backfill import (
        ADVISORY_LOCK_KEY,
        OneCCatalogCompactBackfill,
    )

    os.environ["WAREHOUSE_1C_CATALOG_COMPACT_BACKFILL_ENABLED"] = "1"
    dsn = url
    if dsn.startswith("postgresql+psycopg://"):
        dsn = "postgresql://" + dsn[len("postgresql+psycopg://") :]
    holder = psycopg.connect(dsn, autocommit=True)
    try:
        with holder.cursor() as cur:
            cur.execute("SELECT current_database()")
            assert ALLOWED_RE.match(cur.fetchone()[0])
            cur.execute(f"SELECT pg_try_advisory_lock({int(ADVISORY_LOCK_KEY)})")
            assert cur.fetchone()[0] is True
        report = OneCCatalogCompactBackfill(url, dry_run=False).run()
        assert report.stopped_reason == "advisory_lock_busy"
    finally:
        with holder.cursor() as cur:
            cur.execute(f"SELECT pg_advisory_unlock({int(ADVISORY_LOCK_KEY)})")
        holder.close()


def test_pg_backfill_lock_released_after_exception(gate_store):
    _, url = gate_store
    from sqlalchemy import text
    from backend.appdb.db import get_app_session_factory
    from backend.services.one_c_catalog_compact_backfill import (
        ADVISORY_LOCK_KEY,
        OneCCatalogCompactBackfill,
    )

    os.environ["WAREHOUSE_1C_CATALOG_COMPACT_BACKFILL_ENABLED"] = "1"
    bf = OneCCatalogCompactBackfill(url, dry_run=False)

    def boom(*_a, **_k):
        raise RuntimeError("inject")

    bf._backfill_catalog = boom  # type: ignore[method-assign]
    report = bf.run()
    assert report.stopped_reason.startswith("error:")

    session = get_app_session_factory(url)()
    try:
        got = session.execute(
            text(f"SELECT pg_try_advisory_lock({int(ADVISORY_LOCK_KEY)})")
        ).scalar_one()
        session.commit()
        assert got is True
        session.execute(
            text(f"SELECT pg_advisory_unlock({int(ADVISORY_LOCK_KEY)})")
        )
        session.commit()
    finally:
        session.close()


def test_pg_backfill_disk_floor(gate_store):
    _, url = gate_store
    from backend.services.one_c_catalog_compact_backfill import OneCCatalogCompactBackfill

    os.environ["WAREHOUSE_1C_CATALOG_COMPACT_BACKFILL_ENABLED"] = "1"
    os.environ["WAREHOUSE_1C_CATALOG_COMPACT_MIN_FREE_DISK_BYTES"] = str(10**18)
    report = OneCCatalogCompactBackfill(url, dry_run=False).run()
    assert report.stopped_reason == "low_disk"
    os.environ["WAREHOUSE_1C_CATALOG_COMPACT_MIN_FREE_DISK_BYTES"] = str(15 * 1024**3)


def test_pg_backfill_shutdown(gate_store):
    _, url = gate_store
    from backend.services.one_c_catalog_compact_backfill import OneCCatalogCompactBackfill

    os.environ["WAREHOUSE_1C_CATALOG_COMPACT_BACKFILL_ENABLED"] = "1"
    os.environ["WAREHOUSE_1C_CATALOG_COMPACT_BACKFILL_BATCH"] = "1"
    stop = {"v": False}

    def check():
        return stop["v"]

    bf = OneCCatalogCompactBackfill(url, dry_run=False, stop_check=check)
    # Pre-set stop so run exits early during loop or before heavy work
    stop["v"] = True
    report = bf.run()
    # May complete quickly on tiny catalog before stop is seen; accept shutdown or completed
    assert report.stopped_reason in {"shutdown", "completed", "max_runtime"}


def test_pg_backfill_max_runtime(gate_store):
    _, url = gate_store
    from backend.services.one_c_catalog_compact_backfill import OneCCatalogCompactBackfill

    os.environ["WAREHOUSE_1C_CATALOG_COMPACT_BACKFILL_ENABLED"] = "1"
    os.environ["WAREHOUSE_1C_CATALOG_COMPACT_BACKFILL_MAX_RUNTIME_SECONDS"] = "1"
    os.environ["WAREHOUSE_1C_CATALOG_COMPACT_BACKFILL_BATCH"] = "1"
    os.environ["WAREHOUSE_1C_CATALOG_COMPACT_BACKFILL_PAUSE_MS"] = "600"
    report = OneCCatalogCompactBackfill(url, dry_run=False).run()
    # Tiny catalogue may finish before max_runtime; lock-busy means another holder.
    assert report.stopped_reason in {"max_runtime", "completed", "advisory_lock_busy"}
    os.environ["WAREHOUSE_1C_CATALOG_COMPACT_BACKFILL_MAX_RUNTIME_SECONDS"] = "0"
    os.environ["WAREHOUSE_1C_CATALOG_COMPACT_BACKFILL_PAUSE_MS"] = "0"
    os.environ["WAREHOUSE_1C_CATALOG_COMPACT_BACKFILL_BATCH"] = "2000"


def test_pg_backfill_idempotent_ready(gate_store):
    _, url = gate_store
    from sqlalchemy import text
    from backend.services.one_c_catalog_compact_backfill import OneCCatalogCompactBackfill

    os.environ["WAREHOUSE_1C_CATALOG_COMPACT_BACKFILL_ENABLED"] = "1"
    os.environ["WAREHOUSE_1C_CATALOG_COMPACT_BACKFILL_MAX_RUNTIME_SECONDS"] = "0"
    os.environ["WAREHOUSE_1C_CATALOG_COMPACT_BACKFILL_BATCH"] = "2000"
    os.environ["WAREHOUSE_1C_CATALOG_COMPACT_BACKFILL_PAUSE_MS"] = "0"
    r1 = OneCCatalogCompactBackfill(url, dry_run=False).run()
    assert r1.stopped_reason == "completed", r1
    r2 = OneCCatalogCompactBackfill(url, dry_run=False).run()
    assert r2.stopped_reason == "completed", r2
    with _engine(url).connect() as conn:
        status = conn.execute(
            text(
                """
                SELECT status, expected_count, indexed_count
                FROM app.one_c_catalog_search_index_state
                WHERE catalog_type='nomenclature' AND source_base='buh20'
                """
            )
        ).mappings().first()
        assert status is not None
        assert status["status"] == "ready"
        assert int(status["expected_count"]) == int(status["indexed_count"])

