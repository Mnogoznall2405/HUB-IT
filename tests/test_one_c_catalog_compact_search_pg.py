"""PostgreSQL integration tests for compact 1C search — SAFE TEST DB ONLY."""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path
from urllib.parse import urlparse, urlunparse, unquote

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
def pg_test_url():
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
def prepared_store(pg_test_url):
    """Create minimal app schema + seed + compact backfill on the test DB."""
    os.environ["APP_DATABASE_URL"] = pg_test_url
    os.environ["WAREHOUSE_1C_CATALOG_WRITE_COMPACT"] = "1"
    os.environ["WAREHOUSE_1C_CATALOG_COMPACT_BACKFILL_ENABLED"] = "1"
    os.environ["WAREHOUSE_1C_CATALOG_SEARCH_ENGINE"] = "tokens"
    os.environ["WAREHOUSE_1C_CATALOG_SEARCH_SHADOW"] = "0"
    os.environ["WAREHOUSE_1C_CATALOG_TYPO_FALLBACK_ENABLED"] = "1"
    os.environ["SKIP_PG_SCHEMA_DOCS"] = "1"

    from backend.appdb.db import get_app_engine
    from sqlalchemy import text

    engine = get_app_engine(pg_test_url)
    with engine.begin() as conn:
        conn.execute(text('CREATE SCHEMA IF NOT EXISTS "app"'))
        conn.execute(text('CREATE SCHEMA IF NOT EXISTS "system"'))
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))

    # Apply only the compact migration DDL via upgrade path for revision 0080,
    # after ensuring base catalogue tables exist (create_all for ORM models).
    from backend.appdb.models import AppBase
    from backend.appdb.db import initialize_app_schema

    # Force create_all for models (dev path) — test DB only.
    initialize_app_schema(pg_test_url, force=True)

    # Ensure tsvector column + GIN indexes from migration semantics.
    with engine.begin() as conn:
        # Convert Text search_tsv to tsvector if create_all used Text.
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
                      USING to_tsvector('simple', coalesce(search_tsv, ''));
                  END IF;
                END $$;
                """
            )
        )
        for stmt in (
            "CREATE INDEX IF NOT EXISTS ix_app_one_c_catalog_search_documents_tsv "
            "ON app.one_c_catalog_search_documents USING gin (search_tsv)",
            "CREATE INDEX IF NOT EXISTS ix_app_one_c_catalog_search_documents_trgm "
            "ON app.one_c_catalog_search_documents USING gin (search_text gin_trgm_ops)",
            "CREATE INDEX IF NOT EXISTS ix_app_one_c_catalog_search_token_stats_trgm "
            "ON app.one_c_catalog_search_token_stats USING gin (token gin_trgm_ops)",
            "CREATE INDEX IF NOT EXISTS ix_app_one_c_catalog_tokens_token_trgm "
            "ON app.one_c_catalog_tokens USING gin (token gin_trgm_ops)",
        ):
            conn.execute(text(stmt))

    from backend.services.one_c_catalog_snapshot_service import OneCCatalogSnapshotStore

    store = OneCCatalogSnapshotStore(pg_test_url, enabled=True)
    # Clean prior test rows for isolation.
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
        ],
        warehouses=[
            ("wh-1", "Склад Иванов И.И."),
            ("wh-2", "Основной склад Алёна"),
        ],
    )
    return store, pg_test_url


def test_pg_dual_write_ready_and_no_array_gin(prepared_store):
    store, url = prepared_store
    from sqlalchemy import text
    from backend.appdb.db import get_app_engine

    engine = get_app_engine(url)
    with engine.connect() as conn:
        states = conn.execute(
            text(
                """
                SELECT catalog_type, status, expected_count, indexed_count
                FROM app.one_c_catalog_search_index_state
                ORDER BY catalog_type
                """
            )
        ).mappings().all()
        assert states
        for row in states:
            assert row["status"] == "ready"
            assert int(row["expected_count"]) == int(row["indexed_count"])

        gin_array = conn.execute(
            text(
                """
                SELECT c.relname
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                JOIN pg_index i ON i.indexrelid = c.oid
                JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
                JOIN pg_type t ON t.oid = a.atttypid
                WHERE n.nspname = 'app'
                  AND c.relkind = 'i'
                  AND t.typname = '_text'
                """
            )
        ).fetchall()
        assert gin_array == []


def test_pg_compact_search_critical_fn_zero(prepared_store):
    store, url = prepared_store
    from backend.services.one_c_catalog_compact_flags import parse_compact_flags
    from backend.services.one_c_catalog_compact_search import OneCCatalogCompactSearch

    status = store.get_status()
    assert status and status["has_snapshot"]
    generation = int(status["generation"])
    flags = parse_compact_flags(
        {
            "WAREHOUSE_1C_CATALOG_SEARCH_ENGINE": "compact",
            "WAREHOUSE_1C_CATALOG_TYPO_FALLBACK_ENABLED": "1",
            "WAREHOUSE_1C_CATALOG_MIDTOKEN_MIN_LENGTH": "3",
        }
    )
    searcher = OneCCatalogCompactSearch(url, flags=flags)

    cases = [
        ("PN-101", {"nom-1"}, "exact_code"),
        ("pn-10", {"nom-1"}, "code_prefix"),
        ("m70", {"nom-4", "nom-5"}, "model"),
        ("m-70", {"nom-4", "nom-5"}, "model"),
        ("Ippon 800", {"nom-1"}, "and"),
        ("ppo", {"nom-1", "nom-2"}, "midtoken"),
        ("алена", {"nom-6"}, "yo"),
    ]
    for query, expected_refs, _label in cases:
        result = searcher.search_entries(
            catalog_type="nomenclature",
            text_query=query,
            limit=20,
            source_base="buh20",
            generation=generation,
        )
        assert result.available and result.ready, (query, result.stage, result.error)
        got = {row["ref"] for row in result.rows}
        missing = expected_refs - got
        assert not missing, f"FN for {query!r}: missing={missing} got={got} stage={result.stage}"


def test_pg_engine_flag_rollback_to_tokens(prepared_store):
    store, _url = prepared_store
    os.environ["WAREHOUSE_1C_CATALOG_SEARCH_ENGINE"] = "tokens"
    available, rows = store.search_entries(
        catalog_type="nomenclature",
        text="Ippon 800",
        limit=20,
    )
    assert available is True
    assert [row["ref"] for row in rows] == ["nom-1"]


def test_pg_compact_not_used_when_not_ready(prepared_store):
    store, url = prepared_store
    from sqlalchemy import text
    from backend.appdb.db import get_app_engine
    from backend.services.one_c_catalog_compact_flags import parse_compact_flags
    from backend.services.one_c_catalog_compact_search import OneCCatalogCompactSearch

    engine = get_app_engine(url)
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                UPDATE app.one_c_catalog_search_index_state
                SET status = 'building'
                WHERE catalog_type = 'nomenclature'
                """
            )
        )
    flags = parse_compact_flags({"WAREHOUSE_1C_CATALOG_SEARCH_ENGINE": "compact"})
    searcher = OneCCatalogCompactSearch(url, flags=flags)
    result = searcher.search_entries(
        catalog_type="nomenclature",
        text_query="Ippon",
        limit=10,
        source_base="buh20",
        generation=1,
    )
    assert result.available is False
    assert result.stage == "not_ready"
    # restore
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                UPDATE app.one_c_catalog_search_index_state
                SET status = 'ready'
                WHERE catalog_type = 'nomenclature'
                """
            )
        )


def test_pg_shadow_never_breaks_tokens(prepared_store):
    store, _url = prepared_store
    os.environ["WAREHOUSE_1C_CATALOG_SEARCH_ENGINE"] = "tokens"
    os.environ["WAREHOUSE_1C_CATALOG_SEARCH_SHADOW"] = "1"
    os.environ["WAREHOUSE_1C_CATALOG_SHADOW_SAMPLE_RATE"] = "1"
    available, rows = store.search_entries(
        catalog_type="nomenclature",
        text="Ippon 800",
        limit=20,
    )
    assert available is True
    assert rows and rows[0]["ref"] == "nom-1"
    os.environ["WAREHOUSE_1C_CATALOG_SEARCH_SHADOW"] = "0"
